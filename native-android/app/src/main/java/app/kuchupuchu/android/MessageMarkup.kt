package app.kuchupuchu.android

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle

internal data class MessageTextPart(
    val text: String,
    val bold: Boolean = false,
    val url: String? = null,
    val mention: String? = null,
)

private data class MarkRange(
    val start: Int,
    val end: Int,
    val url: String? = null,
    val mention: String? = null,
)

/** Lightweight message formatting: `*bold*`, `**bold**`, links and optional @username mentions. */
internal object MessageMarkup {
    private val boldMarkers = Regex("\\*{1,2}([^*\\n]+?)\\*{1,2}")
    private val mentionPattern = Regex("(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})(?![A-Za-z0-9_])")
    private val urlPattern = Regex("(?:https?://|www\\.)[^\\s<>\\\"']+", RegexOption.IGNORE_CASE)

    fun plain(value: String): String = parts(value, clickableMentions = false)
        .joinToString(separator = "") { it.text }

    /** Android notification previews support platform spans, not Compose annotations. */
    fun notification(value: String): CharSequence {
        val out = SpannableStringBuilder()
        parts(value).forEach { part ->
            val start = out.length
            out.append(part.text)
            if (part.bold && out.length > start) {
                out.setSpan(StyleSpan(Typeface.BOLD), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
        }
        return out
    }

    fun formatted(value: String): AnnotatedString = buildAnnotatedString {
        parts(value).forEach { part ->
            if (part.bold) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(part.text) }
            else append(part.text)
        }
    }

    /** Delimiter offsets used by the live composer output transform. */
    fun boldDelimiterRanges(value: String): List<IntRange> = buildList {
        for (match in boldMarkers.findAll(value)) {
            val content = match.groups[1] ?: match.groups[2] ?: continue
            add(match.range.first until content.range.first)
            add((content.range.last + 1)..match.range.last)
        }
    }

    fun parts(value: String, clickableMentions: Boolean = false): List<MessageTextPart> {
        val visible = StringBuilder(value.length)
        val boldRanges = mutableListOf<MarkRange>()
        var cursor = 0
        for (match in boldMarkers.findAll(value)) {
            val startAt = match.range.first
            visible.append(value.substring(cursor, startAt))
            val content = match.groups[1]?.value ?: match.groups[2]?.value.orEmpty()
            val start = visible.length
            visible.append(content)
            boldRanges += MarkRange(start, visible.length)
            cursor = match.range.last + 1
        }
        visible.append(value.substring(cursor))
        val text = visible.toString()
        if (text.isEmpty()) return emptyList()

        val links = mutableListOf<MarkRange>()
        for (match in urlPattern.findAll(text)) {
            val cleaned = cleanUrl(match.value)
            if (cleaned.length <= 4) continue
            val start = match.range.first
            links += MarkRange(start, start + cleaned.length, url = cleaned)
        }

        val mentions = mutableListOf<MarkRange>()
        if (clickableMentions) {
            for (match in mentionPattern.findAll(text)) {
                val prefix = match.groups[1]?.value.orEmpty()
                val username = match.groups[2]?.value.orEmpty()
                val start = match.range.first + prefix.length
                val end = start + username.length + 1
                // A username-looking string inside a URL stays part of the URL.
                if (links.none { start < it.end && end > it.start }) {
                    mentions += MarkRange(start, end, mention = username)
                }
            }
        }

        val ranges = boldRanges + links + mentions
        val boundaries = sortedSetOf(0, text.length)
        ranges.forEach { boundaries += it.start; boundaries += it.end }
        val points = boundaries.toList()
        val result = mutableListOf<MessageTextPart>()
        for (index in 0 until points.lastIndex) {
            val start = points[index]
            val end = points[index + 1]
            if (start >= end) continue
            val isBold = boldRanges.any { it.start <= start && it.end >= end }
            val link = links.firstOrNull { it.start <= start && it.end >= end }
            val mention = mentions.firstOrNull { it.start <= start && it.end >= end }
            val part = MessageTextPart(
                text = text.substring(start, end),
                bold = isBold,
                url = link?.url,
                mention = mention?.mention,
            )
            val previous = result.lastOrNull()
            if (previous != null && previous.bold == part.bold && previous.url == part.url && previous.mention == part.mention) {
                result[result.lastIndex] = previous.copy(text = previous.text + part.text)
            } else {
                result += part
            }
        }
        return result
    }

    fun annotate(
        value: String,
        linkInk: Color,
        mentionInk: Color,
        allowMentions: Boolean,
        openUrl: (String) -> Unit,
        openMention: (String) -> Unit,
    ): AnnotatedString? {
        val segments = parts(value, clickableMentions = allowMentions)
        if (segments.none { it.bold || it.url != null || it.mention != null }) return null

        val linkStyles = TextLinkStyles(
            style = SpanStyle(color = linkInk, textDecoration = TextDecoration.Underline),
        )
        val mentionStyles = TextLinkStyles(
            style = SpanStyle(
                color = mentionInk,
                fontWeight = FontWeight.SemiBold,
                textDecoration = TextDecoration.Underline,
            ),
        )
        val urlListener = LinkInteractionListener { link ->
            (link as? LinkAnnotation.Url)?.let { openUrl(it.url) }
        }
        val mentionListener = LinkInteractionListener { link ->
            (link as? LinkAnnotation.Clickable)?.let { openMention(it.tag) }
        }

        return buildAnnotatedString {
            segments.forEach { part ->
                val appendText: AnnotatedString.Builder.() -> Unit = {
                    if (part.bold) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(part.text) }
                    } else {
                        append(part.text)
                    }
                }
                when {
                    part.url != null -> withLink(LinkAnnotation.Url(part.url, linkStyles, urlListener), appendText)
                    part.mention != null -> withLink(
                        LinkAnnotation.Clickable(part.mention, mentionStyles, mentionListener),
                        appendText,
                    )
                    else -> appendText()
                }
            }
        }
    }

    private fun cleanUrl(raw: String): String {
        var value = raw
        while (value.isNotEmpty() && value.last() in ".,;:!?'\"") value = value.dropLast(1)
        if (value.endsWith(")") && value.count { it == '(' } < value.count { it == ')' }) value = value.dropLast(1)
        return value
    }
}
