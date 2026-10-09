package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmojiFallbackSizingPolicyTest {
    @Test
    fun `fallback keeps the same physical font size at normal and enlarged font scales`() {
        val boxSizeDp = 48f
        for (fontScale in listOf(1f, 1.25f, 1.5f, 2f)) {
            val fontSizeSp = EmojiFallbackSizingPolicy.fontSizeSp(boxSizeDp, fontScale)
            assertEquals(boxSizeDp, fontSizeSp * fontScale, 0.001f)
        }
    }

    @Test
    fun `fallback line height leaves room for color emoji font metrics`() {
        val fontSizeSp = EmojiFallbackSizingPolicy.fontSizeSp(boxSizeDp = 48f, fontScale = 1.5f)
        val lineHeightSp = EmojiFallbackSizingPolicy.lineHeightSp(fontSizeSp)

        assertTrue(lineHeightSp > fontSizeSp)
        assertEquals(fontSizeSp * 1.2f, lineHeightSp, 0.001f)
    }
}
