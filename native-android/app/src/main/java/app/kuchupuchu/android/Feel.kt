package app.kuchupuchu.android

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * Feel: subtle send/receive sounds + haptics. All opt-in per action,
 * quiet volumes so nothing feels harsh.
 */
/** Owner-supplied sound set (round 10, 2026-09-04). */
object SoundPrefs {

    /** index 0 = the owner's default calling ring; 1..7 = his incoming ringtones. */
    val ringRes = intArrayOf(
        R.raw.kp_call_ring,
        R.raw.kp_in_ring_1,
        R.raw.kp_in_ring_2,
        R.raw.kp_in_ring_3,
        R.raw.kp_in_ring_4,
        R.raw.kp_in_ring_5,
        R.raw.kp_in_ring_6,
        R.raw.kp_in_ring_7,
    )

    val ringNames = arrayOf(
        "Default (KuchuPuchu)",
        "Ringtone 1",
        "Ringtone 2",
        "Ringtone 3",
        "Ringtone 4",
        "Ringtone 5",
        "Ringtone 6",
        "Ringtone 7",
    )

    fun ringIndex(ctx: Context): Int =
        ctx.getSharedPreferences("kp", 0).getInt("incoming_ringtone", 0).coerceIn(0, ringRes.size - 1)

    fun setRingIndex(ctx: Context, index: Int) {
        ctx.getSharedPreferences("kp", 0).edit().putInt("incoming_ringtone", index.coerceIn(0, ringRes.size - 1)).apply()
    }

    /** The incoming-ring resource the user picked (default = owner's file). */
    fun incomingRingRes(ctx: Context): Int = ringRes[ringIndex(ctx)]
}

object KpSounds {
    private var pool: SoundPool? = null
    private var tapSendId = 0
    private var sentId = 0
    private var inAppId = 0
    private var receiveId = 0

    @Synchronized
    fun ensure(ctx: Context) {
        if (pool != null) return
        val attrs =
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        pool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attrs).build()
        // Owner round 10: his own sound set — "massage sent" plays when a
        // message of ANY kind actually reaches the server; "in app massage"
        // plays when a message arrives while the user is inside the app but
        // NOT on that chat screen.
        tapSendId = pool!!.load(ctx, R.raw.kp_send, 1)
        sentId = pool!!.load(ctx, R.raw.kp_sent, 1)
        inAppId = pool!!.load(ctx, R.raw.kp_inapp_msg, 1)
        receiveId = pool!!.load(ctx, R.raw.kp_receive, 1)
    }

    /** The tap/send sound (owner round 11: BOTH sounds live — this on the
     *  tap, [sent] when the server actually accepts the message). */
    fun send(ctx: Context) {
        runCatching {
            ensure(ctx)
            pool?.play(tapSendId, 0.6f, 0.6f, 1, 0, 1f)
        }
    }

    /** A message the server accepted — any kind (text, photo, file, voice). */
    fun sent(ctx: Context) {
        runCatching {
            ensure(ctx)
            pool?.play(sentId, 0.7f, 0.7f, 1, 0, 1f)
        }
    }

    /** A message arrived while the user is in the app, off the chat screen. */
    fun inApp(ctx: Context) {
        runCatching {
            ensure(ctx)
            pool?.play(inAppId, 0.7f, 0.7f, 1, 0, 1f)
        }
    }

    fun receive(ctx: Context) {
        runCatching {
            ensure(ctx)
            pool?.play(receiveId, 0.55f, 0.55f, 1, 0, 1f)
        }
    }
}

/** Light tap / confirm haptics via the current Compose view. */
class Haptics(private val view: View?) {
    fun tap() {
        view?.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    fun confirm() {
        view?.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    }

    fun heavy() {
        view?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}
