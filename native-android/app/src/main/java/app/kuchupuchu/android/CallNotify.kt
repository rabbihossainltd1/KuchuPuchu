package app.kuchupuchu.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
import java.util.concurrent.atomic.AtomicBoolean

const val CALL_ACCEPT = "app.kuchupuchu.android.CALL_ACCEPT"
const val CALL_DECLINE = "app.kuchupuchu.android.CALL_DECLINE"
const val CALL_END = "app.kuchupuchu.android.CALL_END"
const val CALL_SPEAKER = "app.kuchupuchu.android.CALL_SPEAKER"
private const val INCOMING_ID = 7101
private const val ONGOING_ID = 7102
// v4: incoming-call ring on the ALARM stream — rings even on silent, with
// the new tring-tring tone.
private const val CH_IN = "kp-calls-v4"
private const val CH_FG = "kp-call-fg"

/** Ringtone + vibration while an incoming call rings. */
object CallSounds {
    private var ring: MediaPlayer? = null
    private var ringback: MediaPlayer? = null
    /** Which stream the live ringback rides, so a route change can move it. */
    private var ringbackUsage = 0
    private var liftedFrom = -1

    /**
     * Short one-shot "call ended" tone (user-provided kp_call_end). Fired
     * when the call UI tears down for any reason (hangup, decline, remote
     * end, cancel). Fire-and-forget on its own thread; the player releases
     * itself on completion, nothing in the call state machine depends on it.
     */
    fun playEnd(ctx: Context) {
        Thread {
            runCatching {
                val attrs = android.media.AudioAttributes.Builder()
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build()
                val player =
                    MediaPlayer.create(ctx.applicationContext, R.raw.kp_call_end, attrs, 1)
                        ?: return@runCatching
                player.setOnCompletionListener { runCatching { it.release() } }
                runCatching { player.start() }
            }
        }.start()
    }

    /**
     * R23 proved the ALARM stream alone isn't enough: a phone left at ALARM
     * volume 0 stays dead-silent even for alarms — no ring, no ringback.
     * Lift it while a call is audible, restore the user's level after.
     */
    private fun liftAlarmVolume(ctx: Context) {
        if (liftedFrom >= 0) return
        runCatching {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val cur = am.getStreamVolume(AudioManager.STREAM_ALARM)
            if (cur <= 0) {
                val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
                am.setStreamVolume(AudioManager.STREAM_ALARM, (max * 3 / 5).coerceIn(1, max), 0)
                liftedFrom = cur
            }
        }
    }

    /** Restore only once no call sound is playing anymore. */
    private fun maybeRestoreAlarmVolume(ctx: Context) {
        if (liftedFrom < 0 || ring != null || ringback != null) return
        runCatching {
            (ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                .setStreamVolume(AudioManager.STREAM_ALARM, liftedFrom, 0)
        }
        liftedFrom = -1
    }

    /**
     * RingBACK — the tone the CALLER hears while waiting (a real phone
     * never leaves the caller in silence). Quieter than the incoming
     * ring, no vibration.
     */
    @Synchronized
    fun startRingback(ctx: Context) {
        if (ringback != null || ring != null) return
        val usage = toneUsage(ctx)
        val attrs = android.media.AudioAttributes.Builder()
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(usage)
            // Ringback rides the ALARM stream (the old NOTIFICATION_RINGTONE usage
            // was muted by silent mode, so the caller sat in total silence while
            // "Ringing…" showed — a real dialer is never silent for the caller),
            // EXCEPT while the call has a headset route, where it rides the
            // communication stream so the tone and the call are the same place:
            // see toneUsage().
            .build()
        val player =
            runCatching { MediaPlayer.create(ctx.applicationContext, R.raw.kp_ring, attrs, 1) }.getOrNull()
                ?: return
        player.isLooping = true
        runCatching { player.setVolume(0.62f, 0.62f) }
        // Only the alarm stream needs borrowing the user's alarm volume; the
        // communication stream is already at call level.
        if (usage == android.media.AudioAttributes.USAGE_ALARM) liftAlarmVolume(ctx.applicationContext)
        runCatching { player.start() }
        ringback = player
        ringbackUsage = usage
    }

    @Synchronized
    fun stopRingback() {
        runCatching { ringback?.stop() }
        ringback?.release()
        ringback = null
        // stop() has no Context param; without one we can't restore the alarm
        // volume here — stop(ctx) handles it, and this null-guard just defers.
    }

    @Synchronized
    fun startRing(ctx: Context) {
        if (ring != null) return
        val attrs = android.media.AudioAttributes.Builder()
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(toneUsage(ctx))
            // Incoming ring on the ALARM stream: rings even when the phone is
            // silent — per the user's explicit request. Before it is answered
            // there is no call route yet, so nothing changes there either.
            .build()
        val player =
            runCatching {
                MediaPlayer.create(ctx.applicationContext, R.raw.kp_ring3, attrs, 1)
            }.getOrNull()
                ?: run {
                    // No 4-arg (Uri, attrs) overload exists — build manually:
                    // setAudioAttributes BEFORE setDataSource/prepare is the
                    // only order that sticks (post-prepare is ignored).
                    val fallback = MediaPlayer()
                    val ok =
                        runCatching {
                            fallback.setAudioAttributes(attrs)
                            fallback.setDataSource(
                                ctx.applicationContext,
                                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                            )
                            fallback.prepare()
                            true
                        }.getOrDefault(false)
                    if (ok) fallback else null
                }
                ?: return
        player.isLooping = true
        liftAlarmVolume(ctx.applicationContext)
        runCatching { player.start() }
        ring = player
        vibrate(ctx, longArrayOf(0, 500, 400, 500))
    }

    /**
     * Send a call tone to the device the CALL is on.
     *
     * These tones ride the ALARM stream, which ignores communication routing
     * entirely — so with buds in, the ring came out of the loudspeaker as well
     * and the user heard "both sources at once". AudioAttributes cannot express a
     * preferred device at all (no such builder method); MediaPlayer.setDevice is
     * the only real handle, so it is applied once the player is prepared.
     */
    /**
     * Which stream a call tone rides.
     *
     * USAGE_ALARM is why this app is heard through silent mode and Do Not
     * Disturb, but that stream is routed by the alarm policy — it plays on the
     * phone even when the call itself is sitting in a headset, which is the
     * "audio comes out of both sources" report. While a call has an external
     * route, the tones switch to USAGE_VOICE_COMMUNICATION, which follows the
     * committed device and nothing else. (Pinning the player directly is not an
     * option: AudioAttributes has no preferred-device method and MediaPlayer has
     * no public setDevice on this compileSdk — CI proved both.)
     */
    private fun toneUsage(ctx: Context): Int =
        if (runCatching { AudioRouter.toneFollowsCallRoute(ctx.applicationContext) }.getOrDefault(false))
            android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION
        else android.media.AudioAttributes.USAGE_ALARM

    /**
     * Move the caller's ringback when the call's audio route moves.
     *
     * This is the "never in two places at once" guard for tones: tapping the
     * audio button during "Ringing…" used to leave the ringback on the alarm
     * stream — i.e. on the phone speaker — next to a call that had just moved to
     * the buds. The incoming ring needs nothing here: while the phone is still
     * ringing there is no call route to follow, so it stays on the alarm stream
     * and is loud through silent mode either way.
     */
    @Synchronized
    fun retuneTones(ctx: Context) {
        if (ringback == null) return
        if (ringbackUsage == toneUsage(ctx)) return
        stopRingback()
        startRingback(ctx)
    }

    @Synchronized
    fun vibrate(ctx: Context, pattern: LongArray) {
        val vib =
            if (Build.VERSION.SDK_INT >= 31) {
                ctx.getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
        runCatching {
            if (Build.VERSION.SDK_INT >= 26) {
                vib.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vib.vibrate(pattern, 0)
            }
        }
    }

    @Synchronized
    fun stop(ctx: Context? = null) {
        runCatching { ring?.stop() }
        ring?.release()
        ring = null
        runCatching { ringback?.stop() }
        ringback?.release()
        ringback = null
        // Give the user's alarm-volume level back once nothing rings.
        ctx?.let { maybeRestoreAlarmVolume(it) }
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

/** Incoming-call notification (full-screen, accept/decline) + in-call FGS notification. */
object CallNotify {
    fun ensure(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CH_IN) == null) {
            val ch = NotificationChannel(CH_IN, "Incoming calls", NotificationManager.IMPORTANCE_HIGH)
            ch.setSound(
                Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_ring3}"),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            ch.enableVibration(true)
            ch.vibrationPattern = longArrayOf(0, 500, 400, 500)
            nm.createNotificationChannel(ch)
        }
        if (nm.getNotificationChannel(CH_FG) == null) {
            val fg = NotificationChannel(CH_FG, "In a call", NotificationManager.IMPORTANCE_LOW)
            fg.setSound(null, null)
            nm.createNotificationChannel(fg)
        }
    }

    fun incoming(ctx: Context, name: String, video: Boolean, callId: String? = null) {
        // The Compose IncomingCallScreen is already the foreground control
        // surface; posting a high-priority/full-screen notification as well
        // produced duplicate UI. Background/killed delivery still notifies.
        if (Store.foreground) return
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
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle(if (video) "Incoming video call" else "Incoming voice call")
                .setContentText(name)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .addAction(0, "Accept", accept)
                .addAction(0, "Decline", decline)
                .setSound(Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_ring2}"))
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
        val end = PendingIntent.getBroadcast(
            ctx,
            5,
            Intent(ctx, CallActionReceiver::class.java).setAction(CALL_END),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val speaker = PendingIntent.getBroadcast(
            ctx,
            6,
            Intent(ctx, CallActionReceiver::class.java).setAction(CALL_SPEAKER),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val call = CallEngine.instance?.active
        val startedAt = call?.startedAt ?: 0L
        val isVideo = call?.kind == "VIDEO"
        val builder = NotificationCompat.Builder(ctx, CH_FG)
            .setSmallIcon(R.mipmap.ic_stat_kp)
            .setContentTitle(title)
            .setContentText(if (startedAt > 0L) "Call in progress" else "Connecting…")
            .setOngoing(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOnlyAlertOnce(true)
        if (startedAt > 0L) {
            builder.setWhen(startedAt).setUsesChronometer(true).setShowWhen(true)
        } else {
            builder.setShowWhen(false)
        }
        // Video uses the screen controls for routing; its notification has
        // End only. Voice calls retain Speaker + End.
        if (!isVideo) builder.addAction(0, "Speaker", speaker)
        return builder.addAction(0, "End call", end).build()
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

/** Handles Decline from the notification while the app is closed. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            CALL_DECLINE -> {
                val id = intent.getStringExtra("kp_call_id")
                CallEngine.ignoredCalls.add(id ?: "")
                Thread {
                    if (!id.isNullOrBlank()) {
                        runCatching { Api.post("/api/calls/$id/decline") }
                    }
                }.start()
                CallNotify.cancelIncoming(ctx)
            }
            CALL_END -> CallEngine.instance?.hangup()
            CALL_SPEAKER -> CallEngine.instance?.toggleSpeaker()
        }
    }
}

/** Foreground service holding mic/camera (and screen share) during a call. */
class CallService : Service() {
    companion object {
        val fgReady = AtomicBoolean(false)
        private var started = false
        private var lastShare = false
        private var lastTitle: String? = null
        private var lastStartedAt = -1L
        private var lastKind: String? = null

        fun start(ctx: Context, title: String, share: Boolean = false) {
            val call = CallEngine.instance?.active
            val callStartedAt = call?.startedAt ?: 0L
            val callKind = call?.kind
            if (started) {
                // Only skip when there is genuinely nothing to change. This
                // used to compare `share` alone, so the second start() of every
                // call - the one that replaces "Calling Alice" with "In a call
                // with Alice" once the callee picks up - was dropped and the
                // notification stayed frozen on the ringing text for the whole
                // call.
                if (share == lastShare && title == lastTitle &&
                    callStartedAt == lastStartedAt && callKind == lastKind
                ) return
                // Reset fgReady so callers wait for onStartCommand to
                // re-declare the service types (Android 14+ requires the
                // mediaProjection type before getMediaProjection()).
                lastShare = share
                lastTitle = title
                lastStartedAt = callStartedAt
                lastKind = callKind
                fgReady.set(false)
                runCatching {
                    ctx.startService(
                        Intent(ctx, CallService::class.java).putExtra("title", title).putExtra("share", share),
                    )
                }
                return
            }
            started = true
            lastShare = share
            lastTitle = title
            lastStartedAt = callStartedAt
            lastKind = callKind
            fgReady.set(false)
            val intent = Intent(ctx, CallService::class.java).putExtra("title", title).putExtra("share", share)
            runCatching {
                if (Build.VERSION.SDK_INT >= 29) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            }
        }

        fun stop(ctx: Context) {
            if (!started) return
            started = false
            lastShare = false
            lastTitle = null
            lastStartedAt = -1L
            lastKind = null
            // The next call has to wait for a real startForeground again. This
            // used to stay true, so a caller could race past the wait and hit
            // getMediaProjection() with no foreground service behind it.
            fgReady.set(false)
            runCatching { ctx.stopService(Intent(ctx, CallService::class.java)) }
        }

        /** Drops the cached state, whatever tore the service down. */
        internal fun reset() {
            started = false
            lastShare = false
            lastTitle = null
            lastStartedAt = -1L
            lastKind = null
            fgReady.set(false)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra("title") ?: "Call in progress"
        val share = intent?.getBooleanExtra("share", false) == true
        val types =
            if (Build.VERSION.SDK_INT >= 30) {
                if (share) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                }
            } else {
                0
            }
        // Publish readiness only if the foreground declaration actually took.
        // Setting this unconditionally told CallEngine the service was in the
        // foreground even when startForeground() threw, and it then called
        // getMediaProjection(), which needs the mediaProjection type to have
        // been declared.
        val declared = runCatching {
            if (Build.VERSION.SDK_INT >= 30 && types != 0) {
                startForeground(ONGOING_ID, CallNotify.ongoing(this, title), types)
            } else {
                startForeground(ONGOING_ID, CallNotify.ongoing(this, title))
            }
        }.isSuccess
        fgReady.set(declared)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        // Without this, a service the system killed left `started` true and no
        // later call could ever bring the notification back.
        reset()
        super.onDestroy()
    }
}
