package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * §48 (notification ID generation + cancellation rules). The point of these tests is
 * the ONE property the shipping bug broke: the id a card is posted under must be the
 * id the action buttons cancel — computed by the same function, not by two
 * expressions that happen to look alike.
 */
class NotifyIdsTest {
    /** Real shape: `crypto.randomUUID()` from the worker, so `String.hashCode()` is
     *  effectively uniform — about half of these are negative. */
    private val ids =
        listOf(
            "a90f445e-1e0d-4724-b51a-62eaf48f231b",
            "3f2a1c00-1111-4222-8333-444455556666",
            "00000000-0000-4000-8000-000000000000",
            "ffffffff-ffff-4fff-afff-ffffffffffff",
            "7c1b0e44-9d3a-4a1e-9b0f-0a1b2c3d4e5f",
        )

    @Test
    fun `post id and cancel id are the same number`() {
        for (id in ids) {
            assertEquals(
                "card of $id must be cancelable by the action that carries it",
                NotifyIds.messageCard(id),
                NotifyIds.messageCard(id, "conv-1", System.nanoTime()),
            )
        }
    }

    @Test
    fun `a negative hashCode never reaches the notification manager`() {
        val negative = ids.filter { it.hashCode() < 0 }
        assertTrue("fixture must actually contain a negative hash", negative.isNotEmpty())
        for (id in negative) {
            val card = requireNotNull(NotifyIds.messageCard(id))
            assertTrue("id $card must be non-negative", card >= 0)
            assertEquals(id.hashCode() and Int.MAX_VALUE, card)
        }
    }

    @Test
    fun `ids are deterministic and per-message`() {
        assertEquals(NotifyIds.messageCard(ids[0]), NotifyIds.messageCard(ids[0]))
        val cards = ids.mapNotNull(NotifyIds::messageCard)
        assertEquals("one card per message: no two ids may share a card", cards.size, cards.toSet().size)
    }

    @Test
    fun `missing or blank message id falls back instead of colliding with a real card`() {
        assertNull(NotifyIds.messageCard(null))
        assertNull(NotifyIds.messageCard(""))
        assertNull(NotifyIds.messageCard("   "))
        val conv = "conv-42"
        assertNotEquals(
            "two messages of the same conversation must not replace each other",
            NotifyIds.messageCardFallback(conv, 1_000L),
            NotifyIds.messageCardFallback(conv, 2_000L),
        )
        for (nano in longArrayOf(0L, 0x7FL, Long.MAX_VALUE, -1L)) {
            assertTrue("fallback id must stay non-negative (nano=$nano)", NotifyIds.messageCardFallback(conv, nano) >= 0)
        }
    }
}
