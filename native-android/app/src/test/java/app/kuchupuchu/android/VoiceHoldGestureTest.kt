package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * r74-19 (owner: "ami bolechi voice button a click kore hold korle normal voice
 * record hobe but upore swipe korle voice lock hobe ar voice button ta send
 * button a hoye jabe screenshot a jemon ta ache"): the hold's four endings are
 * pure maths, so this pins what a thumb can actually do — a hold that never
 * moves rolls a locked take, an up-swipe rolls a locked take, a left swipe
 * throws it away, and a plain hold-and-release sends.
 *
 * Distances are pixels at xxhdpi-ish density (cancel 88 dp ≈ 264 px, lock
 * 58 dp ≈ 174 px, slop 12 dp ≈ 36 px), the same numbers the composer passes in.
 */
class VoiceHoldGestureTest {
    private val cancel = 264f
    private val lock = 174f
    private val slop = 36f

    @Test
    fun `a quick touch that never moved locks the take`() {
        assertEquals(
            VoiceHoldGesture.Result.TAP_LOCK,
            VoiceHoldGesture.decide(dx = 0f, dy = 0f, ms = 120L, cancelDist = cancel, lockDist = lock, slop = slop),
        )
    }

    @Test
    fun `a swipe up locks the take even before the badge is reached, and on it`() {
        // half-way up (about 30 dp) — still a lock: "upore swipe korle voice lock hobe"
        assertEquals(
            VoiceHoldGesture.Result.SWIPE_LOCK,
            VoiceHoldGesture.decide(dx = 0f, dy = -90f, ms = 900L, cancelDist = cancel, lockDist = lock, slop = slop),
        )
        // all the way onto the badge
        assertEquals(
            VoiceHoldGesture.Result.SWIPE_LOCK,
            VoiceHoldGesture.decide(dx = 0f, dy = -260f, ms = 900L, cancelDist = cancel, lockDist = lock, slop = slop),
        )
    }

    @Test
    fun `a swipe up that drifts right or left is still a lock until cancel wins`() {
        // up and a little left, but short of the cancel distance
        assertEquals(
            VoiceHoldGesture.Result.SWIPE_LOCK,
            VoiceHoldGesture.decide(
                dx = -120f,
                dy = -120f,
                ms = 900L,
                cancelDist = cancel,
                lockDist = lock,
                slop = slop,
            ),
        )
        // past the cancel distance the bin wins, whatever else happened
        assertEquals(
            VoiceHoldGesture.Result.CANCEL,
            VoiceHoldGesture.decide(
                dx = -300f,
                dy = -300f,
                ms = 900L,
                cancelDist = cancel,
                lockDist = lock,
                slop = slop,
            ),
        )
    }

    @Test
    fun `holding without a direction sends the note`() {
        assertEquals(
            VoiceHoldGesture.Result.SEND,
            VoiceHoldGesture.decide(dx = 0f, dy = 0f, ms = 2_400L, cancelDist = cancel, lockDist = lock, slop = slop),
        )
        // a small sideways wobble is not a direction
        assertEquals(
            VoiceHoldGesture.Result.SEND,
            VoiceHoldGesture.decide(
                dx = -20f,
                dy = 18f,
                ms = 1_500L,
                cancelDist = cancel,
                lockDist = lock,
                slop = slop,
            ),
        )
    }

    @Test
    fun `a long hold that ends on the badge is a lock, not a send`() {
        assertEquals(
            VoiceHoldGesture.Result.SWIPE_LOCK,
            VoiceHoldGesture.decide(dx = 0f, dy = -180f, ms = 8_000L, cancelDist = cancel, lockDist = lock, slop = slop),
        )
    }

    @Test
    fun `a slow drift with no direction is a send even when it is tiny`() {
        assertEquals(
            VoiceHoldGesture.Result.SEND,
            VoiceHoldGesture.decide(dx = -30f, dy = -20f, ms = 5_000L, cancelDist = cancel, lockDist = lock, slop = slop),
        )
    }
}
