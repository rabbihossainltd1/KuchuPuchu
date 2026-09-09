package app.kuchupuchu.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Owner round 32 (item 32): links inside a chat.
 *
 * A URL in a text bubble is a real link (underlined, tap opens it) and the
 * bubble carries a preview card above the text — title, description, picture
 * and host of the page. The card's data comes from the worker
 * (`GET /api/link-preview?url=`): the WORKER reads the page, not the phone, so
 * the link's host never sees a reader's address before they tap, and one
 * fetch serves every member of the chat through the worker's cache.
 */
object Links {
    /** http(s) URLs and bare `www.` hosts — the same shape the worker accepts. */
    val RE = Regex("""(?:https?://|www\.)[^\s<>"']+""", RegexOption.IGNORE_CASE)

    /** Trailing sentence punctuation is prose, not URL; an unbalanced `)` too. */
    fun clean(raw: String): String {
        var s = raw
        while (s.isNotEmpty() && s.last() in ".,;:!?'\"") s = s.dropLast(1)
        if (s.endsWith(")") && s.count { it == '(' } < s.count { it == ')' }) s = s.dropLast(1)
        return s
    }

    /** The first link of a body — the one whose card the bubble shows. */
    fun first(body: String): String? = RE.find(body)?.value?.let(::clean)?.takeIf { it.length > 4 }

    fun href(u: String): String = if (u.startsWith("http", ignoreCase = true)) u else "https://$u"

    fun open(ctx: Context, u: String) {
        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(href(u)))) }
    }

    /**
     * The body with every link turned into a tappable, underlined span; null
     * when there is none (the caller keeps its plain Text). Tapping a link is
     * ours ([open]) — a device with no browser must not throw out of the
     * default handler.
     */
    fun annotate(text: String, ink: Color, open: (String) -> Unit): AnnotatedString? {
        val matches = RE.findAll(text).toList()
        if (matches.isEmpty()) return null
        val styles = TextLinkStyles(style = SpanStyle(color = ink, textDecoration = TextDecoration.Underline))
        val listener = LinkInteractionListener { link -> (link as? LinkAnnotation.Url)?.let { open(it.url) } }
        return buildAnnotatedString {
            var at = 0
            for (mt in matches) {
                val u = clean(mt.value)
                if (u.length <= 4) continue
                val start = mt.range.first
                if (start > at) append(text.substring(at, start))
                withLink(LinkAnnotation.Url(u, styles, listener)) { append(u) }
                at = start + u.length
            }
            if (at < text.length) append(text.substring(at))
        }
    }
}

/**
 * Preview cards by URL. Memory is the source of truth for the screen (a
 * snapshot map, so a bubble recomposes the moment its card lands); real cards
 * also live in ONE small file so a reopened chat does not ask the worker for
 * every link again. A miss (no page / no tags / offline) is remembered for
 * this process only.
 */
object LinkPreviews {
    private const val MAX = 240
    private val cards = mutableStateMapOf<String, JSONObject>()
    private val inflight = HashSet<String>()
    private var file: File? = null
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Called from Cache.init's loader thread — reads the file right there. */
    fun init(ctx: Context) {
        val f = File(ctx.applicationContext.filesDir, "kp-link-cards.json")
        file = f
        runCatching {
            if (!f.exists()) return
            val o = JSONObject(f.readText())
            var n = 0
            for (k in o.keys()) {
                if (n++ >= MAX) break
                o.optJSONObject(k)?.let { cards[k] = it }
            }
        }
    }

    /** The card for [url] once known — fetching it on first ask. */
    @Composable
    fun card(url: String): JSONObject? {
        val known = cards[url]
        LaunchedEffect(url) { if (known == null) fetch(url) }
        return known
    }

    fun fetch(url: String) {
        synchronized(inflight) { if (cards.containsKey(url) || !inflight.add(url)) return }
        io.launch {
            val data = runCatching { Api.request("/api/link-preview?url=${Api.q(url)}", "GET", null) }.getOrNull()
            cards[url] = data ?: JSONObject().put("ok", false)
            synchronized(inflight) { inflight.remove(url) }
            if (data?.optBoolean("ok") == true) save()
        }
    }

    @Synchronized
    private fun save() {
        val f = file ?: return
        val o = JSONObject()
        for ((k, v) in cards) if (v.optBoolean("ok")) o.put(k, v)
        runCatching { f.writeText(o.toString()) }
    }
}

/**
 * The card above a bubble's text: picture (when the page names one and it
 * actually loads), title, description, host. Nothing at all while the card
 * is unknown or the page had nothing to show — the link in the text is still
 * a link. [onOpen] null = the chat is in select mode, taps go to the bubble.
 */
@Composable
internal fun LinkPreviewCard(url: String, mine: Boolean, ink: Color, onOpen: (() -> Unit)?) {
    val card = LinkPreviews.card(url) ?: return
    if (!card.optBoolean("ok")) return
    val title = card.optText("title")
    val description = card.optText("description")
    val host = card.optText("host")
    val image = card.optText("image")
    if (title.isBlank() && image.isBlank()) return
    var imageBroken by remember(image) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (mine) Color(0x26FFFFFF) else if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.18f) else GoldSoft)
            .then(if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier),
    ) {
        if (image.isNotBlank() && !imageBroken) {
            AsyncImage(
                // A worker path (/api/link-image?url=…): the shared client adds
                // the session bearer for our own host, nothing else.
                model = if (image.startsWith("/")) Api.BASE + image else image,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(1.91f),
                onError = { imageBroken = true },
            )
        }
        Column(Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            if (title.isNotBlank()) {
                Text(
                    title,
                    fontSize = 13.sp,
                    lineHeight = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (description.isNotBlank()) {
                Text(
                    description,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = ink.copy(alpha = 0.82f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (host.isNotBlank()) {
                Spacer(Modifier.height(1.dp))
                Text(host, fontSize = 11.sp, color = ink.copy(alpha = 0.65f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
