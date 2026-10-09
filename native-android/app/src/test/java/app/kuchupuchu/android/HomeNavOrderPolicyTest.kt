package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeNavOrderPolicyTest {
    @Test
    fun invalidOrPartialOrderFallsBackToAllFourDefaults() {
        assertEquals(HomeNavOrderPolicy.defaultOrder, HomeNavOrderPolicy.normalize(null))
        assertEquals(HomeNavOrderPolicy.defaultOrder, HomeNavOrderPolicy.normalize(listOf("chats", "status")))
        assertEquals(
            HomeNavOrderPolicy.defaultOrder,
            HomeNavOrderPolicy.normalize(listOf("chats", "chats", "calls", "profile")),
        )
    }

    @Test
    fun reorderMovesTheSelectedTabAndKeepsEveryItemOnce() {
        val start = HomeNavOrderPolicy.defaultOrder
        assertEquals(
            listOf("calls", "chats", "status", "profile"),
            HomeNavOrderPolicy.move(start, "calls", 0),
        )
        assertEquals(
            listOf("chats", "status", "profile", "calls"),
            HomeNavOrderPolicy.move(start, "calls", 3),
        )
        assertEquals(start, HomeNavOrderPolicy.move(start, "missing", 2))
        assertEquals(start, HomeNavOrderPolicy.move(start, "chats", 0))
    }
}
