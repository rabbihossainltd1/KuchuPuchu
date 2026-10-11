package app.kuchupuchu.android

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Android launcher long-press shortcuts (Android 7.1+). */
internal object LauncherShortcuts {
    const val ACTION = "app.kuchupuchu.android.action.OPEN_LAUNCHER_SHORTCUT"
    const val EXTRA_ACTION = "kp_shortcut_action"
    const val EXTRA_CHAT_ID = "kp_chat"

    private const val PREFS = "kp_launcher_shortcuts"
    private const val MAX_TRACKED_CHATS = 32
    private val lock = Any()

    /** Record one real chat open and publish the most frequently opened chats. */
    fun recordChatOpened(context: Context, userId: String, conversationId: String, title: String, peerUserId: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return
        if (userId.isBlank() || conversationId.isBlank() || title.isBlank()) return
        if (peerUserId == "kp_ai_bot" || peerUserId == "kp_official_bot") return

        synchronized(lock) {
            val app = context.applicationContext
            val history = readHistory(app, userId).toMutableList()
            val previous = history.firstOrNull { it.conversationId == conversationId }
            history.removeAll { it.conversationId == conversationId }
            history += LauncherChatUsage(
                conversationId = conversationId,
                title = title.trim(),
                openCount = (previous?.openCount ?: 0) + 1,
                lastOpenedAt = System.currentTimeMillis(),
                peerUserId = peerUserId,
            )
            saveAndPublish(app, userId, history)
        }
    }

    /** Refresh a renamed conversation without counting a title update as another visit. */
    fun refreshTitle(context: Context, userId: String, conversationId: String, title: String, peerUserId: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return
        if (userId.isBlank() || conversationId.isBlank() || title.isBlank()) return
        if (peerUserId == "kp_ai_bot" || peerUserId == "kp_official_bot") return

        synchronized(lock) {
            val app = context.applicationContext
            val history = readHistory(app, userId).toMutableList()
            val index = history.indexOfFirst { it.conversationId == conversationId }
            if (index < 0) return
            history[index] = history[index].copy(title = title.trim(), peerUserId = peerUserId)
            saveAndPublish(app, userId, history)
        }
    }

    /** Rebuild shortcuts after login; history is kept separately per account. */
    fun restore(context: Context, userId: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return
        synchronized(lock) {
            val app = context.applicationContext
            publish(app, readHistory(app, userId))
        }
    }

    /** Remove names from the launcher when the account signs out. */
    fun clearDynamic(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return
        runCatching { ShortcutManagerCompat.removeAllDynamicShortcuts(context.applicationContext) }
    }

    private fun saveAndPublish(context: Context, userId: String, history: List<LauncherChatUsage>) {
        val trimmed = LauncherShortcutPolicy.rank(history, MAX_TRACKED_CHATS)
        val json = JSONArray()
        trimmed.forEach { chat ->
            json.put(
                JSONObject()
                    .put("conversationId", chat.conversationId)
                    .put("title", chat.title)
                    .put("openCount", chat.openCount)
                    .put("lastOpenedAt", chat.lastOpenedAt)
                    .put("peerUserId", chat.peerUserId),
            )
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(historyKey(userId), json.toString())
            .apply()
        publish(context, trimmed)
    }

    private fun readHistory(context: Context, userId: String): List<LauncherChatUsage> {
        if (userId.isBlank()) return emptyList()
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(historyKey(userId), null)
            ?: return emptyList()
        return runCatching {
            val items = JSONArray(raw)
            buildList {
                for (index in 0 until items.length()) {
                    val row = items.optJSONObject(index) ?: continue
                    val conversationId = row.optString("conversationId")
                    val title = row.optString("title")
                    if (conversationId.isBlank() || title.isBlank()) continue
                    add(
                        LauncherChatUsage(
                            conversationId = conversationId,
                            title = title,
                            openCount = row.optInt("openCount"),
                            lastOpenedAt = row.optLong("lastOpenedAt"),
                            peerUserId = row.optString("peerUserId"),
                        ),
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun publish(context: Context, history: List<LauncherChatUsage>) {
        val shortcuts =
            LauncherShortcutPolicy.rank(history).mapIndexed { rank, chat ->
                ShortcutInfoCompat.Builder(context, shortcutId(chat.conversationId))
                    .setShortLabel(LauncherShortcutPolicy.shortLabel(chat.title))
                    .setLongLabel(LauncherShortcutPolicy.shortLabel("Chat with ${chat.title}", 50))
                    .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_chat))
                    .setRank(rank)
                    .setLongLived(true)
                    .setIntent(
                        Intent(context, MainActivity::class.java)
                            .setAction(ACTION)
                            .putExtra(EXTRA_CHAT_ID, chat.conversationId)
                            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    )
                    .build()
            }
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
    }

    private fun shortcutId(conversationId: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(conversationId.toByteArray())
        return "chat_" + digest.take(12).joinToString("") { "%02x".format(it) }
    }

    private fun historyKey(userId: String) = "frequent_chats:$userId"
}
