package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ComposerCommandsTest {
    @Test
    fun slashPrefixShowsOnlyMatchingCommands() {
        assertEquals(listOf("silent", "magic", "vanish"), ComposerCommands.suggestions("/").map { it.name })
        assertEquals(listOf("silent"), ComposerCommands.suggestions("/s").map { it.name })
        assertEquals(listOf("magic"), ComposerCommands.suggestions("/MAG").map { it.name })
        assertEquals(emptyList<ComposerCommand>(), ComposerCommands.suggestions("hello /"))
        assertEquals(emptyList<ComposerCommand>(), ComposerCommands.suggestions("/silent text"))
    }

    @Test
    fun commandIsRemovedFromBodyAndKeptAsMetadata() {
        val silent = ComposerCommands.parse("/silent  quiet text  ")
        assertEquals("silent", silent?.command?.metaKey)
        assertEquals("quiet text", silent?.text)

        val vanish = ComposerCommands.parse("/VANISH disappearing")
        assertEquals("vanish", vanish?.command?.metaKey)
        assertEquals("disappearing", vanish?.text)
        assertEquals("", ComposerCommands.parse("/silent")?.text)
        assertNull(ComposerCommands.parse("/magicx text"))
    }
}
