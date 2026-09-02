package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** §48 (retry/backoff + crash recovery). The queue must back off, cap, and never park a message behind a stale deadline. */
class OutboxPolicyTest {
    @Test
    fun `first failure retries at the first step`() {
        assertEquals(1_500L, OutboxPolicy.waitMs(1))
        assertEquals(OutboxPolicy.backoffMs[0], OutboxPolicy.waitMs(1))
    }

    @Test
    fun `backoff never shrinks and never exceeds the last step`() {
        var prev = 0L
        for (n in 1..OutboxPolicy.MAX_AUTO) {
            val w = OutboxPolicy.waitMs(n)
            assertTrue("attempt $n waits $w, which is less than the previous $prev", w >= prev)
            prev = w
        }
        assertEquals(OutboxPolicy.backoffMs.last(), OutboxPolicy.waitMs(OutboxPolicy.backoffMs.size))
        assertEquals(OutboxPolicy.backoffMs.last(), OutboxPolicy.waitMs(OutboxPolicy.MAX_AUTO - 1))
    }

    @Test
    fun `past the automatic ceiling the item is parked, not retried forever`() {
        val parked = OutboxPolicy.waitMs(OutboxPolicy.MAX_AUTO)
        assertTrue(parked > OutboxPolicy.backoffMs.last())
        assertEquals(parked, OutboxPolicy.waitMs(OutboxPolicy.MAX_AUTO + 1_000))
        // Parked must survive being added to a wall-clock timestamp: an overflow here
        // would make the deadline negative, i.e. "due" forever — a hot retry loop.
        assertTrue(System.currentTimeMillis() + parked > System.currentTimeMillis())
    }

    @Test
    fun `an impossible attempt count cannot crash the queue`() {
        // `bump()` only ever passes attempts+1, but a future caller must not be able to
        // index backoffMs out of bounds or get a negative wait.
        for (n in intArrayOf(0, -1, -999, Int.MIN_VALUE)) {
            assertEquals("attempt count $n", OutboxPolicy.backoffMs[0], OutboxPolicy.waitMs(n))
        }
        assertEquals("a saturated count parks the item", OutboxPolicy.waitMs(OutboxPolicy.MAX_AUTO), OutboxPolicy.waitMs(Int.MAX_VALUE))
    }

    @Test
    fun `a deadline in the past is re-armed on load, a future one is kept`() {
        val now = 1_700_000_000_000L
        assertEquals(0L, OutboxPolicy.rearmOnLoad(now - 1, now))
        assertEquals(0L, OutboxPolicy.rearmOnLoad(1L, now))
        assertEquals(0L, OutboxPolicy.rearmOnLoad(0L, now))
        assertEquals(now, OutboxPolicy.rearmOnLoad(now, now))
        assertEquals(now + 60_000L, OutboxPolicy.rearmOnLoad(now + 60_000L, now))
        assertEquals("a parked deadline survives a restart", Long.MAX_VALUE / 4, OutboxPolicy.rearmOnLoad(Long.MAX_VALUE / 4, now))
    }

    @Test
    fun `due means due and force ignores the clock`() {
        val now = 1_700_000_000_000L
        assertTrue(OutboxPolicy.isDue(0L, now, false))
        assertTrue(OutboxPolicy.isDue(now, now, false))
        assertFalse(OutboxPolicy.isDue(now + 1, now, false))
        assertTrue(OutboxPolicy.isDue(now + 300_000L, now, true))
        assertTrue(OutboxPolicy.isDue(Long.MAX_VALUE / 4, now, true))
        assertFalse(OutboxPolicy.isDue(Long.MAX_VALUE / 4, now, false))
    }
}
