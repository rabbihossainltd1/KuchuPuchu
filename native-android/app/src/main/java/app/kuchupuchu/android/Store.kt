package app.kuchupuchu.android

import android.content.Context
import androidx.compose.runtime.mutableStateOf
import org.json.JSONObject

/**
 * Small global app state: the signed-in user, foreground flag and the
 * current compose route (used by push handling to skip notifications for
 * the screen the user is already looking at).
 */
object Store {
    /** Compose state: true while signed in — KpApp observes, logout flips it. */
    var authed = mutableStateOf(false)

    @Volatile
    var me: JSONObject? = null

    @Volatile
    var foreground: Boolean = false

    @Volatile
    var route: String = ""

    fun init(ctx: Context) {
        val raw = ctx.getSharedPreferences("kp", 0).getString("kp_me", null)
        me = if (raw.isNullOrBlank()) null else runCatching { JSONObject(raw) }.getOrNull()
    }

    fun saveMe(user: JSONObject?) {
        me = user
        MainActivity.current?.let {
            it.getSharedPreferences("kp", 0).edit()
                .putString("kp_me", user?.toString() ?: "").apply()
        }
    }

    fun myName(): String = me?.optString("displayName")?.takeIf { it.isNotBlank() } ?: "Me"

    fun myId(): String = me?.optString("id") ?: ""

    fun signOut(ctx: Context) {
        me = null
        route = ""
        authed.value = false
        ScreenStore.clearMsgs()
        Cache.bustAll("")
        ctx.getSharedPreferences("kp", 0).edit().clear().apply()
        Api.saveToken(ctx, null)
    }
}
