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
 *  - type=call        : { callId, kind (AUDIO|VIDEO), from, fromId }
 *  - type=call_answer : { callId, kind }  (to the caller, on accept)
 */
class KpPushService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "call" -> handleCall(data)
            "call_answer" -> handleCallAnswer(data)
            "message" -> handleMessage(data)
            "missed_call" -> handleMissedCall(data)
            "reoffer", "reanswer" -> data["callId"]?.let { CallEngine.instance?.kickPoll(it) }
        }
    }

    /**
     * Sent to the CALLER when the callee accepts: force an immediate poll so
     * the ringing screen flips to connected within push latency (~1s) instead
     * of waiting for the next poll tick.
     */
    /** Missed-call alert with Call back / Message actions (app alive). */
    private fun handleMissedCall(data: Map<String, String>) {
        KpNotify.missedCall(
            this,
            data["fromName"] ?: "KuchuPuchu",
            data["kind"] == "VIDEO",
            data["kp_callback"] ?: "",
            data["kp_chat"] ?: "",
        )
    }

    private fun handleCallAnswer(data: Map<String, String>) {
        val callId = data["callId"] ?: return
        CallEngine.instance?.kickPoll(callId)
    }

    private fun handleCall(data: Map<String, String>) {
        val callId = data["callId"]
        if (callId.isNullOrBlank()) return
        if (callId in CallEngine.ignoredCalls) return
        // Only skip the heads-up when the engine is actually alive and polling.
        // The old check bailed out whenever an engine had ever been constructed,
        // which is always true once MainActivity has run — so incoming-call
        // notifications effectively never appeared.
        val engine = CallEngine.instance
        if (engine != null && engine.polling) return
        // worker sends "fromName" — "from" is a reserved FCM data key and
        // was silently rejected (400) by FCM, which is why pushes never
        // reached a killed app.
        // ONE card per call. On MIUI a live process receives onMessageReceived
        // AND the OS still draws the plain payload card — the "double call
        // notification, ekta te Receive arekta te nai" bug. Drop every call
        // card first, then post our heads-up.
        // Revalidate against authoritative state immediately before painting.
        // This closes the delayed-push race where Cancel wins on the server
        // while an already-delivered FCM callback is still pending locally.
        Thread {
            val stillRinging = runCatching {
                Api.get("/api/calls/active", force = true).arr("items").objects().any {
                    it.optString("id") == callId && it.optString("status") == "RINGING"
                }
            }.getOrDefault(false)
            if (!stillRinging || callId in CallEngine.ignoredCalls) return@Thread
            KpNotify.cancelSystemCallCards(this)
            KpNotify.callHeadsUp(this, data["fromName"] ?: data["from"] ?: "KuchuPuchu", data["kind"] == "VIDEO", callId)
        }.start()
        // Data-only calls no longer create a later OS payload card, but retain
        // this harmless sweep for upgrades with one stale queued payload.
        // The OS card can land AFTER the cancel above; sweep again shortly.
        // Payload cards only — the engine's full-screen Accept/Decline card
        // (1.6s callee grace) can't exist yet, and this sweep never touches
        // category-bearing cards anyway.
        Thread {
            Thread.sleep(700)
            runCatching { KpNotify.cancelPayloadCallCards(applicationContext) }
        }.start()
    }

    private fun handleMessage(data: Map<String, String>) {
        val convoId = data["convoId"] ?: return
        val mid = data["mid"]
        // Mute is honored on BOTH sides of the wire: the worker tags the push
        // with the recipient's flag, and we also re-check the locally cached
        // conversation (covers a push sent between the user tapping Mute and
        // the next list refresh — the flag the server saw was already stale).
        val muted = data["muted"] == "1" || ScreenStore.isMuted(convoId)
        // Breadcrumb: proves a data-only push reached the process, and in
        // which state (foreground / background / woken-from-dead) — the A/B
        // push test depends on exactly this signal.
        Thread {
            runCatching {
                Api.loadToken(this)
                Api.post(
                    "/api/debug/clientlog",
                    org.json.JSONObject()
                        .put("stage", "push")
                        .put("detail", "data-msg fg=" + Store.foreground + " route=" + Store.route + " muted=" + muted + " from=" + data["fromName"]),
                )
            }
        }.start()
        ScreenStore.pokeInbox()
        if (Store.route == "chat/$convoId" && Store.foreground) {
            if (!muted) runCatching { KpSounds.receive(this) }
            return
        }
        // Badge jumps instantly; the next list refresh confirms the same number.
        ScreenStore.bumpUnread(convoId, data["body"])
        if (!muted) runCatching { KpSounds.receive(this) }
        KpNotify.message(
            this,
            data["fromName"] ?: data["from"] ?: "KuchuPuchu",
            data["body"] ?: "New message",
            convoId,
            muted = muted,
            mid = mid,
        )
    }

    override fun onNewToken(token: String) {
        if (token.isNotBlank()) {
            Thread { runCatching { Api.post("/api/devices", JSONObject().put("token", token)) } }.start()
        }
    }
}
