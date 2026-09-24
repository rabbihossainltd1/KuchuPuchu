package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * r68-4 (owner: "ei haptic ta just tokhoni kaj korbe jokhon 2 ta user e same chat
 * screen a thakbe all time na").
 *
 * The mirrored emoji reaction — animation AND buzz — belongs to a moment both
 * people are looking at. These are the cases the app must refuse: a phone in a
 * pocket, and a chat screen that is composed but buried under another screen.
 */
class EmojiFxPolicyTest {
    @Test
    fun `the same chat in front mirrors the reaction`() {
        assertTrue(EmojiFxPolicy.mirrorsOnScreen(true, "chat/c1", "c1"))
    }

    @Test
    fun `a route argument on the chat still counts as that chat`() {
        assertTrue(EmojiFxPolicy.mirrorsOnScreen(true, "chat/c1?media=1", "c1"))
    }

    @Test
    fun `a backgrounded app never buzzes for an unseen animation`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(false, "chat/c1", "c1"))
    }

    @Test
    fun `another screen on top suppresses the mirror`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(true, "chatmedia/c1", "c1"))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(true, "profile/u1", "c1"))
    }

    @Test
    fun `a neighbour conversation id is never mistaken for this one`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(true, "chat/c12", "c1"))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(true, "chat/c1x", "c1"))
    }

    @Test
    fun `a blank conversation id cannot match anything`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(true, "chat/", ""))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen(true, "", ""))
    }
}
