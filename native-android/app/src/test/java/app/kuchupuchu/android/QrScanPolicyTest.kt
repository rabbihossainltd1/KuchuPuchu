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

    // Owner 2026-10-26 (item 6): the VX profile link scans to a VX handle,
    // never to a KP one — the two resolve through different lookups.
    @Test
    fun `a vintoxbd profile link resolves to a vx handle`() {
        assertEquals(
            QrScanAction.VxUserHandle("rabbihossainltd"),
            parseQrScan("https://vintoxbd.online/@rabbihossainltd"),
        )
        assertEquals(
            QrScanAction.VxUserHandle("rabbihossainltd"),
            parseQrScan("https://vintoxbd.online/@RabbiHossainLTD/?ref=qr"),
        )
    }

    // Owner round 120 (2026-10-21): the QR payload IS the public share link
    // (https://kuchupuchu.web.app/@handle) — the in-app scanner must read its
    // own new codes, and the variants a camera/user can realistically produce.
    @Test
    fun `a share link resolves to its handle`() {
        assertEquals(
            QrScanAction.UserHandle("rabbihossainltd"),
            parseQrScan("https://kuchupuchu.web.app/@rabbihossainltd"),
        )
        assertEquals(
            QrScanAction.UserHandle("rabbihossainltd"),
            parseQrScan("https://kuchupuchu.web.app/@rabbihossainltd/"),
        )
        assertEquals(
            QrScanAction.UserHandle("rabbihossainltd"),
            parseQrScan("  https://kuchupuchu.firebaseapp.com/@rabbihossainltd  "),
        )
        assertEquals(
            QrScanAction.UserHandle("team_final_9"),
            parseQrScan("https://kuchupuchu.web.app/@TEAM_FINAL_9"),
        )
    }

    @Test
    fun `a malformed or off-host link is invalid, never a half-parsed handle`() {
        for (
            raw in listOf(
                "https://kuchupuchu.web.app/",
                "https://kuchupuchu.web.app/@",
                "https://kuchupuchu.web.app/@ab",
                "https://kuchupuchu.web.app/@a b",
                "https://kuchupuchu.web.app/@alice/friends",
                "https://notkuchupuchu.web.app/@alice",
                "https://kuchupuchu.web.app.evil.tld/@alice",
                "https://kuchupuchu.web.app/settings/@alice",
            )
        ) {
            assertEquals("input <$raw>", QrScanAction.Invalid, parseQrScan(raw))
        }
        assertEquals(QrScanAction.UserHandle("rabbi"), parseQrScan("https://kuchupuchu.web.app/@rabbi"))
        // A harmless-looking query on a good link: the handle still parses, the
        // scam parameter never reaches the resolver.
        assertEquals(
            QrScanAction.UserHandle("rabbi"),
            parseQrScan("https://kuchupuchu.web.app/@rabbi?utm=print"),
        )
    }
}
