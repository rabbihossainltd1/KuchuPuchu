package app.kuchupuchu.android

import android.content.Context
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Owner round 32 (item 41): voice isolation on calls — "only human voice is
 * transmitted, filtering background noise — without degrading overall audio
 * quality".
 *
 * Every ~10 ms microphone buffer WebRTC records passes through
 * [process] on the audio thread before the encoder (the same hook the
 * screen-share audio tap uses). Underneath is RNNoise (Xiph.Org, BSD; built
 * from `src/main/cpp`): a small recurrent network that estimates, 100 times a
 * second, how much of each of 22 frequency bands is voice and how much is
 * noise, and turns the noise bands down while leaving the voice bands at unity
 * — fans, traffic, keyboard, wind and room hum go, the speaker's own timbre
 * stays. It adds exactly one 10 ms frame of delay, no more. (WebRTC's own
 * software chain — echo cancel, gain control, its classic spectral noise
 * suppressor — keeps running after it; this sits in front and does the heavy
 * lifting.)
 *
 * Owner round 34 (item 9): strength in three steps, not a switch — Normal
 * hushes the room (a gentle wet/dry mix), Medium cleans it (stronger mix +
 * a soft voice gate), Aggressive gates it (full RNNoise + the gate down to
 * silence). RNNoise has no strength knob of its own, so the C layer mixes
 * the cleaned frame with the noisy one and rides a smoothed VAD gain over
 * the whole frame. The library is loaded lazily on the first call; if the
 * native library is missing or refuses the device's audio format the
 * microphone simply passes through unchanged — a call is never broken by
 * the cleaner. [diag] counts cleaned vs skipped chunks per call (with the
 * skip reason), so a silent cleaner can never hide again.
 */
object VoiceIsolation {
    private const val LEVEL_PREF = "voice_iso_level"

    /** Cleaning strength: 0 Normal, 1 Medium, 2 Aggressive. */
    fun getLevel(ctx: Context): Int = ctx.getSharedPreferences("kp", 0).getInt(LEVEL_PREF, 1).coerceIn(0, 2)

    fun setLevel(ctx: Context, lv: Int) {
        val v = lv.coerceIn(0, 2)
        ctx.getSharedPreferences("kp", 0).edit().putInt(LEVEL_PREF, v).apply()
        level.set(v)
        // Live mid-call: one aligned int the audio thread picks up next chunk.
        val h = handle
        if (h != 0L) runCatching { nativeSetLevel(h, v) }
    }

    /** Mirrors the pref so the audio thread never touches SharedPreferences. */
    private val wanted = AtomicBoolean(true)
    private val level = AtomicInteger(1)
    private val loaded = AtomicBoolean(false)
    private val loadFailed = AtomicBoolean(false)

    // The audio thread owns these; [release] from another thread only flags.
    @Volatile private var handle = 0L

    @Volatile private var handleRate = 0

    @Volatile private var dropRequested = false

    /** Last speech probability the model reported (0..1), for diagnostics / UI. */
    @Volatile var speechProbability = 0f
        private set

    /** Per-call counters: cleaned vs skipped chunks + the latest skip reason. */
    private val chunksOk = AtomicLong(0)
    private val chunksSkipped = AtomicLong(0)

    @Volatile private var lastSkip = ""

    @Volatile private var ranOnce = false

    /** Called once when a call starts, from the engine (any thread). */
    fun prepare(ctx: Context) {
        wanted.set(true)
        level.set(getLevel(ctx))
        chunksOk.set(0)
        chunksSkipped.set(0)
        lastSkip = ""
        ensureLoaded()
    }

    /** Called when the call ends: drop the model state so the next call starts clean. */
    fun release() {
        dropRequested = true
    }

    /** One line for Settings: what the cleaner did on this call, and why not. */
    fun diag(): String {
        val ok = chunksOk.get()
        val skip = chunksSkipped.get()
        if (!ranOnce && ok == 0L && skip == 0L) return "Not run yet — start a call"
        return "This call: $ok cleaned · $skip skipped (${lastSkip.ifBlank { "none" }})"
    }

    /**
     * The audio-thread hook. `audioBuffer` is WebRTC's direct capture buffer
     * (interleaved PCM16); processed in place. Returns quickly (no-op) when
     * isolation is off, the library is unavailable, or the chunk is not a
     * 10 ms frame in a format the cleaner accepts.
     */
    fun process(audioFormat: Int, channelCount: Int, sampleRate: Int, audioBuffer: ByteBuffer) {
        if (dropRequested) {
            dropRequested = false
            if (handle != 0L) runCatching { nativeDestroy(handle) }
            handle = 0L
            handleRate = 0
        }
        if (!wanted.get()) return
        if (audioFormat != android.media.AudioFormat.ENCODING_PCM_16BIT || channelCount <= 0 || sampleRate <= 0) {
            skip("format")
            return
        }
        if (!audioBuffer.isDirect) {
            skip("buffer")
            return
        }
        if (!ensureLoaded()) {
            skip("library")
            return
        }
        val frames = audioBuffer.capacity() / 2 / channelCount
        if (frames != sampleRate / 100) {
            skip("length")
            return
        }
        if (handle == 0L || handleRate != sampleRate) {
            if (handle != 0L) runCatching { nativeDestroy(handle) }
            handle = runCatching { nativeCreate(sampleRate) }.getOrDefault(0L)
            handleRate = sampleRate
            if (handle != 0L) runCatching { nativeSetLevel(handle, level.get()) }
            if (handle == 0L) {
                skip("create")
                return
            }
        }
        val p = runCatching { nativeProcess(handle, audioBuffer, frames, channelCount) }.getOrDefault(-1f)
        if (p >= 0f) {
            speechProbability = p
            ranOnce = true
            chunksOk.incrementAndGet()
        } else {
            skip("native")
        }
    }

    private fun skip(why: String) {
        lastSkip = why
        chunksSkipped.incrementAndGet()
    }

    private fun ensureLoaded(): Boolean {
        if (loaded.get()) return true
        if (loadFailed.get()) return false
        return try {
            System.loadLibrary("kp_voice")
            loaded.set(true)
            true
        } catch (_: Throwable) {
            loadFailed.set(true)
            false
        }
    }

    @JvmStatic private external fun nativeCreate(sampleRate: Int): Long

    @JvmStatic private external fun nativeDestroy(handle: Long)

    @JvmStatic private external fun nativeSetLevel(handle: Long, level: Int)

    @JvmStatic private external fun nativeProcess(handle: Long, buffer: ByteBuffer, frames: Int, channels: Int): Float
}
