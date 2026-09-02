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

    /**
     * Copies bytes into cacheDir and returns a shareable content Uri.
     *
     * The name used to be the only discriminator, so sharing `photo.jpg` twice —
     * or sharing a photo while the receiving app still has the FIRST `photo.jpg`
     * open — overwrote the same file out from under an open file descriptor and
     * the viewer showed the second file's contents (or a half-written read).
     * Each hand-off now gets its own file, and the pile is swept on the way.
     */
    fun cacheFile(ctx: Context, name: String, bytes: ByteArray, mime: String): Uri {
        val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").ifBlank { "file" }
        val dir = ctx.cacheDir
        runCatching {
            // Old hand-offs are dead weight: the receiving app copied the bytes
            // already. Sweep files older than an hour so a long session cannot
            // grow cacheDir without limit.
            val cutoff = System.currentTimeMillis() - 3_600_000L
            dir.listFiles()?.forEach { old ->
                if (old.name.startsWith("shared_") && old.lastModified() < cutoff) runCatching { old.delete() }
            }
        }
        val f = File(dir, "shared_${System.currentTimeMillis()}_${fingerprint(bytes)}_$safe")
        f.writeBytes(bytes)
        return FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
    }

    /** A few hex chars, enough that two shares of the same file name never land
     *  on the same path while the first one is still open elsewhere. */
    private fun fingerprint(bytes: ByteArray): String {
        var h = bytes.size
        val step = maxOf(1, bytes.size / 64)
        var i = 0
        while (i < bytes.size) {
            h = h * 31 + bytes[i].toInt()
            i += step
        }
        return Integer.toHexString(h)
    }

    /** Opens a downloaded file with the system viewer. */
    fun open(ctx: Context, name: String, bytes: ByteArray, mime: String) {
        openUri(ctx, cacheFile(ctx, name, bytes, mime), name, mime)
    }

    /** Opens an already-on-disk file with the system viewer. */
    fun openFile(ctx: Context, name: String, f: File, mime: String): Boolean {
        return openUri(
            ctx,
            androidx.core.content.FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f),
            name,
            mime,
        )
    }

    /**
     * Direct ACTION_VIEW — no chooser. The chooser swallowed launch failures
     * and added a MIUI-flaky layer; a direct view + ClipData grant + mime
     * fallback either opens the file or says exactly why not.
     */
    fun openUri(ctx: Context, uri: Uri, name: String, mime: String): Boolean {
        fun view(type: String) =
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, type)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                clipData = android.content.ClipData.newRawUri(name, uri)
            }
        try {
            ctx.startActivity(view(mime.ifBlank { "*/*" }))
            return true
        } catch (e: Exception) {
            try {
                ctx.startActivity(view("*/*"))
                return true
            } catch (e2: Exception) {
                // No viewer on the phone: park the file in Downloads so it is
                // still reachable from the Files app.
                runCatching { saveToDownloads(ctx, name, uri) }
                android.widget.Toast.makeText(
                    ctx,
                    "Ei file open korar kono app nai — Downloads-e save kora ache",
                    android.widget.Toast.LENGTH_LONG,
                ).show()
                return false
            }
        }
    }

    /** Copies a content Uri into MediaStore Downloads (no viewer needed). */
    private fun saveToDownloads(ctx: Context, name: String, uri: android.net.Uri) {
        val safe = name.ifBlank { "kuchupuchu_${System.currentTimeMillis()}" }
        if (android.os.Build.VERSION.SDK_INT < 29) {
            // MediaStore.Downloads (and IS_PENDING) only exist on API 29+. The
            // reference was to a missing class on 7-9, i.e. "Save to Downloads"
            // threw instead of saving. The app-specific external directory needs
            // no runtime permission there and is visible to file managers.
            runCatching {
                val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "KuchuPuchu")
                if (!dir.exists()) dir.mkdirs()
                val dest = File(dir, safe)
                ctx.contentResolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { out -> input.copyTo(out, 64 * 1024) }
                } ?: return
                android.widget.Toast.makeText(
                    ctx,
                    "Saved to ${dest.absolutePath}",
                    android.widget.Toast.LENGTH_SHORT,
                ).show()
            }
            return
        }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, safe)
            // "*/*" is not a mime type: a file manager that trusts it renders the
            // row as an unknown blob and "Open with" finds no handler.
            put(MediaStore.Downloads.MIME_TYPE, mimeFor(safe, ""))
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val target =
            ctx.contentResolver.insert(
                MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                values,
            ) ?: return
        val input = ctx.contentResolver.openInputStream(uri)
        if (input == null) {
            // Leaving the pending row behind used to put a 0-byte file in
            // Downloads for a copy that never happened.
            runCatching { ctx.contentResolver.delete(target, null) }
            return
        }
        val copied =
            runCatching {
                input.use { src ->
                    ctx.contentResolver.openOutputStream(target)?.use { out -> src.copyTo(out, 64 * 1024) }
                        ?: 0L
                }
            }.getOrDefault(0L)
        values.clear()
        if (copied <= 0L) {
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            runCatching { ctx.contentResolver.delete(target, null) }
            android.widget.Toast.makeText(ctx, "Could not save that file.", android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        ctx.contentResolver.update(target, values, null)
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
            // Reading a 12 MP camera JPEG straight into a Bitmap allocates ~48 MB
            // of Java heap on the spot; on a low-RAM phone under memory pressure
            // the OOM killed the picker instead of downscaling (and ImageDecoder
            // only covers API 28+, so this path is the ONLY path on older
            // devices). Read the header first, then sample down to what we need.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            if (bounds.outWidth > 0 && bounds.outHeight > 0) {
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
            }
            bmp = BitmapFactory.decodeByteArray(
                bytes,
                0,
                bytes.size,
                BitmapFactory.Options().apply { inSampleSize = sample },
            )
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
            // The hand-rolled table below called every sound file audio/mpeg and
            // every picture "image/*" (not a valid mime type — the receiver's
            // gallery then refuses it). mimeFor() already maps all of these.
            mime = mimeFor(name, "")
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
