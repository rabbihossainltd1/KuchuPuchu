package app.kuchupuchu.android

import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import org.json.JSONObject

/**
 * Owner round 31 item 21: a PRIVATE profile is not capturable.
 *
 * While a screen that shows such a person is up — their 1:1 chat, a voice or
 * video call with them, their profile picture, a photo / video they sent —
 * the window carries FLAG_SECURE, so screenshots, screen recording and the
 * recents thumbnail come out black on the OTHER phone as well as on theirs.
 * The same flag guards the app for the user's own private profile.
 *
 * Save / Forward on their pictures and videos are hidden by the callers
 * through [privateUser] / [privatePeer]; this file only owns the window flag.
 *
 * Reference counted: several guarded screens can overlap (a photo viewer on
 * top of a private chat, an incoming call over it) and the flag must stay
 * until the LAST of them is gone.
 */
object KpSecure {
    private val holds = HashMap<Window, Int>()

    /** Is this user shape (server `user` object) a private profile? */
    fun privateUser(u: JSONObject?): Boolean = u?.optBoolean("privateProfile") == true

    /** Is the other side of this 1:1 conversation (list row or detail) private? */
    fun privatePeer(conv: JSONObject?): Boolean =
        conv != null && !conv.optBoolean("isGroup") && privateUser(conv.optJSONObject("other"))

    /** The signed-in user switched their own profile to private. */
    fun selfPrivate(): Boolean = Store.me?.optJSONObject("privacy")?.optBoolean("privateProfile") == true

    @Synchronized
    fun acquire(window: Window?) {
        val w = window ?: return
        val n = (holds[w] ?: 0) + 1
        holds[w] = n
        if (n == 1) runCatching { w.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE) }
    }

    @Synchronized
    fun release(window: Window?) {
        val w = window ?: return
        val n = (holds[w] ?: 0) - 1
        if (n <= 0) {
            holds.remove(w)
            runCatching { w.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
        } else {
            holds[w] = n
        }
    }

    /**
     * Holds FLAG_SECURE on the composition's window (the dialog window when
     * called inside a Dialog, else the activity's) while [on] and composed.
     */
    @Composable
    fun Guard(on: Boolean) {
        val view = LocalView.current
        val window = (view.parent as? DialogWindowProvider)?.window ?: MainActivity.current?.window
        DisposableEffect(on, window) {
            if (on) acquire(window)
            onDispose { if (on) release(window) }
        }
    }
}
