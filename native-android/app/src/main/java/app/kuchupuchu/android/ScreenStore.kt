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

    /** When set, ChatScreen opens in-chat search for this conversation. */
    var pendingChatSearch: String? = null

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

    private fun persist() {
        val folder = disk ?: return
        runCatching {
            val msgsObj = JSONObject()
            msgs.forEach { (k, v) ->
                val arr = JSONArray()
                v.forEach { arr.put(it) }
                msgsObj.put(k, arr)
            }
            val convArr = JSONArray(); convs.forEach { convArr.put(it) }
            val callArr = JSONArray(); calls.forEach { callArr.put(it) }
            val stArr = JSONArray(); statuses.forEach { stArr.put(it) }
            folder.writeText(
                JSONObject()
                    .put("convs", convArr)
                    .put("calls", callArr)
                    .put("statuses", stArr)
                    .put("msgs", msgsObj)
                    .toString(),
            )
        }
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

    @Synchronized
    fun setConvs(list: List<JSONObject>) {
        val raw = list.joinToString(",") { it.optString("id") + ":" + it.optString("lastMessageAt") + ":" + it.optInt("unread") + ":" + it.optBoolean("muted") }
        if (raw != convsRaw || convs.isEmpty()) {
            convsRaw = raw
            convs.clear()
            convs.addAll(list)
        }
        convsLoaded = true
        persist()
    }

    @Synchronized
    fun setMuted(convId: String, muted: Boolean) {
        val i = convs.indexOfFirst { it.optString("id") == convId }
        if (i >= 0) convs[i] = JSONObject(convs[i].toString()).put("muted", muted)
        persist()
    }

    @Synchronized
    fun msgsOf(convId: String): List<JSONObject> = msgs[convId]?.toList() ?: emptyList()

    @Synchronized
    fun setMsgs(convId: String, list: List<JSONObject>) {
        val old = msgs[convId]
        val changed = old == null || old.size != list.size ||
            (list.isNotEmpty() && old.isNotEmpty() && list.last().optString("id") != old.last().optString("id"))
        val idsChanged = changed
        val tickChanged =
            !idsChanged && old != null && list.zip(old).any { (n, o) ->
                n.optIso("deliveredAt") != o.optIso("deliveredAt")
            }
        if (!idsChanged && !tickChanged) return
        msgs[convId] = list.toMutableList()
        msgsVersion.value++
        persist()
    }

    @Synchronized
    fun clearMsgs() {
        msgs.clear()
        convDetail.clear()
    }

    fun setStatuses(list: List<JSONObject>) {
        val raw = list.joinToString(",") { it.optString("id") + ":" + (it.optJSONObject("user")?.optString("id") ?: "") + ":" + it.arr("statuses").length() }
        if (raw != statusesRaw || statuses.isEmpty()) {
            statusesRaw = raw
            statuses.clear()
            statuses.addAll(list)
        }
        statusesLoaded = true
    }

    fun setCalls(list: List<JSONObject>) {
        val raw = list.joinToString(",") { it.optString("id") + ":" + it.optString("status") }
        if (raw != callsRaw || calls.isEmpty()) {
            callsRaw = raw
            calls.clear()
            calls.addAll(list)
        }
        callsLoaded = true
        persist()
    }
}
