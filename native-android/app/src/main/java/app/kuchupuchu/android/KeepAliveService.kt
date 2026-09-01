package app.kuchupuchu.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the process at foreground priority after a real-time event arrives, so
 * the next message/call is not lost to Doze freezing or an aggressive launcher
 * trimming the app.
 *
 * Why this exists: the app deliberately has no always-on service, and pushes
 * are data-only (so our own rich card, with Reply / Accept / Decline, is the
 * thing the user sees). A data-only push needs the process to run
 * onMessageReceived — on a frozen or trimmed process that never happens, which
 * is exactly the "app close kora thakle notification ashe na, call o na"
 * report. A missed-call notification does carry a payload and still shows, but
 * the incoming ring cannot: a system-drawn call card cannot be retracted after
 * the caller cancels, so it would leave a phantom "Incoming call" behind.
 *
 * So instead of faking delivery with payloads, the first push we DO receive
 * promotes the process. Android 12+ forbids starting a foreground service from
 * the background, but explicitly exempts "the app received a high-priority FCM
 * message" — every push here is sent with android.priority=HIGH, so this call
 * is legal at exactly the moment it is needed. The service stops as soon as the
 * user opens the app (MainActivity), so the persistent notification is not
 * there while they are actually using KuchuPuchu.
 */
class KeepAliveService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startTheFgs()
        // If the launcher kills us, recreate the subscription.
        return START_STICKY
    }

    private fun startTheFgs() {
        val ctx = applicationContext
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            runCatching {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "Message sync", NotificationManager.IMPORTANCE_MIN)
                        .apply {
                            description = "Keeps messages and calls arriving while KuchuPuchu is in the background."
                            setShowBadge(false)
                        },
                )
            }
        }
        val n: Notification =
            NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.mipmap.ic_stat_kp)
                .setContentTitle("KuchuPuchu is listening")
                .setContentText("Messages and calls arrive even with the app in the background.")
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(
                    PendingIntent.getActivity(
                        ctx,
                        77001,
                        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                .build()
        // The type is what Android 14 requires for "keeps a chat connection
        // alive"; the matching permission is declared in the manifest.
        runCatching {
            ServiceCompat.startForeground(
                this,
                ID,
                n,
                // Real framework constant (API 34) rather than a hand-typed bit
                // value: passing a type that does not match the manifest is what
                // makes startForeground throw on 14+.
                if (android.os.Build.VERSION.SDK_INT >= 34)
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
                else
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE,
            )
        }.onFailure {
            // Some OEM ROMs reject the type outright: never let the promotion
            // crash the app just because we tried to stay alive.
            runCatching { stopSelf() }
        }
    }

    companion object {
        private const val CHANNEL = "kp_presence_v1"
        private const val ID = 770_001

        /**
         * Called when the app goes to the background, while a session is live.
         * Starting here (instead of only on the first push) is what closes the
         * "app was never opened after the last message" hole: the process is
         * already at foreground priority BEFORE the push has to be delivered, so
         * the first background message is not the one that has to wake us up.
         * Legal because an activity in the foreground is an allowed trigger.
         */
        fun ensureRunning(ctx: Context) {
            runCatching {
                ContextCompat.startForegroundService(ctx, Intent(ctx, KeepAliveService::class.java))
            }
        }

        /** Called from the push path — legal only because the trigger is a
         *  high-priority FCM message (see the class comment). */
        fun promote(ctx: Context) {
            runCatching {
                ContextCompat.startForegroundService(
                    ctx,
                    Intent(ctx, KeepAliveService::class.java),
                )
            }
        }

        /** The user opened the app: normal delivery resumes, so let go. */
        fun release(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, KeepAliveService::class.java)) }
        }
    }
}
