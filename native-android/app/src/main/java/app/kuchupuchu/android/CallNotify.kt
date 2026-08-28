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
private const val INCOMING_ID = 7101
private const val ONGOING_ID = 7102
private const val CH_IN = "kp-calls"
private const val CH_FG = "kp-call-fg"

/** Ringtone + vibration while an incoming call rings. */
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
        vibrate(ctx, longArrayOf(0, 500, 400, 500))
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
                Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_ring}"),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
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
            .setSmallIcon(R.mipmap.ic_stat_kp)
            .setContentTitle(title)
            .setContentText("Tap to return to the call")
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
        }
    }
}

/** Foreground service holding mic/camera (and screen share) during a call. */
class CallService : Service() {
    companion object {
        val fgReady = AtomicBoolean(false)
        private var started = false
        private var lastShare = false

        fun start(ctx: Context, title: String, share: Boolean = false) {
            if (started) {
                if (share == lastShare) return // same service types — nothing to re-declare
                // Re-start with different service types (e.g. screen share):
                // reset fgReady so callers can wait for onStartCommand to
                // re-declare the mediaProjection type (Android 14+ requires
                // this before getMediaProjection()).
                lastShare = share
                fgReady.set(false)
                ctx.startService(
                    Intent(ctx, CallService::class.java).putExtra("title", title).putExtra("share", share),
                )
                return
            }
            started = true
            lastShare = share
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
            runCatching { ctx.stopService(Intent(ctx, CallService::class.java)) }
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
        runCatching {
            if (Build.VERSION.SDK_INT >= 30 && types != 0) {
                startForeground(ONGOING_ID, CallNotify.ongoing(this, title), types)
            } else {
                startForeground(ONGOING_ID, CallNotify.ongoing(this, title))
            }
        }
        fgReady.set(true)
        return START_NOT_STICKY
    }
}
