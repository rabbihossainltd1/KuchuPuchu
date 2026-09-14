package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Owner round 33 (item 24): the document viewer previews Markdown through
 * MarkdownLite. Pinned: the common blocks render, and NOTHING from the file
 * reaches the page unescaped (a shared .md must never inject markup).
 */
class MarkdownLiteTest {
    @Test
    fun `headings paragraphs emphasis and code render`() {
        val html = MarkdownLite.toHtml("# Title\n\nSome *em* and **strong** with `code`.\n\nSecond\n---\n")
        assertTrue(html.contains("<h1>Title</h1>"))
        assertTrue(html.contains("<p>Some <em>em</em> and <strong>strong</strong> with <code>code</code>.</p>"))
        assertTrue(html.contains("<h2>Second</h2>"))
    }

    @Test
    fun `lists quotes tables fences and rules render`() {
        val md = "- a\n- [x] done\n\n1. one\n2. two\n\n> quoted\n\n| h1 | h2 |\n|----|----|\n| c1 | c2 |\n\n```kotlin\nval x = 1 < 2\n```\n\n***\n"
        val html = MarkdownLite.toHtml(md)
        assertTrue(html.contains("<ul>\n<li>a</li>\n<li>\u2611 done</li>\n</ul>"))
        assertTrue(html.contains("<ol>\n<li>one</li>\n<li>two</li>\n</ol>"))
        assertTrue(html.contains("<blockquote>\n<p>quoted</p>\n</blockquote>"))
        assertTrue(html.contains("<th>h1</th><th>h2</th>"))
        assertTrue(html.contains("<td>c1</td><td>c2</td>"))
        assertTrue(html.contains("<pre><code class=\"lang-kotlin\">val x = 1 &lt; 2\n</code></pre>"))
        assertTrue(html.contains("<hr>"))
    }

    @Test
    fun `links keep their text and images fall back to alt text`() {
        val html = MarkdownLite.toHtml("See [docs](https://example.com/x) and ![logo](img.png).")
        assertTrue(html.contains("<a href=\"https://example.com/x\">docs</a>"))
        assertTrue(html.contains("and logo."))
        assertFalse(html.contains("<img"))
    }

    @Test
    fun `raw html in the file is escaped never emitted`() {
        val html = MarkdownLite.toHtml("<script>alert(1)</script>\n\n<b onclick=\"x()\">hi</b> & `<i>`")
        assertFalse(html.contains("<script"))
        assertFalse(html.contains("<b "))
        assertTrue(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"))
        assertTrue(html.contains("&amp;"))
        assertTrue(html.contains("<code>&lt;i&gt;</code>"))
    }

    @Test
    fun `escape covers the four html specials`() {
        assertEquals("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;", MarkdownLite.escape("<a href=\"x\">&</a>"))
    }
}
