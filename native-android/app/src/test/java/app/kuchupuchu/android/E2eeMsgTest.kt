package app.kuchupuchu.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * r64: the message E2EE core on the plain JVM (no Android, no Context) — the
 * crypto is JCA only, so a phone build and a unit test exercise the SAME
 * functions. What a meddler can and cannot do:
 *  - A and B each seal for the other; both directions open;
 *  - a stranger's key opens nothing (null — the UI shows a neutral failure label, never bytes);
 *  - a tampered envelope fails the GCM tag (null);
 *  - the safety code is order-independent and differs per key pair.
 */
class E2eeMsgTest {

    private fun pair(a: java.security.KeyPair, b: java.security.KeyPair) =
        Triple(E2eeMsg.privB64(a.private), E2eeMsg.pubB64(a.public), E2eeMsg.pubB64(b.public))

    @Test
    fun `seal and open round-trip in both directions`() {
        val a = E2eeMsg.newKeyPair()
        val b = E2eeMsg.newKeyPair()
        val (aPriv, aPub, bPub) = pair(a, b)
        val bPriv = E2eeMsg.privB64(b.private)

        val env = E2eeMsg.sealWith(aPriv, bPub, "hello খুচুখু 🚀")
        assertNotNull(env)
        val sealed = env!!
        assertTrue(sealed.startsWith("KP1."))
        assertNotEquals("hello খুচুখু 🚀", sealed) // the envelope is NOT the plaintext
        assertEquals("hello খুচুখু 🚀", E2eeMsg.openWith(bPriv, aPub, sealed))

        // B seals back the same way — same algorithm, fresh nonce each time.
        val back = E2eeMsg.sealWith(bPriv, aPub, "proti uttor")!!
        assertEquals("proti uttor", E2eeMsg.openWith(aPriv, bPub, back))
        assertNotEquals(sealed, back) // even the same plaintext seals differently
    }

    @Test
    fun `a stranger's key opens nothing`() {
        val a = E2eeMsg.newKeyPair()
        val b = E2eeMsg.newKeyPair()
        val c = E2eeMsg.newKeyPair()
        val aPriv = E2eeMsg.privB64(a.private)
        val bPub = E2eeMsg.pubB64(b.public)
        val cPriv = E2eeMsg.privB64(c.private)

        val env = E2eeMsg.sealWith(aPriv, bPub, "secret")!!
        assertNull(E2eeMsg.openWith(cPriv, bPub, env)) // C has no share of A-B's secret
    }

    @Test
    fun `a tampered envelope fails the GCM tag`() {
        val a = E2eeMsg.newKeyPair()
        val b = E2eeMsg.newKeyPair()
        val aPriv = E2eeMsg.privB64(a.private)
        val aPub = E2eeMsg.pubB64(a.public)
        val bPriv = E2eeMsg.privB64(b.private)

        val env = E2eeMsg.sealWith(aPriv, E2eeMsg.pubB64(b.public), "tamper me")!!
        val b64 = env.removePrefix("KP1.")
        val flipped = if (b64[10] == 'A') "KP1." + (b64.replaceRange(10, 11, "B")) else "KP1." + (b64.replaceRange(10, 11, "A"))
        assertNull(E2eeMsg.openWith(bPriv, aPub, flipped))
        // Not-an-envelope bodies pass straight through (plain chats).
        assertNull(E2eeMsg.openWith(bPriv, aPub, "just a plain message"))
    }

    @Test
    fun `a full-length message round-trips`() {
        val a = E2eeMsg.newKeyPair()
        val b = E2eeMsg.newKeyPair()
        val aPriv = E2eeMsg.privB64(a.private)
        val aPub = E2eeMsg.pubB64(a.public)
        val bPriv = E2eeMsg.privB64(b.private)
        val plain = "A".repeat(4000) // the worker's MESSAGE_MAX_LENGTH
        val env = E2eeMsg.sealWith(aPriv, E2eeMsg.pubB64(b.public), plain)!!
        assertEquals(plain, E2eeMsg.openWith(bPriv, aPub, env))
        // base64 stretches 4000 bytes to 5336 chars + the 4-char prefix —
        // inside the worker's 8000-char envelope headroom.
        assertTrue(env.length <= 8000)
    }

    @Test
    fun `full-length Bengali is 16044 envelope characters and round-trips`() {
        val a = E2eeMsg.newKeyPair()
        val b = E2eeMsg.newKeyPair()
        val plain = "\u0985".repeat(4000)
        val envelope = E2eeMsg.sealWith(E2eeMsg.privB64(a.private), E2eeMsg.pubB64(b.public), plain)!!
        assertEquals(16044, envelope.length)
        assertEquals(plain, E2eeMsg.openWith(E2eeMsg.privB64(b.private), E2eeMsg.pubB64(a.public), envelope))
    }

    @Test
    fun `hkdf is deterministic and sized`() {
        val ikm = "input-key-material".toByteArray()
        val k1 = E2eeMsg.hkdfSha256(ikm, "kp-msg-e2ee-v1")
        val k2 = E2eeMsg.hkdfSha256(ikm, "kp-msg-e2ee-v1")
        assertArrayEquals(k1, k2)
        assertEquals(32, k1.size)
        assertFalse(java.util.Arrays.equals(k1, E2eeMsg.hkdfSha256(ikm, "other-info")))
        assertEquals(16, E2eeMsg.hkdfSha256(ikm, "x", 16).size)
    }

    @Test
    fun `safety code is order-independent and pair-specific`() {
        val a = E2eeMsg.newKeyPair()
        val b = E2eeMsg.newKeyPair()
        val c = E2eeMsg.newKeyPair()
        val aPub = E2eeMsg.pubB64(a.public)
        val bPub = E2eeMsg.pubB64(b.public)
        val cPub = E2eeMsg.pubB64(c.public)

        assertEquals(E2eeMsg.safetyCode(aPub, bPub), E2eeMsg.safetyCode(bPub, aPub))
        assertNotEquals(E2eeMsg.safetyCode(aPub, bPub), E2eeMsg.safetyCode(aPub, cPub))
        // The same shape as the call's: "XXXX XXXX XXXX".
        assertEquals(3, E2eeMsg.safetyCode(aPub, bPub).split(" ").size)
    }

    @Test
    fun `key encodings round-trip`() {
        val kp = E2eeMsg.newKeyPair()
        val pub = E2eeMsg.pubB64(kp.public)
        val priv = E2eeMsg.privB64(kp.private)
        assertNotNull(E2eeMsg.parsePub(pub))
        assertNotNull(E2eeMsg.parsePriv(priv))
        assertArrayEquals(kp.public.encoded, E2eeMsg.parsePub(pub)!!.encoded)
        assertNull(E2eeMsg.parsePub("not::base64::keys"))
        assertNull(E2eeMsg.parsePub(priv)) // a private key is not a public one
    }

    // r76-26 (owner: "logout kore app delete kore abar install korle ... lock
    // emoji dekhai"; WhatsApp-style passphrase, the owner's pick): the backup
    // blob seals the identity under the passphrase — the right passphrase
    // opens it, a wrong one gets nothing, and a legacy plaintext blob is not
    // a KP2 blob.
    @Test
    fun `passphrase backup seals and opens the identity`() {
        val kp = E2eeMsg.newKeyPair()
        val priv = E2eeMsg.privB64(kp.private)
        val pub = E2eeMsg.pubB64(kp.public)
        val blob = E2eeMsg.packBackup(priv, pub, "amar-pass-123")
        assertTrue(blob.startsWith("KP2."))
        assertFalse(blob.contains(priv)) // the server sees ciphertext only
        assertFalse(blob.contains(pub))
        val back = E2eeMsg.unpackBackup(blob, "amar-pass-123")
        assertNotNull(back)
        assertEquals(priv, back!!.first)
        assertEquals(pub, back.second)
    }

    @Test
    fun `passphrase backup rejects a wrong passphrase and a legacy blob`() {
        val kp = E2eeMsg.newKeyPair()
        val priv = E2eeMsg.privB64(kp.private)
        val pub = E2eeMsg.pubB64(kp.public)
        val blob = E2eeMsg.packBackup(priv, pub, "right-horse")
        assertNull(E2eeMsg.unpackBackup(blob, "wrong-horse"))
        assertNull(E2eeMsg.unpackBackup(blob, ""))
        // A tampered blob fails the GCM tag; a pre-r76-26 plaintext blob is
        // not KP2 and never opens through the passphrase path.
        assertNull(E2eeMsg.unpackBackup(blob.dropLast(2) + "AA", "right-horse"))
        val legacy = java.util.Base64.getEncoder().encodeToString("{\"p\":\"x\",\"u\":\"y\"}".toByteArray())
        assertNull(E2eeMsg.unpackBackup(legacy, "right-horse"))
    }

    @Test
    fun `passphrase backup salt is random — two packs of one identity differ`() {
        val kp = E2eeMsg.newKeyPair()
        val priv = E2eeMsg.privB64(kp.private)
        val pub = E2eeMsg.pubB64(kp.public)
        val one = E2eeMsg.packBackup(priv, pub, "same-pass")
        val two = E2eeMsg.packBackup(priv, pub, "same-pass")
        assertNotEquals(one, two)
        assertEquals(priv, E2eeMsg.unpackBackup(two, "same-pass")!!.first)
    }

    @Test
    fun `legacy backup is import-only and validates both keys before migration`() {
        val kp = E2eeMsg.newKeyPair()
        val priv = E2eeMsg.privB64(kp.private)
        val pub = E2eeMsg.pubB64(kp.public)
        val legacy = java.util.Base64.getEncoder().encodeToString(
            org.json.JSONObject().put("p", priv).put("u", pub).toString().toByteArray(),
        )
        val decoded = E2eeMsg.decodeLegacyBackup(legacy)
        assertEquals(priv, decoded?.first)
        assertEquals(pub, decoded?.second)
        assertNull(E2eeMsg.decodeLegacyBackup("not-base64"))
        assertNull(E2eeMsg.decodeLegacyBackup("KP2.a.b.c"))
    }
}
