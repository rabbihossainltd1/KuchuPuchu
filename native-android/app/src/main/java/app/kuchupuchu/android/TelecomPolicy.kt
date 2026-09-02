package app.kuchupuchu.android

/**
 * §31: the decisions the Telecom bridge makes.
 *
 * These live apart from `android.telecom` on purpose. The platform types are the
 * transport — a `Connection` that can be poked and a `PhoneAccount` that gets
 * registered — while everything that decides *what to do* is here, in plain values, so
 * §48's unit rung executes them (`./gradlew testDebugUnitTest`). A bug in this file is
 * a call that answers twice, a phone that shows a ghost "ringing" row after the call
 * ended, or a headset button that hangs up the wrong side of a declined call; none of
 * that is testable against a framework class from a JVM test, and all of it is testable
 * against these four functions.
 */

/** What the system's call list believes about the call. */
enum class KpTelecomState {
    RINGING,
    ACTIVE,
    HELD,
    DISCONNECTED,
}

/** The engine action a Telecom-originated request (headset button, watch, DIALER-adjacent
 * system UI) is allowed to perform. [NONE] means "refuse quietly": Telecom acts on its own
 * view of the call, which can be a tick stale, and re-running `answer()` after the user
 * already tapped Accept restarts capture and answers a call that is already up.
 */
enum class KpTelecomAction {
    ACCEPT,
    DECLINE,
    HANGUP,
    HOLD,
    UNHOLD,
    NONE,
}

/** What to do about the framework-side registration on the next engine state change. */
enum class KpTelecomPlan {
    REQUEST,
    WAIT,
    UPDATE,
    RELEASE,
}

object TelecomPolicy {
    /**
     * `PhoneAccount.CAPABILITY_SELF_MANAGED`, `Connection.setConnectionProperties` and
     * `TelecomManager.addNewIncomingCall(PhoneAccountHandle, Bundle)` for a self-managed
     * account are API 26. The app's floor is 24, so Android 7/7.1 keep exactly the
     * behavior they have today (own UI, own notifications, no Telecom) instead of
     * crashing or silently half-working.
     */
    const val MIN_SDK = 26

    /**
     * Stable `PhoneAccountHandle` id. The platform docs ask for an identifier that is
     * not derived from the user (it is persisted across reboot and matched by
     * `getOwnSelfManagedPhoneAccounts()`), so a UUID-per-install or a user id would both
     * be wrong here: a per-install value would orphan the account on restore, and a user
     * id leaks it into the system's phone process.
     */
    const val ACCOUNT_ID = "kuchupuchu-voip"

    /** Label shown in Settings → Apps → Calling accounts; must name the app, not a person. */
    const val ACCOUNT_LABEL = "KuchuPuchu calls"

    /**
     * The scheme the mirrored call's address uses. Never `tel:` or `sip:`: those are the
     * schemes the system dialer interprets as a dialable number, which is how a VoIP user
     * id ends up in a phone app's call log (and, on some OEM dialers, in an actual
     * `ACTION_CALL` attempt). A private scheme routes only to this account.
     */
    const val SCHEME = "kuchupuchu"

    /**
     * How long to wait for Telecom to bind to [KpConnectionService] after a registration
     * is requested before the slot is handed back. Without an expiry a refused
     * registration (account disabled, OEM Telecom implementation that never binds) would
     * keep [planFor] answering WAIT for the rest of the process's life and every later
     * call would be invisible to the system.
     */
    const val REGISTRATION_TIMEOUT_MS = 10_000L

    fun supported(sdkInt: Int): Boolean = sdkInt >= MIN_SDK

    /**
     * Engine row → framework state. Anything that is not a live row (ENDED, DECLINED,
     * MISSED, CANCELLED, an unknown future status) maps to DISCONNECTED so the system
     * never keeps showing a call the engine has already dropped.
     */
    fun stateFor(
        status: String,
        onHold: Boolean,
    ): KpTelecomState =
        when (status) {
            "RINGING" -> KpTelecomState.RINGING
            "ACTIVE" -> if (onHold) KpTelecomState.HELD else KpTelecomState.ACTIVE
            else -> KpTelecomState.DISCONNECTED
        }

    /**
     * Request → action, judged against the *engine's* state rather than Telecom's.
     *
     * `answer` while the row is already ACTIVE is the duplicate-accept case (watch button
     * and thumb at the same time) and must be a no-op. `disconnect` while ringing is a
     * decline for the callee — sending it to `hangup()` instead would post a "call
     * ended"/MISSED row for the other side instead of a clean decline.
     */
    fun actionFor(
        request: String,
        status: String,
        incoming: Boolean,
        onHold: Boolean,
    ): KpTelecomAction =
        when (request) {
            "answer" -> if (status == "RINGING" && incoming) KpTelecomAction.ACCEPT else KpTelecomAction.NONE
            "reject", "disconnect" ->
                when {
                    status == "RINGING" && incoming -> KpTelecomAction.DECLINE
                    status == "RINGING" || status == "ACTIVE" -> KpTelecomAction.HANGUP
                    else -> KpTelecomAction.NONE
                }
            "hold" -> if (status == "ACTIVE" && !onHold) KpTelecomAction.HOLD else KpTelecomAction.NONE
            "unhold" -> if (status == "ACTIVE" && onHold) KpTelecomAction.UNHOLD else KpTelecomAction.NONE
            else -> KpTelecomAction.NONE
        }

    /**
     * Disconnect cause to report. One row, two phones: `DECLINED` written by the callee
     * means "this phone ended it" (local), the same row seen by the caller means "the
     * other side refused" (remote). A missed call left the phone that was called, so for
     * the caller it is remote; `CANCELLED` is always the caller hanging up early.
     */
    fun causeFor(
        status: String,
        incoming: Boolean,
    ): String =
        when {
            status == "DECLINED" -> if (incoming) "local" else "remote"
            status == "MISSED" -> "remote"
            status == "CANCELLED" -> "local"
            status == "FAILED" -> "error"
            else -> "local"
        }

    /**
     * Registration bookkeeping.
     *
     * `addNewIncomingCall`/`placeCall` are requests, not results: the framework binds to
     * [KpConnectionService] some milliseconds later and that is when the live
     * [android.telecom.Connection] exists. The engine publishes state changes faster than
     * that (RINGING → ACTIVE during an auto-answer), so without [KpTelecomPlan.WAIT] a
     * second tick would register the same call twice and the system would hold two
     * Connections for one call.
     *
     * A different id while something is in flight releases the old registration instead of
     * queueing behind it: the stale row is already gone from the engine, and holding the
     * slot forever would make every later call invisible to the system.
     */
    fun planFor(
        liveId: String?,
        registeringId: String?,
        registeringAtMs: Long,
        nowMs: Long,
        callId: String,
        state: KpTelecomState,
        timeoutMs: Long = REGISTRATION_TIMEOUT_MS,
    ): KpTelecomPlan =
        when {
            state == KpTelecomState.DISCONNECTED -> KpTelecomPlan.RELEASE
            liveId != null && liveId == callId -> KpTelecomPlan.UPDATE
            liveId != null -> KpTelecomPlan.RELEASE
            registeringId != null && registeringId == callId &&
                nowMs - registeringAtMs < timeoutMs -> KpTelecomPlan.WAIT
            registeringId != null -> KpTelecomPlan.RELEASE
            else -> KpTelecomPlan.REQUEST
        }
}
