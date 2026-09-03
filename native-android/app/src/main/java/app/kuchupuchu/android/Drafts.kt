package app.kuchupuchu.android

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

/**
 * Unsent composer text, per conversation (§20 draft auto-save).
 *
 * Written on a debounce instead of per keystroke, and flushed to `filesDir`, so the
 * OS reclaiming the process while the user is half-way through a sentence in another
 * app costs them nothing: reopening the chat brings the text back.
 *
 * Two deliberate limits:
 *  - the draft is cleared when the text stops being the composer's problem — the
 *    server accepted the message OR the outbox file took it over (and if the queue
 *    later refuses it permanently, Outbox hands the text straight back here, so
 *    nothing is ever simply lost);
 *  - drafts never reach the network. They are device-local on purpose: picking a
 *    phone up again should not push a half-typed sentence onto a tablet (§17 keeps
 *    draft *server* state as optional for exactly that reason).
 */
object Drafts {
    private const val DEBOUNCE_MS = 600L

    /** Mirrors MESSAGE_MAX_LENGTH in src/shared/constants.ts — longer never sends. */
    private const val MAX_CHARS = 4000

    private val map = LinkedHashMap<String, String>()
    private var file: File? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var writeJob: Job? = null

    fun init(ctx: Context) {
        file = File(ctx.applicationContext.filesDir, "kp-drafts.json")
        // Same cold-start rule as the outbox: file now, parse off the main
        // thread (init runs in Activity.onCreate, in front of the first frame).
        Thread {
            runCatching {
                val f = file ?: return@Thread
                if (!f.exists()) return@Thread
                val o = JSONObject(f.readText())
                val keys = o.keys()
                synchronized(this) {
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = o.optString(k)
                        if (k.isNotBlank() && v.isNotBlank()) map[k] = v
                    }
                }
            }
        }.apply {
            name = "kp-drafts-load"
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    @Synchronized
    fun of(convId: String): String = map[convId].orEmpty()

    fun set(convId: String, text: String) {
        val clean = text.take(MAX_CHARS).trim()
        val changed =
            synchronized(this) {
                if (map[convId].orEmpty() == clean) false
                else {
                    if (clean.isEmpty()) map.remove(convId) else map[convId] = clean
                    true
                }
            }
        if (changed) schedule()
    }

    fun clear(convId: String) = set(convId, "")

    /** Signing out must not leave somebody's unsent sentences on the disk. */
    fun clearAll() {
        synchronized(this) { map.clear() }
        writeJob?.cancel()
        val f = file
        scope.launch { runCatching { f?.delete() } }
    }

    private fun schedule() {
        writeJob?.cancel()
        writeJob = scope.launch {
            delay(DEBOUNCE_MS)
            persist()
        }
    }

    @Synchronized
    private fun snapshot(): String {
        val o = JSONObject()
        map.forEach { (k, v) -> o.put(k, v) }
        return o.toString()
    }

    private fun persist() {
        val f = file ?: return
        val payload = snapshot()
        runCatching {
            val tmp = File(f.parentFile, "${f.name}.tmp")
            tmp.writeText(payload)
            if (!tmp.renameTo(f)) {
                f.writeText(payload)
                tmp.delete()
            }
        }
    }
}
