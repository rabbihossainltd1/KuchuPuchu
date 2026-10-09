package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageReplySwipePolicyTest {
    @Test
    fun `sent and received rows share one threshold and reply in opposite directions`() {
        assertEquals(50.4f, MessageReplySwipePolicy.requiredDistance(baseThresholdPx = 36f), 0.01f)
        assertTrue(MessageReplySwipePolicy.shouldReply(deltaX = 51f, deltaY = 4f, mine = false, baseThresholdPx = 36f))
        assertTrue(MessageReplySwipePolicy.shouldReply(deltaX = -51f, deltaY = 4f, mine = true, baseThresholdPx = 36f))
    }

    @Test
    fun `wrong direction and movement below the shared threshold do not reply`() {
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = -60f, deltaY = 0f, mine = false, baseThresholdPx = 36f))
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = 60f, deltaY = 0f, mine = true, baseThresholdPx = 36f))
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = 50f, deltaY = 0f, mine = false, baseThresholdPx = 36f))
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = -50f, deltaY = 0f, mine = true, baseThresholdPx = 36f))
    }

    @Test
    fun `dominant vertical movement does not reply`() {
        assertFalse(MessageReplySwipePolicy.shouldReply(deltaX = 51f, deltaY = 52f, mine = false, baseThresholdPx = 36f))
    }

    @Test
    fun `horizontal intent waits for touch slop and vertical scrolling stays unclaimed`() {
        assertFalse(MessageReplySwipePolicy.isHorizontalIntent(deltaX = 8f, deltaY = 0f, touchSlopPx = 10f))
        assertFalse(MessageReplySwipePolicy.isHorizontalIntent(deltaX = 20f, deltaY = 24f, touchSlopPx = 10f))
        assertTrue(MessageReplySwipePolicy.isHorizontalIntent(deltaX = 20f, deltaY = 8f, touchSlopPx = 10f))
    }

    @Test
    fun `drag feedback follows the reply direction and has the same cap on both sides`() {
        assertEquals(70.56f, MessageReplySwipePolicy.dragOffset(deltaX = 90f, mine = false, baseThresholdPx = 36f), 0.01f)
        assertEquals(-70.56f, MessageReplySwipePolicy.dragOffset(deltaX = -90f, mine = true, baseThresholdPx = 36f), 0.01f)
        assertEquals(0f, MessageReplySwipePolicy.dragOffset(deltaX = -40f, mine = false, baseThresholdPx = 36f), 0.01f)
        assertEquals(0f, MessageReplySwipePolicy.dragOffset(deltaX = 40f, mine = true, baseThresholdPx = 36f), 0.01f)
    }
}
