package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageStampPolicyTest {
    @Test
    fun `newest visible message keeps its status without a tap`() {
        assertTrue(MessageStampPolicy.isVisible(isLatestVisible = true, rowKey = "m1", overrideKey = ""))
    }

    @Test
    fun `older status stays hidden until that same message is tapped`() {
        assertFalse(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "m1", overrideKey = ""))
        assertTrue(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "m1", overrideKey = "m1"))
    }

    @Test
    fun `revealing one row does not reveal a different older row`() {
        assertFalse(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "m2", overrideKey = "m1"))
    }

    @Test
    fun `blank row keys cannot reveal a hidden status`() {
        assertFalse(MessageStampPolicy.isVisible(isLatestVisible = false, rowKey = "", overrideKey = ""))
    }

    @Test
    fun `tapping an older row twice reveals then hides its status`() {
        val revealed = MessageStampPolicy.toggleOverrideVisible(
            currentKey = "",
            currentVisible = false,
            tappedKey = "m1",
            tappedIsLatest = false,
        )
        assertTrue(revealed)
        assertFalse(
            MessageStampPolicy.toggleOverrideVisible(
                currentKey = "m1",
                currentVisible = revealed,
                tappedKey = "m1",
                tappedIsLatest = false,
            ),
        )
    }

    @Test
    fun `tapping the newest row can hide it and a second tap restores it`() {
        val hidden = MessageStampPolicy.toggleOverrideVisible(
            currentKey = "",
            currentVisible = false,
            tappedKey = "m2",
            tappedIsLatest = true,
        )
        assertFalse(hidden)
        assertTrue(
            MessageStampPolicy.toggleOverrideVisible(
                currentKey = "m2",
                currentVisible = hidden,
                tappedKey = "m2",
                tappedIsLatest = true,
            ),
        )
    }

    @Test
    fun `tapping another row overrides visibility according to that rows default`() {
        assertTrue(
            MessageStampPolicy.toggleOverrideVisible(
                currentKey = "m1",
                currentVisible = false,
                tappedKey = "m2",
                tappedIsLatest = false,
            ),
        )
        assertFalse(
            MessageStampPolicy.toggleOverrideVisible(
                currentKey = "m1",
                currentVisible = true,
                tappedKey = "m2",
                tappedIsLatest = true,
            ),
        )
    }

    @Test
    fun `blank key cannot change the current override visibility`() {
        assertTrue(
            MessageStampPolicy.toggleOverrideVisible(
                currentKey = "m1",
                currentVisible = true,
                tappedKey = "",
                tappedIsLatest = false,
            ),
        )
    }
}
