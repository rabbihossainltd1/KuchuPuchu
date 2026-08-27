package app.kuchupuchu.android

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File

/** File helpers: sharing temp files out, downscaling picked photos. */
object FilesUtil {

    /** Copies bytes into cacheDir and returns a shareable content Uri. */
    fun cacheFile(ctx: Context, name: String, bytes: ByteArray, mime: String): Uri {
        val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").ifBlank { "file" }
        val f = File(ctx.cacheDir, "shared_$safe")
        f.writeBytes(bytes)
        return FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
    }

    /** Opens a downloaded file with the system viewer. */
    fun open(ctx: Context, name: String, bytes: ByteArray, mime: String) {
        val uri = cacheFile(ctx, name, bytes, mime)
        val intent =
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime.ifBlank { "*/*" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        runCatching { ctx.startActivity(Intent.createChooser(intent, name)) }
    }

    /**
     * Decodes a picked image and re-encodes it as a JPEG dataUrl small
     * enough for inline storage (≤ ~420KB base64). Handles HEIC/HEIF via
     * ImageDecoder on API 28+.
     */
    fun imageToDataUrl(uri: Uri, ctx: Context, maxSide: Int = 1280): String? = runCatching {
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bmp == null && android.os.Build.VERSION.SDK_INT >= 28) {
            // HEIC/HEIF and other formats BitmapFactory can't read directly
            val source = android.graphics.ImageDecoder.createSource(bytes)
            bmp = android.graphics.ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                decoder.setTargetSampleSize(1)
            }
        }
        if (bmp == null) return null
        var scale = 1
        while (bmp.width / scale > maxSide || bmp.height / scale > maxSide) scale *= 2
        if (scale > 1) bmp = Bitmap.createScaledBitmap(bmp, bmp.width / scale, bmp.height / scale, true)
        var quality = 82
        var out: ByteArray
        var dataUrl: String
        while (true) {
            val buf = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, buf)
            out = buf.toByteArray()
            dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out, Base64.NO_WRAP)
            if (dataUrl.length <= 420_000 || quality <= 35) break
            quality -= 12
        }
        dataUrl
    }.getOrNull()

    /** Reads any picked document's bytes + guessed mime. */
    fun readDocument(ctx: Context, uri: Uri): Pair<String, ByteArray>? = runCatching {
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        var mime = ctx.contentResolver.getType(uri) ?: ""
        if (mime.isBlank()) {
            val name = uri.lastPathSegment ?: "file"
            mime =
                when (name.substringAfterLast('.', "").lowercase()) {
                    "pdf" -> "application/pdf"
                    "mp3", "m4a", "aac", "wav", "ogg" -> "audio/mpeg"
                    "mp4", "mov", "mkv" -> "video/mp4"
                    "jpg", "jpeg", "png", "webp", "gif" -> "image/*"
                    "txt" -> "text/plain"
                    "zip" -> "application/zip"
                    else -> "application/octet-stream"
                }
        }
        mime to bytes
    }.getOrNull()

    fun displaySize(bytes: Int): String =
        when {
            bytes >= 1_048_576 -> String.format("%.1f MB", bytes / 1_048_576.0)
            bytes >= 1024 -> "${bytes / 1024} KB"
            else -> "$bytes B"
        }
}
