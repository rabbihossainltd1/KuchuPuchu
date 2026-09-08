package app.kuchupuchu.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Owner round 31 (item 30): the status share screen's crop window. Normalised
 * to the DISPLAY orientation of the media (0..1, top-left origin) so the same
 * box drives the photo crop, the video crop and the on-screen overlay.
 */
data class CropBox(val x: Float, val y: Float, val w: Float, val h: Float) {
    fun isFull(): Boolean = x <= 0.002f && y <= 0.002f && w >= 0.996f && h >= 0.996f

    /** Dragged from the inside: slides, never leaves the frame. */
    fun moved(dx: Float, dy: Float): CropBox =
        CropBox((x + dx).coerceIn(0f, 1f - w), (y + dy).coerceIn(0f, 1f - h), w, h)

    /**
     * Dragged by a corner (2 = top-left, 3 = top-right, 4 = bottom-left,
     * 5 = bottom-right). The opposite corner stays put. `lock` is the wanted
     * width/height in PIXELS (null = free), `boxAspect` the stage's own
     * width/height in pixels, so a 1:1 lock is square on screen even though
     * the box is stored in normalised units.
     */
    fun resized(corner: Int, dx: Float, dy: Float, lock: Float?, boxAspect: Float): CropBox {
        val left = corner == 2 || corner == 4
        val top = corner == 2 || corner == 3
        val ax = if (left) x + w else x
        val ay = if (top) y + h else y
        val roomW = if (left) ax else 1f - ax
        val roomH = if (top) ay else 1f - ay
        val wantW = (if (left) w - dx else w + dx).coerceIn(0f, roomW)
        val wantH = (if (top) h - dy else h + dy).coerceIn(0f, roomH)
        val ww: Float
        val hh: Float
        if (lock == null) {
            ww = maxOf(wantW, MIN).coerceAtMost(roomW)
            hh = maxOf(wantH, MIN).coerceAtMost(roomH)
        } else {
            ww = minOf(wantW, wantH * lock / boxAspect)
            hh = ww * boxAspect / lock
            if (ww < MIN || hh < MIN) return this
        }
        return CropBox(if (left) ax - ww else ax, if (top) ay - hh else ay, ww, hh)
    }

    companion object {
        val FULL = CropBox(0f, 0f, 1f, 1f)
        const val MIN = 0.12f

        /** The largest centred box with a given pixel aspect inside a stage. */
        fun centered(lock: Float, boxAspect: Float): CropBox {
            var w = 1f
            var h = w * boxAspect / lock
            if (h > 1f) {
                h = 1f
                w = h * lock / boxAspect
            }
            return CropBox((1f - w) / 2f, (1f - h) / 2f, w, h)
        }
    }
}

/**
 * Pure maths behind the share screen — no Android classes, so it is pinned by
 * a JVM unit test (VideoPlanTest): the one-minute rule, the trim handles, the
 * output size and the texture mapping that performs rotation + crop on the GPU.
 */
object VideoPlan {
    const val MAX_STATUS_MS = 60_000L
    const val MIN_STATUS_MS = 1_000L
    const val MAX_SIDE = 1280
    const val UPLOAD_LIMIT = 25L * 1024 * 1024

    /** Below this an untouched, untrimmed, uncropped mp4 is uploaded as-is. */
    const val PASS_THROUGH_LIMIT = 20L * 1024 * 1024
    private const val VIDEO_BUDGET_BYTES = 19_000_000L

    /** Default selection: the first minute, or the whole clip when shorter. */
    fun defaultWindow(durationMs: Long): Pair<Long, Long> = 0L to durationMs.coerceAtMost(MAX_STATUS_MS)

    /** Start handle: never past (end − 1s); a window over a minute pushes the end along. */
    fun moveStart(start: Long, end: Long, durationMs: Long, newStart: Long): Pair<Long, Long> {
        val e0 = end.coerceIn(MIN_STATUS_MS, durationMs.coerceAtLeast(MIN_STATUS_MS))
        val s = newStart.coerceIn(0L, e0 - MIN_STATUS_MS)
        val e = if (e0 - s > MAX_STATUS_MS) s + MAX_STATUS_MS else e0
        return s to e
    }

    /** End handle: never before (start + 1s); a window over a minute pulls the start along. */
    fun moveEnd(start: Long, end: Long, durationMs: Long, newEnd: Long): Pair<Long, Long> {
        val s0 = start.coerceIn(0L, (durationMs - MIN_STATUS_MS).coerceAtLeast(0L))
        val e = newEnd.coerceIn(s0 + MIN_STATUS_MS, durationMs.coerceAtLeast(s0 + MIN_STATUS_MS))
        val s = if (e - s0 > MAX_STATUS_MS) e - MAX_STATUS_MS else s0
        return s to e
    }

    /** Dragging the window itself slides it, keeping its length ("trim from any point"). */
    fun slide(start: Long, end: Long, durationMs: Long, deltaMs: Long): Pair<Long, Long> {
        val len = (end - start).coerceIn(MIN_STATUS_MS, durationMs.coerceAtLeast(MIN_STATUS_MS))
        val s = (start + deltaMs).coerceIn(0L, (durationMs - len).coerceAtLeast(0L))
        return s to s + len
    }

    fun displaySize(codedW: Int, codedH: Int, rotation: Int): Pair<Int, Int> =
        if (rotation == 90 || rotation == 270) codedH to codedW else codedW to codedH

    /** Encoded size: the crop's pixels, capped at 1280 on the long side, 16-aligned. */
    fun outputSize(codedW: Int, codedH: Int, rotation: Int, crop: CropBox?): Pair<Int, Int> {
        val (dw, dh) = displaySize(codedW, codedH, rotation)
        val c = crop ?: CropBox.FULL
        var w = dw * c.w
        var h = dh * c.h
        val long = maxOf(w, h)
        if (long > MAX_SIDE) {
            val s = MAX_SIDE / long
            w *= s
            h *= s
        }
        return align16(w) to align16(h)
    }

    private fun align16(v: Float): Int = ((v / 16f).roundToInt() * 16).coerceAtLeast(16)

    /** Bits per second: quality-led, but a full minute must land under the 25 MB upload cap. */
    fun bitrate(durationMs: Long, w: Int, h: Int, fps: Int): Int {
        val secs = (durationMs / 1000.0).coerceAtLeast(1.0)
        val budget = (VIDEO_BUDGET_BYTES * 8 / secs).toLong()
        val quality = (w.toLong() * h * fps.coerceIn(15, 60) * 0.09).toLong()
        return minOf(budget, quality, 6_000_000L).coerceAtLeast(500_000L).toInt()
    }

    /**
     * Texture coordinates for the full-screen quad (corners BL, BR, TL, TR),
     * in GL orientation, BEFORE the SurfaceTexture matrix is applied. The
     * decoder is told rotation 0, so the frame arrives unrotated: the mapping
     * below reads the crop window out of the rotated picture the user saw.
     */
    fun texCoords(rotation: Int, crop: CropBox?): FloatArray {
        val c = crop ?: CropBox.FULL
        val corners = arrayOf(0f to 0f, 1f to 0f, 0f to 1f, 1f to 1f)
        val out = FloatArray(8)
        corners.forEachIndexed { i, (bx, byGl) ->
            val xd = c.x + bx * c.w
            val yd = c.y + (1f - byGl) * c.h
            val (xs, ys) =
                when (rotation) {
                    90 -> yd to (1f - xd)
                    180 -> (1f - xd) to (1f - yd)
                    270 -> (1f - yd) to xd
                    else -> xd to yd
                }
            out[i * 2] = xs
            out[i * 2 + 1] = 1f - ys
        }
        return out
    }

    /** Untouched upload only when nothing was trimmed or cropped and the file is small. */
    fun needsTranscode(crop: CropBox?, start: Long, end: Long, durationMs: Long, bytes: Long, mime: String): Boolean =
        (crop != null && !crop.isFull()) ||
            start > 0L ||
            end < durationMs ||
            bytes < 0L ||
            bytes > PASS_THROUGH_LIMIT ||
            (mime != "video/mp4" && mime != "video/3gpp")
}

/**
 * Owner round 31 (item 30): trims (from any point), crops and downsizes a
 * gallery video into a status clip. MediaCodec decodes onto a GPU texture,
 * one quad draw applies rotation + crop, MediaCodec encodes H.264 from that
 * surface; the AAC audio inside the window is copied through untouched.
 * Everything here is blocking — call it from an IO thread.
 */
object VideoExport {
    class Failed(message: String) : Exception(message)

    data class Source(val durationMs: Long, val codedW: Int, val codedH: Int, val rotation: Int) {
        val displayW: Int get() = if (rotation == 90 || rotation == 270) codedH else codedW
        val displayH: Int get() = if (rotation == 90 || rotation == 270) codedW else codedH
    }

    fun probe(ctx: Context, uri: Uri): Source? {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(ctx, uri)
            val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            if (dur <= 0L || w <= 0 || h <= 0) null else Source(dur, w, h, ((rot % 360) + 360) % 360)
        } catch (e: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }

    /** Evenly spaced small frames for the trim strip; `onFrame` fires on this thread. */
    fun thumbnails(ctx: Context, uri: Uri, durationMs: Long, count: Int, onFrame: (Int, Bitmap) -> Unit) {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(ctx, uri)
            for (i in 0 until count) {
                val tUs = (durationMs * 1000.0 * (i + 0.5) / count).toLong()
                val bmp =
                    if (Build.VERSION.SDK_INT >= 27) {
                        r.getScaledFrameAtTime(tUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 160, 160)
                    } else {
                        r.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { full ->
                            val s = 160f / maxOf(full.width, full.height).coerceAtLeast(1)
                            if (s >= 1f) full
                            else Bitmap.createScaledBitmap(full, (full.width * s).toInt().coerceAtLeast(1), (full.height * s).toInt().coerceAtLeast(1), true)
                        }
                    }
                if (bmp != null) onFrame(i, bmp)
            }
        } catch (e: Exception) {
            // a strip with gaps is fine; the handles still work on the timeline
        } finally {
            runCatching { r.release() }
        }
    }

    /** Re-encodes [startMs, endMs] (+ optional crop) into an H.264/AAC mp4 at `out`;
     *  `onProgress` gets 0..1 as frames land (called on this thread). */
    fun export(ctx: Context, uri: Uri, startMs: Long, endMs: Long, crop: CropBox?, out: File, onProgress: (Float) -> Unit = {}) {
        val src = probe(ctx, uri) ?: throw Failed("Could not read that video.")
        val startUs = startMs.coerceAtLeast(0L) * 1000L
        val endUs = endMs.coerceAtMost(src.durationMs) * 1000L
        if (endUs - startUs < 200_000L) throw Failed("That clip is too short.")
        if (out.exists()) out.delete()
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var sink: GlFrameSink? = null
        var inputSurface: Surface? = null
        var muxer: MediaMuxer? = null
        var muxerStarted = false
        try {
            extractor.setDataSource(ctx, uri, null)
            var videoTrack = -1
            var audioTrack = -1
            var videoFormat: MediaFormat? = null
            var audioFormat: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (videoTrack < 0 && mime.startsWith("video/")) {
                    videoTrack = i
                    videoFormat = f
                } else if (audioTrack < 0 && mime == MediaFormat.MIMETYPE_AUDIO_AAC) {
                    audioTrack = i
                    audioFormat = f
                }
            }
            val vf = videoFormat ?: throw Failed("No video in that file.")
            val rotation =
                if (vf.containsKey(MediaFormat.KEY_ROTATION)) vf.getInteger(MediaFormat.KEY_ROTATION) else src.rotation
            val codedW = vf.getInteger(MediaFormat.KEY_WIDTH)
            val codedH = vf.getInteger(MediaFormat.KEY_HEIGHT)
            val (outW, outH) = VideoPlan.outputSize(codedW, codedH, rotation, crop)
            val fps = runCatching { vf.getInteger(MediaFormat.KEY_FRAME_RATE) }.getOrDefault(30).coerceIn(15, 60)
            val audioInRange = audioTrack >= 0 && audioHasSamples(ctx, uri, audioTrack, startUs, endUs)

            val mux = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            muxer = mux
            // The audio track is declared up front (both tracks must exist before
            // start); the video track is declared when the encoder reports its format.
            val audioMuxTrack = if (audioInRange) mux.addTrack(audioFormat!!) else -1

            val encFormat =
                MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, outW, outH).apply {
                    setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                    setInteger(MediaFormat.KEY_BIT_RATE, VideoPlan.bitrate(endMs - startMs, outW, outH, fps))
                    setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                }
            val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            encoder = enc
            enc.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val inSurface = enc.createInputSurface()
            inputSurface = inSurface
            enc.start()
            val gl = GlFrameSink(inSurface, outW, outH, VideoPlan.texCoords(rotation, crop))
            sink = gl

            // Rotation is OURS: the decoder hands over the unrotated frame and the
            // texture mapping turns + crops it, so every device behaves the same.
            vf.setInteger(MediaFormat.KEY_ROTATION, 0)
            val dec = MediaCodec.createDecoderByType(vf.getString(MediaFormat.KEY_MIME)!!)
            decoder = dec
            dec.configure(vf, gl.decoderSurface, null, 0)
            dec.start()
            extractor.selectTrack(videoTrack)
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

            val info = MediaCodec.BufferInfo()
            val encInfo = MediaCodec.BufferInfo()
            var videoMuxTrack = -1
            var inputDone = false
            var decoderDone = false
            var encoderDone = false
            var rendered = 0
            var lastProgress = System.currentTimeMillis()

            fun drainEncoder(untilEos: Boolean) {
                while (true) {
                    val idx = enc.dequeueOutputBuffer(encInfo, if (untilEos) 10_000L else 0L)
                    when {
                        idx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                            if (!untilEos) return
                            if (System.currentTimeMillis() - lastProgress > 8_000L) throw Failed("Video encode stalled.")
                        }
                        idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            if (muxerStarted) throw Failed("Encoder format changed twice.")
                            videoMuxTrack = mux.addTrack(enc.outputFormat)
                            mux.start()
                            muxerStarted = true
                        }
                        idx >= 0 -> {
                            val buf = enc.getOutputBuffer(idx)
                            val config = (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            if (buf != null && encInfo.size > 0 && !config) {
                                if (!muxerStarted) throw Failed("Encoder wrote before its format.")
                                buf.position(encInfo.offset)
                                buf.limit(encInfo.offset + encInfo.size)
                                mux.writeSampleData(videoMuxTrack, buf, encInfo)
                                lastProgress = System.currentTimeMillis()
                            }
                            enc.releaseOutputBuffer(idx, false)
                            if ((encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                                encoderDone = true
                                return
                            }
                        }
                    }
                }
            }

            while (!encoderDone) {
                if (!inputDone) {
                    val inIdx = dec.dequeueInputBuffer(10_000L)
                    if (inIdx >= 0) {
                        val buf = dec.getInputBuffer(inIdx) ?: throw Failed("Decoder gave no buffer.")
                        val size = extractor.readSampleData(buf, 0)
                        val t = extractor.sampleTime
                        if (size < 0 || t > endUs) {
                            dec.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            dec.queueInputBuffer(inIdx, 0, size, t, 0)
                            extractor.advance()
                        }
                    }
                }
                if (!decoderDone) {
                    val outIdx = dec.dequeueOutputBuffer(info, 10_000L)
                    if (outIdx >= 0) {
                        // Skipped lead-in frames (the GOP before the start handle)
                        // are progress too — a long GOP must not read as a stall.
                        lastProgress = System.currentTimeMillis()
                        val eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        val pts = info.presentationTimeUs
                        // Frames before the start handle are decoded (the GOP needs
                        // them) but never drawn; frames past the end never arrive.
                        val render = info.size > 0 && pts >= startUs && pts <= endUs
                        if (render) drainEncoder(false)
                        dec.releaseOutputBuffer(outIdx, render)
                        if (render) {
                            gl.awaitFrame()
                            gl.draw((pts - startUs) * 1000L)
                            rendered++
                            lastProgress = System.currentTimeMillis()
                            onProgress(((pts - startUs).toFloat() / (endUs - startUs)).coerceIn(0f, 1f))
                        }
                        if (eos) {
                            decoderDone = true
                            if (rendered == 0) throw Failed("Nothing to encode in that range.")
                            enc.signalEndOfInputStream()
                        }
                    } else if (System.currentTimeMillis() - lastProgress > 8_000L) {
                        throw Failed("Video decode stalled.")
                    }
                }
                drainEncoder(decoderDone)
            }

            if (audioMuxTrack >= 0 && muxerStarted) copyAudio(ctx, uri, audioTrack, audioMuxTrack, startUs, endUs, mux)
            mux.stop()
            muxerStarted = false
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            runCatching { sink?.release() }
            runCatching { inputSurface?.release() }
            runCatching { extractor.release() }
            if (muxerStarted) runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
        }
        if (!out.exists() || out.length() < 1024L) {
            out.delete()
            throw Failed("Video export failed.")
        }
    }

    /**
     * Fallback when the codec path fails on a device: the samples inside the
     * window are copied into a fresh mp4 without re-encoding (the start snaps
     * back to the previous keyframe, the length stays what was chosen). No crop.
     */
    fun passthrough(ctx: Context, uri: Uri, startMs: Long, endMs: Long, out: File) {
        val src = probe(ctx, uri) ?: throw Failed("Could not read that video.")
        val startUs = startMs.coerceAtLeast(0L) * 1000L
        val windowUs = ((endMs.coerceAtMost(src.durationMs) - startMs) * 1000L).coerceAtLeast(200_000L)
        if (out.exists()) out.delete()
        var baseUs = startUs
        val look = MediaExtractor()
        try {
            look.setDataSource(ctx, uri, null)
            for (i in 0 until look.trackCount) {
                if (look.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) {
                    look.selectTrack(i)
                    look.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                    val t = look.sampleTime
                    if (t >= 0L) baseUs = t
                    break
                }
            }
        } finally {
            runCatching { look.release() }
        }
        val endUs = baseUs + windowUs
        val ex = MediaExtractor()
        var mux: MediaMuxer? = null
        var started = false
        try {
            ex.setDataSource(ctx, uri, null)
            val m = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            mux = m
            val tracks = HashMap<Int, Int>()
            var haveVideo = false
            var haveAudio = false
            var bufSize = 1 shl 20
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                val keep =
                    when {
                        !haveVideo && mime.startsWith("video/") -> {
                            haveVideo = true
                            true
                        }
                        !haveAudio && mime == MediaFormat.MIMETYPE_AUDIO_AAC -> {
                            haveAudio = true
                            true
                        }
                        else -> false
                    }
                if (!keep) continue
                ex.selectTrack(i)
                tracks[i] = m.addTrack(f)
                if (f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) bufSize = maxOf(bufSize, f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
            }
            if (!haveVideo) throw Failed("No video in that file.")
            if (src.rotation != 0) m.setOrientationHint(src.rotation)
            ex.seekTo(baseUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            m.start()
            started = true
            var buf = ByteBuffer.allocateDirect(bufSize)
            val info = MediaCodec.BufferInfo()
            while (tracks.isNotEmpty()) {
                val size =
                    try {
                        ex.readSampleData(buf, 0)
                    } catch (e: IllegalArgumentException) {
                        if (buf.capacity() >= (32 shl 20)) throw e
                        buf = ByteBuffer.allocateDirect(buf.capacity() * 2)
                        continue
                    }
                if (size < 0) break
                val track = ex.sampleTrackIndex
                val t = ex.sampleTime
                val muxTrack = tracks[track]
                if (muxTrack != null && t >= baseUs) {
                    if (t > endUs) {
                        ex.unselectTrack(track)
                        tracks.remove(track)
                    } else {
                        val sync = (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                        info.set(0, size, t - baseUs, if (sync) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                        m.writeSampleData(muxTrack, buf, info)
                    }
                }
                if (tracks.isEmpty() || !ex.advance()) break
            }
            m.stop()
            started = false
        } finally {
            runCatching { ex.release() }
            if (started) runCatching { mux?.stop() }
            runCatching { mux?.release() }
        }
        if (!out.exists() || out.length() < 1024L) {
            out.delete()
            throw Failed("Video export failed.")
        }
    }

    private fun audioHasSamples(ctx: Context, uri: Uri, track: Int, startUs: Long, endUs: Long): Boolean {
        val ex = MediaExtractor()
        return try {
            ex.setDataSource(ctx, uri, null)
            ex.selectTrack(track)
            ex.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            var found = false
            var guard = 0
            while (guard++ < 64) {
                val t = ex.sampleTime
                if (t < 0L || t > endUs) break
                if (t >= startUs) {
                    found = true
                    break
                }
                if (!ex.advance()) break
            }
            found
        } catch (e: Exception) {
            false
        } finally {
            runCatching { ex.release() }
        }
    }

    private fun copyAudio(ctx: Context, uri: Uri, track: Int, muxTrack: Int, startUs: Long, endUs: Long, mux: MediaMuxer) {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(ctx, uri, null)
            ex.selectTrack(track)
            ex.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            var buf = ByteBuffer.allocateDirect(256 * 1024)
            val info = MediaCodec.BufferInfo()
            var last = -1L
            while (true) {
                val size =
                    try {
                        ex.readSampleData(buf, 0)
                    } catch (e: IllegalArgumentException) {
                        if (buf.capacity() >= (16 shl 20)) throw e
                        buf = ByteBuffer.allocateDirect(buf.capacity() * 4)
                        continue
                    }
                if (size < 0) break
                val t = ex.sampleTime
                if (t > endUs) break
                if (t >= startUs) {
                    val pts = t - startUs
                    if (pts > last) {
                        val sync = (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                        info.set(0, size, pts, if (sync) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                        mux.writeSampleData(muxTrack, buf, info)
                        last = pts
                    }
                }
                if (!ex.advance()) break
            }
        } finally {
            runCatching { ex.release() }
        }
    }
}

/**
 * EGL window on the encoder's input surface + an external texture the decoder
 * renders into. One quad per frame; the texture coordinates carry the
 * rotation and the crop, the SurfaceTexture matrix the buffer's own flip.
 */
private class GlFrameSink(
    private val encoderSurface: Surface,
    private val width: Int,
    private val height: Int,
    texCoords: FloatArray,
) : SurfaceTexture.OnFrameAvailableListener {
    private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private val frames = Semaphore(0)
    private val thread = HandlerThread("kp-status-frames").apply { start() }
    private var program = 0
    private var texId = 0
    private var aPosition = 0
    private var aTexCoord = 0
    private var uTexMatrix = 0
    private val stMatrix = FloatArray(16)
    private val vertices: FloatBuffer = floats(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
    private val texBuf: FloatBuffer = floats(texCoords)
    private lateinit var surfaceTexture: SurfaceTexture
    lateinit var decoderSurface: Surface
        private set

    init {
        try {
            setUp()
        } catch (e: Exception) {
            teardownEgl()
            throw e
        }
    }

    private fun setUp() {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        if (eglDisplay == EGL14.EGL_NO_DISPLAY) throw VideoExport.Failed("No EGL display.")
        val version = IntArray(2)
        if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) throw VideoExport.Failed("EGL init failed.")
        val attribs =
            intArrayOf(
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL_RECORDABLE_ANDROID, 1,
                EGL14.EGL_NONE,
            )
        val configs = arrayOfNulls<EGLConfig>(1)
        val num = IntArray(1)
        if (!EGL14.eglChooseConfig(eglDisplay, attribs, 0, configs, 0, 1, num, 0) || num[0] <= 0) {
            throw VideoExport.Failed("No recordable EGL config.")
        }
        val config = configs[0] ?: throw VideoExport.Failed("No recordable EGL config.")
        eglContext =
            EGL14.eglCreateContext(
                eglDisplay,
                config,
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE),
                0,
            )
        if (eglContext == EGL14.EGL_NO_CONTEXT) throw VideoExport.Failed("EGL context failed.")
        eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, config, encoderSurface, intArrayOf(EGL14.EGL_NONE), 0)
        if (eglSurface == EGL14.EGL_NO_SURFACE) throw VideoExport.Failed("EGL surface failed.")
        if (!EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)) throw VideoExport.Failed("EGL makeCurrent failed.")

        program = buildProgram()
        aPosition = GLES20.glGetAttribLocation(program, "aPosition")
        aTexCoord = GLES20.glGetAttribLocation(program, "aTextureCoord")
        uTexMatrix = GLES20.glGetUniformLocation(program, "uTexMatrix")
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        texId = ids[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
        GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR.toFloat())
        GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR.toFloat())
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        surfaceTexture = SurfaceTexture(texId)
        // Callbacks land on their own looper thread, never on the thread that
        // waits for them (and never on the UI thread).
        surfaceTexture.setOnFrameAvailableListener(this, Handler(thread.looper))
        decoderSurface = Surface(surfaceTexture)
    }

    override fun onFrameAvailable(st: SurfaceTexture) {
        frames.release()
    }

    /** Blocks until the decoder's rendered frame is in the texture. */
    fun awaitFrame() {
        if (!frames.tryAcquire(2500, TimeUnit.MILLISECONDS)) throw VideoExport.Failed("Video decode stalled.")
        frames.drainPermits()
        surfaceTexture.updateTexImage()
        surfaceTexture.getTransformMatrix(stMatrix)
    }

    fun draw(ptsNs: Long) {
        GLES20.glViewport(0, 0, width, height)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
        GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, stMatrix, 0)
        GLES20.glEnableVertexAttribArray(aPosition)
        GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 8, vertices)
        GLES20.glEnableVertexAttribArray(aTexCoord)
        GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 8, texBuf)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(aPosition)
        GLES20.glDisableVertexAttribArray(aTexCoord)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, 0)
        EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, ptsNs)
        if (!EGL14.eglSwapBuffers(eglDisplay, eglSurface)) throw VideoExport.Failed("Frame hand-off failed.")
    }

    fun release() {
        if (this::decoderSurface.isInitialized) runCatching { decoderSurface.release() }
        if (this::surfaceTexture.isInitialized) runCatching { surfaceTexture.release() }
        runCatching { GLES20.glDeleteProgram(program) }
        runCatching { GLES20.glDeleteTextures(1, intArrayOf(texId), 0) }
        teardownEgl()
    }

    private fun teardownEgl() {
        if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, eglSurface)
            if (eglContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(eglDisplay, eglContext)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(eglDisplay)
        }
        eglDisplay = EGL14.EGL_NO_DISPLAY
        eglContext = EGL14.EGL_NO_CONTEXT
        eglSurface = EGL14.EGL_NO_SURFACE
        runCatching { thread.quitSafely() }
    }

    private fun buildProgram(): Int {
        val vs = compile(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
        val p = GLES20.glCreateProgram()
        if (p == 0) throw VideoExport.Failed("GL program failed.")
        GLES20.glAttachShader(p, vs)
        GLES20.glAttachShader(p, fs)
        GLES20.glLinkProgram(p)
        val status = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
        GLES20.glDeleteShader(vs)
        GLES20.glDeleteShader(fs)
        if (status[0] != GLES20.GL_TRUE) {
            GLES20.glDeleteProgram(p)
            throw VideoExport.Failed("GL program failed.")
        }
        return p
    }

    private fun compile(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        if (shader == 0) throw VideoExport.Failed("GL shader failed.")
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val status = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) {
            GLES20.glDeleteShader(shader)
            throw VideoExport.Failed("GL shader failed.")
        }
        return shader
    }

    private fun floats(values: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(values.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
            put(values)
            position(0)
        }

    companion object {
        private const val EGL_RECORDABLE_ANDROID = 0x3142
        private const val VERTEX_SHADER =
            "uniform mat4 uTexMatrix;\n" +
                "attribute vec4 aPosition;\n" +
                "attribute vec4 aTextureCoord;\n" +
                "varying vec2 vTextureCoord;\n" +
                "void main() {\n" +
                "    gl_Position = aPosition;\n" +
                "    vTextureCoord = (uTexMatrix * aTextureCoord).xy;\n" +
                "}\n"
        private const val FRAGMENT_SHADER =
            "#extension GL_OES_EGL_image_external : require\n" +
                "precision mediump float;\n" +
                "varying vec2 vTextureCoord;\n" +
                "uniform samplerExternalOES sTexture;\n" +
                "void main() {\n" +
                "    gl_FragColor = texture2D(sTexture, vTextureCoord);\n" +
                "}\n"
    }
}
