package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class OriginRealmBadgeTest {
    @Test
    fun onlyForeignVxAccountsGetArtworkInsideKp() {
        assertTrue(isCrossRealmBadge("vx"))
        assertFalse(isCrossRealmBadge("kp"))
        assertFalse(isCrossRealmBadge(null))
        assertFalse(isCrossRealmBadge("unknown"))
    }

    @Test
    fun originIsKnownServerRealmOnly() {
        assertEquals("kp", originRealmOf("kp"))
        assertEquals("vx", originRealmOf("VX"))
        assertNull(originRealmOf(null))
        assertNull(originRealmOf(""))
        assertNull(originRealmOf("unknown"))
        assertNull(originRealmOf("kp-user-name"))
    }
}
