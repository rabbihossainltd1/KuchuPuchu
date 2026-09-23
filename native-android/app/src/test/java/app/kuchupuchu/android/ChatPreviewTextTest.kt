package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ChatPreviewTextTest {
    @Test
    fun `unread text only shows count and type`() {
        assertEquals("1 new message", ChatPreviewText.unread(1, "message"))
        assertEquals("12 new messages", ChatPreviewText.unread(12, "message"))
    }

    @Test
    fun `media counts use singular and plural labels`() {
        for ((kind, labels) in mapOf(
            "photo" to ("photo" to "photos"),
            "video" to ("video" to "videos"),
            "document" to ("document" to "documents"),
            "voice" to ("voice message" to "voice messages"),
            "sticker" to ("sticker" to "stickers"),
            "contact" to ("contact" to "contacts"),
            "location" to ("location" to "locations"),
        )) {
            assertEquals("1 new ${labels.first}", ChatPreviewText.unread(1, kind))
            assertEquals("3 new ${labels.second}", ChatPreviewText.unread(3, kind))
        }
    }

    @Test
    fun `unknown or mixed types use an honest generic count`() {
        assertEquals("7 new messages", ChatPreviewText.unread(7, "mixed"))
        assertEquals("100 new messages", ChatPreviewText.unread(100, ""))
        assertEquals("", ChatPreviewText.unread(0, "photo"))
        assertEquals("", ChatPreviewText.unread(-1, "photo"))
    }

    @Test
    fun `seen text and captions show actual local content`() {
        assertEquals("Hello there", ChatPreviewText.seen("Hello there", "message", "\uD83D\uDD12"))
        assertEquals("My photo caption", ChatPreviewText.seen("My photo caption", "photo", "Photo"))
        assertEquals("two lines", ChatPreviewText.seen("two\nlines", "message", "Message"))
    }

    @Test
    fun `legacy encrypted placeholder and raw envelope never appear`() {
        assertEquals("Message", ChatPreviewText.seen(null, "message", "\uD83D\uDD12"))
        assertEquals("Message", ChatPreviewText.seen(null, "message", "KP1.not-for-display"))
        assertEquals("Photo", ChatPreviewText.seen(null, "photo", "Message"))
        assertFalse(ChatPreviewText.unread(4, "message").contains("\uD83D\uDD12"))
    }

    @Test
    fun `media labels and empty chats remain unchanged`() {
        assertEquals("Photo", ChatPreviewText.seen("", "photo", "Photo"))
        assertEquals("Voice message", ChatPreviewText.seen(null, "voice", "Voice message"))
        assertEquals("No messages yet", ChatPreviewText.seen(null, "message", "No messages yet"))
    }

    @Test
    fun `view-once label does not invent a caption`() {
        assertEquals("Photo \u00B7 View once", ChatPreviewText.seen(null, "photo", "Photo \u00B7 View once"))
        assertEquals("Video \u00B7 View once", ChatPreviewText.seen(null, "video", "Video \u00B7 View once"))
    }

    @Test
    fun `an intentional user lock emoji is message content not a placeholder`() {
        assertEquals("\uD83D\uDD12", ChatPreviewText.seen("\uD83D\uDD12", "message", "\uD83D\uDD12"))
    }

    @Test
    fun `preview text stays bounded`() {
        assertEquals(120, ChatPreviewText.seen("x".repeat(4000), "message", "Message").length)
    }
}
