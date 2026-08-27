package app.kuchupuchu.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import org.json.JSONObject

const val CALL_ACCEPT = "app.kuchupuchu.android.CALL_ACCEPT"
const val CALL_DECLINE = "app.kuchupuchu.android.CALL_DECLINE"
const val REPLY_ACTION = "app.kuchupuchu.android.REPLY"
private const val INCOMING_ID = 7101
private const val ONGOING_ID = 7102
private const val CH_IN = "kp-calls-v3"
private const val CH_FG = "kp-call-fg"
private const val CH_MSG = "kp-msg-v3"

object CallSounds {
    private var ring: MediaPlayer? = null

    @Synchronized
    fun startRing(ctx: Context) {
        if (ring != null) return
        val player =
            runCatching { MediaPlayer.create(ctx.applicationContext, R.raw.kp_ring) }.getOrNull()
                ?: runCatching {
                    MediaPlayer.create(ctx.applicationContext, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                }.getOrNull()
                ?: return
        player.isLooping = true
        runCatching { player.setAudioStreamType(AudioManager.STREAM_RING) }
        runCatching { player.start() }
        ring = player
        val vib =
            if (Build.VERSION.SDK_INT >= 31) {
                ctx.getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
        runCatching {
            if (Build.VERSION.SDK_INT >= 26) {
                vib.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 500, 400, 500), 0))
            } else {
                @Suppress("DEPRECATION")
                vib.vibrate(longArrayOf(0, 500, 400, 500), 0)
            }
        }
    }

    @Synchronized
    fun stop(ctx: Context? = null) {
        runCatching { ring?.stop() }
        ring?.release()
        ring = null
        ctx?.let {
            val vib =
                if (Build.VERSION.SDK_INT >= 31) {
                    it.getSystemService(VibratorManager::class.java).defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    it.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                }
            runCatching { vib.cancel() }
        }
    }
}

object CallNotify {
    fun ensure(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CH_IN) == null) {
            val ch = NotificationChannel(CH_IN, "Incoming calls", NotificationManager.IMPORTANCE_HIGH)
            ch.setSound(
                Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_ring}"),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            ch.enableVibration(true)
            ch.vibrationPattern = longArrayOf(0, 500, 400, 500)
            ch.setBypassDnd(true)
            nm.createNotificationChannel(ch)
        }
        if (nm.getNotificationChannel(CH_FG) == null) {
            val fg = NotificationChannel(CH_FG, "In a call", NotificationManager.IMPORTANCE_LOW)
            fg.setSound(null, null)
            nm.createNotificationChannel(fg)
        }
        if (nm.getNotificationChannel(CH_MSG) == null) {
            val msg = NotificationChannel(CH_MSG, "Messages", NotificationManager.IMPORTANCE_HIGH)
            msg.setSound(
                Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_notify}"),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            msg.enableVibration(true)
            nm.createNotificationChannel(msg)
        }
        if (nm.getNotificationChannel(KpSyncService.CH_SYNC) == null) {
            val sync =
                NotificationChannel(KpSyncService.CH_SYNC, "Stay connected", NotificationManager.IMPORTANCE_MIN)
            sync.setSound(null, null)
            sync.enableVibration(false)
            nm.createNotificationChannel(sync)
        }
    }

    fun incoming(ctx: Context, name: String, video: Boolean, callId: String? = null) {
        ensure(ctx)
        val open =
            PendingIntent.getActivity(
                ctx,
                1,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        // Android 12+ blocks starting activities from broadcast receivers
        // (notification trampolines), so Accept goes straight to the activity.
        val accept =
            PendingIntent.getActivity(
                ctx,
                2,
                Intent(ctx, MainActivity::class.java)
                    .setAction(CALL_ACCEPT)
                    .putExtra("kp_accept", true)
                    .putExtra("kp_call_id", callId)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val decline =
            PendingIntent.getBroadcast(
                ctx,
                3,
                Intent(ctx, CallActionReceiver::class.java).setAction(CALL_DECLINE).putExtra("kp_call_id", callId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val n =
            NotificationCompat.Builder(ctx, CH_IN)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle(if (video) "Incoming video" else "Incoming call")
                .setContentText(name)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .addAction(0, "Accept", accept)
                .addAction(0, "Decline", decline)
                .setSound(Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_ring}"))
                .build()
        ctx.getSystemService(NotificationManager::class.java).notify(INCOMING_ID, n)
    }

    fun ongoing(ctx: Context, title: String): Notification {
        ensure(ctx)
        val open =
            PendingIntent.getActivity(
                ctx,
                4,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        return NotificationCompat.Builder(ctx, CH_FG)
            .setSmallIcon(R.drawable.icon_gold)
            .setContentTitle(title)
            .setContentText("Tap to return")
            .setOngoing(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()
    }

    fun cancelIncoming(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(INCOMING_ID)
        CallSounds.stop(ctx)
    }

    fun cancelAll(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.cancel(INCOMING_ID)
        nm.cancel(ONGOING_ID)
        CallSounds.stop(ctx)
    }
}

object MsgNotify {
    private class Line(val name: String, val body: String)

    private val history = java.util.Collections.synchronizedMap(HashMap<String, MutableList<Line>>())
    private val shownIds = java.util.Collections.synchronizedSet(HashSet<Int>())

    private fun notifId(convoId: String): Int = 7200 + (convoId.hashCode() and 0xfff)

    /**
     * Shows (or updates) the single notification for a conversation. New
     * messages append to the same notification instead of stacking new ones.
     */
    fun show(ctx: Context, other: JSONObject, body: String, convoId: String) {
        CallNotify.ensure(ctx)
        val name = other.name()
        val lines =
            synchronized(history) {
                val list = history.getOrPut(convoId) { ArrayList() }
                list.add(Line(name, body))
                while (list.size > 8) list.removeAt(0)
                list.toList()
            }
        val persona =
            androidx.core.app.Person.Builder()
                .setName(name)
                .setKey("kp-$convoId")
                .build()
        val style = NotificationCompat.MessagingStyle(persona)
        for (line in lines) {
            style.addMessage(
                NotificationCompat.MessagingStyle.Message(
                    line.body,
                    System.currentTimeMillis(),
                    androidx.core.app.Person.Builder().setName(line.name).build(),
                ),
            )
        }
        val open =
            PendingIntent.getActivity(
                ctx,
                convoId.hashCode(),
                Intent(ctx, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("kp_chat", convoId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val replyInput =
            RemoteInput.Builder("kp_reply")
                .setLabel("Reply")
                .build()
        val reply =
            PendingIntent.getBroadcast(
                ctx,
                convoId.hashCode() + 1,
                Intent(ctx, ReplyReceiver::class.java)
                    .setAction(REPLY_ACTION)
                    .putExtra("convoId", convoId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val n =
            NotificationCompat.Builder(ctx, CH_MSG)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle(name)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(open)
                .setStyle(style)
                .setNumber(lines.size)
                .addAction(
                    NotificationCompat.Action.Builder(
                        0,
                        "Reply",
                        reply,
                    ).addRemoteInput(replyInput).build(),
                )
                .setSound(Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_notify}"))
                .build()
        val id = notifId(convoId)
        shownIds.add(id)
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }

    /** Hides the conversation notification, e.g. after a direct reply. */
    fun cancel(ctx: Context, convoId: String) {
        history.remove(convoId)
        ctx.getSystemService(NotificationManager::class.java).cancel(notifId(convoId))
    }

    fun clearAll(ctx: Context) {
        synchronized(history) { history.clear() }
        val nm = ctx.getSystemService(NotificationManager::class.java)
        synchronized(shownIds) {
            for (id in shownIds) nm.cancel(id)
            shownIds.clear()
        }
    }
}

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra("kp_call_id")
        if (intent.action == CALL_DECLINE) {
            val engine = CallEngine.instance
            if (engine != null && (callId == null || engine.active?.id == callId)) {
                engine.decline()
            } else if (callId != null) {
                CallEngine.ignoredCalls.add(callId)
                Thread {
                    runCatching {
                        Api.loadToken(context)
                        Api.post("/api/calls/$callId/decline")
                    }
                }.start()
            }
        }
        CallNotify.cancelIncoming(context)
    }
}

class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra("title") ?: "KuchuPuchu call"
        val share = intent?.getBooleanExtra("share", false) == true
        if (Build.VERSION.SDK_INT >= 29) {
            var types =
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            if (share) types = types or android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            startForeground(ONGOING_ID, CallNotify.ongoing(this, title), types)
        } else {
            startForeground(ONGOING_ID, CallNotify.ongoing(this, title))
        }
        fgReady.set(true)
        return START_STICKY
    }

    override fun onDestroy() {
        fgReady.set(false)
        super.onDestroy()
    }

    companion object {
        val fgReady = java.util.concurrent.atomic.AtomicBoolean(false)

        fun start(ctx: Context, title: String, share: Boolean = false) {
            val i = Intent(ctx, CallService::class.java).putExtra("title", title).putExtra("share", share)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            fgReady.set(false)
            ctx.stopService(Intent(ctx, CallService::class.java))
        }
    }
}
