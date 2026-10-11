package app.kuchupuchu.android

import java.util.Locale

internal data class ComposerCommand(
    val name: String,
    val hint: String,
    val metaKey: String,
)

internal data class ParsedComposerCommand(
    val command: ComposerCommand,
    val text: String,
)

/** Slash-command parsing shared by the Android composer and local contract tests. */
internal object ComposerCommands {
    val all: List<ComposerCommand> = listOf(
        ComposerCommand("silent", "No notification or sound", "silent"),
        ComposerCommand("magic", "Animate the message text on both sides", "magic"),
        ComposerCommand("vanish", "Disappears one minute after first read", "vanish"),
    )

    private val commandPattern = Regex("^/(silent|magic|vanish)(?:[\\t ]+([\\s\\S]*))?$", RegexOption.IGNORE_CASE)

    fun parse(value: String): ParsedComposerCommand? {
        val match = commandPattern.matchEntire(value.trim()) ?: return null
        val command = all.firstOrNull { it.name == match.groupValues[1].lowercase(Locale.ROOT) } ?: return null
        return ParsedComposerCommand(command, match.groups[2]?.value.orEmpty().trim())
    }

    fun suggestions(value: String): List<ComposerCommand> {
        if (!value.startsWith("/") || value.any(Char::isWhitespace)) return emptyList()
        val query = value.drop(1).lowercase(Locale.ROOT)
        return all.filter { it.name.startsWith(query) }
    }

    fun draft(command: ComposerCommand): String = "/${command.name} "
}
