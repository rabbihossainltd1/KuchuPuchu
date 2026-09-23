package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class E2eePolicyTest {
    private fun refused(block: () -> Unit) {
        try {
            block()
            fail("A personal message must not leave unencrypted")
        } catch (_: IllegalStateException) {
        }
    }

    @Test
    fun `failed publication retries without restarting the app`() {
        val gate = E2eePublicationGate()
        var attempts = 0
        assertFalse(gate.ensure("a", { true }) { attempts++; false })
        assertTrue(gate.ensure("a", { true }) { attempts++; true })
        assertTrue(gate.ensure("a", { true }) { attempts++; true })
        assertEquals(2, attempts)
    }

    @Test
    fun `network exception does not latch publication`() {
        val gate = E2eePublicationGate()
        assertFalse(gate.ensure("a", { true }) { throw IllegalStateException("offline") })
        assertTrue(gate.ensure("a", { true }) { true })
    }

    @Test
    fun `a different account or login session republishes`() {
        val gate = E2eePublicationGate()
        var attempts = 0
        assertTrue(gate.ensure("a", { true }) { attempts++; true })
        assertTrue(gate.ensure("b", { true }) { attempts++; true })
        assertTrue(gate.ensure("a-new-session", { true }) { attempts++; true })
        assertEquals(3, attempts)
    }

    @Test
    fun `logout during publication cannot acknowledge a new session`() {
        val gate = E2eePublicationGate()
        var session = "a"
        assertFalse(gate.ensure("a", { session == "a" }) { session = "b"; true })
        var publishedB = false
        assertTrue(gate.ensure("b", { session == "b" }) { publishedB = true; true })
        assertTrue(publishedB)
    }

    @Test
    fun `no request is sent for a missing or stale session`() {
        val gate = E2eePublicationGate()
        var calls = 0
        assertFalse(gate.ensure("", { true }) { calls++; true })
        assertFalse(gate.ensure("a", { false }) { calls++; true })
        assertEquals(0, calls)
    }

    @Test
    fun `concurrent app and chat entry publish only once`() {
        val gate = E2eePublicationGate()
        val calls = AtomicInteger()
        val start = CountDownLatch(1)
        val succeeded = AtomicInteger()
        val threads = (1..8).map {
            Thread {
                start.await()
                if (gate.ensure("a", { true }) { calls.incrementAndGet(); true }) succeeded.incrementAndGet()
            }.also { it.start() }
        }
        start.countDown()
        threads.forEach { it.join(5_000) }
        assertEquals(8, succeeded.get())
        assertEquals(1, calls.get())
    }

    @Test
    fun `personal send is sealed and an existing envelope is not double sealed`() {
        var calls = 0
        val seal: (String) -> String? = { calls++; "KP1.encrypted-$it" }
        assertEquals("KP1.encrypted-hello", E2eeSendPolicy.protectBody("hello", true, true, seal))
        assertEquals("KP1.existing", E2eeSendPolicy.protectBody("KP1.existing", true, true, seal))
        assertEquals(1, calls)
    }

    @Test
    fun `missing key or unpublished identity never falls back to plaintext`() {
        var encrypted = false
        refused { E2eeSendPolicy.protectBody("private", true, false) { encrypted = true; "KP1.x" } }
        assertFalse(encrypted)
        refused { E2eeSendPolicy.protectBody("KP1.x", true, false) { "KP1.x" } }
    }

    @Test
    fun `encryption failure or non-envelope result never passes plaintext`() {
        refused { E2eeSendPolicy.protectBody("private", true, true) { null } }
        refused { E2eeSendPolicy.protectBody("private", true, true) { it } }
    }

    @Test
    fun `group bot and empty captions retain existing behavior`() {
        val never: (String) -> String? = { throw AssertionError("Must not encrypt") }
        assertEquals("group", E2eeSendPolicy.protectBody("group", false, false, never))
        assertEquals("", E2eeSendPolicy.protectBody("", true, false, never))
    }

    @Test
    fun `all body and caption kinds share the guard but structured rows do not`() {
        listOf("", "TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE").forEach {
            assertTrue(E2eeSendPolicy.protectsKind(it))
        }
        listOf("STICKER", "CALL", "SYSTEM", "LOCATION", "CONTACT").forEach {
            assertFalse(E2eeSendPolicy.protectsKind(it))
        }
    }
}
