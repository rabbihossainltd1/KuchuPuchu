package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The first scroll through a chat or the chat list used to be the laggy one: every row
 * decoded its avatar at the source's full size (512x512 for an 88dp circle, ~1MB of
 * bitmap each) and re-encoded it to disk, then the second pass was smooth because the
 * memory cache answered. Decoding *at the size that is drawn* is the whole fix, and
 * that decision is this function — so it is worth pinning rather than eyeballing.
 */
class BitmapSamplerTest {
    @Test
    fun `an avatar-sized draw of a 512 source halves once, not twice`() {
        // 512 -> 256 fits over 219px; going to 128 would be visibly soft in the list.
        assertEquals(2, bitmapSampleSize(512, 512, 219))
    }

    @Test
    fun `a source no bigger than the target is decoded whole`() {
        assertEquals(1, bitmapSampleSize(512, 512, 1080))
        assertEquals(1, bitmapSampleSize(100, 80, 64))
    }

    @Test
    fun `the old photo ceiling is reproduced exactly`() {
        // The pre-existing loop (`while (side / 2 >= 1080)`) sampled 4000x3000 by 2:
        // this is a behaviour-preserving rename, so the number must not move.
        assertEquals(2, bitmapSampleSize(4000, 3000, 1080))
        assertEquals(4, bitmapSampleSize(8000, 6000, 1080))
    }

    /**
     * The two properties the caller actually depends on, over a grid rather than in
     * prose: the sample is a power of two (`BitmapFactory`'s contract), and it is the
     * *largest* one that still leaves the decoded image at or above the drawn size —
     * i.e. doubling it once more would under-shoot the target and blur the row.
     * A source smaller than the target must sample 1, which is why the second rule is
     * only asserted once we are really downsampling.
     */
    @Test
    fun `power of two, and never more downsampling than fits`() {
        for (src in intArrayOf(64, 100, 200, 512, 1024, 2048, 4096, 5000)) {
            for (max in intArrayOf(32, 96, 219, 256, 512, 1080, 2000)) {
                val s = bitmapSampleSize(src, src, max)
                assertTrue("src=$src max=$max -> sample $s is not a power of two", s and (s - 1) == 0 && s >= 1)
                val decoded = src / s
                if (s > 1) {
                    assertTrue("src=$src max=$max -> $s over-shrank to $decoded", decoded >= max)
                    assertTrue(
                        "src=$src max=$max -> $s could have been ${(s * 2)} ($decoded vs ${src / (s * 2)})",
                        src / (s * 2) < max,
                    )
                } else {
                    assertTrue("src=$src max=$max should have downsampled", src / 2 < max)
                }
            }
        }
    }

    @Test
    fun `unknown or zero bounds decode whole instead of dividing by zero`() {
        assertEquals(1, bitmapSampleSize(0, 0, 256))
        assertEquals(1, bitmapSampleSize(-1, 512, 256))
        assertEquals(1, bitmapSampleSize(512, 512, 0))
    }
}
