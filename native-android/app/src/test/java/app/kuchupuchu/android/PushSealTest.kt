package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * r67-2: the push payload's own decision table — which pushes are sealed, what
 * rides them, and what the tray card is allowed to say. The Android half
 * (fetching the row, opening it with the peer's key) is exercised by the live
 * probe; this is the part that must never regress silently, because getting it
 * wrong either prints ciphertext in the shade or hides a real message.
 */
class PushSealTest {
    private val lock = PushSeal.LOCK
    private val env = "KP1.AAAAAAAAAAAAAAAAAAAAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

    @Test
    fun `a sealed push with the envelope rides it and needs no request`() {
        val plan = PushSeal.plan("1", env, lock)
        assertTrue(plan.sealed)
        assertEquals(env, plan.envelope)
    }

    @Test
    fun `a sealed push without the envelope is still sealed - the app fetches the row`() {
        val plan = PushSeal.plan("1", null, lock)
        assertTrue(plan.sealed)
        assertNull(plan.envelope)
    }

    @Test
    fun `an older worker that only sent the envelope as the preview still lands on the sealed path`() {
        val plan = PushSeal.plan(null, null, env)
        assertTrue(plan.sealed)
        assertEquals(env, plan.envelope)
    }

    @Test
    fun `a plaintext push is left completely alone`() {
        val plan = PushSeal.plan(null, null, "oi, call daw")
        assertFalse(plan.sealed)
        assertNull(plan.envelope)
    }

    @Test
    fun `a kp_env that is not an envelope is ignored`() {
        val plan = PushSeal.plan("1", "not-an-envelope", lock)
        assertTrue(plan.sealed)
        assertNull(plan.envelope)
    }

    @Test
    fun `the opened plaintext is what the card says`() {
        val plan = PushSeal.plan("1", env, lock)
        assertEquals("oi, call daw", PushSeal.cardText(plan, "oi, call daw", lock))
    }

    @Test
    fun `a sealed body never reaches the card as a lock or as ciphertext`() {
        val plan = PushSeal.plan("1", null, lock)
        assertEquals("New message", PushSeal.cardText(plan, null, lock))
        assertEquals("New message", PushSeal.cardText(plan, null, env))
    }

    @Test
    fun `an empty payload still reads as a message`() {
        assertEquals("New message", PushSeal.cardText(PushSeal.plan(null, null, ""), null, ""))
    }

    @Test
    fun `a normal preview passes through untouched`() {
        val plan = PushSeal.plan(null, null, "photo.jpg")
        assertEquals("photo.jpg", PushSeal.cardText(plan, null, "photo.jpg"))
    }
}
