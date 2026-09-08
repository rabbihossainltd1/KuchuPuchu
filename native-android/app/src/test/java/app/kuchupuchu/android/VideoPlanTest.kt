package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Owner round 31 (item 30): the status share screen's rules are pure maths —
 * a clip over a minute opens on its FIRST minute, the handles can pick any
 * window but never more than a minute, the crop box stays inside the frame
 * and the GPU texture mapping reads the crop out of the rotated picture.
 */
class VideoPlanTest {
    @Test
    fun `a long clip opens with its first minute selected, a short one whole`() {
        assertEquals(0L to 60_000L, VideoPlan.defaultWindow(185_000L))
        assertEquals(0L to 42_000L, VideoPlan.defaultWindow(42_000L))
    }

    @Test
    fun `the window can start anywhere but never exceeds a minute`() {
        val (s1, e1) = VideoPlan.slide(0L, 60_000L, 185_000L, 90_000L)
        assertEquals(90_000L to 150_000L, s1 to e1)
        val (s2, e2) = VideoPlan.slide(0L, 60_000L, 185_000L, 999_000L)
        assertEquals(125_000L to 185_000L, s2 to e2)
        // dragging the END past a minute pulls the START along
        val (s3, e3) = VideoPlan.moveEnd(10_000L, 50_000L, 185_000L, 120_000L)
        assertEquals(60_000L to 120_000L, s3 to e3)
        // dragging the START back past a minute pulls the END along
        val (s4, e4) = VideoPlan.moveStart(100_000L, 150_000L, 185_000L, 0L)
        assertEquals(0L to 60_000L, s4 to e4)
        // handles never cross: at least one second stays
        val (s5, e5) = VideoPlan.moveStart(10_000L, 20_000L, 185_000L, 30_000L)
        assertEquals(19_000L to 20_000L, s5 to e5)
    }

    @Test
    fun `an untouched small mp4 is uploaded as-is, anything trimmed or cropped is re-encoded`() {
        assertFalse(VideoPlan.needsTranscode(null, 0L, 30_000L, 30_000L, 5_000_000L, "video/mp4"))
        assertTrue(VideoPlan.needsTranscode(null, 0L, 60_000L, 90_000L, 5_000_000L, "video/mp4"))
        assertTrue(VideoPlan.needsTranscode(CropBox(0.1f, 0.1f, 0.5f, 0.5f), 0L, 30_000L, 30_000L, 5_000_000L, "video/mp4"))
        assertTrue(VideoPlan.needsTranscode(null, 0L, 30_000L, 30_000L, 24_000_000L, "video/mp4"))
        assertTrue(VideoPlan.needsTranscode(null, 0L, 30_000L, 30_000L, 5_000_000L, "video/x-matroska"))
    }

    @Test
    fun `output size follows the crop in display orientation, capped at 1280 and 16-aligned`() {
        // portrait phone clip: coded 1920x1080 rotated 90 = 1080x1920 on screen
        assertEquals(720 to 1280, VideoPlan.outputSize(1920, 1080, 90, null))
        // a square crop of it
        val (w, h) = VideoPlan.outputSize(1920, 1080, 90, CropBox(0f, 0.2f, 1f, 0.5625f))
        assertEquals(w, h)
        assertEquals(0, w % 16)
        assertTrue(w <= 1280)
    }

    @Test
    fun `a full minute lands under the 25 MB upload cap`() {
        val bps = VideoPlan.bitrate(60_000L, 720, 1280, 30)
        assertTrue(bps.toLong() * 60 / 8 < 20L * 1024 * 1024)
        assertTrue(bps >= 500_000)
    }

    @Test
    fun `texture mapping - no rotation and full crop is the classic full-frame quad`() {
        val t = VideoPlan.texCoords(0, null)
        assertArrayEq(floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f), t)
    }

    @Test
    fun `texture mapping - a 90 degree clip turns clockwise on the way out`() {
        // the output's bottom-left corner shows the coded frame's bottom-right
        val t = VideoPlan.texCoords(90, null)
        assertEquals(1f, t[0], 1e-6f)
        assertEquals(0f, t[1], 1e-6f)
        // the output's top-left corner shows the coded frame's bottom-left
        assertEquals(0f, t[4], 1e-6f)
        assertEquals(0f, t[5], 1e-6f)
    }

    @Test
    fun `texture mapping - a crop reads only its own window`() {
        val t = VideoPlan.texCoords(0, CropBox(0.25f, 0.5f, 0.5f, 0.25f))
        // bottom-left of the quad = left edge of the box, bottom edge of the box
        assertEquals(0.25f, t[0], 1e-6f)
        assertEquals(1f - 0.75f, t[1], 1e-6f)
        // top-right of the quad = right edge, top edge of the box
        assertEquals(0.75f, t[6], 1e-6f)
        assertEquals(1f - 0.5f, t[7], 1e-6f)
    }

    @Test
    fun `the crop box never leaves the frame and a locked preset keeps its ratio`() {
        val moved = CropBox(0.5f, 0.5f, 0.4f, 0.4f).moved(0.9f, -0.9f)
        assertEquals(0.6f, moved.x, 1e-6f)
        assertEquals(0f, moved.y, 1e-6f)
        val square = CropBox.centered(1f, 9f / 16f)
        assertEquals(1f, square.w, 1e-6f)
        assertEquals(9f / 16f, square.h, 1e-6f)
        val resized = square.resized(5, -0.3f, -0.3f, 1f, 9f / 16f)
        assertEquals(resized.w * (9f / 16f), resized.h, 1e-4f)
        assertTrue(resized.x >= 0f && resized.y >= 0f && resized.x + resized.w <= 1.0001f)
        assertTrue(CropBox.FULL.isFull())
        assertFalse(resized.isFull())
    }

    private fun assertArrayEq(expected: FloatArray, actual: FloatArray) {
        assertEquals(expected.size, actual.size)
        expected.indices.forEach { assertEquals("index $it", expected[it], actual[it], 1e-6f) }
    }
}
