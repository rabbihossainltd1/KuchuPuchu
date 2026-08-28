package app.kuchupuchu.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import org.json.JSONObject

/**
 * In-memory screen data that survives navigation, so revisiting a screen
 * paints instantly from the last response and refreshes silently in the
 * background — no more loading spinners on every screen switch.
 */
object ScreenStore {
    val convs = mutableStateListOf<JSONObject>()
    var convsRaw by mutableStateOf("")
    var convsLoaded by mutableStateOf(false)

    private val msgs = HashMap<String, MutableList<JSONObject>>()
    val msgsVersion = mutableStateOf(0)

    /** Last-known conversation detail per chat — reopening a chat paints the
     *  name/avatar instantly instead of flashing "…" then loading. */
    private val convDetail = HashMap<String, JSONObject>()
    val convDetailVersion = mutableStateOf(0)

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
    }

    @Synchronized
    fun msgsOf(convId: String): List<JSONObject> = msgs[convId]?.toList() ?: emptyList()

    @Synchronized
    fun setMsgs(convId: String, list: List<JSONObject>) {
        val old = msgs[convId]
        val changed = old == null || old.size != list.size ||
            (list.isNotEmpty() && old.isNotEmpty() && list.last().optString("id") != old.last().optString("id"))
        if (!changed) return
        msgs[convId] = list.toMutableList()
        msgsVersion.value++
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
    }
}
