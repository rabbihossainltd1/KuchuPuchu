package app.kuchupuchu.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.RemoteInput
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** RemoteInput key for the notification reply action (shared with the receiver). */
private const val KEY_REPLY = "kp_reply_text"

/**
 * Notification channels + builders.
 *
 * Message notifications: tap opens the conversation.
 * Call heads-up: round-1 stand-in until the ringing screens land
 * (they replace this with full-screen ringing + accept/decline).
 */
object KpNotify {
    private const val CHAT_CHANNEL = "kp_messages_v2"
    // Muted conversations land here: badge + shade entry, but no sound and
    // no vibration (IMPORTANCE_DEFAULT). The mute toggle used to change only
    // the bell icon — every message still rang on the loud channel above.
    private const val SILENT_CHANNEL = "kp_silent_v1"
    private const val CALL_CHANNEL = "kp_calls_v5"
    private const val GROUP = "kp_chats"

    fun ensureChannels(ctx: Context) {
        // NotificationChannel is API 26 and the module ships minSdk 24, so on
        // Android 7.x this line threw NoSuchMethodError *before* any
        // notification got posted — message notifications could never appear at
        // all there, and because ensureChannels() runs inside
        // KpPushService.onMessageReceived the whole push delivery blew up.
        // Pre-26 the builders' own setSound/setPriority/setVibrationPattern
        // carry the behaviour, so simply skipping the channel is correct.
        if (Build.VERSION.SDK_INT < 26) return
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
            NotificationChannel(SILENT_CHANNEL, "Muted chats", NotificationManager.IMPORTANCE_DEFAULT)
                .apply {
                    description = "Messages from muted conversations"
                    setSound(null, null)
                    // Single-zero pattern = no vibration (works on every API
                    // level; setVibrationEnabled() is API 30+ only).
                    setVibrationPattern(longArrayOf(0))
                },
        )
        // v5: the user wants incoming calls to RING even on silent (like an
        // alarm) — new channel id, ALARM stream, new tring-tring tone.
        val ringAttrs = android.media.AudioAttributes.Builder()
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
            .build()
        mgr.createNotificationChannel(
            NotificationChannel(CALL_CHANNEL, "Calls", NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "Incoming calls"
                    setSound(
                        Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_ring3}"),
                        ringAttrs,
                    )
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 500, 400, 500)
                    setBypassDnd(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                },
        )
    }

    private fun chatTap(ctx: Context, convoId: String): PendingIntent =
        PendingIntent.getActivity(
            ctx,
            convoId.hashCode(),
            chatTapIntent(ctx, convoId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun message(
        ctx: Context,
        from: String,
        body: String,
        convoId: String,
        muted: Boolean = false,
        mid: String? = null,
    ) {
        ensureChannels(ctx)
        // WhatsApp-style direct actions: reply straight from the
        // notification, like with one tap, or mark read — no app open needed.
        // Each action carries the message id so it can cancel the EXACT card
        // (card ids below are derived from `mid`).
        val remoteInput = RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build()
        // The reply action is the ONLY one with a RemoteInput — and on Android
        // 14+ (API 34) a notification whose action has remote inputs is refused
        // outright unless that action's PendingIntent is FLAG_MUTABLE:
        //   IllegalArgumentException: "... Not posted. PendingIntents attached
        //   to actions with remote inputs must be mutable"
        // The system then drops the ENTIRE card, so every message notification
        // silently vanished on 14/15 devices — that is the real "message
        // notification ashe na" (the push itself arrives; error_log's
        // stage:"notify" breadcrumb recorded this exact throw). Like / mark-read
        // carry no input, so they keep FLAG_IMMUTABLE, which S+ requires.
        val replyPending =
            PendingIntent.getBroadcast(
                ctx,
                convoId.hashCode() * 4 + 1,
                Intent(ctx, KpNotifActionReceiver::class.java)
                    .setAction(KpNotifActionReceiver.ACTION_REPLY)
                    .putExtra("convoId", convoId)
                    .putExtra("mid", mid ?: ""),
                PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE
                     else 0),
            )
        val likePending =
            PendingIntent.getBroadcast(
                ctx,
                convoId.hashCode() * 4 + 2,
                Intent(ctx, KpNotifActionReceiver::class.java)
                    .setAction(KpNotifActionReceiver.ACTION_LIKE)
                    .putExtra("convoId", convoId)
                    .putExtra("mid", mid ?: ""),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val readPending =
            PendingIntent.getBroadcast(
                ctx,
                convoId.hashCode() * 4 + 3,
                Intent(ctx, KpNotifActionReceiver::class.java)
                    .setAction(KpNotifActionReceiver.ACTION_MARK_READ)
                    .putExtra("convoId", convoId)
                    .putExtra("mid", mid ?: ""),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val replyAction =
            NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, "Reply", replyPending)
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(true)
                .build()
        val likeAction =
            NotificationCompat.Action.Builder(android.R.drawable.ic_menu_agenda, "Like", likePending)
                .build()
        val readAction =
            NotificationCompat.Action.Builder(android.R.drawable.ic_menu_view, "Mark as read", readPending)
                .build()
        val n =
            NotificationCompat.Builder(ctx, if (muted) SILENT_CHANNEL else CHAT_CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle(from)
                .setContentText(body)
                .setAutoCancel(true)
                .setGroup(GROUP)
                .setWhen(System.currentTimeMillis())
                .setContentIntent(chatTap(ctx, convoId))
                .addAction(replyAction)
                .addAction(likeAction)
                .addAction(readAction)
                // Muted: no heads-up, no sound — channel is silent anyway,
                // and PRIORITY_DEFAULT keeps it out of the full-intent path.
                .setPriority(if (muted) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .apply { if (!muted) setSound(defaultSound()) }
                .build()
        // A group summary is REQUIRED once >1 grouped notification is
        // posted — without one, several OEM launchers (and Android itself
        // on some versions) silently collapse everything down to nothing
        // visible in the shade. This was part of "message notification
        // jacche na" — messages WERE posted, some launchers just never
        // surfaced them.
        val summary =
            NotificationCompat.Builder(ctx, CHAT_CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle("KuchuPuchu")
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .build()
        val mgr = NotificationManagerCompat.from(ctx)
        if (!mgr.areNotificationsEnabled()) {
            // This exact case was silently swallowed before, which is why
            // "message notification jai na" was undiagnosable from the server
            // side: the push HAD arrived, the user (or MIUI) had the channel
            // muted, and nothing anywhere recorded it.
            reportSkip(ctx, "blocked: system notifications disabled for app/channel")
            return
        }
        runCatching {
            // ONE card per message — a shared per-convo id used to make the
            // SECOND message silently replace the first card (no new
            // heads-up/sound on many OEMs). But the id must be recomputable
            // by the action buttons: they cancel THIS card. With the worker's
            // `mid` in the push payload the card id is simply mid.hashCode()
            // — unique per message AND known to the Reply/Like/Mark-as-read
            // actions (they carry `mid` as an extra). The old random high
            // bits made nm.cancel(convoId.hashCode()) miss the card ~127/128
            // of the time, so actions "did nothing".
            val msgId =
                mid?.takeIf { it.isNotBlank() }?.hashCode()?.and(Int.MAX_VALUE)
                    ?: (convoId.hashCode() and 0x00FFFFFF) or ((System.nanoTime() and 0x7F).toInt() shl 24)
            mgr.notify(msgId, n)
            mgr.notify(GROUP.hashCode(), summary)
        }.onFailure { e ->
            reportSkip(ctx, "notify threw " + e.javaClass.simpleName + ": " + (e.message?.take(120) ?: ""))
        }
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

    /**
     * Fire-and-forget breadcrumb for the "why is there no card" cases. Never
     * throws, never blocks: called straight from the push path, where anything
     * that fails must not take the delivery down with it.
     */
    private fun reportSkip(ctx: Context, why: String) {
        Thread {
            runCatching {
                Api.loadToken(ctx)
                Api.post(
                    "/api/debug/clientlog",
                    org.json.JSONObject().put("stage", "notify").put("detail", why),
                )
            }
        }.start()
    }

    private fun defaultSound(): Uri = android.provider.Settings.System.DEFAULT_NOTIFICATION_URI

    /**
     * Missed-call alert with Call back / Message actions. Actions only show
     * when OUR process builds this (app alive); the FCM payload fallback
     * (app killed) is system-drawn and cannot carry actions — tapping it
     * deep-links via the data extras instead.
     */
    fun missedCall(
        ctx: Context,
        from: String,
        video: Boolean,
        otherId: String,
        convoId: String,
    ) {
        ensureChannels(ctx)
        val callBack =
            PendingIntent.getActivity(
                ctx,
                otherId.hashCode() * 4 + 3,
                Intent(ctx, MainActivity::class.java)
                    .putExtra("kp_callback", otherId)
                    .putExtra("kp_callback_kind", if (video) "VIDEO" else "AUDIO")
                    .putExtra("kp_callback_name", from)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val message =
            PendingIntent.getActivity(
                ctx,
                otherId.hashCode() * 4 + 4,
                chatTapIntent(ctx, convoId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val n =
            NotificationCompat.Builder(ctx, CALL_CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle("Missed call · $from")
                .setContentText(if (video) "📹 Missed video call" else "📞 Missed voice call")
                .setAutoCancel(true)
                .setContentIntent(message)
                .addAction(0, "Call back", callBack)
                .addAction(0, "Message", message)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(("missed$otherId").hashCode(), n) }
    }

    /** The chatTap PendingIntent without the notify wrapper. */
    private fun chatTapIntent(ctx: Context, convoId: String): Intent =
        Intent(ctx, MainActivity::class.java).apply {
            putExtra("kp_chat", convoId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

    /**
     * Quiet confirmation shown after replying from the notification.
     * `cardId` (the original card's id) is reused so this REPLACES the card
     * in place — a second, differently-id'd "Sent" card used to pile up next
     * to the one that failed to dismiss.
     */
    fun replySent(ctx: Context, convoId: String, text: String, cardId: Int) {
        val n =
            NotificationCompat.Builder(ctx, CHAT_CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle("Sent")
                .setContentText(text.take(80))
                .setAutoCancel(true)
                .setContentIntent(chatTap(ctx, convoId))
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(cardId, n) }
    }

    /**
     * Dismisses call cards: our own heads-up (category CALL) AND the plain
     * OS-drawn FCM payload card. The payload card has NO category — matching
     * on category alone never removed it, which was the double-notification
     * bug (one card with buttons, one without). Missed-call cards carry
     * CATEGORY_MISSED_CALL and are always spared.
     */
    fun cancelSystemCallCards(ctx: Context, keepId: Int? = null) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.activeNotifications
                .filter {
                    val n = it.notification
                    it.id != keepId &&
                        (
                            n.category == android.app.Notification.CATEGORY_CALL ||
                                (n.channelId == CALL_CHANNEL && n.category == null)
                            )
                }
                .forEach { nm.cancel(it.id) }
        }
    }

    /**
     * OS-drawn payload cards ONLY (call channel, no category) — safe to call
     * at ANY moment: it can never touch our heads-up, the full-screen
     * Accept/Decline card, or missed-call alerts.
     */
    fun cancelPayloadCallCards(ctx: Context) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.activeNotifications
                .filter { it.notification.channelId == CALL_CHANNEL && it.notification.category == null }
                .forEach { nm.cancel(it.id) }
        }
    }

    fun cancelAll(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancelAll()
    }
}

/** Handles Reply / Like / Mark-as-read straight from the message notification. */
class KpNotifActionReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val convoId = intent.getStringExtra("convoId") ?: return
        // The exact card this action came from (worker `mid` in the extras).
        // Legacy cards (pre-`mid` pushes) fall back to the old cancel id —
        // they were the ones that leaked, but at least we never make it worse.
        val cardId =
            intent.getStringExtra("mid")
                ?.takeIf { it.isNotBlank() }
                ?.hashCode()
                ?: convoId.hashCode()
        Api.loadToken(ctx)
        val nm = NotificationManagerCompat.from(ctx)
        when (intent.action) {
            ACTION_LIKE -> {
                nm.cancel(cardId)
                val pending = goAsync()
                Thread {
                    runCatching {
                        Api.post(
                            "/api/conversations/$convoId/messages",
                            org.json.JSONObject()
                                .put("kind", "TEXT")
                                .put("body", "❤️")
                                .put("clientId", "c_${java.util.UUID.randomUUID()}"),
                        )
                    }
                    pending.finish()
                }.start()
            }
            ACTION_MARK_READ -> {
                // Just dismisses + marks read server-side — no reply sent,
                // no app open, matches the messenger-style tick behaviour.
                nm.cancel(cardId)
                val pending = goAsync()
                Thread {
                    runCatching { Api.post("/api/conversations/$convoId/read") }
                    runCatching { ScreenStore.markRead(convoId) }
                    pending.finish()
                }.start()
            }
            ACTION_REPLY -> {
                val text =
                    RemoteInput.getResultsFromIntent(intent)
                        ?.getCharSequence(KEY_REPLY)
                        ?.toString()
                        ?.trim()
                        ?: return
                if (text.isEmpty()) return
                val pending = goAsync()
                Thread {
                    val ok =
                        runCatching {
                            Api.post(
                                "/api/conversations/$convoId/messages",
                                org.json.JSONObject()
                                    .put("kind", "TEXT")
                                    .put("body", text)
                                    .put("clientId", "c_${java.util.UUID.randomUUID()}"),
                            )
                        }.isSuccess
                    if (ok) {
                        nm.cancel(cardId)
                        // Quiet "sent" confirmation REPLACES the same card
                        // (same id) — the old code posted a second card with
                        // convoId.hashCode(), so users saw the original card
                        // still there PLUS a duplicate "Sent" one.
                        runCatching {
                            KpNotify.replySent(ctx, convoId, text, cardId)
                        }
                    }
                    pending.finish()
                }.start()
            }
        }
    }

    companion object {
        const val ACTION_REPLY = "app.kuchupuchu.android.NOTIF_REPLY"
        const val ACTION_LIKE = "app.kuchupuchu.android.NOTIF_LIKE"
        const val ACTION_MARK_READ = "app.kuchupuchu.android.NOTIF_MARK_READ"
    }
}
