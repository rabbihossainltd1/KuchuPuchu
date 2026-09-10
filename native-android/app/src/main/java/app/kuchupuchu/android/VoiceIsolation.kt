package app.kuchupuchu.android

import android.content.Context
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

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
 * On by default, one switch in Settings › Privacy ("Voice isolation on calls")
 * for the rare device where the user prefers the raw microphone. The library
 * is loaded lazily on the first call; if the native library is missing or
 * refuses the device's audio format the microphone simply passes through
 * unchanged — a call is never broken by the cleaner.
 */
object VoiceIsolation {
    private const val PREF = "voice_isolation"

    fun isEnabled(ctx: Context): Boolean = ctx.getSharedPreferences("kp", 0).getBoolean(PREF, true)

    fun setEnabled(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences("kp", 0).edit().putBoolean(PREF, on).apply()
        wanted.set(on)
        if (!on) release()
    }

    /** Mirrors the pref so the audio thread never touches SharedPreferences. */
    private val wanted = AtomicBoolean(true)
    private val loaded = AtomicBoolean(false)
    private val loadFailed = AtomicBoolean(false)

    // The audio thread owns these; [release] from another thread only flags.
    @Volatile private var handle = 0L

    @Volatile private var handleRate = 0

    @Volatile private var dropRequested = false

    /** Last speech probability the model reported (0..1), for diagnostics / UI. */
    @Volatile var speechProbability = 0f
        private set

    /** Called once when a call starts, from the engine (any thread). */
    fun prepare(ctx: Context) {
        wanted.set(isEnabled(ctx))
        ensureLoaded()
    }

    /** Called when the call ends: drop the model state so the next call starts clean. */
    fun release() {
        dropRequested = true
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
        if (audioFormat != android.media.AudioFormat.ENCODING_PCM_16BIT || channelCount <= 0 || sampleRate <= 0) return
        if (!audioBuffer.isDirect) return
        if (!ensureLoaded()) return
        val frames = audioBuffer.capacity() / 2 / channelCount
        if (frames != sampleRate / 100) return
        if (handle == 0L || handleRate != sampleRate) {
            if (handle != 0L) runCatching { nativeDestroy(handle) }
            handle = runCatching { nativeCreate(sampleRate) }.getOrDefault(0L)
            handleRate = sampleRate
            if (handle == 0L) return
        }
        val p = runCatching { nativeProcess(handle, audioBuffer, frames, channelCount) }.getOrDefault(-1f)
        if (p >= 0f) speechProbability = p
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

    @JvmStatic private external fun nativeProcess(handle: Long, buffer: ByteBuffer, frames: Int, channels: Int): Float
}
