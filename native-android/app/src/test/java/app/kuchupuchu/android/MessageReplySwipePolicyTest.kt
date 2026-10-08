package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageReplySwipePolicyTest {
    @Test
    fun `incoming photo replies on a long horizontal swipe to the right`() {
        assertTrue(MessageReplySwipePolicy.shouldReply(deltaX = 48f, deltaY = 4f, mine = false, baseThresholdPx = 36f))
    }

    @Test
    fun `own photo replies on a longer horizontal swipe to the left`() {
        assertTrue(MessageReplySwipePolicy.shouldReply(deltaX = -60f, deltaY = 4f, mine = true, baseThresholdPx = 36f))
    }

    @Test
    fun `wrong direction and short movement do not reply`() {
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = -60f, deltaY = 0f, mine = false, baseThresholdPx = 36f))
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = 35f, deltaY = 0f, mine = false, baseThresholdPx = 36f))
    }

    @Test
    fun `dominant vertical movement does not reply`() {
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = 48f, deltaY = 50f, mine = false, baseThresholdPx = 36f))
    }

    @Test
    fun `horizontal intent waits for touch slop and vertical scrolling stays unclaimed`() {
        assertFalse(MessageReplySwipePolicy.isHorizontalIntent(deltaX = 8f, deltaY = 0f, touchSlopPx = 10f))
        assertFalse(MessageReplySwipePolicy.isHorizontalIntent(deltaX = 20f, deltaY = 24f, touchSlopPx = 10f))
        assertTrue(MessageReplySwipePolicy.isHorizontalIntent(deltaX = 20f, deltaY = 8f, touchSlopPx = 10f))
    }

    @Test
    fun `drag feedback follows the reply direction and is capped`() {
        assertEquals(50.4f, MessageReplySwipePolicy.dragOffset(deltaX = 90f, mine = false, baseThresholdPx = 36f), 0.01f)
        assertEquals(-75.6f, MessageReplySwipePolicy.dragOffset(deltaX = -90f, mine = true, baseThresholdPx = 36f), 0.01f)
        assertEquals(0f, MessageReplySwipePolicy.dragOffset(deltaX = -40f, mine = false, baseThresholdPx = 36f), 0.01f)
    }
}
