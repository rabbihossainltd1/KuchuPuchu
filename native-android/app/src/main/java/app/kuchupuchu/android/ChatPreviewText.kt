package app.kuchupuchu.android

/** r66: display-only rules. Counts never expose unread message content. */
internal object ChatPreviewText {
    private fun label(category: String, plural: Boolean): String = when (category) {
        "photo" -> if (plural) "photos" else "photo"
        "video" -> if (plural) "videos" else "video"
        "document" -> if (plural) "documents" else "document"
        "voice" -> if (plural) "voice messages" else "voice message"
        "sticker" -> if (plural) "stickers" else "sticker"
        "contact" -> if (plural) "contacts" else "contact"
        "location" -> if (plural) "locations" else "location"
        "call" -> if (plural) "calls" else "call"
        else -> if (plural) "messages" else "message"
    }

    fun unread(count: Int, category: String): String =
        if (count <= 0) "" else "$count new ${label(category, count != 1)}"

    /** [plain] is locally decrypted or known plaintext, never the wire envelope. */
    fun seen(plain: String?, category: String, fallback: String): String {
        if (!plain.isNullOrBlank()) return plain.replace('\n', ' ').replace('\r', ' ').take(120)
        val safe = fallback.trim()
        // Legacy server placeholders and undecodable envelopes are not icons
        // or raw ciphertext in the list. A real user-typed lock in [plain]
        // remains legitimate message content.
        if (safe.isBlank() || safe == "\uD83D\uDD12" || safe.startsWith("KP1.") || safe == "Message") {
            return label(category, false).replaceFirstChar { it.uppercaseChar() }
        }
        return safe
    }
}
