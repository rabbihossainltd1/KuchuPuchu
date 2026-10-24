package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OriginRealmBadgeTest {
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
