package app.kuchupuchu.android

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Voice notes: record to a temp m4a with MediaRecorder, play back with
 * MediaPlayer from a cached download (auth headers can't go on a stream
 * URL, so bytes come through Api.download first). Files are keyed by
 * their immutable R2 key, so replays start instantly from cache.
 */
object VoiceNote {
    /** Owner round 31 (item 27): the recorder's peak is read every 100 ms while
     *  the finger is down; [stop] squashes those peaks into the bubble's bars. */
    const val SAMPLE_MS = 100L
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val amps = ArrayList<Int>()
    private val sampler =
        object : Runnable {
            override fun run() {
                if (!isRecording) return
                // maxAmplitude = the loudest sample since the previous read;
                // it throws once the recorder is gone, hence runCatching.
                amps.add(runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0))
                handler.postDelayed(this, SAMPLE_MS)
            }
        }
    var isRecording: Boolean = false
        private set

    fun start(ctx: Context): Boolean =
        runCatching {
            val f = File(ctx.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
            val r =
                if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx)
                else @Suppress("DEPRECATION") MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(64_000)
            r.setAudioSamplingRate(44_100)
            r.setOutputFile(f.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            file = f
            startedAt = System.currentTimeMillis()
            isRecording = true
            amps.clear()
            handler.removeCallbacks(sampler)
            handler.postDelayed(sampler, SAMPLE_MS)
            true
        }.getOrDefault(false)

    /** Recording elapsed time in ms (for the min-1-second rule). */
    fun elapsedMs(): Long = if (isRecording) System.currentTimeMillis() - startedAt else 0L

    /** Stops and returns the take (file, seconds, waveform bars) or null on failure. */
    fun stop(): VoiceTake? {
        if (!isRecording) return null
        isRecording = false
        handler.removeCallbacks(sampler)
        val f = file
        val secs = ((System.currentTimeMillis() - startedAt) / 1000).toInt()
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        file = null
        val wave = VoiceWaveform.squash(amps)
        amps.clear()
        return if (f != null && f.exists() && f.length() > 0 && secs >= 1) VoiceTake(f, secs, wave) else null
    }

    fun cancel() {
        if (!isRecording) return
        isRecording = false
        handler.removeCallbacks(sampler)
        amps.clear()
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        file?.delete()
        file = null
    }
}

/** One finished recording: the temp m4a, its length and the bubble's bars (0..100). */
class VoiceTake(val file: File, val seconds: Int, val waveform: List<Int>)

/**
 * Owner round 31 (item 27): the voice bubble's waveform. Pure maths, no Android
 * types, so the JVM unit test can pin it. The recorder's 100 ms peaks become
 * [BARS] values scaled to the take's loudest moment (a quiet note still shows
 * its shape), on a square-root curve so speech does not collapse into spikes.
 * The bars travel in the message meta (`waveform`), so BOTH sides draw the
 * same picture without decoding the AAC again.
 */
object VoiceWaveform {
    const val BARS = 36
    const val MAX_BARS = 64

    fun squash(samples: List<Int>, bars: Int = BARS): List<Int> {
        if (samples.isEmpty() || bars <= 0) return emptyList()
        val means = FloatArray(bars)
        for (i in 0 until bars) {
            val from = i * samples.size / bars
            val to = maxOf(from + 1, (i + 1) * samples.size / bars).coerceAtMost(samples.size)
            var acc = 0L
            for (j in from until to) acc += samples[j].coerceAtLeast(0)
            means[i] = acc.toFloat() / (to - from)
        }
        val peak = means.max()
        if (peak <= 0f) return List(bars) { 0 }
        return means.map { (sqrt(it / peak) * 100f).roundToInt().coerceIn(0, 100) }
    }

    /** Bars for a note recorded before the app sampled them (old messages,
     *  other clients): a fixed pattern from the message id, so the same note
     *  always looks the same and a tap still seeks on it. */
    fun pseudo(seed: String, bars: Int = BARS): List<Int> {
        var s = (seed.hashCode().toLong() and 0xffffffffL) or 1L
        return List(bars) { i ->
            s = (s * 1103515245L + 12345L) and 0x7fffffffL
            val r = ((s ushr 8) % 100L).toInt()
            val env = 0.55f + 0.45f * kotlin.math.sin(i * 6.4f / bars + 0.3f)
            (18f + r * 0.62f * env).roundToInt().coerceIn(8, 100)
        }
    }

    /** Clamps whatever the server or an old client sent into drawable bars. */
    fun sanitize(raw: List<Int>): List<Int> =
        raw.take(MAX_BARS).map { it.coerceIn(0, 100) }
}

/**
 * Single active player for voice bubbles. Plays from a cached copy
 * downloaded with auth; toggles feel instant (state flips first, audio
 * starts as soon as the file is ready, replays hit the cache).
 */
class VoicePlayer {
    private var player: MediaPlayer? = null
    var playingId: String? by mutableStateOf(null)
        private set
    var loadingId: String? by mutableStateOf(null)
        private set

    /** Owner round 31 (item 27): the pause button PAUSES now (it used to stop
     *  and forget the position); the paused note keeps its progress. */
    var pausedId: String? by mutableStateOf(null)
        private set

    /** 0..1 through the note that is playing or paused — the bubble paints its
     *  bars up to here, refreshed by [ticker] while audio runs. */
    var progress: Float by mutableStateOf(0f)
        private set
    private var currentId: String? = null
    private var pendingSeek = 0f
    private var loadGen = 0
    private var focusAm: AudioManager? = null
    private var focusToken: Any? = null
    private val handler = Handler(Looper.getMainLooper())
    private val ticker =
        object : Runnable {
            override fun run() {
                val p = player ?: return
                val d = runCatching { p.duration }.getOrDefault(0)
                if (d > 0) progress = (runCatching { p.currentPosition }.getOrDefault(0).toFloat() / d).coerceIn(0f, 1f)
                if (playingId != null) handler.postDelayed(this, TICK_MS)
            }
        }

    /** Play / pause / resume one voice message; downloads with auth on IO (cached). */
    fun toggle(ctx: Context, id: String, fileKey: String, onEnded: () -> Unit = {}) {
        val live = player
        if (live != null && currentId == id) {
            if (playingId == id) {
                runCatching { live.pause() }
                playingId = null
                pausedId = id
                handler.removeCallbacks(ticker)
            } else {
                runCatching { live.start() }
                pausedId = null
                playingId = id
                handler.post(ticker)
            }
            return
        }
        if (loadingId == id && currentId == id) {
            // Second tap while it is still downloading = cancel, as before.
            stop()
            return
        }
        // A seek that arrived before the note was loaded survives the reset.
        val want = pendingSeek
        stop()
        pendingSeek = want
        val gen = ++loadGen
        playingId = id
        loadingId = id
        currentId = id
        progress = want
        Thread {
            runCatching {
                val f = File(ctx.cacheDir, "voice_${fileKey.replace(Regex("[^A-Za-z0-9._-]"), "_")}")
                if (!f.exists() || f.length() == 0L) {
                    // R2 keys are unique per upload — safe to cache forever.
                    val bytes = Api.download(fileKey)
                    f.writeBytes(bytes)
                }
                val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val focus = gainDuckFocus(am)
                val p = MediaPlayer()
                p.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                p.setDataSource(f.absolutePath)
                p.setOnCompletionListener {
                    handler.removeCallbacks(ticker)
                    playingId = null
                    loadingId = null
                    pausedId = null
                    currentId = null
                    progress = 0f
                    releaseDuckFocus(am, focus)
                    focusToken = null
                    onEnded()
                }
                p.setOnErrorListener { _, _, _ ->
                    handler.removeCallbacks(ticker)
                    playingId = null
                    loadingId = null
                    pausedId = null
                    currentId = null
                    progress = 0f
                    releaseDuckFocus(am, focus)
                    focusToken = null
                    true
                }
                p.prepare() // local file — synchronous prepare is fine
                if (gen != loadGen) {
                    // A newer toggle won while this one was downloading.
                    runCatching { p.release() }
                    releaseDuckFocus(am, focus)
                } else {
                    // Read HERE, not at toggle time: a tap on the bars while the
                    // note was still downloading lands too.
                    val startAt = pendingSeek
                    pendingSeek = 0f
                    if (startAt > 0f) runCatching { p.seekTo((startAt * p.duration).toInt()) }
                    loadingId = null
                    p.start()
                    player = p
                    focusAm = am
                    focusToken = focus
                    handler.post(ticker)
                }
            }.onFailure {
                if (gen == loadGen) {
                    playingId = null
                    loadingId = null
                    currentId = null
                    player = null
                }
            }
        }.start()
    }

    /** Jump to a fraction of the note (tap on its bars); a note that is not
     *  loaded starts from there, a paused one resumes from there. */
    fun seekTo(ctx: Context, id: String, fileKey: String, frac: Float) {
        val f = frac.coerceIn(0f, 1f)
        val live = player
        if (live != null && currentId == id) {
            runCatching { live.seekTo((f * live.duration).toInt()) }
            progress = f
            if (playingId != id) {
                runCatching { live.start() }
                pausedId = null
                playingId = id
                handler.post(ticker)
            }
            return
        }
        if (loadingId == id && currentId == id) {
            // Still downloading — the load thread applies this once prepared.
            pendingSeek = f
            progress = f
            return
        }
        pendingSeek = f
        toggle(ctx, id, fileKey)
    }

    fun stop() {
        handler.removeCallbacks(ticker)
        loadGen++
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        playingId = null
        loadingId = null
        pausedId = null
        currentId = null
        progress = 0f
        pendingSeek = 0f
        focusAm?.let { releaseDuckFocus(it, focusToken) }
        focusAm = null
        focusToken = null
    }

    /**
     * Transient ducking focus, on both platforms: `AudioFocusRequest` is API 26+ and
     * this module's floor is 24, so building it unguarded meant `requestAudioFocus`
     * threw NoSuchMethodError at the top of the play block — no voice note played on
     * Android 7.x at all. Returns the token [releaseDuckFocus] hands back; the play
     * path does not depend on the result, exactly as before.
     */
    @Suppress("DEPRECATION")
    private fun gainDuckFocus(am: AudioManager): Any? =
        if (Build.VERSION.SDK_INT >= 26) {
            val req =
                android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    .build()
            if (am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) req else null
        } else {
            val listener = AudioManager.OnAudioFocusChangeListener { }
            val res =
                am.requestAudioFocus(
                    listener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
                )
            if (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) listener else null
        }

    /** Releases whatever [gainDuckFocus] took. Branches on the API level, never on `is`:
     *  a type test on a class the device does not have is itself the crash. */
    private fun releaseDuckFocus(am: AudioManager, token: Any?) {
        if (token == null) return
        if (Build.VERSION.SDK_INT >= 26) {
            runCatching { am.abandonAudioFocusRequest(token as android.media.AudioFocusRequest) }
        } else {
            @Suppress("DEPRECATION")
            runCatching { am.abandonAudioFocus(token as AudioManager.OnAudioFocusChangeListener) }
        }
    }

    private companion object {
        const val TICK_MS = 80L
    }
}
