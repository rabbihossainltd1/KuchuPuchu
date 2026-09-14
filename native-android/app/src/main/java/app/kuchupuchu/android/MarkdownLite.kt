package app.kuchupuchu.android

/**
 * Owner round 33 (item 24): a small, dependency-free Markdown → HTML
 * converter for the document viewer's preview. Covers what README-style
 * files use: ATX and setext headings, paragraphs, emphasis, inline code,
 * fenced and indented code, links (rendered, never followed — the preview
 * WebView blocks navigation), images (their alt text; the WebView is
 * offline), bullet / numbered / task lists, block quotes, tables and
 * horizontal rules. Every character is HTML-escaped first, so a Markdown
 * file can never smuggle markup of its own into the page.
 */
internal object MarkdownLite {
    private val fenceRe = Regex("""^(`{3,}|~{3,})\s*(\S*)""")
    private val atxRe = Regex("""^(#{1,6})\s+(.*?)\s*#*\s*$""")
    private val setextRe = Regex("""^(=+|-+)$""")
    private val hrRe = Regex("""^([-*_])(\s*\1){2,}$""")
    private val itemRe = Regex("""^([-*+]|\d+[.)])\s+(.*)$""")
    private val taskRe = Regex("""^\[( |x|X)]\s+(.*)$""")
    private val tableSepRe = Regex("""^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$""")

    fun toHtml(md: String): String {
        val out = StringBuilder(md.length + 64)
        val lines = md.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val para = ArrayList<String>()
        fun flushPara() {
            if (para.isEmpty()) return
            out.append("<p>").append(inline(para.joinToString(" "))).append("</p>\n")
            para.clear()
        }
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val t = line.trim()

            val fence = fenceRe.find(t)
            if (fence != null) {
                flushPara()
                val mark = fence.groupValues[1][0]
                val lang = fence.groupValues[2]
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trim().let { c -> c.length >= 3 && c.all { it == mark } }) {
                    code.append(escape(lines[i])).append('\n')
                    i++
                }
                i++ // the closing fence (or the end of the file)
                out.append("<pre><code")
                if (lang.isNotBlank()) out.append(" class=\"lang-").append(escape(lang)).append('"')
                out.append('>').append(code).append("</code></pre>\n")
                continue
            }
            if (t.isEmpty()) {
                flushPara()
                i++
                continue
            }
            if (para.size == 1 && setextRe.matches(t)) {
                val lvl = if (t[0] == '=') 1 else 2
                out.append("<h").append(lvl).append('>').append(inline(para[0])).append("</h").append(lvl).append(">\n")
                para.clear()
                i++
                continue
            }
            val h = atxRe.find(t)
            if (h != null) {
                flushPara()
                val lvl = h.groupValues[1].length
                out.append("<h").append(lvl).append('>').append(inline(h.groupValues[2])).append("</h").append(lvl).append(">\n")
                i++
                continue
            }
            if (hrRe.matches(t)) {
                flushPara()
                out.append("<hr>\n")
                i++
                continue
            }
            if (t.startsWith(">")) {
                flushPara()
                val quoted = ArrayList<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    quoted.add(lines[i].trim().removePrefix(">").removePrefix(" "))
                    i++
                }
                out.append("<blockquote>\n").append(toHtml(quoted.joinToString("\n"))).append("</blockquote>\n")
                continue
            }
            if (t.startsWith("|") && i + 1 < lines.size && tableSepRe.matches(lines[i + 1].trim())) {
                flushPara()
                fun cells(row: String) = row.trim().removePrefix("|").removeSuffix("|").split('|').map { inline(it.trim()) }
                out.append("<table>\n<tr>")
                cells(t).forEach { out.append("<th>").append(it).append("</th>") }
                out.append("</tr>\n")
                i += 2
                while (i < lines.size && lines[i].trim().startsWith("|")) {
                    out.append("<tr>")
                    cells(lines[i]).forEach { out.append("<td>").append(it).append("</td>") }
                    out.append("</tr>\n")
                    i++
                }
                out.append("</table>\n")
                continue
            }
            val li = itemRe.find(t)
            if (li != null) {
                flushPara()
                val ordered = li.groupValues[1][0].isDigit()
                out.append(if (ordered) "<ol>\n" else "<ul>\n")
                while (i < lines.size) {
                    val m = itemRe.find(lines[i].trim()) ?: break
                    if (m.groupValues[1][0].isDigit() != ordered) break
                    var item = m.groupValues[2]
                    val task = taskRe.find(item)
                    if (task != null) item = (if (task.groupValues[1] == " ") "\u2610 " else "\u2611 ") + task.groupValues[2]
                    i++
                    // indented continuation lines belong to the item
                    while (i < lines.size && lines[i].isNotBlank() && lines[i].startsWith("  ") && itemRe.find(lines[i].trim()) == null) {
                        item += " " + lines[i].trim()
                        i++
                    }
                    out.append("<li>").append(inline(item)).append("</li>\n")
                }
                out.append(if (ordered) "</ol>\n" else "</ul>\n")
                continue
            }
            if (para.isEmpty() && (line.startsWith("    ") || line.startsWith("\t"))) {
                val code = StringBuilder()
                while (i < lines.size && (lines[i].startsWith("    ") || lines[i].startsWith("\t"))) {
                    code.append(escape(lines[i].removePrefix("    ").removePrefix("\t"))).append('\n')
                    i++
                }
                out.append("<pre><code>").append(code).append("</code></pre>\n")
                continue
            }
            para.add(t)
            i++
        }
        flushPara()
        return out.toString()
    }

    private val imageRe = Regex("""!\[([^\]]*)]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)""")
    private val linkRe = Regex("""\[([^\]]+)]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)""")
    private val boldRe = Regex("""\*\*(.+?)\*\*|__(.+?)__""")
    private val italicRe = Regex("""(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])""")
    private val strikeRe = Regex("""~~(.+?)~~""")

    /** Inline marks on ONE already-trimmed line (or a joined paragraph). */
    internal fun inline(src: String): String {
        val sb = StringBuilder(src.length + 16)
        val parts = src.split('`')
        val closed = parts.size % 2 == 1 // an even count means one backtick is unmatched
        for ((k, p) in parts.withIndex()) {
            if (k % 2 == 1 && (closed || k < parts.size - 1)) {
                sb.append("<code>").append(escape(p)).append("</code>")
            } else {
                if (k % 2 == 1) sb.append('`')
                sb.append(styled(escape(p)))
            }
        }
        return sb.toString()
    }

    private fun styled(escaped: String): String {
        var s = escaped
        s = imageRe.replace(s) { m -> m.groupValues[1] }
        s = linkRe.replace(s) { m -> "<a href=\"" + m.groupValues[2] + "\">" + m.groupValues[1] + "</a>" }
        s = boldRe.replace(s) { m -> "<strong>" + (m.groupValues[1].ifEmpty { m.groupValues[2] }) + "</strong>" }
        s = italicRe.replace(s) { m -> "<em>" + (m.groupValues[1].ifEmpty { m.groupValues[2] }) + "</em>" }
        s = strikeRe.replace(s) { m -> "<del>" + m.groupValues[1] + "</del>" }
        return s
    }

    internal fun escape(s: String): String {
        val sb = StringBuilder(s.length + 16)
        for (ch in s) {
            when (ch) {
                '&' -> sb.append("&amp;")
                '<' -> sb.append("&lt;")
                '>' -> sb.append("&gt;")
                '"' -> sb.append("&quot;")
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }
}
