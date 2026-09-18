package app.kuchupuchu.android

import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * v163 (owner: "ekhono ekta hardcoded thumbnail ache fake … ratio eita dynamic
 * hobe"): everything the app needs to know about a clip, read from the clip
 * itself, in one place — so a video bubble can be the clip's own shape with the
 * clip's own first frame instead of a hardcoded 16:9 placeholder with a play
 * icon on it.
 *
 * [probe] is rotation aware on purpose: a phone clip recorded in portrait is
 * coded 1920x1080 with a 90 degree tag and PLAYED portrait, so the raw metadata
 * alone would lay every portrait clip out landscape.
 */
internal object VideoFacts {
    /** (width, height, durationMs) as the clip is DISPLAYED, or null. */
    fun probe(f: File): Triple<Int, Int, Long>? {
        if (!f.exists()) return null
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(f.absolutePath)
            var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toFloatOrNull() ?: 0f
            var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toFloatOrNull() ?: 0f
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            if (w <= 0f || h <= 0f) return null
            if (rot == 90 || rot == 270) {
                val t = w
                w = h
                h = t
            }
            val ms = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            Triple(w.toInt(), h.toInt(), ms)
        } catch (_: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }

    /** The first sync frame as a small JPEG (at most [maxW] wide), rotated to
     *  the way the clip plays — what the receiver draws before any download. */
    fun poster(f: File, maxW: Int = 480, quality: Int = 80): ByteArray? {
        if (!f.exists()) return null
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(f.absolutePath)
            val frame = r.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return null
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val turned =
                if (rot != 0) {
                    val m = Matrix().apply { postRotate(rot.toFloat()) }
                    Bitmap.createBitmap(frame, 0, 0, frame.width, frame.height, m, true)
                } else {
                    frame
                }
            val scaled =
                if (turned.width > maxW) {
                    Bitmap.createScaledBitmap(turned, maxW, (turned.height * maxW / turned.width).coerceAtLeast(1), true)
                } else {
                    turned
                }
            ByteArrayOutputStream().use { out ->
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                out.toByteArray()
            }
        } catch (_: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }
}
