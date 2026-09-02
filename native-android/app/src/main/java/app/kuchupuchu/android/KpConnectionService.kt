package app.kuchupuchu.android

import android.os.Build
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle

/**
 * §31: the entry point Telecom binds to when [KpTelecom] reports a call.
 *
 * The service does not create calls. It hands the framework a [KpCallConnection] that
 * mirrors the call [CallEngine] is already running, and if there is nothing to mirror —
 * the row is gone, the direction does not match, the app was restarted while the system
 * still remembered a call — it returns a connection that is disconnected on arrival.
 * Returning a live-but-orphaned connection is the failure mode worth naming: the system
 * would then keep a phantom "in call" entry, hold the telephony audio mode, and on some
 * OEMs mute the ringtone for real GSM calls afterwards.
 *
 * `MANAGE_OWN_CALLS` in the manifest is what lets Telecom bind this at all; the
 * `BIND_TELECOM_CONNECTION_SERVICE` permission on the declaration is what keeps anyone
 * other than the system from doing so.
 */
class KpConnectionService : ConnectionService() {
    override fun onCreateIncomingConnection(
        phoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ): Connection = mirror(request, incoming = true)

    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ): Connection = mirror(request, incoming = false)

    override fun onCreateIncomingConnectionFailed(
        phoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ) {
        // Nothing was bound, so the pending registration must not keep its slot.
        KpTelecom.onFailed()
        super.onCreateIncomingConnectionFailed(phoneAccount, request)
    }

    override fun onCreateOutgoingConnectionFailed(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ) {
        KpTelecom.onFailed()
        super.onCreateOutgoingConnectionFailed(connectionManagerPhoneAccount, request)
    }

    override fun onDestroy() {
        KpTelecom.onServiceDestroyed()
        super.onDestroy()
    }

    private fun mirror(
        request: ConnectionRequest?,
        incoming: Boolean,
    ): Connection {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return refused()
        val engine = CallEngine.instance
        val call = engine?.active
            ?: return refused()
        // The address round-trips the `calls` row id (see KpTelecom.uriFor), so a request
        // the framework is replaying for a call we have already dropped is refused rather
        // than mapped onto whatever happens to be live now.
        val wanted = request?.address?.lastPathSegment
        if (call.incoming != incoming || (wanted != null && wanted != call.id)) return refused()
        return KpCallConnection(call.id).also { KpTelecom.onCreated(it, call, engine.onHold) }
    }

    /**
     * `Connection` is abstract, and the framework already ships the right answer for "this
     * cannot be served": a connection that arrives disconnected. Handing back a live one
     * with nothing behind it is what leaves the system believing a call is up.
     */
    private fun refused(): Connection = Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
}
