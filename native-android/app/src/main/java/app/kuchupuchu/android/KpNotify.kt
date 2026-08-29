package app.kuchupuchu.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Notification channels + builders.
 *
 * Message notifications: tap opens the conversation.
 * Call heads-up: round-1 stand-in until the ringing screens land
 * (they replace this with full-screen ringing + accept/decline).
 */
object KpNotify {
    private const val CHAT_CHANNEL = "kp_messages_v2"
    private const val CALL_CHANNEL = "kp_calls_v2"
    private const val GROUP = "kp_chats"

    fun ensureChannels(ctx: Context) {
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // API 26+: the CHANNEL decides sound/vibration; a per-notification
        // setSound() is ignored. Channels created without an explicit sound
        // were SILENT — a top reason "notification jacche na" reports.
        val attrs = android.media.AudioAttributes.Builder()
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
            .build()
        mgr.createNotificationChannel(
            NotificationChannel(CHAT_CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "New chat messages"
                    setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), attrs)
                    enableVibration(true)
                },
        )
        mgr.createNotificationChannel(
            NotificationChannel(CALL_CHANNEL, "Calls", NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "Incoming calls"
                    setBypassDnd(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                },
        )
    }

    private fun chatTap(ctx: Context, convoId: String): PendingIntent =
        PendingIntent.getActivity(
            ctx,
            convoId.hashCode(),
            Intent(ctx, MainActivity::class.java).apply {
                putExtra("kp_chat", convoId)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun message(ctx: Context, from: String, body: String, convoId: String) {
        ensureChannels(ctx)
        val n =
            NotificationCompat.Builder(ctx, CHAT_CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle(from)
                .setContentText(body)
                .setAutoCancel(true)
                .setGroup(GROUP)
                .setContentIntent(chatTap(ctx, convoId))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setSound(defaultSound())
                .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(convoId.hashCode(), n) }
    }

    /** Incoming-call heads-up when the engine isn't alive yet; opening the app lets it take over. */
    fun callHeadsUp(ctx: Context, from: String, video: Boolean, callId: String) {
        ensureChannels(ctx)
        val open =
            PendingIntent.getActivity(
                ctx,
                5,
                Intent(ctx, MainActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP,
                ),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val n =
            NotificationCompat.Builder(ctx, CALL_CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle("$from is calling")
                .setContentText(if (video) "Incoming video call" else "Incoming voice call")
                .setAutoCancel(true)
                .setContentIntent(open)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setSound(defaultSound())
                .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(callId.hashCode(), n) }
    }

    private fun defaultSound(): Uri = android.provider.Settings.System.DEFAULT_NOTIFICATION_URI

    fun cancelAll(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancelAll()
    }
}
