package app.kuchupuchu.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.widget.Toast
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
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
import java.util.Collections
import java.util.IdentityHashMap
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
    private const val MAX_REPORT_CHARS = 24_000
    private const val MAX_STACK_FRAMES = 256
    private const val MAX_CAUSE_DEPTH = 12
    private const val MAX_SUPPRESSED_PER_THROWABLE = 16
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
                        appendLine("app: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                        appendLine("build: ${BuildConfig.BUILD_SHA}")
                        appendLine("compose-bom: ${BuildConfig.COMPOSE_BOM_VERSION}")
                        appendLine("android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                        appendLine("device: ${Build.MANUFACTURER} ${Build.MODEL} (device=${Build.DEVICE})")
                        appendLine("route: ${Store.route}")
                        appendLine("crumbs: ${crumbs.joinToString(" | ")}")
                        appendLine(stackOf(e))
                    }.let(::boundedReport),
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

    private fun stackOf(root: Throwable): String =
        buildString {
            val seen = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())

            fun appendThrowable(error: Throwable, relation: String, depth: Int) {
                if (depth > MAX_CAUSE_DEPTH) {
                    appendLine("$relation: [cause depth limit]")
                    return
                }
                if (!seen.add(error)) {
                    appendLine("$relation: [circular throwable reference]")
                    return
                }
                appendLine("$relation: ${error.javaClass.name}: ${error.message}")
                val frames = error.stackTrace
                frames.take(MAX_STACK_FRAMES).forEach { appendLine("    at $it") }
                if (frames.size > MAX_STACK_FRAMES) {
                    appendLine("    ... ${frames.size - MAX_STACK_FRAMES} additional frames omitted")
                }
                error.suppressed.take(MAX_SUPPRESSED_PER_THROWABLE).forEachIndexed { index, nested ->
                    appendThrowable(nested, "suppressed[$index]", depth + 1)
                }
                if (error.suppressed.size > MAX_SUPPRESSED_PER_THROWABLE) {
                    appendLine("    ... ${error.suppressed.size - MAX_SUPPRESSED_PER_THROWABLE} more suppressed errors")
                }
                error.cause?.let { appendThrowable(it, "caused by", depth + 1) }
            }

            appendThrowable(root, "exception", 0)
        }

    private fun boundedReport(report: String): String =
        if (report.length <= MAX_REPORT_CHARS) report
        else report.take(MAX_REPORT_CHARS - 32) + "\n...[report truncated]..."

    fun lastReport(ctx: Context): String? =
        runCatching { ctx.filesDir.resolve(FILE).takeIf { it.exists() }?.readText() }.getOrNull()

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
    // Owner round 31: a bottom sheet like every popup in the app.
    KpSheet(onDismiss = { KpCrash.clear(ctx); report = null }, title = "Last crash report") {
        androidx.compose.foundation.layout.Column(Modifier.padding(horizontal = 14.dp)) {
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
            androidx.compose.foundation.layout.Spacer(Modifier.height(12.dp))
            GoldBtn("Copy", Modifier.fillMaxWidth()) {
                runCatching {
                    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("kp-crash", rep))
                }
                Toast.makeText(ctx, "Copied", Toast.LENGTH_SHORT).show()
                KpCrash.clear(ctx)
                report = null
            }
            androidx.compose.foundation.layout.Spacer(Modifier.height(6.dp))
        }
    }
}
