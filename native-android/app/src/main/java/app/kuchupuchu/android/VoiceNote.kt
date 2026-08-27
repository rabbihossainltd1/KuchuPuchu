package app.kuchupuchu.android

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File

/**
 * Voice notes: record to a temp m4a with MediaRecorder, play back with
 * MediaPlayer from a downloaded cache file (auth headers can't go on a
 * stream URL, so bytes come through Api.download first).
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

/**
 * Single active player for voice bubbles. Plays from a cached copy
 * downloaded with auth; toggles feel instant (state flips first, audio
 * starts as soon as the file is ready).
 */
class VoicePlayer {
    private var player: MediaPlayer? = null
    var playingId: String? by mutableStateOf(null)
        private set

    /** Starts playing a voice message; downloads with auth on IO. */
    fun toggle(ctx: Context, id: String, fileKey: String, onEnded: () -> Unit = {}) {
        if (playingId == id) {
            stop()
            return
        }
        stop()
        playingId = id
        Thread {
            runCatching {
                val bytes = Api.download(fileKey)
                val f = File(ctx.cacheDir, "voice_msg_${id.hashCode()}.m4a")
                f.writeBytes(bytes)
                val p = MediaPlayer()
                p.setDataSource(f.absolutePath)
                p.setOnCompletionListener {
                    playingId = null
                    onEnded()
                }
                p.prepare()
                p.start()
                player = p
            }.onFailure {
                playingId = null
                player = null
            }
        }.start()
    }

    fun stop() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        playingId = null
    }
}
