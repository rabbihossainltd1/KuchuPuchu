package app.kuchupuchu.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Memory TTL + disk snapshot so chats/calls/messages still paint offline.
 * Network failures fall back to [peek] which ignores TTL.
 */
object Cache {
    private val mem = LinkedHashMap<String, Pair<Long, JSONObject>>()
    private var dir: File? = null

    fun init(ctx: Context) {
        val app = ctx.applicationContext
        dir = File(app.filesDir, "kp-cache").also { it.mkdirs() }
        // None of this on the calling thread. Every one of these reads a file, and
        // init runs from Activity.onCreate — i.e. directly in front of the first
        // frame. Parsing every cached conversation there is the other half of
        // "the first scroll after opening the app is laggy": the UI thread was
        // busy deserialising JSON while the list was trying to compose.
        // Everything below is a cache, so a miss only means "fetch again".
        Thread {
            runCatching { loadDisk() }
            // Same idea for pixels: the JSON is worthless on screen if the avatar
            // it names still has to be fetched and decoded.
            runCatching { Bitmaps.init(app) }
            runCatching { ImageRatios.init(app) }
            // Owner round 32 (item 32): link cards already seen.
            runCatching { LinkPreviews.init(app) }
            // The avatar ref → data-URI map is read by every row that composes;
            // warming it here means no composition ever touches the prefs file.
            runCatching { AvatarRefs.warm(app) }
        }
            .apply {
                name = "kp-cache-load"
                isDaemon = true
                priority = Thread.MIN_PRIORITY
                start()
            }
    }

    fun ttl(path: String): Long =
        when {
            path.contains("/calls") -> 0L
            path.contains("/messages") -> 0L
            path.contains("/statuses") -> 2_000L
            // A contact's profile is painted from this snapshot and the profile
            // screen force-refreshes right after, so a long TTL cannot go stale —
            // it only removes the "Loading…" frame on every cold start (bug the
            // owner reported as "the profile never stays saved").
            path.contains("/api/users/") -> 24L * 3600_000L
            path.contains("/conversations") -> 1_500L
            else -> 45_000L
        }

    @Synchronized
    fun peek(path: String): JSONObject? = mem[path]?.second

    @Synchronized
    fun get(path: String): JSONObject? {
        val ttl = ttl(path)
        if (ttl <= 0) return null
        val entry = mem[path] ?: return null
        if (System.currentTimeMillis() - entry.first > ttl) return null
        return entry.second
    }

    @Synchronized
    fun put(path: String, data: JSONObject) {
        mem[path] = System.currentTimeMillis() to data
        persist(path, data)
    }

    @Synchronized
    fun bust(path: String) {
        mem.remove(path)
    }

    @Synchronized
    fun bustAll(contains: String) {
        mem.keys.filter { it.contains(contains) }.forEach { mem.remove(it) }
    }

    @Synchronized
    fun clearDisk() {
        mem.clear()
        dir?.listFiles()?.forEach { it.delete() }
    }

    private fun persist(path: String, data: JSONObject) {
        val folder = dir ?: return
        val name = path.hashCode().toUInt().toString(16)
        runCatching { File(folder, name).writeText(JSONObject().put("p", path).put("d", data).toString()) }
    }

    @Synchronized
    private fun loadDisk() {
        val folder = dir ?: return
        folder.listFiles()?.forEach { f ->
            runCatching {
                val o = JSONObject(f.readText())
                val p = o.optString("p")
                val d = o.optJSONObject("d") ?: return@forEach
                if (p.isNotBlank()) mem[p] = 0L to d
            }
        }
    }
}

/**
 * Outgoing messages waiting for a network.
 *
 * What this replaces: one `flush()` call site (only when the user opened that exact
 * chat), no per-item state, and a `break` that let one permanently-rejected item
 * block everyone behind it. A message queued in a metro tunnel therefore waited for
 * the user to walk out and re-enter the conversation — "amar message ta jayni" —
 * and an over-length body re-failed on every chat open forever.
 *
 * Now, per the architecture doc (§11 offline queue, §40 crash recovery item 4):
 * every item carries `attempts` / `nextAt` / `lastErr`; a failure defers THAT item
 * with backoff instead of freezing the queue; after MAX_AUTO automatic attempts the
 * item waits for an explicit trigger (scheduled recovery) and is never deleted; and
 * a request the server rejected for a reason retrying cannot fix is dropped AND
 * reported through [droppedIds] so the sender's bubble shows "failed" instead of
 * pretending to send forever.
 *
 * Retry triggers: network available, socket open, app start, opening the chat.
 * Server-side idempotency by `clientId` (indexed, and asserted in
 * test/cases/16-media-ratio-payload.mjs) is what makes resending a timed-out item
 * safe — that is the only reason a queue like this cannot duplicate messages.
 */
object Outbox {
    private val items = ArrayList<JSONObject>()
    private var file: File? = null

    @Volatile
    var flushing = false
        private set
    private val flushLock = Any()
    private val dropped = LinkedHashSet<String>()
    /** Full items (body included) the queue gave up on, oldest first. */
    private val droppedBodies = ArrayList<JSONObject>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val kickLock = Any()
    private var kickJob: Job? = null
    private var kickPending = false
    private var kickDueAt = 0L
    private var kickForce = false
    private var netCb: ConnectivityManager.NetworkCallback? = null

    // Owner round 33 (item 3): the queue file is read on a loader thread; a
    // flush or a chat that opens before it lands waits on this (bounded).
    private val loadLatch = CountDownLatch(1)

    /** ClientIds whose immediate POST ([send]) is in the air — [flushNow] leaves them alone. */
    private val inflight: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())

    /** One ordered writer: [save] snapshots the JSON under the lock (microseconds,
     *  so a queue-first send costs Main nothing) and the file write happens here. */
    private val writer =
        Executors.newSingleThreadExecutor { r -> Thread(r, "kp-outbox-write").apply { isDaemon = true } }

    // The retry clock itself lives in OutboxPolicy, so it can be unit-tested
    // (and so `waitMs` cannot be handed an attempt count it would index out of bounds).

    fun init(ctx: Context) {
        // `file` synchronously (a queue() call in the first milliseconds must
        // be able to persist), the READ off the main thread — init runs in
        // Activity.onCreate, and parsing the queue JSON there is exactly the
        // cold-start jank this round removes.
        file = File(ctx.applicationContext.filesDir, "kp-outbox.json")
        Thread {
            try {
                loadQueue()
            } finally {
                loadLatch.countDown()
            }
        }.apply {
            name = "kp-outbox-load"
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    private fun loadQueue() {
        runCatching {
            val raw = file?.takeIf { it.exists() }?.readText() ?: return
                val arr = JSONArray(raw)
                val loaded = ArrayList<JSONObject>()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val body = o.optJSONObject("body") ?: continue
                    if (o.optString("convId").isBlank() || o.optString("clientId").isBlank()) continue
                    // A deadline in the past is "now"; a device restart must never
                    // leave a queued message parked behind an old backoff value.
                    o.put("nextAt", OutboxPolicy.rearmOnLoad(o.optLong("nextAt"), System.currentTimeMillis()))
                    o.put("body", body)
                    loaded.add(o)
                }
                synchronized(this) {
                    val have = items.map { it.optString("clientId") }.toHashSet()
                    items.addAll(0, loaded.filter { it.optString("clientId") !in have })
                    if (have.isNotEmpty()) save()
                }
            }
    }

    /** Blocks (briefly) until the queue file has been read — never call on Main. */
    fun awaitLoaded(ms: Long = 3_000): Boolean =
        runCatching { loadLatch.await(ms, TimeUnit.MILLISECONDS) }.getOrDefault(true)

    /** Called once at startup: re-arm the retry clock for whatever is queued. */
    fun start(ctx: Context) {
        watchNetwork(ctx)
        kick(800, force = true)
    }

    @Synchronized
    fun count(): Int = items.size

    /** ClientIds the server refused permanently — the chat marks those bubbles failed. */
    @Synchronized
    fun droppedIds(): Set<String> = dropped.toSet()

    /** Queues a payload whose immediate attempt already failed elsewhere. */
    fun add(convId: String, clientId: String, body: JSONObject) {
        enqueue(convId, clientId, body)
        // The send that just failed was the "immediate" attempt; the queue's own
        // first retry is a short delay later, then backoff. A one-off network blip
        // therefore heals by itself instead of waiting for the chat to reopen.
        kick(OutboxPolicy.waitMs(1))
    }

    @Synchronized
    private fun enqueue(convId: String, clientId: String, body: JSONObject) {
        items.removeAll { it.optString("clientId") == clientId }
        items.add(
            JSONObject()
                .put("convId", convId)
                .put("clientId", clientId)
                .put("body", JSONObject(body.toString()))
                .put("attempts", 0)
                .put("nextAt", 0L)
                .put("addedAt", System.currentTimeMillis()),
        )
        dropped.remove(clientId)
        save()
    }

    /**
     * Owner round 33 (item 3): queue-FIRST send. The payload is in the queue
     * file BEFORE the request leaves, so backing out of the chat mid-send (the
     * screen's coroutine scope dies with it) or sending offline can no longer
     * lose the message. The immediate POST runs on the queue's own scope; a
     * blip hands it to the retry clock, a permanent refusal drops it (§20 hands
     * the text back to the composer). [onResult] runs on Main with the server
     * row (success) or the refusal (failure) and answers whether it painted the
     * outcome — when nothing did, the open chat is poked to reconcile itself.
     */
    fun send(convId: String, clientId: String, body: JSONObject, onResult: ((Result<JSONObject>) -> Boolean)? = null) {
        inflight.add(clientId)
        enqueue(convId, clientId, body)
        scope.launch {
            val outcome: Result<JSONObject>? =
                try {
                    val row = Api.post("/api/conversations/$convId/messages", body).optJSONObject("message") ?: JSONObject()
                    remove(clientId)
                    Result.success(row)
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val status = (e as? ApiException)?.status ?: 0
                    if (status in 400..499 && status != 408 && status != 429) {
                        refuse(clientId)
                        Result.failure(e)
                    } else {
                        bump(clientId, e.message ?: "network")
                        kick(OutboxPolicy.waitMs(1))
                        null
                    }
                } finally {
                    inflight.remove(clientId)
                }
            if (outcome == null) return@launch
            val painted = withContext(Dispatchers.Main) { onResult?.invoke(outcome) ?: false }
            if (!painted) ScreenStore.pokeInbox()
        }
    }

    /**
     * Owner round 33 (item 3): this chat's queued sends as bubble rows (oldest
     * first, clock tick) — what the screen paints again when the user comes
     * back, so a message typed here never vanishes for leaving early or being
     * offline; it goes when it can.
     */
    @Synchronized
    fun pendingFor(convId: String): List<JSONObject> =
        items
            .filter { it.optString("convId") == convId && it.optJSONObject("body") != null }
            .map { echoOf(it) }

    private fun echoOf(item: JSONObject): JSONObject {
        val body = item.optJSONObject("body") ?: JSONObject()
        val clientId = item.optString("clientId")
        val at = item.optLong("addedAt").takeIf { it > 0 } ?: System.currentTimeMillis()
        val row = JSONObject(body.toString())
        row.put("id", clientId)
        row.put("clientId", clientId)
        row.put("senderId", Store.myId())
        row.put("createdAt", java.time.Instant.ofEpochMilli(at).toString())
        row.put("queued", true)
        row.remove("sendAt")
        val inline = body.optString("imageData")
        if (inline.isNotBlank()) {
            row.remove("imageData")
            row.put("mediaUrl", inline)
            row.put("hasImage", true)
        }
        if (body.optString("fileType").startsWith("image/")) row.put("hasImage", true)
        return row
    }

    @Synchronized
    private fun refuse(clientId: String) {
        items.firstOrNull { it.optString("clientId") == clientId }?.let { markDropped(it) }
        items.removeAll { it.optString("clientId") == clientId }
        save()
    }

    @Synchronized
    private fun deadlines(): List<Long> =
        items.filter { it.optString("clientId") !in inflight }.map { it.optLong("nextAt") }

    /**
     * Owner round 33 (item 3): the retry clock re-arms ITSELF. `bump` used to
     * set a deadline that nothing woke up for — after the one short retry
     * behind `add`, a queued message waited for a network flip, a socket
     * reconnect or the chat being reopened. A success proves the path is open
     * again, so anything still on a backoff from before it goes now.
     */
    private fun rearm(sent: Int, pathDeadUntil: Long) {
        val left = deadlines()
        if (left.isEmpty()) return
        if (sent > 0) {
            // Whatever is still on a backoff (or parked) from before goes now.
            kick(500, force = true)
            return
        }
        val now = System.currentTimeMillis()
        // The item that broke the walk says how long the path is presumed dead —
        // capped at the last backoff step, so a parked item at the front never
        // silences the (skipped, not parked) ones behind it for good.
        val dead = minOf(pathDeadUntil, now + OutboxPolicy.backoffMs.last())
        val wake = OutboxPolicy.nextWakeMs(left.map { maxOf(it, dead) }, now) ?: return
        kick(if (Api.inCooldown()) maxOf(wake, 15_000L) else wake)
    }

    @Synchronized
    fun remove(clientId: String) {
        if (clientId.isBlank()) return
        items.removeAll { it.optString("clientId") == clientId }
        save()
    }

    /** Records one failed attempt; returns the item's new deadline (0 when unknown). */
    @Synchronized
    private fun bump(clientId: String, err: String): Long {
        val item = items.firstOrNull { it.optString("clientId") == clientId } ?: return 0L
        val n = item.optInt("attempts") + 1
        item.put("attempts", n)
        item.put("lastErr", err.take(180))
        item.put("lastErrAt", System.currentTimeMillis())
        val next = System.currentTimeMillis() + OutboxPolicy.waitMs(n)
        item.put("nextAt", next)
        save()
        return next
    }

    @Synchronized
    private fun markDropped(item: JSONObject) {
        val clientId = item.optString("clientId")
        if (clientId.isBlank()) return
        dropped.add(clientId)
        // §20 pairs with this: the text goes back to the composer instead of dying
        // with the queue entry, so "the server refused it" never means "it's gone".
        if (item.optJSONObject("body") != null) {
            droppedBodies.add(JSONObject(item.toString()))
            while (droppedBodies.size > 16) droppedBodies.removeAt(0)
        }
        while (dropped.size > 64) dropped.remove(dropped.iterator().next())
    }

    /** Recovers one refused send's text for [convId] (and consumes it). */
    @Synchronized
    fun takeDroppedBody(convId: String): String? {
        val i = droppedBodies.indexOfFirst { it.optString("convId") == convId }
        if (i < 0) return null
        return droppedBodies
            .removeAt(i)
            .optJSONObject("body")
            ?.optString("body")
            ?.takeIf { it.isNotBlank() }
    }

    @Synchronized
    private fun snapshot(): List<JSONObject> = items.map { JSONObject(it.toString()) }

    /**
     * Debounced, non-suspending entry point for socket / connectivity / startup.
     *
     * Owner round 33 (item 3): a pending kick that is due SOONER and at least as
     * strong (forced) stays — the queue's own re-arm (a 60 s backoff, say) must
     * never displace the 400 ms forced kick the network callback just placed.
     */
    fun kick(delayMs: Long = 250, force: Boolean = false) {
        synchronized(kickLock) {
            val dueAt = System.currentTimeMillis() + delayMs
            if (kickPending && kickDueAt <= dueAt && (kickForce || !force)) return
            // A sooner kick inherits the strength of the one it replaces. Only a
            // kick that has not fired yet is replaced — a walk already in a
            // request finishes its item (the server is idempotent, but a result
            // thrown away is a request repeated).
            val strong = force || (kickPending && kickForce)
            if (kickPending) kickJob?.cancel()
            kickPending = true
            kickDueAt = dueAt
            kickForce = strong
            kickJob = scope.launch {
                delay(delayMs)
                synchronized(kickLock) { kickPending = false }
                runCatching { flushNow(strong) }
            }
        }
    }

    /** A walk is already running (maybe one a newer kick cancelled, still blocked
     *  in a request): the trigger is kept, not dropped — try again shortly. */
    private fun retryLater(force: Boolean) = kick(1_500, force)

    suspend fun flushNow(force: Boolean = false) {
        // Two coroutines in here used to post the same queued message twice.
        synchronized(flushLock) {
            if (flushing) return retryLater(force)
            flushing = true
        }
        var sent = 0
        var refused = 0
        var pathDeadUntil = 0L
        try {
            // The API told us "not yet" (429/503 + Retry-After). Pushing the queue
            // at it anyway spends the cooldown we just agreed to — and the queue is
            // the one place a client can be patient, since nothing is waiting on it.
            if (Api.inCooldown()) return
            // The startup kick can beat the loader thread: wait for the file.
            withContext(Dispatchers.IO) { awaitLoaded() }
            for (item in snapshot()) {
                val convId = item.optString("convId")
                val clientId = item.optString("clientId")
                if (item.optJSONObject("body") == null || convId.isBlank() || clientId.isBlank()) {
                    purgeInvalid(clientId)
                    continue
                }
                if (!OutboxPolicy.isDue(item.optLong("nextAt"), System.currentTimeMillis(), force)) continue
                if (clientId in inflight) continue
                try {
                    val body = item.optJSONObject("body")!!
                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", body) }
                    remove(clientId)
                    sent++
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val status = (e as? ApiException)?.status ?: 0
                    if (status in 400..499 && status != 408 && status != 429) {
                        markDropped(item)
                        remove(clientId)
                        refused++
                        continue
                    }
                    pathDeadUntil = bump(clientId, e.message ?: "network")
                    // Anything behind this would fail down the same dead path: stop
                    // for now and let the backoff / network callback reschedule.
                    break
                }
            }
        } finally {
            flushing = false
            // A walk that was cancelled (the chat's scope went down with the
            // screen mid-flush) must not compute a long wait from a half-done
            // pass — it simply tries again shortly.
            if (kotlin.coroutines.coroutineContext.isActive) rearm(sent, pathDeadUntil) else kick(2_000, force)
        }
        // The open chat reconciles its optimistic bubble against the server row on
        // a poke; without this the user waits for the next poll tick to see a
        // queued message turn into a sent one. A refusal is news too: the text
        // has to come back to the composer (§20) and the bubble turn red now.
        if (sent > 0) ScreenStore.pokeInbox() else if (refused > 0) ScreenStore.pokeInbox()
    }

    @Synchronized
    private fun purgeInvalid(clientId: String) {
        items.removeAll { it.optString("clientId") == clientId || it.optJSONObject("body") == null }
        save()
    }

    private fun watchNetwork(ctx: Context) {
        if (netCb != null) return
        val mgr = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
            as? ConnectivityManager ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // The radio just came back: whatever is queued has waited long
                // enough, and a 5s outage must not turn into "message stuck until
                // the user opens that chat".
                kick(400, force = true)
            }
        }
        runCatching {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            mgr.registerNetworkCallback(req, cb)
            netCb = cb
        }
    }

    /** Called under the queue lock: snapshot now, write in order on the writer thread. */
    private fun save() {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        val f = file ?: return
        val text = arr.toString()
        runCatching {
            writer.execute {
                runCatching {
                    val tmp = File(f.parentFile, "${f.name}.tmp")
                    tmp.writeText(text)
                    if (!tmp.renameTo(f)) {
                        f.writeText(text)
                        tmp.delete()
                    }
                }
            }
        }
    }
}
