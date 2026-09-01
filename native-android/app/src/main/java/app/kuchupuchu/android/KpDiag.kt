package app.kuchupuchu.android

import android.content.Context

/**
 * On-device log of what the push path actually saw.
 *
 * Why this exists: three rounds of "background e message ashe na" were argued
 * from server logs, and the server can never settle it — FCM answers 200 whether
 * or not the phone ever handed the message to us. The worker-side breadcrumb
 * (POST /api/debug/clientlog) is authenticated, so a push received by a process
 * with no live session writes nothing, and an empty table proves nothing.
 *
 * This is the local witness: every push that reaches onMessageReceived appends a
 * line here, whatever happens next (mute, in-chat suppression, error). Settings
 * shows it, so one test run answers the only question that matters:
 *   log HAS the minute the message was sent  -> the app got it; the bug is ours
 *   log does NOT                            -> FCM/OEM never delivered it; no app
 *                                              code can fix that (autostart /
 *                                              ConnectionService are the levers)
 */
object KpDiag {
    private const val PREFS = "kp_diag"
    private const val KEY = "push_log"
    private const val MAX = 8

    fun log(ctx: Context, line: String) {
        runCatching {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val stamp = java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.US).format(java.util.Date())
            val prev = p.getString(KEY, "") ?: ""
            val next = ("$stamp $line\n" + prev).lineSequence().filter { it.isNotBlank() }.take(MAX).joinToString("\n")
            p.edit().putString(KEY, next).apply()
        }
    }

    fun recent(ctx: Context): List<String> =
        runCatching {
            (ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: "")
                .lines()
                .filter { it.isNotBlank() }
        }.getOrDefault(emptyList())

    fun clear(ctx: Context) {
        runCatching { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply() }
    }
}
