package app.kuchupuchu.android

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager

/**
 * §31: the app's side of the Android Telecom bridge.
 *
 * KuchuPuchu already had a complete call UI before this file existed, and that UI stays
 * authoritative: this object only tells the platform what the engine is doing, and lets
 * the platform's own surfaces (a headset's call button, a watch, the system's notion of
 * "a call is in progress") ask the engine to do something. It never starts, answers or
 * ends a call by itself — the decision functions live in [TelecomPolicy] and every entry
 * point here is wrapped so a Telecom or OEM failure can only ever leave the call
 * invisible to the system, never broken for the user.
 *
 * Two deliberate non-goals, both because the alternative was measured to be worse:
 *
 *  - **Audio routing is not handed over.** The platform's own guidance for Telecom-based
 *    calls is to route through `Connection.onAvailableCallEndpointsChanged` /
 *    `requestCallEndpointChange` and *not* to touch `AudioManager` — which would mean
 *    replacing [AudioRouter]'s verified 645 lines (earpiece/speaker/Bluetooth SCO,
 *    the `startBluetoothSco` race it exists to fix) with a path that cannot be tested
 *    here. `AudioRouter.apply` and Telecom both ask for the same telephony audio mode,
 *    so the two do not fight; adopting the endpoint API is the follow-up that needs the
 *    §46/§47 device matrix first.
 *  - **No system call log.** `EXTRA_LOG_SELF_MANAGED_CALLS` (the opt-in) was deprecated in
 *    API 36.1 and would duplicate the app's own Calls tab, which already carries the
 *    missed-call and call-back flows.
 *  - **Not `androidx.core:core-telecom`.** It is the path the current docs lead with, and
 *    1.0.1 was tried before writing this file: its classes carry
 *    `kotlin.Metadata(mv = [2, 0, 0])`, which kotlinc 1.9.25 — the Kotlin this project is
 *    on, see the root build file — refuses to read. Taking the library would mean moving
 *    the whole app to Kotlin 2.x plus the Compose-compiler Gradle plugin, and it also
 *    brings its own foreground service and call notification, which would duplicate the
 *    call notification §25/§30 already own. `TelecomManager.addCall(CallAttributes, ...)`
 *    is the other "modern" answer and is API 34-only, so it would leave API 26-33 on a
 *    second code path; `addNewIncomingCall` is not deprecated for self-managed accounts.
 */
object KpTelecom {
    /** The application context, kept for [KpCallConnection] to start our own activity in
     * `onShowIncomingCallUi`. An application context only — never an activity — so a
     * connection the system holds cannot leak a destroyed screen. */
    @Volatile
    var context: Context? = null
        private set

    @Volatile
    private var live: KpCallConnection? = null

    /** Id whose registration the framework has been asked for but has not answered yet.
     * See [TelecomPolicy.planFor]: without this a fast RINGING→ACTIVE publish registers
     * the same call twice and Telecom ends up holding two connections for one call. */
    @Volatile
    private var registeringId: String? = null

    /** [android.os.SystemClock.elapsedRealtime] when [registeringId] was set. */
    @Volatile
    private var registeringAtMs = 0L

    @Volatile
    private var accountReady = false

    /** Called once from [CallEngine.start]: registers the self-managed account so a call
     * can be added later. Idempotent, and a no-op below API 26. */
    fun ensureAccount(app: android.app.Application) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        context = app
        if (accountReady) return
        runCatching {
            val tm = telecom(app) ?: return
            val handle = handle(app)
            // Already registered by an earlier run (the account survives reboot and
            // process death), so nothing to do — re-registering is not harmless: it
            // replaces the handle the system may be using for a live call.
            if (tm.getPhoneAccount(handle) != null) {
                accountReady = true
                return
            }
            tm.registerPhoneAccount(
                PhoneAccount
                    .Builder(handle, TelecomPolicy.ACCOUNT_LABEL)
                    .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                    .addSupportedUriScheme(TelecomPolicy.SCHEME)
                    .build(),
            )
            accountReady = true
        }
    }

    /**
     * Mirror the engine's current call. Called from [CallEngine.publishChange] on every
     * state change the UI itself sees, which is what keeps the two from diverging.
     */
    fun syncNow(app: android.app.Application) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        context = app
        runCatching {
            val engine = CallEngine.instance
            val call = engine?.active
            val state =
                if (call == null) {
                    KpTelecomState.DISCONNECTED
                } else {
                    TelecomPolicy.stateFor(call.status, engine?.onHold == true)
                }
            when (
                TelecomPolicy.planFor(
                    liveId = live?.callId,
                    registeringId = registeringId,
                    registeringAtMs = registeringAtMs,
                    nowMs = android.os.SystemClock.elapsedRealtime(),
                    callId = call?.id ?: "",
                    state = state,
                )
            ) {
                // RELEASE covers three things at once: the call ended, a different call
                // row took over, and a registration that never came back. In the latter
                // two there is a live call to mirror, so the same tick re-requests it
                // instead of waiting for a state change that may never arrive.
                KpTelecomPlan.RELEASE -> {
                    release(call)
                    if (call != null && state != KpTelecomState.DISCONNECTED) request(app, call)
                }
                KpTelecomPlan.WAIT -> Unit
                KpTelecomPlan.UPDATE -> if (call != null) {
                    live?.apply(call, engine?.onHold == true)
                }
                KpTelecomPlan.REQUEST -> if (call != null) request(app, call)
            }
        }
    }

    /** The framework accepted the registration and bound to [KpConnectionService]. */
    fun onCreated(
        connection: KpCallConnection,
        call: CallUi,
        onHold: Boolean,
    ) {
        live = connection
        registeringId = null
        connection.apply(call, onHold)
    }

    /** The framework refused; clear the slot so a later publish can try again. */
    fun onFailed() {
        registeringId = null
        registeringAtMs = 0L
    }

    /** Process death / service teardown: forget the mirror, keep the account (the
     * platform persists it across reboot by design, and unregistering on sign-out would
     * make the next call slower for no user-visible gain). */
    fun onServiceDestroyed() {
        live = null
        registeringId = null
        registeringAtMs = 0L
    }

    /** Address a call is identified by, in both directions. A *custom* scheme on purpose:
     * `tel:`/`sip:` with a user id inside it invites the dialer to treat it as a phone
     * number, and the platform asks not to put a persistent identity in these URIs. */
    fun uriFor(id: String): Uri = Uri.fromParts(TelecomPolicy.SCHEME, id, null)

    fun handle(app: Context): PhoneAccountHandle =
        PhoneAccountHandle(
            ComponentName(app.packageName, KpConnectionService::class.java.name),
            TelecomPolicy.ACCOUNT_ID,
        )

    private fun telecom(app: Context): TelecomManager? =
        app.getSystemService(TelecomManager::class.java)

    private fun release(call: CallUi?) {
        val connection = live
        live = null
        registeringId = null
        registeringAtMs = 0L
        if (connection == null) return
        runCatching {
            connection.end(TelecomPolicy.causeFor(call?.status ?: "ENDED", call?.incoming == true))
        }
    }

    private fun request(
        app: android.app.Application,
        call: CallUi,
    ) {
        ensureAccount(app)
        val tm = telecom(app) ?: return
        val handle = handle(app)
        // A disabled account (Settings → Apps → Special app access → Calling accounts) is
        // the user opting out. `placeCall` on a disabled account is what makes the system
        // dialer surface a bogus number, so the whole bridge stays quiet instead.
        if (tm.getPhoneAccount(handle) == null) return
        // §31's concurrency rules, asked of the platform rather than guessed: false while
        // an emergency call is up, or (for self-managed accounts) while another
        // ConnectionService holds the line. Our own call still proceeds; it is simply not
        // mirrored while the platform would refuse it.
        val permitted =
            if (call.incoming) {
                tm.isIncomingCallPermitted(handle)
            } else {
                tm.isOutgoingCallPermitted(handle)
            }
        if (!permitted) return
        registeringId = call.id
        registeringAtMs = android.os.SystemClock.elapsedRealtime()
        val extras =
            Bundle().apply {
                putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
                if (call.incoming) {
                    putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, uriFor(call.id))
                }
            }
        if (call.incoming) {
            tm.addNewIncomingCall(handle, extras)
        } else {
            // Outgoing: the row already exists and the offer is already in flight, so this
            // is a report, not a dial — the framework binds back to us with this request.
            tm.placeCall(uriFor(call.id), extras)
        }
    }
}
