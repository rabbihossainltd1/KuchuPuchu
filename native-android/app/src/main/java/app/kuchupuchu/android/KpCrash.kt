package app.kuchupuchu.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.ui.unit.sp

/**
 * Owner round 13d (2026-09-05): the chat screen exits SILENTLY on the owner's
 * device — no crash dialog, no store report. This catches the real stack on
 * device: the previous handler is chained (so system behaviour is unchanged),
 * the report + the last navigation breadcrumbs land in filesDir, and the next
 * launch shows the report with a Copy button — a single screenshot then gives
 * us the exact failing line.
 */
object KpCrash {
    private const val FILE = "crash_last.txt"
    private const val PREF = "crash_capture"
    private val crumbs = ArrayDeque<String>()
    private var enabled = true

    /** Owner round 15: crash capture can be turned off from Settings. */
    fun isEnabled(ctx: Context): Boolean =
        ctx.getSharedPreferences("kp", 0).getBoolean(PREF, true)

    fun setEnabled(ctx: Context, on: Boolean) {
        enabled = on
        ctx.getSharedPreferences("kp", 0).edit().putBoolean(PREF, on).apply()
        if (!on) ctx.filesDir.resolve(FILE).delete()
    }

    fun install(ctx: Context) {
        val appCtx = ctx.applicationContext
        enabled = isEnabled(appCtx)
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            if (!enabled) {
                prev?.uncaughtException(t, e)
                return@setDefaultUncaughtExceptionHandler
            }
            runCatching {
                appCtx.filesDir.resolve(FILE).writeText(
                    buildString {
                        appendLine("time: ${java.time.Instant.now()}")
                        appendLine("thread: ${t.name}")
                        appendLine("route: ${Store.route}")
                        appendLine("crumbs: ${crumbs.joinToString(" | ")}")
                        appendLine(stackOf(e))
                    },
                )
            }
            prev?.uncaughtException(t, e)
        }
    }

    /** Cheap breadcrumb ring — the tail shows the last phase before a kill. */
    fun mark(s: String) {
        runCatching {
            if (crumbs.isEmpty() || crumbs.last() != s) {
                crumbs.addLast("${System.currentTimeMillis() % 100_000}:$s")
                if (crumbs.size > 25) crumbs.removeFirst()
            }
        }
    }

    private fun stackOf(e: Throwable): String =
        buildString {
            appendLine("${e.javaClass.name}: ${e.message}")
            e.stackTrace.take(28).forEach { appendLine("    at $it") }
            e.cause?.let { c ->
                appendLine("cause: ${c.javaClass.name}: ${c.message}")
                c.stackTrace.take(10).forEach { appendLine("    at $it") }
            }
        }

    fun lastReport(ctx: Context): String? =
        runCatching { ctx.filesDir.resolve(FILE).takeIf { it.exists() }?.readText()?.take(1600) }.getOrNull()

    fun clear(ctx: Context) {
        runCatching { ctx.filesDir.resolve(FILE).delete() }
    }
}

/** Shown at the root of KpApp when the PREVIOUS launch crashed. */
@Composable
fun KpCrashReportDialog() {
    val ctx = LocalContext.current
    // Owner round 15: nothing to show when capture is off.
    if (!remember { KpCrash.isEnabled(ctx) }) return
    var report by remember { mutableStateOf<String?>(null) }
    // Owner round 14: read the file OFF the main thread — a synchronous read
    // at every app open was cold-start work.
    androidx.compose.runtime.LaunchedEffect(Unit) {
        report = withContext(Dispatchers.IO) { KpCrash.lastReport(ctx) }
    }
    val rep = report ?: return
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Last crash report", color = Ink) },
        text = {
            Text(
                rep,
                color = Muted,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                modifier =
                    Modifier
                        .heightIn(max = 340.dp)
                        .verticalScroll(rememberScrollState()),
            )
        },
        confirmButton = {
            TextButton(
                onClick = {
                    runCatching {
                        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("kp-crash", rep))
                    }
                    Toast.makeText(ctx, "Copied — paste it to the developer", Toast.LENGTH_SHORT).show()
                },
            ) { Text("Copy report", color = GoldDeep, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) }
        },
        dismissButton = {
            TextButton(onClick = { KpCrash.clear(ctx); report = null }) { Text("Dismiss", color = Muted) }
        },
    )
}
