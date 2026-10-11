package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageMarkupTest {
    @Test
    fun bothBoldDelimitersAreRemovedAndMarkedBold() {
        val source = "plain *single* and **double**"
        val parts = MessageMarkup.parts(source)

        assertEquals("plain single and double", MessageMarkup.plain(source))
        assertTrue(parts.any { it.text == "single" && it.bold })
        assertTrue(parts.any { it.text == "double" && it.bold })
        assertTrue(parts.none { it.text.contains('*') })
        assertEquals("plain single and double", MessageMarkup.formatted(source).text)
    }

    @Test
    fun mixedSingleAndDoubleMarkersStillFormatWithoutLeakingAsterisks() {
        assertEquals("example", MessageMarkup.plain("*example**"))
        assertEquals("example", MessageMarkup.plain("**example*"))
        assertEquals("example**", MessageMarkup.plain("example**"))
        assertTrue(MessageMarkup.parts("*example**").any { it.text == "example" && it.bold })
    }

    @Test
    fun oneToOneMentionIsClickableButGroupMentionsStayPlain() {
        val source = "Hi @rahi, email a@b.com"
        val direct = MessageMarkup.parts(source, clickableMentions = true)
        val group = MessageMarkup.parts(source, clickableMentions = false)
        val url = MessageMarkup.parts("https://example.com/@linked", clickableMentions = true)

        assertTrue(direct.any { it.text == "@rahi" && it.mention == "rahi" })
        assertTrue(direct.none { it.mention == "b" })
        assertTrue(group.none { it.mention != null })
        assertTrue(url.none { it.mention != null })
        assertEquals(source, MessageMarkup.plain(source))
    }
}
