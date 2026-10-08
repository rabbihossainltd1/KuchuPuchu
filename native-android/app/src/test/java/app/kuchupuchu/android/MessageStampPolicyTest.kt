package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageStampPolicyTest {
    @Test
    fun `newest visible message keeps its status without a tap`() {
        assertTrue(MessageStampPolicy.isVisible(isLatestVisible = true, rowKey = "m1", revealedKey = ""))
    }

    @Test
    fun `older status stays hidden until that same message is tapped`() {
        assertFalse(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "m1", revealedKey = ""))
        assertTrue(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "m1", revealedKey = "m1"))
    }

    @Test
    fun `revealing one row does not reveal a different older row`() {
        assertFalse(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "m2", revealedKey = "m1"))
    }

    @Test
    fun `blank row keys cannot reveal a hidden status`() {
        assertFalse(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "", revealedKey = ""))
    }
}
