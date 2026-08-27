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
object KpSounds {
    private var pool: SoundPool? = null
    private var sendId = 0
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
        sendId = pool!!.load(ctx, R.raw.kp_send, 1)
        receiveId = pool!!.load(ctx, R.raw.kp_receive, 1)
    }

    fun send(ctx: Context) {
        runCatching {
            ensure(ctx)
            pool?.play(sendId, 0.6f, 0.6f, 1, 0, 1f)
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
