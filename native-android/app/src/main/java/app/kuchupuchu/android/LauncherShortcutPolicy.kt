package app.kuchupuchu.android

/** A locally observed conversation used to rank launcher shortcuts. */
internal data class LauncherChatUsage(
    val conversationId: String,
    val title: String,
    val openCount: Int,
    val lastOpenedAt: Long,
    val peerUserId: String = "",
)

/** Pure ranking rules, kept separate from Android's ShortcutManager for tests. */
internal object LauncherShortcutPolicy {
    const val MAX_CHAT_SHORTCUTS = 4
    private val systemBots = setOf("kp_ai_bot", "kp_official_bot")

    /** Most-opened chats first; recency breaks ties. Bots have dedicated shortcuts. */
    fun rank(chats: List<LauncherChatUsage>, limit: Int = MAX_CHAT_SHORTCUTS): List<LauncherChatUsage> {
        if (limit <= 0) return emptyList()
        return chats
            .asSequence()
            .filter { it.conversationId.isNotBlank() && it.title.isNotBlank() && it.openCount > 0 }
            .filterNot { it.peerUserId in systemBots }
            .groupBy { it.conversationId }
            .values
            .mapNotNull { duplicates ->
                duplicates.maxWithOrNull(compareBy<LauncherChatUsage> { it.openCount }.thenBy { it.lastOpenedAt })
            }
            .sortedWith(
                compareByDescending<LauncherChatUsage> { it.openCount }
                    .thenByDescending { it.lastOpenedAt }
                    .thenBy { it.conversationId },
            )
            .take(limit)
            .toList()
    }

    /** Android requires a short label; truncate by Unicode code point, not UTF-16 unit. */
    fun shortLabel(label: String, maxCodePoints: Int = 25): String {
        val clean = label.trim().ifBlank { "Chat" }
        val count = clean.codePointCount(0, clean.length)
        if (count <= maxCodePoints) return clean
        return clean.substring(0, clean.offsetByCodePoints(0, maxCodePoints.coerceAtLeast(1)))
    }
}
