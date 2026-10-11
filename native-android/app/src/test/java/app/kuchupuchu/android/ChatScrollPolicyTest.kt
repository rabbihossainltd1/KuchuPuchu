package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatScrollPolicyTest {
    @Test
    fun nearTailUsesRenderedRowsWhenAlbumMessagesAreFoldedTogether() {
        // Eight stored message rows can render as three LazyColumn items after
        // album folding. The visible rendered tail is still the actual bottom.
        assertTrue(ChatScrollPolicy.isNearTail(lastVisibleItemIndex = 2, renderedItemCount = 3))
        assertFalse(ChatScrollPolicy.isNearTail(lastVisibleItemIndex = 2, renderedItemCount = 8))
        assertFalse(ChatScrollPolicy.isNearTail(lastVisibleItemIndex = null, renderedItemCount = 3))
        assertFalse(ChatScrollPolicy.isNearTail(lastVisibleItemIndex = 0, renderedItemCount = 0))
    }

    @Test
    fun liveTailFollowIsAllowedOnlyWhenIdleAndAlreadyNearTheTail() {
        assertTrue(ChatScrollPolicy.shouldFollowTail(nearBottom = true, scrollInProgress = false))
        assertFalse(ChatScrollPolicy.shouldFollowTail(nearBottom = false, scrollInProgress = false))
        assertFalse(ChatScrollPolicy.shouldFollowTail(nearBottom = true, scrollInProgress = true))
        assertFalse(ChatScrollPolicy.shouldFollowTail(nearBottom = false, scrollInProgress = true))
    }
}
