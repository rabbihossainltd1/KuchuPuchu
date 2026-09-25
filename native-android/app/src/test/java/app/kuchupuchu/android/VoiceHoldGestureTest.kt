package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * r75-1 (owner: "current voice lock system hold swipe up system shob remove koro
 * ami ekta md file diyechi dekho ei vabe hobe shob"): the hold's three endings
 * are pure maths — a release inside the lock zone confirms the lock (the
 * mid-drag cross already fired it), a left swipe throws the take away, and a
 * plain hold-and-release sends. A short upward drift that never reached the
 * zone is NOT a lock (the old release-to-lock shortcut is gone with the system
 * it served).
 *
 * Distances are pixels at xxhdpi-ish density (cancel 88 dp ≈ 264 px, the
 * lock-AT half 46 dp ≈ 138 px since r75-9), the same numbers the composer
 * passes in.
 */
class VoiceHoldGestureTest {
    private val cancel = 264f
    private val lock = 138f

    @Test
    fun `releasing inside the lock zone is a lock`() {
        assertEquals(
            VoiceHoldGesture.Result.LOCK,
            VoiceHoldGesture.decide(dx = 0f, dy = -300f, cancelDist = cancel, lockDist = lock),
        )
        // well past the zone — the capsule was crossed long ago
        assertEquals(
            VoiceHoldGesture.Result.LOCK,
            VoiceHoldGesture.decide(dx = 0f, dy = -460f, cancelDist = cancel, lockDist = lock),
        )
    }

    @Test
    fun `a short upward drift below the zone is not a lock - it sends`() {
        // the old rule locked on ANY upward release; the MD locks on the ZONE
        assertEquals(
            VoiceHoldGesture.Result.SEND,
            VoiceHoldGesture.decide(dx = 0f, dy = -90f, cancelDist = cancel, lockDist = lock),
        )
    }

    @Test
    fun `the left slide cancels, even while climbing`() {
        assertEquals(
            VoiceHoldGesture.Result.CANCEL,
            VoiceHoldGesture.decide(dx = -300f, dy = -300f, cancelDist = cancel, lockDist = lock),
        )
    }

    @Test
    fun `holding without a direction sends the note`() {
        assertEquals(
            VoiceHoldGesture.Result.SEND,
            VoiceHoldGesture.decide(dx = 0f, dy = 0f, cancelDist = cancel, lockDist = lock),
        )
        // a small wobble is not a direction
        assertEquals(
            VoiceHoldGesture.Result.SEND,
            VoiceHoldGesture.decide(dx = -20f, dy = 18f, cancelDist = cancel, lockDist = lock),
        )
    }

    @Test
    fun `cancel wins over the lock`() {
        // the finger went for the bin, wherever else it climbed
        assertEquals(
            VoiceHoldGesture.Result.CANCEL,
            VoiceHoldGesture.decide(dx = -400f, dy = -460f, cancelDist = cancel, lockDist = lock),
        )
    }
}
