package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LauncherShortcutPolicyTest {
    @Test
    fun frequentChatsRankByUseThenRecencyAndSkipSystemBots() {
        val ranked =
            LauncherShortcutPolicy.rank(
                listOf(
                    LauncherChatUsage("old-frequent", "Old frequent", 8, 10),
                    LauncherChatUsage("new-frequent", "New frequent", 8, 20),
                    LauncherChatUsage("recent-once", "Recent", 1, 100),
                    LauncherChatUsage("ai", "KuchuPuchu AI", 20, 200, "kp_ai_bot"),
                    LauncherChatUsage("official", "Official", 30, 300, "kp_official_bot"),
                ),
                limit = 3,
            )

        assertEquals(listOf("new-frequent", "old-frequent", "recent-once"), ranked.map { it.conversationId })
    }

    @Test
    fun rankingDeduplicatesAndHonorsTheLauncherLimit() {
        val ranked =
            LauncherShortcutPolicy.rank(
                listOf(
                    LauncherChatUsage("a", "A old", 1, 1),
                    LauncherChatUsage("a", "A new", 4, 2),
                    LauncherChatUsage("b", "B", 3, 3),
                    LauncherChatUsage("c", "C", 2, 4),
                    LauncherChatUsage("d", "D", 1, 5),
                ),
                limit = 2,
            )

        assertEquals(listOf("a", "b"), ranked.map { it.conversationId })
        assertEquals("A new", ranked.first().title)
        assertTrue(LauncherShortcutPolicy.rank(emptyList()).isEmpty())
        assertTrue(LauncherShortcutPolicy.rank(listOf(LauncherChatUsage("a", "A", 1, 1)), limit = 0).isEmpty())
    }

    @Test
    fun shortLabelsDoNotSplitSupplementaryUnicodeCharacters() {
        val label = "👨‍👩‍👧‍👦".repeat(9)
        val short = LauncherShortcutPolicy.shortLabel(label, maxCodePoints = 4)
        assertEquals(4, short.codePointCount(0, short.length))
        assertFalse(short.endsWith("\uD83D"))
        assertEquals("Chat", LauncherShortcutPolicy.shortLabel("   "))
    }
}
