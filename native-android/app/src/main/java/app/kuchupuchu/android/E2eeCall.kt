package app.kuchupuchu.android

import android.content.Context
import android.content.SharedPreferences
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.webrtc.RtcCertificatePem

/**
 * E4 (calls-only E2EE verification — message E2EE deferred by owner call):
 * call media is DTLS-SRTP (inherently encrypted), but nothing verified WHOSE
 * key the peer connection used: the SDP is server-relayed, so a meddler
 * swapping it would own the media silently. This closes that gap with a
 * stable DTLS identity + per-call safety codes + trust-on-first-use, all
 * computed locally — zero added call latency (no network, no media-path
 * touch; the whole check is a string parse, one SHA-256 and one prefs read).
 *
 * Honest limits: group calls show no code (per-peer pcs are not modelled
 * here yet); the identity lives in private prefs, not the hardware keystore.
 */
internal object E2eeCall {
    private const val PREFS = "kp_e2ee"
    private const val KEY_PRIV = "dtls_priv"
    private const val KEY_CERT = "dtls_cert"

    /**
     * Our stable DTLS identity: generated once per install, then reused, so
     * our fingerprint is the same on every call and peers can TOFU-check it.
     * (A fresh cert per call would make every peer look "changed".)
     */
    fun identity(ctx: Context): RtcCertificatePem {
        val prefs = ctx.getSharedPreferences(PREFS, 0)
        val priv = prefs.getString(KEY_PRIV, null)
        val cert = prefs.getString(KEY_CERT, null)
        if (!priv.isNullOrBlank() && !cert.isNullOrBlank()) {
            runCatching { return RtcCertificatePem(priv, cert) }
        }
        return fresh(prefs)
    }

    private fun fresh(prefs: SharedPreferences): RtcCertificatePem {
        val pem = RtcCertificatePem.generateCertificate()
        runCatching {
            prefs.edit().putString(KEY_PRIV, pem.privateKey).putString(KEY_CERT, pem.certificate).apply()
        }
        return pem
    }

    /**
     * The SHA-256 DTLS fingerprint hex out of an SDP description (uppercased,
     * colonless), or null when the SDP carries none.
     */
    fun fingerprint(sdp: String?): String? {
        if (sdp.isNullOrBlank()) return null
        val line = sdp.lineSequence().firstOrNull { it.contains("fingerprint:", ignoreCase = true) } ?: return null
        val hex = line.trim().split(Regex("\\s+")).lastOrNull()?.replace(":", "").orEmpty().uppercase()
        if (hex.length < 40 || !hex.all { it in '0'..'9' || it in 'A'..'F' }) return null
        return hex
    }

    /**
     * Order-independent safety code: both ends feed the same two fingerprints
     * and read the same "XXXX XXXX XXXX" to compare aloud.
     */
    fun safetyCode(fpA: String, fpB: String): String {
        val (lo, hi) = if (fpA <= fpB) fpA to fpB else fpB to fpA
        return sha256Hex(lo + hi).take(12).uppercase().chunked(4).joinToString(" ")
    }

    fun sha256Hex(s: String): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(s.toByteArray())
            .joinToString("") { "%02x".format(it) }

    /**
     * Trust-on-first-use: stores the peer's fingerprint on first sight and
     * returns true when it DIFFERS (the caller shows the changed-code
     * warning; the new print is stored only via [trustPeer], never silently).
     */
    fun checkPeer(ctx: Context, peerId: String, fp: String): Boolean {
        if (peerId.isBlank() || fp.isBlank()) return false
        val prefs = ctx.getSharedPreferences(PREFS, 0)
        val key = "peer_$peerId"
        val prev = prefs.getString(key, null)
        if (prev.isNullOrBlank()) {
            runCatching { prefs.edit().putString(key, fp).apply() }
            return false
        }
        return prev != fp
    }

    /** The user compared codes aloud and accepts the peer's new fingerprint. */
    fun trustPeer(ctx: Context, peerId: String, fp: String) {
        if (peerId.isBlank() || fp.isBlank()) return
        runCatching { ctx.getSharedPreferences(PREFS, 0).edit().putString("peer_$peerId", fp).apply() }
    }
}

/**
 * E4: the lock line under the call status — tap for the verify sheet. Groups
 * and pre-ACTIVE calls have no code and show nothing (never claim it).
 * E4f: the code stays HIDDEN — the line reads plain "End-to-end encrypted"
 * until tapped. A tap swaps the code in for 3 s (then it hides itself); a tap
 * while the code shows opens the verify sheet (the ceremony stays one tap
 * away). The code-changed warning still opens the sheet at once.
 */
@Composable
internal fun E2eeCodeRow(call: CallUi, compact: Boolean = false) {
    if (call.group || call.e2eeCode.isBlank()) return
    var showSheet by remember(call.id) { mutableStateOf(false) }
    var codeVisible by remember(call.id) { mutableStateOf(false) }
    val warn = call.e2eeChanged
    LaunchedEffect(codeVisible, call.id) {
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
            tint = if (warn) Red else Color(0xB3FFFFFF),
            modifier = Modifier.size(if (compact) 11.dp else 13.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            if (warn) "Security code changed — tap to verify" else if (codeVisible) call.e2eeCode else "End-to-end encrypted",
            color = if (warn) Red else Color(0xB3FFFFFF),
            fontSize = if (compact) 11.sp else 12.5.sp,
            fontWeight = if (warn) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
    if (showSheet) E2eeVerifySheet(call) { showSheet = false }
}

@Composable
private fun E2eeVerifySheet(call: CallUi, onClose: () -> Unit) {
    val ctx = LocalContext.current
    KpSheet(onDismiss = onClose, title = "End-to-end encrypted") {
        Text(
            "Nobody — not even KuchuPuchu — can listen to this call. Read this code aloud with ${call.otherName}: if it matches on both phones, no one is in the middle.",
            color = Muted,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Text(
            call.e2eeCode,
            color = Ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
        if (call.e2eeChanged) {
            Text(
                "This code differs from your last call — ${call.otherName} may have reinstalled, or someone may be intercepting. Only trust it after comparing aloud.",
                color = Red,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
            )
            KpSheetRow(Icons.Filled.Check, "Trust this new code") {
                CallEngine.instance?.trustE2eePeer()
                onClose()
            }
        }
        KpSheetRow(Icons.Filled.ContentCopy, "Copy code") {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("KuchuPuchu", call.e2eeCode))
            onClose()
        }
        KpSheetRow(Icons.Filled.Close, "Close", onClick = onClose)
    }
}
