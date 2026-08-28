package app.kuchupuchu.android

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * In-memory screen data that survives navigation, so revisiting a screen
 * paints instantly from the last response and refreshes silently in the
 * background — no more loading spinners on every screen switch.
 */
object ScreenStore {
    private var disk: File? = null

    /**
     * Message ids hidden on THIS device only ("Delete for me"). Others still
     * see them; the owner's list just skips them. Persisted locally.
     */
    val hiddenMsgIds = mutableSetOf<String>()
    private var hiddenFile: File? = null

    /**
     * Conversations archived on THIS device (WhatsApp-style swipe right).
     * Archive is purely local: the chat just leaves the main list and shows
     * up under the archive screen. Persisted locally.
     */
    val archivedConvIds = mutableSetOf<String>()
    private var archiveFile: File? = null

    fun archiveConv(id: String) {
        if (id.isNotBlank()) {
            archivedConvIds.add(id)
            saveArchive()
        }
    }

    fun unarchiveConv(id: String) {
        archivedConvIds.remove(id)
        saveArchive()
    }

    fun isArchived(id: String): Boolean = id in archivedConvIds

    private fun saveArchive() {
        runCatching { archiveFile?.writeText(JSONObject().put("ids", JSONArray(archivedConvIds.toList())).toString()) }
    }

    private fun loadArchive() {
        runCatching {
            val raw = archiveFile?.takeIf { it.exists() }?.readText() ?: return@runCatching
            val arr = JSONObject(raw).optJSONArray("ids") ?: return@runCatching
            for (i in 0 until arr.length()) archivedConvIds.add(arr.optString(i))
        }
    }

    /**
     * Status owners hidden from the status feed ("Hide" in the 3-dot menu of
     * the status viewer). Local only. Persisted.
     */
    val hiddenStatusUserIds = mutableSetOf<String>()
    private var statusHiddenFile: File? = null

    fun hideStatusUser(id: String) {
        if (id.isNotBlank()) {
            hiddenStatusUserIds.add(id)
            saveStatusHidden()
        }
    }

    private fun saveStatusHidden() {
        runCatching { statusHiddenFile?.writeText(JSONObject().put("ids", JSONArray(hiddenStatusUserIds.toList())).toString()) }
    }

    private fun loadStatusHidden() {
        runCatching {
            val raw = statusHiddenFile?.takeIf { it.exists() }?.readText() ?: return@runCatching
            val arr = JSONObject(raw).optJSONArray("ids") ?: return@runCatching
            for (i in 0 until arr.length()) hiddenStatusUserIds.add(arr.optString(i))
        }
    }

    /**
     * App-lifetime scope for work that must outlive the screen that started
     * it — e.g. status uploads that keep running after "Sharing status…"
     * pops the composer.
     */
    val appScope = kotlinx.coroutines.CoroutineScope(
        kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO,
    )

    fun hideMessage(id: String) {
        if (id.isNotBlank()) {
            hiddenMsgIds.add(id)
            saveHidden()
        }
    }

    private fun saveHidden() {
        runCatching { hiddenFile?.writeText(JSONObject().put("ids", JSONArray(hiddenMsgIds.toList())).toString()) }
    }

    private fun loadHidden() {
        runCatching {
            val raw = hiddenFile?.takeIf { it.exists() }?.readText() ?: return@runCatching
            val arr = JSONObject(raw).optJSONArray("ids") ?: return@runCatching
            for (i in 0 until arr.length()) hiddenMsgIds.add(arr.optString(i))
        }
    }

    /** When set, ChatScreen opens in-chat search for this conversation. */
    var pendingChatSearch: String? = null

    /** Bumped on FCM so an open chat refreshes immediately. */
    var poke by mutableStateOf(0)
    fun pokeInbox() {
        poke++
    }

    private val lastNotifiedAt = HashMap<String, String>()

    /** Instant local read: zero the unread badge without waiting for the next
     *  list refresh (the next server response carries the same 0 anyway). */
    fun markRead(convId: String) {
        val i = convs.indexOfFirst { it.optString("id") == convId }
        if (i >= 0 && convs[i].optInt("unread", 0) != 0) {
            convs[i] = JSONObject(convs[i].toString()).put("unread", 0)
        }
    }

    /** Instant local badge bump from an FCM push while the chat is not open. */
    fun bumpUnread(convId: String) {
        val i = convs.indexOfFirst { it.optString("id") == convId }
        if (i >= 0) {
            convs[i] = JSONObject(convs[i].toString()).put("unread", convs[i].optInt("unread", 0) + 1)
        }
    }

    fun shouldNotifyChat(convId: String, lastAt: String, unread: Int): Boolean {
        if (unread <= 0 || lastAt.isBlank()) return false
        if (Store.route == "chat/$convId") {
            lastNotifiedAt[convId] = lastAt
            return false
        }
        val prev = lastNotifiedAt[convId]
        lastNotifiedAt[convId] = lastAt
        return prev != null && prev != lastAt
    }

    val convs = mutableStateListOf<JSONObject>()
    var convsRaw by mutableStateOf("")
    var convsLoaded by mutableStateOf(false)

    private val msgs = HashMap<String, MutableList<JSONObject>>()
    val msgsVersion = mutableStateOf(0)

    /** Last-known conversation detail per chat — reopening a chat paints the
     *  name/avatar instantly instead of flashing "…" then loading. */
    private val convDetail = HashMap<String, JSONObject>()
    val convDetailVersion = mutableStateOf(0)

    fun hydrate(ctx: Context) {
        disk = File(ctx.filesDir, "kp-screens.json")
        hiddenFile = File(ctx.filesDir, "kp-hidden.json")
        archiveFile = File(ctx.filesDir, "kp-archive.json")
        statusHiddenFile = File(ctx.filesDir, "kp-statushidden.json")
        loadHidden()
        loadArchive()
        loadStatusHidden()
        val raw = disk?.takeIf { it.exists() }?.readText() ?: return
        runCatching {
            val o = JSONObject(raw)
            o.optJSONArray("convs")?.objects()?.let { setConvs(it) }
            o.optJSONArray("calls")?.objects()?.let { setCalls(it) }
            o.optJSONArray("statuses")?.objects()?.let { setStatuses(it) }
            val msgsObj = o.optJSONObject("msgs") ?: JSONObject()
            msgsObj.keys().forEach { k ->
                msgs[k] = msgsObj.arr(k).objects().toMutableList()
            }
        }
    }

    /**
     * Writes the cache to disk.
     *
     * This used to serialize every message of every chat and write the file
     * inline, on the caller's thread, and `setConvs` called it on every chat
     * list poll - 2.5s - whether or not anything had changed. Both problems
     * are fixed here: the callers only persist on a real change, and the
     * serialization and the write happen on one background thread with at most
     * one write in flight.
     *
     * The snapshot itself is taken under the caller's lock and only copies
     * references, so it stays cheap; nothing mutates a cached JSONObject in
     * place (setMuted replaces the object), so handing the graph to another
     * thread is safe.
     */
    /** Builds the cache snapshot. Callers must hold the ScreenStore lock. */
    private fun snapshotLocked(): JSONObject {
        val msgsObj = JSONObject()
        msgs.forEach { (k, v) ->
            val arr = JSONArray()
            v.toList().forEach { arr.put(it) }
            msgsObj.put(k, arr)
        }
        val convArr = JSONArray(); convs.toList().forEach { convArr.put(it) }
        val callArr = JSONArray(); calls.toList().forEach { callArr.put(it) }
        val stArr = JSONArray(); statuses.toList().forEach { stArr.put(it) }
        return JSONObject()
            .put("convs", convArr)
            .put("calls", callArr)
            .put("statuses", stArr)
            .put("msgs", msgsObj)
    }

    private fun persist() {
        if (disk == null) return
        dirty.set(true)
        if (!writeInFlight.compareAndSet(false, true)) return
        writer.execute { drainWrites() }
    }

    /** Writes the newest snapshot, then any that arrived while it was writing. */
    private fun drainWrites() {
        try {
            while (true) {
                val target: File
                val snapshot: JSONObject
                synchronized(ScreenStore) {
                    val d = disk
                    if (d == null || !dirty.compareAndSet(true, false)) return
                    target = d
                    snapshot = snapshotLocked()
                }
                val text = runCatching { snapshot.toString() }.getOrNull() ?: continue
                runCatching { target.writeText(text) }
            }
        } finally {
            writeInFlight.set(false)
        }
    }

    private val dirty = java.util.concurrent.atomic.AtomicBoolean(false)
    private val writeInFlight = java.util.concurrent.atomic.AtomicBoolean(false)
    private val writer =
        java.util.concurrent.Executors.newSingleThreadExecutor { r ->
            Thread(r, "kp-persist").apply { isDaemon = true }
        }

    @Synchronized
    fun setConvDetail(convId: String, conv: JSONObject?) {
        if (conv == null) return
        convDetail[convId] = conv
        convDetailVersion.value++
    }

    @Synchronized
    fun convDetailOf(convId: String): JSONObject? = convDetail[convId]

    val statuses = mutableStateListOf<JSONObject>()
    var statusesRaw by mutableStateOf("")
    var statusesLoaded by mutableStateOf(false)

    val calls = mutableStateListOf<JSONObject>()
    var callsRaw by mutableStateOf("")
    var callsLoaded by mutableStateOf(false)

    /**
     * Everything the chat list row renders. The old fingerprint was only
     * id/lastMessageAt/unread/muted, so a contact renaming themselves, changing
     * their avatar, or coming online never reached the list.
     */
    private fun convSignature(list: List<JSONObject>) = list.joinToString(",") { c ->
        val other = c.optJSONObject("other")
        buildString {
            append(c.optString("id")).append('|')
            append(c.optString("title")).append('|')
            append(c.optString("lastMessage")).append('|')
            append(c.optString("lastMessageAt")).append('|')
            append(c.optInt("unread")).append('|')
            append(c.optBoolean("muted")).append('|')
            append(other?.optString("displayName")).append('|')
            append(other?.optString("avatarUrl")).append('|')
            append(other?.optBoolean("online"))
        }
    }

    @Synchronized
    fun setConvs(list: List<JSONObject>) {
        val raw = convSignature(list)
        val changed = raw != convsRaw || convs.isEmpty()
        if (changed) {
            convsRaw = raw
            convs.clear()
            convs.addAll(list)
        }
        convsLoaded = true
        // The chat list polls every 2.5s. Rewriting the whole cache on every
        // one of those polls, when almost none of them change anything, was
        // most of the cost; only a real change needs to reach disk.
        if (changed) persist()
    }

    @Synchronized
    fun setMuted(convId: String, muted: Boolean) {
        val i = convs.indexOfFirst { it.optString("id") == convId }
        if (i >= 0) convs[i] = JSONObject(convs[i].toString()).put("muted", muted)
        persist()
    }

    @Synchronized
    fun msgsOf(convId: String): List<JSONObject> = msgs[convId]?.toList() ?: emptyList()

    /**
     * Full per-message signature. The old check only compared the list length
     * and the last id, so a server-side delete (kind flips to DELETED, body goes
     * null) or a read-receipt change produced an identical fingerprint and the
     * screen kept showing the stale bubble until the app was restarted.
     */
    private fun msgSignature(list: List<JSONObject>) = list.joinToString("|") { m ->
        buildString {
            append(m.optString("id")).append(':')
            append(m.optString("kind")).append(':')
            append(m.optString("body")).append(':')
            append(m.optIso("deliveredAt")).append(':')
            append(m.optString("mediaUrl")).append(':')
            append(m.optString("fileKey"))
        }
    }

    @Synchronized
    fun setMsgs(convId: String, list: List<JSONObject>) {
        if (msgs[convId]?.let { msgSignature(it) } == msgSignature(list)) return
        msgs[convId] = list.toMutableList()
        msgsVersion.value++
        persist()
    }

    @Synchronized
    fun clearMsgs() {
        msgs.clear()
        convDetail.clear()
    }

    @Synchronized
    fun setStatuses(list: List<JSONObject>) {
        val raw = list.joinToString(",") { it.optString("id") + ":" + (it.optJSONObject("user")?.optString("id") ?: "") + ":" + it.arr("statuses").length() }
        val changed = raw != statusesRaw || statuses.isEmpty()
        if (changed) {
            statusesRaw = raw
            statuses.clear()
            statuses.addAll(list)
        }
        statusesLoaded = true
        // Every other setter persisted; this one did not, so the statuses tab
        // was the one screen that always came back empty after a restart even
        // though hydrate() reads a "statuses" key.
        if (changed) persist()
    }

    fun setCalls(list: List<JSONObject>) {
        val raw = list.joinToString(",") { it.optString("id") + ":" + it.optString("status") }
        val changed = raw != callsRaw || calls.isEmpty()
        if (changed) {
            callsRaw = raw
            calls.clear()
            calls.addAll(list)
        }
        callsLoaded = true
        if (changed) persist()
    }
}
