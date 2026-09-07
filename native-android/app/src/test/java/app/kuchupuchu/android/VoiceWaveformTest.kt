package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Owner round 31 (item 27): the voice bubble draws a REAL waveform. The
 * recorder's 100 ms peaks are squashed into a fixed number of bars (0..100)
 * that travel in the message meta, so both phones draw the same picture. The
 * squash is pure maths — pinned here so a refactor cannot flatten every note
 * into a straight line or push a bar past what the server accepts.
 */
class VoiceWaveformTest {
    @Test
    fun `a take is squashed into exactly BARS bars inside 0 to 100`() {
        val peaks = List(137) { i -> (i * 977) % 32767 }
        val bars = VoiceWaveform.squash(peaks)
        assertEquals(VoiceWaveform.BARS, bars.size)
        assertTrue(bars.all { it in 0..100 })
        // The loudest moment always reaches the full height.
        assertEquals(100, bars.max())
    }

    @Test
    fun `a short take (fewer peaks than bars) still fills every bar`() {
        val bars = VoiceWaveform.squash(listOf(1000, 20000, 500))
        assertEquals(VoiceWaveform.BARS, bars.size)
        assertTrue(bars.all { it in 0..100 })
        assertEquals(100, bars.max())
    }

    @Test
    fun `a quiet take keeps its shape (scaled to its own peak, not to the mic ceiling)`() {
        val quiet = List(80) { i -> if (i in 30..40) 400 else 40 }
        val bars = VoiceWaveform.squash(quiet)
        assertEquals(100, bars.max())
        assertTrue("the quiet part must stay visibly lower", bars.min() < 50)
    }

    @Test
    fun `silence and nothing recorded do not crash`() {
        assertEquals(List(VoiceWaveform.BARS) { 0 }, VoiceWaveform.squash(List(50) { 0 }))
        assertTrue(VoiceWaveform.squash(emptyList()).isEmpty())
        assertTrue(VoiceWaveform.squash(listOf(1, 2, 3), bars = 0).isEmpty())
    }

    @Test
    fun `negative or garbage peaks are clamped, never negative bars`() {
        val bars = VoiceWaveform.squash(listOf(-5, -10, 300, 12))
        assertTrue(bars.all { it in 0..100 })
    }

    @Test
    fun `the fallback pattern is stable per message and never empty`() {
        val a = VoiceWaveform.pseudo("msg-1")
        val b = VoiceWaveform.pseudo("msg-1")
        val c = VoiceWaveform.pseudo("msg-2")
        assertEquals(a, b)
        assertEquals(VoiceWaveform.BARS, a.size)
        assertTrue(a != c)
        assertTrue(a.all { it in 8..100 })
    }

    @Test
    fun `whatever arrives from the server is clamped to the drawable range and length`() {
        val raw = List(200) { i -> i * 3 - 50 }
        val bars = VoiceWaveform.sanitize(raw)
        assertEquals(VoiceWaveform.MAX_BARS, bars.size)
        assertTrue(bars.all { it in 0..100 })
        assertEquals(0, bars.first())
    }
}
