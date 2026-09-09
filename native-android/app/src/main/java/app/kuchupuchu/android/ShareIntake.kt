package app.kuchupuchu.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.content.IntentCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/** One shared file, already copied into the app's cache (see [ShareActivity]). */
internal data class ShareItem(val file: File, val mime: String, val name: String)

/** What the system share sheet handed us: free text and/or files. */
internal data class SharePayload(val text: String, val items: List<ShareItem>)

/**
 * Owner round 32 (item 36): KuchuPuchu in the system share sheet.
 *
 * The share target is its own tiny activity, not MainActivity: a SEND intent
 * aimed at a singleTop launcher activity is started INSIDE the sharing app's
 * task, so a second MainActivity (a second KpApp, a second call gate) would
 * come up next to the real one. This activity copies the shared content into
 * the cache — the sender's URI grant only lasts while THIS activity lives, so
 * the copy happens here, off the main thread — then hands the payload to the
 * real app through [MainActivity.pendingShare], brings it forward and finishes.
 */
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val incoming = intent
        val action = incoming?.action
        if (incoming == null || (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE)) {
            finish()
            return
        }
        val text =
            incoming.getStringExtra(Intent.EXTRA_TEXT).orEmpty().trim().ifBlank {
                incoming.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty().trim()
            }
        val uris = sharedUris(incoming)
        val declaredType = incoming.type.orEmpty()
        val app = applicationContext
        Thread {
            val items =
                uris.mapNotNull { uri ->
                    runCatching {
                        val name = queryName(app, uri)
                        // Over the 25 MB upload cap: never even copied (a
                        // picture is exempt — it is re-encoded before upload).
                        val declared = app.contentResolver.getType(uri).orEmpty().ifBlank { declaredType }
                        if (!declared.startsWith("image/") && querySize(app, uri) > VideoPlan.UPLOAD_LIMIT) {
                            return@runCatching null
                        }
                        val (mime, file) = FilesUtil.copyDocument(app, uri, name) ?: return@runCatching null
                        if (file.length() == 0L) {
                            file.delete()
                            null
                        } else {
                            val type = mime.ifBlank { declaredType }.ifBlank { "application/octet-stream" }
                            ShareItem(file, if (type.endsWith("/*")) "application/octet-stream" else type, name)
                        }
                    }.getOrNull()
                }
            if (text.isNotBlank() || items.isNotEmpty()) {
                MainActivity.pendingShare.value = SharePayload(text, items)
            }
            runOnUiThread {
                startActivity(
                    Intent(this, MainActivity::class.java).addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
                    ),
                )
                finish()
            }
        }.start()
    }

    private fun querySize(ctx: Context, uri: Uri): Long =
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L
            } ?: 0L
        }.getOrDefault(0L)

    private fun sharedUris(i: Intent): List<Uri> {
        val fromExtra: List<Uri> =
            if (i.action == Intent.ACTION_SEND_MULTIPLE) {
                IntentCompat.getParcelableArrayListExtra(i, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            } else {
                listOfNotNull(IntentCompat.getParcelableExtra(i, Intent.EXTRA_STREAM, Uri::class.java))
            }
        if (fromExtra.isNotEmpty()) return fromExtra
        // Some senders put the streams on the clip only.
        val clip = i.clipData ?: return emptyList()
        return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    }
}

/**
 * Sends a share payload to the picked chats. Process-level scope (like
 * [Uploads]): the picker closes and the user may leave for the chat while the
 * uploads are still running. Each file is uploaded ONCE and its key posted to
 * every target (a forwarded key is readable by any chat that references it).
 * Rules match the in-app attach flow: a picture travels as a photo (re-encoded
 * JPEG, dimensions in meta, an album when two or more), a video as media,
 * anything else as a document row. Over 25 MB is skipped.
 */
internal object ShareSend {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun discard(payload: SharePayload) {
        scope.launch { payload.items.forEach { runCatching { it.file.delete() } } }
    }

    fun send(ctx: Context, targets: List<String>, payload: SharePayload, onDone: (Boolean) -> Unit) {
        val app = ctx.applicationContext
        scope.launch {
            var ok = true
            val templates = ArrayList<JSONObject>()
            for (item in payload.items) {
                val template = runCatching { uploadOne(app, item) }.getOrNull()
                if (template == null) ok = false else templates.add(template)
            }
            val photos = templates.count { it.optString("fileType").startsWith("image/") }
            for (target in targets) {
                if (payload.text.isNotBlank()) {
                    val body =
                        JSONObject()
                            .put("kind", "TEXT")
                            .put("body", payload.text)
                            .put("clientId", "c_${java.util.UUID.randomUUID()}")
                    runCatching { Api.post("/api/conversations/$target/messages", body) }.onFailure { ok = false }
                }
                val album = if (photos >= 2) newAlbumId() else null
                for (template in templates) {
                    val body = JSONObject(template.toString()).put("clientId", "c_${java.util.UUID.randomUUID()}")
                    if (album != null && template.optString("fileType").startsWith("image/")) {
                        val meta = body.optJSONObject("meta") ?: JSONObject()
                        body.put("meta", meta.put("album", album))
                    }
                    runCatching { Api.post("/api/conversations/$target/messages", body) }.onFailure { ok = false }
                }
            }
            payload.items.forEach { runCatching { it.file.delete() } }
            withContext(Dispatchers.Main) {
                ScreenStore.pokeInbox()
                if (ok) runCatching { KpSounds.sent(app) }
                onDone(ok)
            }
        }
    }

    /** Uploads one item; the returned object is the message body minus clientId. */
    private fun uploadOne(ctx: Context, item: ShareItem): JSONObject? {
        if (item.mime.startsWith("image/")) {
            // Same budget as the chat's photo path (1440 px, ~285 KB).
            val jpeg = FilesUtil.imageToJpeg(Uri.fromFile(item.file), ctx, maxSide = 1440, maxBytes = 285_000)
            if (jpeg != null && jpeg.isNotEmpty()) {
                val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                android.graphics.BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, bounds)
                val up = Api.upload("photo.jpg", "image/jpeg", jpeg)
                val key = up.optString("fileKey")
                if (key.isBlank()) return null
                val body =
                    JSONObject()
                        .put("kind", "FILE")
                        .put("fileKey", key)
                        .put("fileName", "photo.jpg")
                        .put("fileType", "image/jpeg")
                        .put("fileSize", jpeg.size)
                if (bounds.outWidth > 0 && bounds.outHeight > 0) {
                    body.put("meta", JSONObject().put("w", bounds.outWidth).put("h", bounds.outHeight))
                }
                return body
            }
            // Not decodable as a picture: falls through as a document.
        }
        if (item.file.length() > VideoPlan.UPLOAD_LIMIT) return null
        val up = Api.uploadFile(item.name, item.mime, item.file)
        val key = up.optString("fileKey")
        if (key.isBlank()) return null
        val body =
            JSONObject()
                .put("kind", "FILE")
                .put("fileKey", key)
                .put("fileName", item.name)
                .put("fileType", item.mime)
                .put("fileSize", item.file.length())
        if (!item.mime.startsWith("video/")) body.put("meta", JSONObject().put("document", true))
        return body
    }
}
