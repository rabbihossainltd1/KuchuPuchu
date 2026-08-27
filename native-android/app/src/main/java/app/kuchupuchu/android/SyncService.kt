package app.kuchupuchu.android

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Tiny global snapshot of what the UI is doing, read by the sync service. */
object KpState {
    @Volatile
    var foreground: Boolean = false

    @Volatile
    var route: String = ""
}

/**
 * Always-on foreground service so message + call notifications arrive within
 * seconds even when the app is closed. Polls calls every ~1.5s and the inbox
 * every ~3s, and posts the notifications itself.
 */
class KpSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lastUnread = HashMap<String, Int>()
    private var ringingCallId: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        CallNotify.ensure(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // The process may have been restarted by the system for this service
        // alone, so the token has to be read from storage first.
        if (Api.token == null) Api.loadToken(this)
        if (Api.token.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = syncNotification()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                SYNC_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(SYNC_ID, notification)
        }
        startPolling()
        return START_STICKY
    }

    override fun onDestroy() {
        pollStarted = false
        scope.cancel()
        super.onDestroy()
    }

    private fun syncNotification(): Notification {
        val open =
            PendingIntent.getActivity(
                this,
                10,
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        return NotificationCompat.Builder(this, CH_SYNC)
            .setSmallIcon(R.drawable.icon_gold)
            .setContentTitle("KuchuPuchu connected")
            .setContentText("Tap to open. Messages and calls arrive instantly.")
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .build()
    }

    private fun startPolling() {
        if (pollStarted) return
        pollStarted = true
        scope.launch {
            var tick = 0L
            while (isActive) {
                if (Api.token.isNullOrBlank()) break
                runCatching { pollCalls() }
                if (tick % 2 == 0L) runCatching { pollInbox() }
                tick++
                delay(1500)
            }
            stopSelf()
        }
    }

    /**
     * While the app process is alive the CallEngine handles calls itself
     * (including its own ringing UI), so the service only steps in when the
     * engine is gone, e.g. after Android restarted the process for the service.
     */
    private suspend fun pollCalls() {
        if (CallEngine.instance != null) {
            if (ringingCallId != null) {
                CallNotify.cancelIncoming(this)
                ringingCallId = null
            }
            return
        }
        val data = runCatching { Api.get("/api/calls/active") }.getOrNull() ?: return
        val ringing =
            data.arr("items").objects().filter {
                it.optBoolean("incoming") &&
                    it.optString("status") == "RINGING" &&
                    it.optString("id") !in CallEngine.ignoredCalls
            }
        val top = ringing.firstOrNull()
        if (top == null) {
            if (ringingCallId != null) {
                CallNotify.cancelIncoming(this)
                ringingCallId = null
            }
            return
        }
        val callId = top.optString("id")
        if (callId == ringingCallId) return
        ringingCallId = callId
        val other = top.optJSONObject("other") ?: JSONObject()
        CallNotify.incoming(this, other.name(), top.optString("kind") == "VIDEO", callId)
    }

    private suspend fun pollInbox() {
        val data = runCatching { Api.get("/api/conversations") }.getOrNull() ?: return
        val watchingInbox = KpState.foreground && KpState.route == "tabs/inbox"
        val inAnyChat = KpState.foreground && KpState.route.startsWith("chat/")
        for (row in data.arr("items").objects()) {
            val id = row.optString("id")
            if (id.isBlank()) continue
            val unread = row.optInt("unread")
            val prev = lastUnread[id]
            lastUnread[id] = unread
            if (watchingInbox || inAnyChat) continue
            if (prev == null || unread <= prev) continue
            if (id == CallEngine.instance?.openChat) continue
            if (row.optBoolean("muted")) continue
            val other = row.optJSONObject("other") ?: JSONObject()
            val body =
                row.optJSONObject("lastMessage")?.clean("body").orEmpty().ifBlank { "New message" }
            MsgNotify.show(this, other, body, id)
        }
    }

    companion object {
        const val SYNC_ID = 7110
        const val CH_SYNC = "kp-sync"
        private var pollStarted = false

        fun start(ctx: Context) {
            if (Api.token.isNullOrBlank()) return
            val intent = Intent(ctx, KpSyncService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, KpSyncService::class.java))
        }
    }
}

/** Handles direct replies typed inside the message notification. */
class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val convoId = intent.getStringExtra("convoId") ?: return
        val text =
            RemoteInput.getResultsFromIntent(intent)
                ?.getCharSequence("kp_reply")
                ?.toString()
                ?.trim()
                .orEmpty()
        if (text.isEmpty()) return
        val result = goAsync()
        Thread {
            val sent =
                runCatching {
                    Api.loadToken(context)
                    Api.post("/api/conversations/$convoId/messages", JSONObject().put("body", text))
                }.isSuccess
            if (sent) MsgNotify.cancel(context, convoId)
            result.finish()
        }.start()
    }
}
