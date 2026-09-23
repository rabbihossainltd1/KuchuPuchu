package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttachmentExitGateTest {
    @Test
    fun `no selection executes immediately without a confirmation`() {
        val gate = AttachmentExitGate()
        var ran = false
        assertTrue(gate.request(false) { ran = true })
        assertTrue(ran)
    }

    @Test
    fun `selected media suspends the requested action`() {
        val gate = AttachmentExitGate()
        var replies = 0
        assertFalse(gate.request(true) { replies++ })
        assertEquals(0, replies)
    }

    @Test
    fun `cancel preserves media caption and view-once state`() {
        val gate = AttachmentExitGate()
        val selection = mutableListOf("photo:caption:once", "video:hd")
        var left = false
        assertFalse(gate.request(true) { left = true })
        gate.cancel()
        gate.confirm { selection.clear() }
        assertEquals(listOf("photo:caption:once", "video:hd"), selection)
        assertFalse(left)
    }

    @Test
    fun `confirmation discards before running the outside action`() {
        val gate = AttachmentExitGate()
        val events = mutableListOf<String>()
        val selection = mutableListOf("photo")
        gate.request(true) {
            assertTrue(selection.isEmpty())
            events.add("reply")
        }
        gate.confirm { selection.clear(); events.add("discard") }
        assertEquals(listOf("discard", "reply"), events)
    }

    @Test
    fun `repeated confirm cannot repeat the action or discard`() {
        val gate = AttachmentExitGate()
        var actions = 0
        var discards = 0
        gate.request(true) { actions++ }
        repeat(3) { gate.confirm { discards++ } }
        assertEquals(1, actions)
        assertEquals(1, discards)
    }

    @Test
    fun `an outside pointer and callback cannot overwrite the first action`() {
        val gate = AttachmentExitGate()
        val events = mutableListOf<String>()
        gate.request(true) { events.add("first") }
        gate.request(true) { events.add("second") }
        gate.confirm { }
        assertEquals(listOf("first"), events)
    }

    @Test
    fun `cancelling allows a later independent request`() {
        val gate = AttachmentExitGate()
        var action = ""
        gate.request(true) { action = "back" }
        gate.cancel()
        gate.request(true) { action = "reply" }
        gate.confirm { }
        assertEquals("reply", action)
    }

    @Test
    fun `outside touch confirmation does not replay a dangerous gesture`() {
        val gate = AttachmentExitGate()
        var discards = 0
        gate.request(true) { }
        gate.confirm { discards++ }
        assertEquals(1, discards)
        // A new gesture after closing is handled normally.
        var freshAction = false
        assertTrue(gate.request(false) { freshAction = true })
        assertTrue(freshAction)
    }
}
