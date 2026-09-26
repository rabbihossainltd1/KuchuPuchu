package app.kuchupuchu.android

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * r64 (owner: "e2e system implement kore daw" — calls already verify; now the
 * messages do too): 1:1 message bodies are sealed on the phone and only the
 * two phones can open them. The worker stores and forwards the opaque
 * envelope (the "KP1." prefix marks it) — it never sees plaintext and never
 * holds a private key.
 *
 * Crypto is standard JCA only — P-256 ECDH, HKDF-SHA256 (RFC 5869),
 * AES-256-GCM — so it runs on minSdk 24 with no new dependency and on the
 * JVM unit tests.
 *
 * Honest limits (same class as the call E2EE):
 *  - SOLO chats only: a group would need a group-key protocol (an
 *    architecture change the owner ruled out), so group / AI / official
 *    traffic stays open — those accounts simply carry no key;
 *  - the identity lives in private prefs, not the hardware keystore: a
 *    reinstall changes the key, the peer's safety code changes with it, and
 *    messages sealed to the old key no longer open on the new phone (a lock,
 *    never a crash);
 *  - media BYTES are not encrypted this round — the R2 object stays
 *    token-gated exactly as before; the caption text is sealed with the same
 *    key.
 */
internal object E2eeMsg {
    const val PREFIX = "KP1."
    private const val LOCK = "\uD83D\uDD12"
    private const val PREFS = "kp_e2ee"
    private const val KEY_PRIV = "msg_priv"
    private const val KEY_PUB = "msg_pub"
    private const val INFO = "kp-msg-e2ee-v1"

    @Volatile
    private var identityCache: Pair<String, String>? = null

    /** r76-12: bumped when a roaming identity lands — open chats re-unseal. */
    var restoredNonce by mutableStateOf(0)

    private val publication = E2eePublicationGate()

    // ---------- pure core (JVM-testable, no Android) ----------

    fun newKeyPair(): KeyPair {
        val gen = KeyPairGenerator.getInstance("EC")
        gen.initialize(ECGenParameterSpec("secp256r1"))
        return gen.generateKeyPair()
    }

    fun pubB64(pub: PublicKey): String = Base64.getEncoder().encodeToString(pub.encoded)

    fun privB64(priv: PrivateKey): String = Base64.getEncoder().encodeToString(priv.encoded)

    fun parsePub(b64: String): PublicKey? =
        runCatching {
            val raw = Base64.getDecoder().decode(b64)
            KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(raw))
        }.getOrNull()

    fun parsePriv(b64: String): PrivateKey? =
        runCatching {
            val raw = Base64.getDecoder().decode(b64)
            KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(raw))
        }.getOrNull()

    /** The ECDH shared secret between our private key and the peer's public one. */
    fun ecdhShared(privB64: String, peerPubB64: String): ByteArray? =
        runCatching {
            val priv = parsePriv(privB64) ?: return null
            val pub = parsePub(peerPubB64) ?: return null
            val ka = KeyAgreement.getInstance("ECDH")
            ka.init(priv)
            ka.doPhase(pub, true)
            ka.generateSecret()
        }.getOrNull()

    /** RFC 5869 HKDF-Extract-Expand with SHA-256 (pure JCA, no new deps). */
    fun hkdfSha256(ikm: ByteArray, info: String, length: Int = 32): ByteArray {
        val salt = ByteArray(0) // RFC 5869: an empty salt means all zero bytes
        val prk = hmacSha256(ikm, salt)
        val out = ArrayList<ByteArray>()
        var t = ByteArray(0)
        var block = 1
        while (out.sumOf { it.size } < length) {
            t = hmacSha256(prk, t + info.toByteArray(Charsets.UTF_8) + byteArrayOf(block.toByte()))
            out.add(t)
            block++
        }
        return out.fold(byteArrayOf()) { a, b -> a + b }.copyOf(length)
    }

    private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)

    /** Seal [plain] for the peer: KP1. + base64(12B nonce || AES-GCM ciphertext). */
    fun sealWith(privB64: String, peerPubB64: String, plain: String): String? {
        val shared = ecdhShared(privB64, peerPubB64) ?: return null
        val key = SecretKeySpec(hkdfSha256(shared, INFO), "AES")
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return PREFIX + Base64.getEncoder().encodeToString(nonce + ct)
    }

    /** Open an envelope sealed to us, or null (wrong peer / tampered / not one). */
    fun openWith(privB64: String, peerPubB64: String, envelope: String): String? {
        if (!envelope.startsWith(PREFIX)) return null
        val raw = runCatching { Base64.getDecoder().decode(envelope.removePrefix(PREFIX)) }.getOrNull()
            ?: return null
        if (raw.size < 29) return null // 12 nonce + 16 GCM tag minimum
        val shared = ecdhShared(privB64, peerPubB64) ?: return null
        val key = SecretKeySpec(hkdfSha256(shared, INFO), "AES")
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, raw, 0, 12))
            String(cipher.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        }.getOrNull()
    }

    /** Order-independent safety code — the same shape as the call's. */
    fun safetyCode(myPub: String, peerPub: String): String = E2eeCall.safetyCode(myPub, peerPub)

    fun isEnvelope(s: String): Boolean = s.startsWith(PREFIX)

    // ---------- device identity (Android) ----------

    /**
     * Our stable message identity: generated once per install, then reused —
     * so our public key (and every peer's safety code) is stable across chats
     * and sessions, and peers can TOFU-check it.
     */
    @Synchronized
    fun identity(ctx: Context): Pair<String, String> {
        val cached = identityCache
        if (cached != null) return cached
        val prefs = ctx.getSharedPreferences(PREFS, 0)
        val priv = prefs.getString(KEY_PRIV, null)
        val pub = prefs.getString(KEY_PUB, null)
        if (!priv.isNullOrBlank() && !pub.isNullOrBlank() && parsePriv(priv) != null && parsePub(pub) != null) {
            identityCache = priv to pub
            return priv to pub
        }
        val kp = newKeyPair()
        val p = privB64(kp.private)
        val q = pubB64(kp.public)
        runCatching {
            prefs.edit().putString(KEY_PRIV, p).putString(KEY_PUB, q).apply()
        }
        identityCache = p to q
        return p to q
    }

    fun seal(ctx: Context, plain: String, peerPub: String): String? =
        if (plain.isBlank() || peerPub.isBlank()) null else
            sealWith(identity(ctx).first, peerPub, plain)

    fun open(ctx: Context, envelope: String, peerPub: String): String? =
        if (!isEnvelope(envelope) || peerPub.isBlank()) null else
            openWith(identity(ctx).first, peerPub, envelope)

    /**
     * Seal with the process-cached identity — the forward path runs off a
     * composable (no Context); null until app entry cached it. The transport
     * guard seals any remaining local plaintext before transmission.
     */
    fun sealGlobal(plain: String, peerPub: String): String? =
        if (plain.isBlank() || peerPub.isBlank()) null else
            identityCache?.let { sealWith(it.first, peerPub, plain) }

    /**
     * Open a row without destroying its envelope. A copy is returned only
     * when the displayed body changes; cached envelopes can be retried. A row
     * we cannot open (our key lost on a reinstall, the peer's new device)
     * becomes a bare lock, never ciphertext.
     */
    fun unsealRow(ctx: Context, m: JSONObject, peerPub: String): JSONObject {
        // Keep the wire envelope locally so a late peer-key refresh can retry.
        // Never expose ciphertext, and never destroy the only decryptable copy.
        val b = m.optText("kpEnvelope").ifBlank { m.optText("body") }
        if (!isEnvelope(b)) return m
        val plain = open(ctx, b, peerPub) ?: LOCK
        if (m.optText("body") == plain && m.optText("kpEnvelope") == b) return m
        return JSONObject(m.toString()).put("body", plain).put("kpEnvelope", b)
    }

    // ---------- TOFU (separate namespace from the call's DTLS TOFU) ----------

    /**
     * Trust-on-first-use: stores the peer's public key on first sight and
     * returns true when it DIFFERS (the header shows the changed-code
     * warning; the new key is stored only via [trustPeer], never silently).
     */
    fun checkPeer(ctx: Context, peerId: String, pub: String): Boolean {
        if (peerId.isBlank() || pub.isBlank()) return false
        val prefs = ctx.getSharedPreferences(PREFS, 0)
        val key = "msgpeer_$peerId"
        val prev = prefs.getString(key, null)
        if (prev.isNullOrBlank()) {
            runCatching { prefs.edit().putString(key, pub).apply() }
            return false
        }
        return prev != pub
    }

    /** The user compared codes aloud and accepts the peer's new key. */
    fun trustPeer(ctx: Context, peerId: String, pub: String) {
        if (peerId.isBlank() || pub.isBlank()) return
        runCatching {
            ctx.getSharedPreferences(PREFS, 0).edit().putString("msgpeer_$peerId", pub).apply()
        }
    }

    // ---------- key publication ----------

    /** App entry retries failures; success is scoped to the authenticated token. */
    suspend fun ensureOnce(ctx: Context): Boolean =
        withContext(Dispatchers.IO) { ensurePublished(ctx) }

    private fun ensurePublished(ctx: Context): Boolean {
        val session = Api.token.orEmpty()
        return publication.ensure(session, { Api.token == session }) {
            // r76-12: restore (or back up) the roaming identity BEFORE reading
            // ours — a fresh install must not mint a key over its history.
            restoreRoaming(ctx)
            val pub = identity(ctx).second
            // Do not use the offline GET cache as a server acknowledgement.
            val me = Api.request("/api/me", "GET", null).optJSONObject("user")
                ?: return@ensure false
            if (Api.token != session) return@ensure false
            if (me.optText("e2eePublicKey") != pub) {
                Api.patch("/api/me", JSONObject().put("e2eePublicKey", pub))
            }
            true
        }
    }

    // ---------- r76-12: roaming identity (owner: history on a new phone) ----------

    private fun encodeBackup(priv: String, pub: String): String =
        Base64.getEncoder()
            .encodeToString(
                JSONObject().put("p", priv).put("u", pub).toString().toByteArray(Charsets.UTF_8),
            )

    /** Restore the backed-up pair when we have none; back ours up when the
     *  server lacks one. Runs on the caller's IO thread (ensurePublished). */
    private fun restoreRoaming(ctx: Context): Boolean =
        runCatching {
            val prefs = ctx.getSharedPreferences(PREFS, 0)
            val priv = prefs.getString(KEY_PRIV, null).orEmpty()
            val pub = prefs.getString(KEY_PUB, null).orEmpty()
            val remote = Api.request("/api/e2ee/backup", "GET", null).optText("backup")
            if (priv.isBlank() || pub.isBlank()) {
                if (remote.isNotBlank()) {
                    val j = JSONObject(String(Base64.getDecoder().decode(remote), Charsets.UTF_8))
                    val rp = j.optText("p")
                    val ru = j.optText("u")
                    if (parsePriv(rp) != null && parsePub(ru) != null) {
                        prefs.edit().putString(KEY_PRIV, rp).putString(KEY_PUB, ru).apply()
                        identityCache = rp to ru
                        restoredNonce++
                        return@runCatching true
                    }
                }
                // First device ever: mint, then back up for the next phone.
                identity(ctx)
                return@runCatching backupLocal(ctx)
            }
            if (remote.isBlank()) return@runCatching backupLocal(ctx)
            true
        }.getOrDefault(false)

    private fun backupLocal(ctx: Context): Boolean =
        runCatching {
            val prefs = ctx.getSharedPreferences(PREFS, 0)
            val priv = prefs.getString(KEY_PRIV, null).orEmpty()
            val pub = prefs.getString(KEY_PUB, null).orEmpty()
            if (priv.isBlank() || pub.isBlank()) return@runCatching false
            Api.request("/api/e2ee/backup", "PUT", JSONObject().put("backup", encodeBackup(priv, pub)))
            true
        }.getOrDefault(false)

    /**
     * The final transport guard covers outbox, schedules, forwards, external
     * shares, status replies and notification replies. Optimistic local rows
     * may be plaintext; a personal text/caption may NEVER leave that way.
     * This runs on the caller's IO thread, never in a composable callback.
     */
    fun prepareOutgoing(ctx: Context?, path: String, method: String, body: JSONObject?): JSONObject? {
        if (body == null || body.optText("body").isBlank()) return body
        val route = path.removePrefix(Api.BASE).substringBefore('?')
        val send = method == "POST" && Regex("^/api/conversations/[^/]+/messages$").matches(route)
        val edit = method == "PATCH" && Regex("^/api/messages/[^/]+$").matches(route)
        if (!send && !edit) return body
        if (send && !E2eeSendPolicy.protectsKind(body.optText("kind"))) return body
        val convId = if (send) route.removePrefix("/api/conversations/").removeSuffix("/messages")
            else body.optText("conversationId")
        if (convId.isBlank()) throw ApiException(503, "Waiting for secure chat.")
        val detailPath = "/api/conversations/$convId"
        var conv = Cache.peek(detailPath)?.optJSONObject("conversation")
        fun known(c: JSONObject?): Boolean = c != null && c.has("isGroup") &&
            (c.optBoolean("isGroup") || c.optJSONObject("other")?.optText("id").orEmpty().isNotBlank())
        fun personal(c: JSONObject): Boolean = !c.optBoolean("isGroup") &&
            !isKpBot(c.optJSONObject("other")?.optText("id").orEmpty())
        fun peerKey(c: JSONObject): String = c.optJSONObject("other")?.optText("e2eePublicKey").orEmpty()
        if (!known(conv) || (conv != null && personal(conv) && parsePub(peerKey(conv)) == null)) {
            // A missing/stale key must be re-fetched, never converted to open chat.
            val data = Api.request(detailPath, "GET", null)
            Cache.put(detailPath, data)
            conv = data.optJSONObject("conversation")
        }
        val target = conv?.takeIf { known(it) } ?: throw ApiException(503, "Waiting for secure chat.")
        val isPersonal = personal(target)
        val key = peerKey(target)
        val ready = !isPersonal || (ctx != null && parsePub(key) != null && ensurePublished(ctx))
        val sealed = try {
            E2eeSendPolicy.protectBody(
                body.optText("body"), isPersonal, ready,
            ) { plain -> ctx?.let { seal(it, plain, key) } }
        } catch (_: Exception) {
            // Retryable: the existing outbox keeps the message and retries.
            throw ApiException(503, "Waiting for secure chat.")
        }
        return JSONObject(body.toString()).put("body", sealed).also {
            if (edit) it.remove("conversationId")
        }
    }

}

/**
 * r64/r66: the scrolling thread-start line, also used in the profile; the twin of the call's
 * E2eeCodeRow. The code stays hidden — the line reads plain "End-to-end
 * encrypted" until tapped. A tap swaps the code in for 3 s (then it hides
 * itself); a tap while the code shows opens the verify sheet; the
 * changed-key warning opens the sheet at once.
 */
@Composable
internal fun E2eeMsgCodeRow(ctx: Context, peerId: String, peerPub: String, peerName: String) {
    if (peerId.isBlank() || peerPub.isBlank()) return
    var showSheet by remember(peerId) { mutableStateOf(false) }
    var codeVisible by remember(peerId) { mutableStateOf(false) }
    val warn by remember(peerId, peerPub) { mutableStateOf(E2eeMsg.checkPeer(ctx, peerId, peerPub)) }
    val code = remember(peerPub) { E2eeMsg.safetyCode(E2eeMsg.identity(ctx).second, peerPub) }
    LaunchedEffect(codeVisible, peerId) {
        if (codeVisible) {
            delay(3_000)
            codeVisible = false
        }
    }
    Row(
        Modifier.clickable {
            if (warn || codeVisible) showSheet = true else codeVisible = true
        },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Filled.Lock,
            "End-to-end encrypted",
            tint = if (warn) Red else Muted,
            modifier = Modifier.size(11.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            if (warn) "Security code changed — tap to verify" else if (codeVisible) code else "End-to-end encrypted",
            color = if (warn) Red else Muted,
            fontSize = 11.5.sp,
            fontWeight = if (warn) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
        )
    }
    if (showSheet) E2eeMsgVerifySheet(ctx, peerId, peerPub, peerName, code, warn) { showSheet = false }
}

@Composable
private fun E2eeMsgVerifySheet(
    ctx: Context,
    peerId: String,
    peerPub: String,
    peerName: String,
    code: String,
    warn: Boolean,
    onClose: () -> Unit,
) {
    KpSheet(onDismiss = onClose, title = "End-to-end encrypted") {
        Text(
            "Nobody — not even KuchuPuchu — can read these messages. Read this code aloud with $peerName: if it matches on both phones, no one is in the middle.",
            color = Muted,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Text(
            code,
            color = Ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
        if (warn) {
            Text(
                "This code differs from your last one — $peerName may have reinstalled, or someone may be intercepting. Only trust it after comparing aloud.",
                color = Red,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
            )
            KpSheetRow(Icons.Filled.Check, "Trust this new code") {
                E2eeMsg.trustPeer(ctx, peerId, peerPub)
                onClose()
            }
        }
        KpSheetRow(Icons.Filled.ContentCopy, "Copy code") {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("KuchuPuchu", code))
            onClose()
        }
        KpSheetRow(Icons.Filled.Close, "Close", onClick = onClose)
    }
}
