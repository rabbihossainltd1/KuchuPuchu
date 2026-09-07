package app.kuchupuchu.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min

/**
 * Owner round 31 item 20: "Share audio via screen share".
 *
 * Android has no way to hand a second audio source to a WebRTC peer
 * connection without a second transceiver and a full renegotiation, so the
 * device sounds are MIXED INTO THE MICROPHONE TRACK instead: while a screen
 * share is up and the toggle is on, an [AudioRecord] built on the projection's
 * [AudioPlaybackCaptureConfiguration] (API 29+) pulls what the phone is
 * playing (media, games, the video the user is showing) into a ring buffer,
 * and WebRTC's `AudioRecordDataCallback` — called for every ~10ms mic buffer
 * just before it is handed to the encoder — adds the matching slice to the
 * mic samples. The other side hears the user AND the phone.
 *
 * The capture is resampled/re-channelled on the fly to whatever the mic
 * session negotiated (WebRTC decides sample rate + channel count per device;
 * the capture is asked for the same rate, and falls back to 48 kHz + mono
 * arithmetic when the platform insists on something else).
 *
 * What is NOT captured (platform rule, not ours): apps that opted out of
 * playback capture (most DRM players, some banking apps), and the call's own
 * voice-communication stream — so the far side never hears itself echoed.
 */
object SystemAudioTap {
    private const val PREF = "kp_share_system_audio"

    fun isEnabled(ctx: Context): Boolean = ctx.getSharedPreferences("kp", 0).getBoolean(PREF, false)

    fun setEnabled(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences("kp", 0).edit().putBoolean(PREF, on).apply()
    }

    /** True where the platform can do playback capture at all. */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= 29

    private class Session(val record: AudioRecord, val rate: Int, val channels: Int) {
        // ~400ms of captured PCM16 — enough to ride out scheduling jitter
        // between the capture thread and WebRTC's record thread, small
        // enough that the shared sound stays in sync with the shared picture.
        private val ring = ShortArray(max(rate * channels * 2 / 5, 4096))
        private var head = 0
        private var size = 0
        private val lock = Any()

        @Volatile var running = true
        val thread =
            Thread({
                val buf = ShortArray(rate / 100 * channels)
                while (running) {
                    val n = runCatching { record.read(buf, 0, buf.size) }.getOrDefault(-1)
                    if (n <= 0) {
                        if (n < 0) break
                        continue
                    }
                    synchronized(lock) {
                        for (i in 0 until n) {
                            ring[(head + size) % ring.size] = buf[i]
                            if (size < ring.size) size++ else head = (head + 1) % ring.size
                        }
                    }
                }
            }, "kp-sysaudio").apply { isDaemon = true }

        /** Pop up to [count] samples; missing samples read as silence. */
        fun take(out: ShortArray, count: Int) {
            synchronized(lock) {
                for (i in 0 until count) {
                    if (size > 0) {
                        out[i] = ring[head]
                        head = (head + 1) % ring.size
                        size--
                    } else {
                        out[i] = 0
                    }
                }
            }
        }

        fun close() {
            running = false
            runCatching { record.stop() }
            runCatching { record.release() }
        }
    }

    private val session = AtomicReference<Session?>(null)

    /** Starts pulling the phone's playback while [projection] lives. Safe to call twice. */
    fun start(ctx: Context, projection: MediaProjection) {
        if (!supported || !isEnabled(ctx) || session.get() != null) return
        if (Build.VERSION.SDK_INT < 29) return
        // Playback capture is an AudioRecord, so it needs the microphone
        // permission like any recorder; a call is already holding it, but
        // the check keeps this safe (and lint honest) if it ever runs without.
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
        val config =
            AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
        val channels = 1
        var record: AudioRecord? = null
        var rate = 0
        // 48k is what every modern mixer runs at; the others cover devices
        // whose playback-capture path only opens at a legacy rate.
        for (candidate in intArrayOf(48_000, 44_100, 16_000)) {
            val minBuf =
                AudioRecord.getMinBufferSize(candidate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                    .coerceAtLeast(candidate / 10 * 2)
            val r =
                runCatching {
                    AudioRecord.Builder()
                        .setAudioPlaybackCaptureConfig(config)
                        .setAudioFormat(
                            AudioFormat.Builder()
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setSampleRate(candidate)
                                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                                .build(),
                        )
                        .setBufferSizeInBytes(minBuf * 2)
                        .build()
                }.getOrNull() ?: continue
            if (r.state == AudioRecord.STATE_INITIALIZED && runCatching { r.startRecording() }.isSuccess) {
                record = r
                rate = candidate
                break
            }
            runCatching { r.release() }
        }
        if (record == null || rate == 0) return
        val s = Session(record, rate, channels)
        if (!session.compareAndSet(null, s)) {
            s.close()
            return
        }
        s.thread.start()
    }

    fun stop() {
        session.getAndSet(null)?.close()
    }

    val active: Boolean get() = session.get() != null

    private var scratch = ShortArray(0)

    /**
     * WebRTC's per-buffer hook (`AudioRecordDataCallback`): mixes the captured
     * playback into the mic samples IN PLACE. No-op while nothing is captured,
     * so the plain call path costs one null check per 10ms.
     */
    fun mixInto(audioFormat: Int, channelCount: Int, sampleRate: Int, audioBuffer: ByteBuffer) {
        val s = session.get() ?: return
        if (audioFormat != AudioFormat.ENCODING_PCM_16BIT || channelCount <= 0 || sampleRate <= 0) return
        val micSamples = audioBuffer.capacity() / 2
        val frames = micSamples / channelCount
        // Captured frames needed for this many mic frames at the capture rate.
        val need = (frames.toLong() * s.rate / sampleRate).toInt().coerceAtLeast(1) * s.channels
        if (scratch.size < need) scratch = ShortArray(need)
        val src = scratch
        s.take(src, need)
        val mic = audioBuffer.duplicate().order(ByteOrder.nativeOrder())
        val step = s.rate.toDouble() / sampleRate
        for (f in 0 until frames) {
            // Nearest-neighbour resample + down/up-mix: fine for phone
            // speakers over an Opus voice channel; a proper filter would cost
            // more than it gives here.
            val srcFrame = min((f * step).toInt(), need / s.channels - 1)
            var acc = 0
            for (c in 0 until s.channels) acc += src[srcFrame * s.channels + c].toInt()
            val sys = acc / s.channels
            for (c in 0 until channelCount) {
                val idx = (f * channelCount + c) * 2
                val cur = mic.getShort(idx).toInt()
                // Sum with a soft ceiling: both sources at full scale would
                // clip, so the phone sound comes in at ~70% and the total is
                // clamped to 16-bit.
                val mixed = (cur + sys * 7 / 10).coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                mic.putShort(idx, mixed.toShort())
            }
        }
    }
}
