package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * r68-4 (owner: "ei haptic ta just tokhoni kaj korbe jokhon 2 ta user e same chat
 * screen a thakbe all time na"), corrected by r69-4 (owner: "maybe not fixed
 * (only chat screen a thaklei hobe eita)").
 *
 * The mirrored emoji reaction — animation AND buzz — belongs to a moment both
 * people are looking at. The route is the whole condition now: being on THAT
 * chat screen. These are the cases the app must refuse: another screen on top,
 * a neighbour conversation id, no chat at all.
 */
class EmojiFxPolicyTest {
    @Test
    fun `the same chat in front mirrors the reaction`() {
        assertTrue(EmojiFxPolicy.mirrorsOnScreen("chat/c1", "c1"))
    }

    @Test
    fun `a route argument on the chat still counts as that chat`() {
        assertTrue(EmojiFxPolicy.mirrorsOnScreen("chat/c1?media=1", "c1"))
    }

    @Test
    fun `being on the chat screen is enough — the app-level flag is not consulted`() {
        // r69-4: the owner's clarification, pinned as a compile-time fact — the
        // policy has no `foreground` parameter to pass a stale `false` through.
        assertTrue(EmojiFxPolicy.mirrorsOnScreen("chat/c1", "c1"))
    }

    @Test
    fun `another screen on top suppresses the mirror`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("chatmedia/c1", "c1"))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("profile/u1", "c1"))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("", "c1"))
    }

    @Test
    fun `a neighbour conversation id is never mistaken for this one`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("chat/c12", "c1"))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("chat/c1x", "c1"))
    }

    @Test
    fun `a blank conversation id cannot match anything`() {
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("chat/", ""))
        assertFalse(EmojiFxPolicy.mirrorsOnScreen("", ""))
    }
}
