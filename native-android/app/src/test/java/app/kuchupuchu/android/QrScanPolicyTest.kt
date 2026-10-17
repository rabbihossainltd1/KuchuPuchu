package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase R9: the two deep-link shapes a scanned KuchuPuchu QR code can carry —
 * a profile's share code and the Web login handshake — plus everything that
 * must fall back to "not a KuchuPuchu code" rather than crash or half-parse.
 */
class QrScanPolicyTest {
    @Test
    fun `a profile share code resolves to its bare code`() {
        val action = parseQrScan("kuchupuchu://user/ab12cd34")
        assertTrue(action is QrScanAction.UserProfile)
        assertEquals("ab12cd34", (action as QrScanAction.UserProfile).code)
    }

    @Test
    fun `a web login code resolves to its bare token`() {
        val action = parseQrScan("kuchupuchu://weblogin/tok_9f8e7d")
        assertTrue(action is QrScanAction.WebLogin)
        assertEquals("tok_9f8e7d", (action as QrScanAction.WebLogin).token)
    }

    @Test
    fun `surrounding whitespace from a camera read does not break either shape`() {
        assertEquals(
            QrScanAction.UserProfile("abc123"),
            parseQrScan("  kuchupuchu://user/abc123  "),
        )
        assertEquals(
            QrScanAction.WebLogin("tok1"),
            parseQrScan("\nkuchupuchu://weblogin/tok1\n"),
        )
    }

    @Test
    fun `an empty code or token after the prefix is invalid, not a crash`() {
        assertEquals(QrScanAction.Invalid, parseQrScan("kuchupuchu://user/"))
        assertEquals(QrScanAction.Invalid, parseQrScan("kuchupuchu://weblogin/"))
        assertEquals(QrScanAction.Invalid, parseQrScan("kuchupuchu://user/   "))
    }

    @Test
    fun `null, blank, and a stranger's QR code are all invalid`() {
        for (raw in listOf(null, "", "   ", "https://example.com", "kuchupuchu://group/abc", "just text")) {
            assertEquals("input <$raw>", QrScanAction.Invalid, parseQrScan(raw))
        }
    }
}
