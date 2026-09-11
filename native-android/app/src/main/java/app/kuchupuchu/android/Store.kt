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
        PhoneBook.init(ctx)
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

    /**
     * Local sign-out. `revokedRemotely` = the server already killed the session
     * (401): there is no bearer left to send, but the push handle must still be
     * released — by token, which the worker accepts without a session.
     *
     * Owner round 28 ("logout korleo notification ashe"): every path that ends a
     * session runs the SAME teardown — push row + FCM token, live sockets, the
     * cached screens of the old account, and its shown notifications.
     */
    fun signOut(ctx: Context, revokedRemotely: Boolean = false) {
        if (revokedRemotely && me == null && Api.token.isNullOrBlank()) return
        val app = ctx.applicationContext
        val pushToken = KpPush.registeredToken(app)
        if (revokedRemotely && !pushToken.isNullOrBlank()) {
            // Session gone → an authenticated call is impossible; the token
            // alone identifies the row. Fire-and-forget off the main thread.
            Thread {
                runCatching {
                    Api.request("/api/auth/logout", "POST", JSONObject().put("pushToken", pushToken))
                }
            }.start()
        }
        me = null
        route = ""
        authed.value = false
        KpSocket.closeAll()
        KpPush.unregister()
        runCatching { KpNotify.cancelAll(app) }
        ScreenStore.clearMsgs()
        ScreenStore.clearAccount()
        PhoneBook.clear()
        Drafts.clearAll()
        Cache.bustAll("")
        Cache.clearDisk()
        ctx.getSharedPreferences("kp", 0).edit().clear().apply()
        Api.saveToken(ctx, null)
    }
}

/**
 * Owner round 33 (item 26): forces class-init of every singleton that holds
 * `mutableStateOf` / `mutableStateListOf` / `mutableStateMapOf` state, so
 * their state records are created on the main thread from the global snapshot.
 *
 * Reading each object's cheapest member is enough — Kotlin initialises an
 * `object` (and a `companion object`) on first access, and it is that first
 * access that decides which snapshot the records belong to. Called once from
 * MainActivity.onCreate before any background thread starts; every member read
 * here is a plain field or trivial getter, never I/O.
 */
object SnapshotSingletons {
    @Volatile
    private var warmed = false

    fun warm() {
        if (warmed) return
        warmed = true
        runCatching {
            KpUpdate.checking
            ScreenStore.poke
            ScreenStore.callsVersion
            VoiceNote.livePeaks
            LinkPreviews.size()
            PhoneBook.syncing.value
            UploadProgress.fracs.size
            CallEngine.instance
        }
    }
}
