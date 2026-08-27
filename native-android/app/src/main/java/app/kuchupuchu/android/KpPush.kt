package app.kuchupuchu.android

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Firebase Cloud Messaging push (Messenger mode).
 *
 * The worker has FCM secrets configured and sends high-priority data
 * messages for every new message and incoming call, so the app needs no
 * always-on service and no permanent notification.
 */
object KpPush {
    @Volatile
    var decided: Boolean = false

    @Volatile
    var enabled: Boolean = false

    /** Fetches the public Firebase config from the worker and inits Firebase. */
    fun tryInit(ctx: Context): Boolean {
        if (enabled) return true
        val cfg =
            runCatching { Api.get("/api/config/firebase", force = true).optJSONObject("firebase") }.getOrNull()
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
        enabled = ok
        decided = true
        return ok
    }

    /** Registers (or refreshes) this device's FCM token with the worker. */
    fun registerToken(ctx: Context) {
        if (!enabled) return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (token.isNotBlank()) {
                    Thread { runCatching { Api.post("/api/devices", JSONObject().put("token", token)) } }.start()
                }
            }
        }
    }

    /** Removes this device from push delivery (logout). */
    fun unregister() {
        if (!enabled) return
        runCatching { FirebaseMessaging.getInstance().deleteToken() }
        enabled = false
        decided = false
    }
}

/**
 * Receives FCM data messages:
 *  - type=message : { convoId, kind, from, body }
 *  - type=call     : { callId, kind (AUDIO|VIDEO), from, fromId }
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
        val callId = data["callId"]
        if (callId.isNullOrBlank()) return
        // Call UI (ringing screen + engine) arrives with the call round.
        // Until then show a high-priority heads-up notification.
        KpNotify.callHeadsUp(this, data["from"] ?: "KuchuPuchu", data["kind"] == "VIDEO", callId)
    }

    private fun handleMessage(data: Map<String, String>) {
        val convoId = data["convoId"] ?: return
        if (Store.foreground && Store.route == "chat/$convoId") return
        KpNotify.message(this, data["from"] ?: "KuchuPuchu", data["body"] ?: "New message", convoId)
    }

    override fun onNewToken(token: String) {
        if (token.isNotBlank()) {
            Thread { runCatching { Api.post("/api/devices", JSONObject().put("token", token)) } }.start()
        }
    }
}
