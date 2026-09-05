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

    /** index 0 = the app's ORIGINAL incoming tone; 1..7 = his ringtone pack. */
    val ringRes = intArrayOf(
        R.raw.kp_ring3,
        R.raw.kp_in_ring_1,
        R.raw.kp_in_ring_2,
        R.raw.kp_in_ring_3,
        R.raw.kp_in_ring_4,
        R.raw.kp_in_ring_5,
        R.raw.kp_in_ring_6,
        R.raw.kp_in_ring_7,
        R.raw.kp_in_ring_8,
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
        "Ringtone 8",
    )

    /** Owner round 21: the NOTIFICATION ringtone pack (message alerts). */
    val notifRes = intArrayOf(
        R.raw.kp_notif_01, R.raw.kp_notif_02, R.raw.kp_notif_03,
        R.raw.kp_notif_04, R.raw.kp_notif_05, R.raw.kp_notif_06,
        R.raw.kp_notif_07, R.raw.kp_notif_08, R.raw.kp_notif_09,
        R.raw.kp_notif_10, R.raw.kp_notif_11, R.raw.kp_notif_12,
        R.raw.kp_notif_13, R.raw.kp_notif_14, R.raw.kp_notif_15,
    )

    val notifNames = (1..15).map { "Notification $it" }

    fun ringIndex(ctx: Context): Int =
        ctx.getSharedPreferences("kp", 0).getInt("incoming_ringtone", 0).coerceIn(0, ringRes.size - 1)

    fun setRingIndex(ctx: Context, index: Int) {
        ctx.getSharedPreferences("kp", 0)
            .edit()
            .putInt("incoming_ringtone", index.coerceIn(0, ringRes.size - 1))
            .remove("incoming_ring_custom")
            .apply()
    }

    /** The user's own audio file set as the incoming ring (round 11). */
    fun customRingPath(ctx: Context): String? =
        ctx.getSharedPreferences("kp", 0)
            .getString("incoming_ring_custom", null)
            ?.takeIf { java.io.File(it).exists() }

    fun setCustomRing(ctx: Context, path: String) {
        ctx.getSharedPreferences("kp", 0)
            .edit()
            .putString("incoming_ring_custom", path)
            .apply()
    }

    /** The incoming-ring resource the user picked (default = the original tone). */
    fun incomingRingRes(ctx: Context): Int = ringRes[ringIndex(ctx)]

    /** Owner round 21: the NOTIFICATION tone (message alerts). */
    fun notifIndex(ctx: Context): Int =
        ctx.getSharedPreferences("kp", 0).getInt("notif_ringtone", 0).coerceIn(0, notifRes.size - 1)

    fun setNotifIndex(ctx: Context, index: Int) {
        ctx.getSharedPreferences("kp", 0)
            .edit()
            .putInt("notif_ringtone", index.coerceIn(0, notifRes.size - 1))
            .apply()
        // The messages channel owns its sound on API 26+ — rebuild it so the
        // new tone actually rings (KpNotify recreates on every post).
        KpNotify.rebuildMessageChannel(ctx)
    }

    fun notificationRingRes(ctx: Context): Int = notifRes[notifIndex(ctx)]

    fun notifLabel(ctx: Context): String = notifNames[notifIndex(ctx)]

    /** Row label: the custom file's name when one is set, else the built-in's. */
    fun currentLabel(ctx: Context): String {
        val custom = customRingPath(ctx)
        return if (custom != null) "Custom · ${java.io.File(custom).nameWithoutExtension}" else ringNames[ringIndex(ctx)]
    }
}

object KpSounds {
    private var pool: SoundPool? = null
    private var tapSendId = 0
    private var sentId = 0
    private var inAppId = 0
    private var receiveId = 0

    // Owner round 21: his own event set (photo/voice send, cancel, reply
    // swipe, reaction, status share, screen share, line busy).
    private var photoSendId = 0
    private var voiceSendId = 0
    private var voiceCancelId = 0
    private var replySwipeId = 0
    private var reactionId = 0
    private var statusShareId = 0
    private var screenShareId = 0
    private var lineBusyId = 0

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
        photoSendId = pool!!.load(ctx, R.raw.kp_photo_send, 1)
        voiceSendId = pool!!.load(ctx, R.raw.kp_voice_send, 1)
        voiceCancelId = pool!!.load(ctx, R.raw.kp_voice_cancel, 1)
        replySwipeId = pool!!.load(ctx, R.raw.kp_reply_swipe, 1)
        reactionId = pool!!.load(ctx, R.raw.kp_reaction, 1)
        statusShareId = pool!!.load(ctx, R.raw.kp_status_share, 1)
        screenShareId = pool!!.load(ctx, R.raw.kp_screen_share, 1)
        lineBusyId = pool!!.load(ctx, R.raw.kp_line_busy, 1)
    }

    /** Owner round 21: per-event sounds from his pack. */
    fun photoSend(ctx: Context) = play(ctx, photoSendId, 0.7f)
    fun voiceSend(ctx: Context) = play(ctx, voiceSendId, 0.7f)
    fun voiceCancel(ctx: Context) = play(ctx, voiceCancelId, 0.7f)
    fun replySwipe(ctx: Context) = play(ctx, replySwipeId, 0.6f)
    fun reaction(ctx: Context) = play(ctx, reactionId, 0.7f)
    fun statusShare(ctx: Context) = play(ctx, statusShareId, 0.7f)
    fun screenShare(ctx: Context) = play(ctx, screenShareId, 0.7f)
    fun lineBusy(ctx: Context) = play(ctx, lineBusyId, 0.9f)

    private fun play(ctx: Context, id: Int, vol: Float) {
        runCatching {
            ensure(ctx)
            pool?.play(id, vol, vol, 1, 0, 1f)
        }
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
