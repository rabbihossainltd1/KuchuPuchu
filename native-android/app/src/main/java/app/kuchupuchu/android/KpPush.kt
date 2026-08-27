package app.kuchupuchu.android

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Firebase Cloud Messaging push support.
 *
 * When push is configured the app behaves like Messenger: no always-on
 * foreground service, no permanent notification. The worker sends a data
 * message for every new chat message / incoming call and Android wakes the
 * app just-in-time to show the notification.
 *
 * Until the worker has FCM secrets set (`/api/config/firebase` returns
 * nothing) everything here silently no-ops and the legacy sync service stays
 * in charge, so nothing breaks in between.
 */
object KpPush {
    /** True once we've asked the server whether push is configured. */
    @Volatile
    var decided: Boolean = false

    /** True when Firebase was initialized and push is usable. */
    @Volatile
    var enabled: Boolean = false

    /** App ID of the registered Firebase Android client. */
    @Volatile
    private var appId: String = ""

    /**
     * Fetches the public Firebase config from the worker and initializes
     * Firebase if present. Must run on a background thread. Returns whether
     * push is enabled.
     */
    fun tryInit(ctx: Context): Boolean {
        if (enabled) return true
        val cfg =
            runCatching { Api.get("/api/config/firebase").optJSONObject("firebase") }.getOrNull()
        if (cfg == null || cfg.optString("applicationId").isBlank()) {
            decided = true
            enabled = false
            return false
        }
        val ok =
            runCatching {
                if (FirebaseApp.getApps(ctx).isEmpty()) {
                    FirebaseApp.initializeApp(
                        ctx,
                        FirebaseOptions.Builder()
                            .setApplicationId(cfg.optString("applicationId"))
                            .setApiKey(cfg.optString("apiKey"))
                            .setProjectId(cfg.optString("projectId"))
                            .setGcmSenderId(cfg.optString("senderId"))
                            .build(),
                    )
                }
                true
            }.getOrDefault(false)
        appId = cfg.optString("applicationId")
        enabled = ok
        decided = true
        return ok
    }

    /** Registers (or refreshes) this device's FCM token with the worker. */
    fun registerToken(ctx: Context) {
        if (!enabled) return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (token.isNotBlank()) sendToken(token)
            }
        }
    }

    /** Removes this device from push delivery (logout) — best effort. */
    fun unregister(ctx: Context) {
        if (!enabled) return
        // deleteToken() unregisters with Google, so pushes stop reaching this
        // device; the worker prunes its row on the next UNREGISTERED send.
        runCatching { FirebaseMessaging.getInstance().deleteToken() }
        enabled = false
        decided = false
    }

    private fun sendToken(token: String) {
        Thread {
            runCatching { Api.post("/api/devices", JSONObject().put("token", token)) }
        }.start()
    }
}

/**
 * Receives FCM data messages: new chat messages and incoming calls.
 * Data-only messages (with HIGH priority) are delivered here even when the
 * app is closed, which is exactly what replaces the old sync service.
 */
class KpPushService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "call" -> handleCall(data)
            "message" -> handleMessage(data)
        }
    }

    private fun handleCall(data: Map<String, String>) {
        // A live engine polls /api/calls/active itself and shows its own
        // ringing UI — don't double-ring.
        if (CallEngine.instance != null) return
        if (CallEngine.isIncomingSuppressed()) return
        val callId = data["callId"]
        if (callId.isNullOrBlank()) return
        if (callId in CallEngine.ignoredCalls) return
        CallNotify.incoming(this, data["from"] ?: "KuchuPuchu", data["kind"] == "VIDEO", callId)
    }

    private fun handleMessage(data: Map<String, String>) {
        val convoId = data["convoId"] ?: return
        // Chat screen for this conversation is open and visible → the UI
        // already shows it, no notification needed.
        if (KpState.foreground && KpState.route == "chat/$convoId") return
        val other =
            JSONObject()
                .put("displayName", data["from"] ?: "KuchuPuchu")
                .put("avatarUrl", data["avatar"] ?: "")
        MsgNotify.show(this, other, data["body"] ?: "New message", convoId)
    }

    override fun onNewToken(token: String) {
        if (token.isNotBlank()) {
            Thread { runCatching { Api.post("/api/devices", JSONObject().put("token", token)) } }.start()
        }
    }
}
