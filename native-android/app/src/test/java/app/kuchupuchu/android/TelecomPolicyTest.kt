package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * §48 for §31: the Telecom bridge's decisions.
 *
 * These are the four functions the mirror lives on, and each one guards a failure that
 * is invisible from a phone (no device here) and unmistakable in a table: a duplicate
 * accept, a ghost "ringing" row, the wrong side of a declined call reported as the
 * user's own hangup, and a registration slot stuck forever.
 */
class TelecomPolicyTest {
    // ------------------------------------------------------------------ capability
    @Test
    fun selfManagedNeedsApi26() {
        assertFalse(TelecomPolicy.supported(24))
        assertFalse(TelecomPolicy.supported(25))
        assertTrue(TelecomPolicy.supported(TelecomPolicy.MIN_SDK))
        assertTrue(TelecomPolicy.supported(35))
    }

    @Test
    fun identifiersCarryNoUserOrDeviceData() {
        // `PhoneAccountHandle.getId()` is persisted in the system's Telecom store and is
        // visible to any app that can query phone accounts, so it must not be a user id,
        // a phone number or an email.
        val id = TelecomPolicy.ACCOUNT_ID
        assertFalse("no digits in the account id", id.any { it.isDigit() })
        assertFalse("no email-shaped id", id.contains("@"))
        assertEquals("kuchupuchu-voip", id)
    }

    @Test
    fun addressSchemeIsNotADialableOne() {
        // `tel:`/`sip:` invite the dialer to treat the payload as a number to call.
        val scheme = TelecomPolicy.SCHEME
        assertTrue(scheme !in setOf("tel", "sip", "sms", "voip", "callto"))
        assertTrue(scheme.none { it.isDigit() })
    }

    // ------------------------------------------------------------------ state map
    @Test
    fun onlyLiveRowsAreRingingOrActive() {
        assertEquals(KpTelecomState.RINGING, TelecomPolicy.stateFor("RINGING", false))
        assertEquals(KpTelecomState.ACTIVE, TelecomPolicy.stateFor("ACTIVE", false))
        assertEquals(KpTelecomState.HELD, TelecomPolicy.stateFor("ACTIVE", true))
        for (
            dead in listOf("ENDED", "DECLINED", "MISSED", "CANCELLED", "FAILED", "", "SOMETHING_NEW")
        ) {
            assertEquals("$dead", KpTelecomState.DISCONNECTED, TelecomPolicy.stateFor(dead, false))
        }
    }

    @Test
    fun aHeldRingingCallIsStillRinging() {
        // Nothing can put a ringing call on hold; reporting HELD there would make the
        // system show a call the user has not answered as if it had been.
        assertEquals(KpTelecomState.RINGING, TelecomPolicy.stateFor("RINGING", true))
    }

    // ------------------------------------------------------------------ request → action
    @Test
    fun answeringIsOnlyPossibleWhileRinging() {
        assertEquals(
            KpTelecomAction.ACCEPT,
            TelecomPolicy.actionFor("answer", "RINGING", incoming = true, onHold = false),
        )
        // The duplicate-accept guard: the user tapped Accept and the headset button
        // arrives a frame later.
        assertEquals(
            KpTelecomAction.NONE,
            TelecomPolicy.actionFor("answer", "ACTIVE", incoming = true, onHold = false),
        )
        // Our own outgoing ring: "answer" from a remote surface means nothing here.
        assertEquals(
            KpTelecomAction.NONE,
            TelecomPolicy.actionFor("answer", "RINGING", incoming = false, onHold = false),
        )
    }

    @Test
    fun endingWhileRingingIsADeclineForTheCalleeOnly() {
        assertEquals(
            KpTelecomAction.DECLINE,
            TelecomPolicy.actionFor("disconnect", "RINGING", incoming = true, onHold = false),
        )
        assertEquals(
            KpTelecomAction.HANGUP,
            TelecomPolicy.actionFor("disconnect", "RINGING", incoming = false, onHold = false),
        )
        assertEquals(
            KpTelecomAction.HANGUP,
            TelecomPolicy.actionFor("disconnect", "ACTIVE", incoming = false, onHold = false),
        )
    }

    @Test
    fun nothingIsActedOnAfterTheCallIsGone() {
        for (request in listOf("answer", "reject", "disconnect", "hold", "unhold", "mute")) {
            assertEquals(
                request,
                KpTelecomAction.NONE,
                TelecomPolicy.actionFor(request, "ENDED", incoming = true, onHold = false),
            )
        }
        assertEquals(
            KpTelecomAction.NONE,
            TelecomPolicy.actionFor("someFutureVerb", "ACTIVE", incoming = false, onHold = false),
        )
    }

    @Test
    fun holdRequiresTheOppositeState() {
        assertEquals(
            KpTelecomAction.HOLD,
            TelecomPolicy.actionFor("hold", "ACTIVE", incoming = false, onHold = false),
        )
        assertEquals(
            KpTelecomAction.NONE,
            TelecomPolicy.actionFor("hold", "ACTIVE", incoming = false, onHold = true),
        )
        assertEquals(
            KpTelecomAction.UNHOLD,
            TelecomPolicy.actionFor("unhold", "ACTIVE", incoming = false, onHold = true),
        )
        assertEquals(
            KpTelecomAction.NONE,
            TelecomPolicy.actionFor("unhold", "ACTIVE", incoming = false, onHold = false),
        )
    }

    // ------------------------------------------------------------------ disconnect cause
    @Test
    fun theSameRowMeansDifferentThingsOnTheTwoPhones() {
        // Callee declined: this phone ended it. Caller saw a decline: remote.
        assertEquals("local", TelecomPolicy.causeFor("DECLINED", incoming = true))
        assertEquals("remote", TelecomPolicy.causeFor("DECLINED", incoming = false))
        assertEquals("remote", TelecomPolicy.causeFor("MISSED", incoming = false))
        assertEquals("local", TelecomPolicy.causeFor("CANCELLED", incoming = false))
        assertEquals("error", TelecomPolicy.causeFor("FAILED", incoming = true))
        assertEquals("local", TelecomPolicy.causeFor("ENDED", incoming = false))
    }

    // ------------------------------------------------------------------ registration plan
    @Test
    fun aDeadRowAlwaysReleasesEvenForTheLiveCall() {
        assertEquals(
            KpTelecomPlan.RELEASE,
            TelecomPolicy.planFor(
                liveId = "c1",
                registeringId = null,
                registeringAtMs = 0L,
                nowMs = 1_000L,
                callId = "c1",
                state = KpTelecomState.DISCONNECTED,
            ),
        )
    }

    @Test
    fun oneCallIsRegisteredOnceAndThenOnlyUpdated() {
        val request =
            TelecomPolicy.planFor(
                liveId = null,
                registeringId = null,
                registeringAtMs = 0L,
                nowMs = 1_000L,
                callId = "c1",
                state = KpTelecomState.RINGING,
            )
        assertEquals(KpTelecomPlan.REQUEST, request)
        // The RINGING -> ACTIVE publish that lands before Telecom has bound: the second
        // addNewIncomingCall is what would give the system two connections for one call.
        val wait =
            TelecomPolicy.planFor(
                liveId = null,
                registeringId = "c1",
                registeringAtMs = 900L,
                nowMs = 1_000L,
                callId = "c1",
                state = KpTelecomState.ACTIVE,
            )
        assertEquals(KpTelecomPlan.WAIT, wait)
        val update =
            TelecomPolicy.planFor(
                liveId = "c1",
                registeringId = null,
                registeringAtMs = 0L,
                nowMs = 5_000L,
                callId = "c1",
                state = KpTelecomState.ACTIVE,
            )
        assertEquals(KpTelecomPlan.UPDATE, update)
    }

    @Test
    fun aRegistrationThatNeverLandsIsGivenUpAndRetried() {
        val stale =
            TelecomPolicy.planFor(
                liveId = null,
                registeringId = "c1",
                registeringAtMs = 0L,
                nowMs = TelecomPolicy.REGISTRATION_TIMEOUT_MS,
                callId = "c1",
                state = KpTelecomState.RINGING,
            )
        assertEquals(KpTelecomPlan.RELEASE, stale)
    }

    @Test
    fun aNewCallWhileAnOldOneIsMirroredReleasesFirst() {
        val swap =
            TelecomPolicy.planFor(
                liveId = "c1",
                registeringId = null,
                registeringAtMs = 0L,
                nowMs = 9_000L,
                callId = "c2",
                state = KpTelecomState.RINGING,
            )
        assertEquals(KpTelecomPlan.RELEASE, swap)
        val orphan =
            TelecomPolicy.planFor(
                liveId = null,
                registeringId = "c1",
                registeringAtMs = 9_000L,
                nowMs = 9_100L,
                callId = "c2",
                state = KpTelecomState.RINGING,
            )
        assertEquals(KpTelecomPlan.RELEASE, orphan)
    }
}
