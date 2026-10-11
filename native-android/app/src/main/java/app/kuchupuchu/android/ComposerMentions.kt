package app.kuchupuchu.android

import org.json.JSONObject
import java.util.Locale

internal data class ComposerMention(
    val id: String,
    val displayName: String,
    val username: String,
)

internal data class ActiveComposerMention(
    val start: Int,
    val query: String,
)

/** Mention parsing/filtering kept pure so Android contract tests can cover it. */
internal object ComposerMentions {
    private val activePattern = Regex("(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{0,30})$")
    private val validUsername = Regex("^[A-Za-z0-9_]{3,30}$")

    fun forConversation(conversation: JSONObject?, meId: String): List<ComposerMention> {
        if (conversation == null) return emptyList()
        val users = mutableListOf<JSONObject>()
        if (conversation.optBoolean("isGroup")) {
            val members = conversation.optJSONArray("members")
            if (members != null) for (index in 0 until members.length()) {
                members.optJSONObject(index)?.optJSONObject("user")?.let(users::add)
            }
        } else {
            conversation.optJSONObject("other")?.let(users::add)
        }
        return users.mapNotNull { user ->
            val id = user.optString("id")
            val username = user.optText("username").removePrefix("@")
            if (id.isBlank() || id == meId || !validUsername.matches(username)) return@mapNotNull null
            ComposerMention(
                id = id,
                displayName = user.optText("displayName").ifBlank { username },
                username = username,
            )
        }.distinctBy { it.username.lowercase(Locale.ROOT) }
    }

    fun active(input: String): ActiveComposerMention? {
        val match = activePattern.find(input) ?: return null
        val query = match.groupValues[2]
        return ActiveComposerMention(start = input.length - query.length - 1, query = query)
    }

    fun suggestions(query: String, candidates: List<ComposerMention>, limit: Int = 6): List<ComposerMention> {
        val needle = query.trim().lowercase(Locale.ROOT)
        return candidates.filter { candidate ->
            needle.isBlank() ||
                candidate.username.lowercase(Locale.ROOT).startsWith(needle) ||
                candidate.displayName.lowercase(Locale.ROOT).contains(needle)
        }.take(limit.coerceAtLeast(0))
    }

    fun insert(input: String, mention: ComposerMention): String? {
        val active = active(input) ?: return null
        if (!validUsername.matches(mention.username)) return null
        val insertion = "@${mention.username} "
        return input.take(active.start) + insertion + input.drop(input.length)
    }
}
