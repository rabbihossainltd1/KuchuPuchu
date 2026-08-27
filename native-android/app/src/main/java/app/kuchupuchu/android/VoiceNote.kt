package app.kuchupuchu.android

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * Voice notes: record to a temp m4a with MediaRecorder, play back with
 * MediaPlayer. One active player at a time per screen.
 */
object VoiceNote {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    var isRecording = false
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
            true
        }.getOrDefault(false)

    /** Stops and returns (file, seconds) or null on failure. */
    fun stop(): Pair<File, Int>? {
        if (!isRecording) return null
        isRecording = false
        val f = file
        val secs = ((System.currentTimeMillis() - startedAt) / 1000).toInt()
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        file = null
        return if (f != null && f.exists() && f.length() > 0 && secs >= 1) f to secs else null
    }

    fun cancel() {
        if (!isRecording) return
        isRecording = false
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        file?.delete()
        file = null
    }
}

/** Simple single-player helper for voice bubbles. */
class VoicePlayer {
    private var player: MediaPlayer? = null
    var playingId: String? = null
        private set

    fun toggle(id: String, url: String, onEnd: () -> Unit = {}): Boolean {
        if (playingId == id) {
            stop()
            return false
        }
        stop()
        return runCatching {
            val p = MediaPlayer()
            p.setDataSource(url)
            p.setOnCompletionListener {
                playingId = null
                onEnd()
            }
            p.prepare()
            p.start()
            player = p
            playingId = id
            true
        }.getOrDefault(false)
    }

    fun stop() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        playingId = null
    }
}
