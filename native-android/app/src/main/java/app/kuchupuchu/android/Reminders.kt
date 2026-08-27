package app.kuchupuchu.android

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * "Remind me" on the incoming-call screen: schedules a local callback
 * reminder 10 minutes after declining the call.
 */
object Reminders {
    private const val TEN_MINUTES = 10 * 60 * 1000L

    fun schedule(ctx: Context, name: String, userId: String) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent =
            Intent(ctx, ReminderReceiver::class.java)
                .putExtra("name", name)
                .putExtra("userId", userId)
        val pi =
            PendingIntent.getBroadcast(
                ctx,
                ("remind$userId").hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        runCatching {
            am.set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + TEN_MINUTES, pi)
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val name = intent.getStringExtra("name") ?: "someone"
        KpNotify.message(ctx, "⏰ Reminder", "Call $name back on KuchuPuchu.", "")
    }
}
