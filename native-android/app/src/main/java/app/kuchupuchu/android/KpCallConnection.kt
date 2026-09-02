package app.kuchupuchu.android

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telecom.Connection
import android.telecom.DisconnectCause
import android.telecom.TelecomManager
import android.telecom.VideoProfile
import androidx.annotation.RequiresApi

/**
 * §31: the one [Connection] the system holds for KuchuPuchu's live call.
 *
 * It is a mirror, not a second call machine. [CallEngine] remains the only thing that
 * touches WebRTC, the mic, the speaker and the server; this object only reports state
 * outward and translates the small set of requests that can arrive from *outside* the
 * app — a Bluetooth headset's call button, a watch's answer affordance, the system's
 * "end call" — into engine calls. Which is what the platform integration is actually for:
 * those surfaces stop being dead during a KuchuPuchu call, and the phone's own call
 * concurrency (an incoming GSM call, an emergency call) can now see that we hold a line.
 *
 * Nothing here may decide a call outcome on its own, so every request goes through
 * [TelecomPolicy.actionFor], which is allowed to answer nothing at all.
 */
@RequiresApi(Build.VERSION_CODES.O)
class KpCallConnection(
    /** The `calls` row this mirror belongs to. */
    val callId: String,
) : Connection() {
    private val main = Handler(Looper.getMainLooper())

    /** Last state pushed to Telecom, so a repeated publish is a no-op. Telecom rejects
     * backwards transitions ("setRinging: unable to transition") and logs them; a call
     * that flickers between two rows would otherwise spam the system's own log. */
    private var pushed: KpTelecomState? = null

    init {
        // Marks this connection as owned by the app rather than the platform dialer: the
        // system then does not look for an InCallService for it, which is what keeps the
        // existing in-app call UI the only one on screen.
        setConnectionProperties(PROPERTY_SELF_MANAGED)
        // The engine supports holding one call (CallEngine.toggleHold) and nothing else,
        // so exactly that and no more is advertised — CAPABILITY_MUTE and the DTMF bits
        // are deliberately absent because there is no engine action behind them.
        setConnectionCapabilities(CAPABILITY_SUPPORT_HOLD)
        // A VoIP call: Telecom keeps the telephony audio mode for as long as this
        // connection is live, which is the mode the WebRTC side already runs.
        setAudioModeIsVoip(true)
    }

    /** Push one engine state. Safe to call on every publish; see [pushed]. */
    fun apply(
        call: CallUi,
        onHold: Boolean,
    ) {
        val state = TelecomPolicy.stateFor(call.status, onHold)
        val address = KpTelecom.uriFor(call.id)
        if (address.toString() != this.address?.toString()) {
            setAddress(address, TelecomManager.PRESENTATION_ALLOWED)
        }
        // `Connection` has no display-name setter: the peer's name travels as the caller
        // display name in both directions, which is what the system's surfaces (a watch, a
        // headset's screen) label the call with. PRESENTATION_ALLOWED because the name is
        // the app's own account data, not something the platform should hide.
        if (call.otherName.isNotBlank() && call.otherName != callerDisplayName) {
            setCallerDisplayName(call.otherName, TelecomManager.PRESENTATION_ALLOWED)
        }
        setVideoState(if (call.kind == "VIDEO") VideoProfile.STATE_BIDIRECTIONAL else VideoProfile.STATE_AUDIO_ONLY)
        if (state == pushed) return
        when (state) {
            KpTelecomState.RINGING -> setRinging()
            KpTelecomState.ACTIVE -> setActive()
            // `setOnHold()` is the held transition; there is no setOnUnhold, going back to
            // active is the unhold. The public surface has no connect-time setter at all
            // (setConnectTimeMillis is @hide), so the system shows the state-change time
            // and the app's own in-call timer stays the authoritative duration.
            KpTelecomState.HELD -> setOnHold()
            KpTelecomState.DISCONNECTED -> Unit // handled by KpTelecom.release, which also destroys us
        }
        pushed = state
    }

    /** End the mirror with the cause the engine's row implies. */
    fun end(cause: String) {
        main.removeCallbacksAndMessages(null)
        setDisconnected(
            DisconnectCause(
                when (cause) {
                    "remote" -> DisconnectCause.REMOTE
                    "error" -> DisconnectCause.ERROR
                    "busy" -> DisconnectCause.BUSY
                    else -> DisconnectCause.LOCAL
                },
            ),
        )
        pushed = KpTelecomState.DISCONNECTED
        destroy()
    }

    override fun onAnswer() = request("answer")

    override fun onDisconnect() = request("disconnect")

    override fun onHold() = request("hold")

    override fun onUnhold() = request("unhold")

    /**
     * The system wants the user to see this call (a tap on its own call notification, an
     * "answer" affordance that needs the app). Self-managed means the app owns the UI, so
     * the answer is: bring our own activity forward. Deliberately not a new screen — the
     * ringing screen is already the right one and `singleTop` keeps it instance-stable.
     */
    override fun onShowIncomingCallUi() {
        val ctx = KpTelecom.context ?: return
        runCatching {
            ctx.startActivity(
                android.content.Intent(ctx, MainActivity::class.java)
                    .addFlags(
                        android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            android.content.Intent.FLAG_ACTIVITY_NEW_TASK,
                    ),
            )
        }
    }

    /**
     * Hand a framework request to the engine on the main thread, judged against the
     * engine's own state. Engine methods write Compose state and touch WebRTC, so they
     * are not called from Telecom's binder thread; and if the engine has vanished (the
     * process was restarted while Telecom still held the connection) the request is
     * dropped rather than resurrected.
     */
    private fun request(name: String) {
        val engine = CallEngine.instance ?: return
        val call = engine.active ?: return
        val action = TelecomPolicy.actionFor(name, call.status, call.incoming, engine.onHold)
        if (action == KpTelecomAction.NONE) return
        main.post {
            val now = CallEngine.instance?.active ?: return@post
            when (TelecomPolicy.actionFor(name, now.status, now.incoming, CallEngine.instance?.onHold == true)) {
                KpTelecomAction.ACCEPT -> runCatching { engine.answer() }
                KpTelecomAction.DECLINE -> runCatching { engine.decline() }
                KpTelecomAction.HANGUP -> runCatching { engine.hangup() }
                KpTelecomAction.HOLD -> runCatching { engine.toggleHold() }
                KpTelecomAction.UNHOLD -> runCatching { engine.toggleHold() }
                KpTelecomAction.NONE -> Unit
            }
        }
    }
}
