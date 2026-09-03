package app.kuchupuchu.android

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/**
 * Small global app state: the signed-in user, foreground flag and the
 * current compose route (used by push handling to skip notifications for
 * the screen the user is already looking at).
 */
object Store {
    /** Compose state: true while signed in — KpApp observes, logout flips it. */
    var authed = mutableStateOf(false)

    /**
     * The signed-in user — Compose state, deliberately.
     *
     * A plain `@Volatile var` was the "my new profile picture never reaches the status
     * screen" bug: `SettingsScreen` PATCHes the photo and calls `saveMe`, and every
     * reader of `Store.me` (the status rail's own bubble, the viewer header's fallback)
     * kept showing the OLD data-URI, because nothing was invalidated — the value only
     * appeared to update when some unrelated recomposition happened to sweep past it,
     * which is exactly the "onek onek late" the owner saw. Writing it through
     * `mutableStateOf` means the change is the invalidation.
     *
     * `JSONObject` is treated as an unstable class, so the comparison that matters is
     * reference equality — and `saveMe` always installs the fresh response object.
     */
    var me: JSONObject? by mutableStateOf<JSONObject?>(null)
        private set

    @Volatile
    var foreground: Boolean = false

    @Volatile
    var route: String = ""

    fun init(ctx: Context) {
        val raw = ctx.getSharedPreferences("kp", 0).getString("kp_me", null)
        me = if (raw.isNullOrBlank()) null else runCatching { JSONObject(raw) }.getOrNull()
        Cache.init(ctx)
        Outbox.init(ctx)
        Drafts.init(ctx)
        ScreenStore.hydrate(ctx)
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
        Drafts.clearAll()
        Cache.bustAll("")
        Cache.clearDisk()
        ctx.getSharedPreferences("kp", 0).edit().clear().apply()
        Api.saveToken(ctx, null)
    }
}
