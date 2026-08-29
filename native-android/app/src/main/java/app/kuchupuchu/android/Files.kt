package app.kuchupuchu.android

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
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
        val chooser = Intent.createChooser(intent, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { ctx.startActivity(chooser) }
    }

    /**
     * The best mime for OPENING a file: pickers often hand back a generic
     * "application/octet-stream" (or nothing), and with that most viewers
     * refuse the doc ("open korte parche na"). Fall back to the extension.
     */
    fun mimeFor(name: String, declared: String): String {
        if (!declared.isBlank() && !declared.equals("application/octet-stream", true) &&
            !declared.equals("application/binary", true)
        ) {
            return declared
        }
        return when (name.substringAfterLast('.', "").lowercase()) {
            "pdf" -> "application/pdf"
            "doc" -> "application/msword"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xls" -> "application/vnd.ms-excel"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "ppt" -> "application/vnd.ms-powerpoint"
            "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            "txt", "log" -> "text/plain"
            "csv" -> "text/csv"
            "zip" -> "application/zip"
            "mp3" -> "audio/mpeg"
            "m4a", "aac" -> "audio/mp4"
            "wav" -> "audio/x-wav"
            "ogg" -> "audio/ogg"
            "mp4", "mov" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            else -> declared.ifBlank { "*/*" }
        }
    }

    /**
     * Decodes a picked image and re-encodes it as a JPEG dataUrl small
     * enough for inline storage. Handles HEIC/HEIF via ImageDecoder on
     * API 28+. `maxChars` defaults to the 420KB inline-photo budget; avatars
     * pass the worker's 200KB avatar budget.
     */
    fun imageToJpeg(uri: Uri, ctx: Context, maxSide: Int = 960, maxBytes: Int = 220_000): ByteArray? = runCatching {
        var bmp: Bitmap? = null
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            val source = android.graphics.ImageDecoder.createSource(ctx.contentResolver, uri)
            bmp = android.graphics.ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                val w = info.size.width.coerceAtLeast(1)
                val h = info.size.height.coerceAtLeast(1)
                val sample = maxOf(1, maxOf(w, h) / maxSide)
                decoder.setTargetSampleSize(sample)
                decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        if (bmp == null) {
            val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
        var picture = bmp ?: return null
        if (picture.config != Bitmap.Config.ARGB_8888) {
            picture = picture.copy(Bitmap.Config.ARGB_8888, false)
        }
        var scale = 1
        while (picture.width / scale > maxSide || picture.height / scale > maxSide) scale *= 2
        if (scale > 1) picture = Bitmap.createScaledBitmap(picture, picture.width / scale, picture.height / scale, true)
        var quality = 85
        var out = ByteArray(0)
        while (true) {
            val buf = ByteArrayOutputStream()
            if (!picture.compress(Bitmap.CompressFormat.JPEG, quality, buf)) break
            out = buf.toByteArray()
            if (out.size <= maxBytes || quality <= 28) break
            quality -= 10
        }
        out.takeIf { it.isNotEmpty() }
    }.getOrNull()

    fun imageToDataUrl(uri: Uri, ctx: Context, maxSide: Int = 960, maxChars: Int = 300_000): String? {
        val jpeg = imageToJpeg(uri, ctx, maxSide, maxBytes = maxChars * 3 / 4) ?: return null
        return "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP)
    }

    /**
     * Saves image bytes into the gallery (Pictures/KuchuPuchu) and returns the
     * target Uri, or null on failure. Scoped-storage safe on every API level.
     */
    fun saveImage(ctx: Context, bytes: ByteArray, displayName: String): Uri? = runCatching {
        val safe = displayName.ifBlank { "kuchupuchu_${System.currentTimeMillis()}.jpg" }
        val values =
            ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, safe)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                if (Build.VERSION.SDK_INT >= 29) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/KuchuPuchu")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
        val uri =
            ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return null
        if (Build.VERSION.SDK_INT >= 29) {
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            ctx.contentResolver.update(uri, values, null, null)
        }
        uri
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
