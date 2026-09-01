package app.kuchupuchu.android

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/**
 * Which output call audio goes to.
 *
 * The product rules this implements (owner's spec, voice + video calls alike):
 *  1. If any personal output is connected — Bluetooth headset/earbuds, wired
 *     headset OR headphones, USB audio — call audio goes to that device ONLY,
 *     never also to the loudspeaker.
 *  2. The in-call audio button steps to the next output that physically exists,
 *     and its icon follows the route (Bluetooth glyph on Bluetooth, headset
 *     glyph on wired, speaker glyph on the loudspeaker, handset on the earpiece).
 *  3. Connecting another output during a call takes over instantly; unplugging
 *     hands back to the next best one.
 */
enum class AudioRoute { BLUETOOTH, WIRED, EARPIECE, SPEAKER }

/**
 * Owns audio routing while a call is up.
 *
 * Framework routing is spread over three API generations — `isSpeakerphoneOn` +
 * `startBluetoothSco` everywhere, `setCommunicationDevice` from 31 — and the
 * Bluetooth half is gated behind a runtime permission on 31+, so it lives in one
 * place instead of being re-derived at every call site. Only framework APIs are
 * used: WebRTC's JavaAudioDeviceModule just sets the mode and starts its threads,
 * and the engine re-asserts the route whenever those restart.
 */
object AudioRouter {

    /** Bluetooth outputs that can carry a call, most preferred first. */
    private val BT_TYPES: IntArray by lazy {
        val t = ArrayList<Int>()
        t.add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
        // A2DP is what a paired pair of buds looks like while it is doing media.
        // Matching only TYPE_BLUETOOTH_SCO (the first cut here) made a connected
        // headset invisible: the call stayed on the phone while tone went to the
        // buds — which is exactly the "it plays on the headset AND the speaker"
        // report. BLE_* are the modern earbud transports.
        t.add(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
        if (Build.VERSION.SDK_INT >= 33) {
            t.add(AudioDeviceInfo.TYPE_BLE_HEADSET)
            t.add(AudioDeviceInfo.TYPE_BLE_SPEAKER)
        }
        t.toIntArray()
    }

    /**
     * Wired / USB outputs. TYPE_WIRED_HEADPHONES belongs here too: a headphone
     * with no mic is still an output the user expects to be used.
     */
    private val WIRED_TYPES =
        intArrayOf(
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_DEVICE,
        )

    /**
     * Bluetooth devices that can actually CARRY a call (mic + voice channel), as
     * opposed to A2DP, which is media-only. Used by the watchdog below: if SCO
     * never came up and the framework refused the device, the call is silently
     * still on the phone, and the UI must stop claiming otherwise.
     */
    private val CALL_BT_TYPES: IntArray by lazy {
        val t = ArrayList<Int>()
        t.add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
        if (Build.VERSION.SDK_INT >= 31) t.add(AudioDeviceInfo.TYPE_BLE_EARPHONE)
        if (Build.VERSION.SDK_INT >= 33) {
            t.add(AudioDeviceInfo.TYPE_BLE_HEADSET)
            t.add(AudioDeviceInfo.TYPE_BLE_SPEAKER)
        }
        t.toIntArray()
    }

    /** A device that must exist before it can be routed to (vs built-in hardware). */
    private fun needsExternalDevice(route: AudioRoute) =
        route == AudioRoute.BLUETOOTH || route == AudioRoute.WIRED

    private var app: Context? = null
    private var inCall = false
    private var videoCall = false
    private var wanted = AudioRoute.EARPIECE
    private var scoUp = false
    private var btCommitted = false
    private var deviceCb: AudioDeviceCallback? = null
    private var scoRx: BroadcastReceiver? = null
    private val main = Handler(Looper.getMainLooper())
    private var btWatchdog: Runnable? = null

    /** Fired when routing changes underneath the UI (hot-plug, SCO up/down). */
    var onRouteChanged: ((AudioRoute) -> Unit)? = null

    /** One-line explanation for the user when a device turns out to be unusable. */
    var onNotice: ((String) -> Unit)? = null

    private fun manager(ctx: Context): AudioManager = ctx.getSystemService(AudioManager::class.java)

    // ── permission ────────────────────────────────────────────────────────────

    /** API 31+ puts every Bluetooth audio call behind a runtime permission. */
    fun needsBluetoothPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= 31 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) !=
            PackageManager.PERMISSION_GRANTED

    // ── discovery ─────────────────────────────────────────────────────────────

    private fun outputs(ctx: Context): List<AudioDeviceInfo> =
        runCatching { amDevices(ctx) }.getOrDefault(emptyList())

    private fun amDevices(ctx: Context): List<AudioDeviceInfo> =
        manager(ctx).getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()

    fun deviceFor(ctx: Context, route: AudioRoute): AudioDeviceInfo? {
        val outs = outputs(ctx)
        return when (route) {
            AudioRoute.BLUETOOTH -> BT_TYPES.firstNotNullOfOrNull { t -> outs.firstOrNull { it.type == t } }
            AudioRoute.WIRED -> WIRED_TYPES.firstNotNullOfOrNull { t -> outs.firstOrNull { it.type == t } }
            AudioRoute.EARPIECE -> outs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
            AudioRoute.SPEAKER -> outs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        }
    }

    /** Outputs usable for a call right now, best first. */
    fun available(ctx: Context): List<AudioRoute> {
        // From 31 the framework's own "usable for communication" list is
        // authoritative; union it with the output list so a headset connected for
        // media (A2DP) but not yet for a call is still offered.
        val routable =
            if (Build.VERSION.SDK_INT >= 31) {
                runCatching { manager(ctx).availableCommunicationDevices.toList() }.getOrDefault(emptyList())
            } else {
                emptyList()
            }
        val all = (outputs(ctx) + routable).distinctBy { it.type }
        val out = ArrayList<AudioRoute>(4)
        if (all.any { it.type in BT_TYPES }) out.add(AudioRoute.BLUETOOTH)
        if (all.any { it.type in WIRED_TYPES }) out.add(AudioRoute.WIRED)
        if (all.any { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }) out.add(AudioRoute.EARPIECE)
        // The loudspeaker is always a choice, even on a HAL that omits it.
        out.add(AudioRoute.SPEAKER)
        return out
    }

    /**
     * Where a fresh call starts: a connected personal output wins — for video
     * calls too, since "the buds are in" is a deliberate choice. With nothing
     * connected, video opens on the speaker and voice on the earpiece.
     */
    fun defaultRoute(ctx: Context, kind: String?): AudioRoute {
        val avail = available(ctx)
        if (AudioRoute.BLUETOOTH in avail) return AudioRoute.BLUETOOTH
        if (AudioRoute.WIRED in avail) return AudioRoute.WIRED
        return if (kind == "VIDEO") AudioRoute.SPEAKER else AudioRoute.EARPIECE
    }

    /**
     * True when [route] can only work after the user grants BLUETOOTH_CONNECT.
     * The UI asks in that case instead of quietly leaving the call on the phone.
     */
    fun blockedByPermission(ctx: Context, route: AudioRoute): Boolean =
        route == AudioRoute.BLUETOOTH && needsBluetoothPermission(ctx)

    /** Button label: the device's own name for a headset, the route name otherwise. */
    fun label(ctx: Context, route: AudioRoute): String {
        if (needsExternalDevice(route)) {
            val name = runCatching { deviceFor(ctx, route)?.productName?.toString()?.trim() }.getOrNull()
            if (!name.isNullOrEmpty() && name.length in 3..18) return name
        }
        return when (route) {
            AudioRoute.BLUETOOTH -> "Bluetooth"
            AudioRoute.WIRED -> "Headset"
            AudioRoute.EARPIECE -> "Earpiece"
            AudioRoute.SPEAKER -> "Speaker"
        }
    }

    /** The route the button should select next, skipping unusable ones. */
    fun next(ctx: Context, from: AudioRoute): AudioRoute {
        val list = available(ctx)
        if (list.size <= 1) return from
        val start = list.indexOf(from).coerceAtLeast(0)
        for (step in 1..list.size) {
            val cand = list[(start + step) % list.size]
            if (cand != from) return cand
        }
        return from
    }

    /**
     * The device call TONES (ring, ringback) should be pinned to. The alarm
     * stream these use ignores communication routing, so without this the phone
     * rang out loud next to a pair of buds that was already carrying the call —
     * the "audio goes to both sources" report.
     *
     * During a call this follows the route the user chose; while an incoming call
     * is only ringing (no route decided yet) it goes to whatever is connected,
     * over A2DP — the same thing a real dialer does, and SCO is opened later by
     * [begin] when the call is actually answered.
     *
     * Null means "let the framework decide", i.e. phone hardware.
     */
    fun tonePlaybackDevice(ctx: Context): AudioDeviceInfo? {
        if (inCall) return if (needsExternalDevice(wanted)) deviceFor(ctx, wanted) else null
        if (AudioRoute.BLUETOOTH in available(ctx) && !needsBluetoothPermission(ctx)) {
            return deviceFor(ctx, AudioRoute.BLUETOOTH)
        }
        if (AudioRoute.WIRED in available(ctx)) return deviceFor(ctx, AudioRoute.WIRED)
        return null
    }

    /** The route in effect, for the UI. */
    fun current(): AudioRoute = wanted

    // ── hardware ─────────────────────────────────────────────────────────────

    /**
     * Program the stack for [route] and return the route actually in effect —
     * it can differ when the device vanished or Bluetooth still lacks its
     * permission, and the caller must show what really happened, not what it asked for.
     */
    @Synchronized
    fun apply(ctx: Context, route: AudioRoute): AudioRoute {
        app = ctx.applicationContext
        val a = manager(ctx)
        var target = route
        if (target == AudioRoute.BLUETOOTH && needsBluetoothPermission(ctx)) {
            // Without the permission we can neither open SCO nor select the
            // device; stay on phone hardware instead of muting the call.
            target = if (videoCall) AudioRoute.SPEAKER else AudioRoute.EARPIECE
        }
        val avail = available(ctx)
        val deviceOk = !needsExternalDevice(target) || deviceFor(ctx, target) != null
        if (target !in avail || !deviceOk) {
            target =
                avail.firstOrNull { it != AudioRoute.BLUETOOTH || !needsBluetoothPermission(ctx) }
                    ?: AudioRoute.EARPIECE
        }
        wanted = target

        runCatching { a.mode = AudioManager.MODE_IN_COMMUNICATION }
        raiseCallVolume(a)

        val device = deviceFor(ctx, target)
        if (Build.VERSION.SDK_INT >= 31) {
            // The one exclusive way to choose a communication output from 31 on.
            // Setting it explicitly is also what stops the audio arriving on BOTH
            // the speaker and the headset.
            btCommitted = device != null && runCatching { a.setCommunicationDevice(device) }.isSuccess
            if (device == null) runCatching { a.clearCommunicationDevice() }
        }
        when (target) {
            AudioRoute.BLUETOOTH -> {
                runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = false }
                // The SCO link only has to be opened when it is not already the
                // device we committed to (31+ does that itself for LE Audio).
                val linkThere = scoUp || (btCommitted && (device?.type ?: -1) in CALL_BT_TYPES)
                if (!linkThere && (Build.VERSION.SDK_INT < 31 || device?.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO)) {
                    // SCO is what carries a call plus its mic. Below 31 that is
                    // the only route; from 31 it is needed only when the stack has
                    // not opened SCO on its own yet — the state broadcast then
                    // re-applies once the device shows up.
                    runCatching { @Suppress("DEPRECATION") a.setBluetoothScoOn(true) }
                    runCatching { a.startBluetoothSco() }
                    armScoWatchdog(ctx)
                }
            }
            AudioRoute.WIRED, AudioRoute.EARPIECE -> {
                runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = false }
                stopSco(a)
                btWatchdog?.let { main.removeCallbacks(it) }
                btWatchdog = null
            }
            AudioRoute.SPEAKER -> {
                runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = true }
                stopSco(a)
            }
        }
        return target
    }

    /**
     * Media-only Bluetooth (A2DP with no call profile) can be selected and then
     * simply does nothing: SCO never opens, the framework refuses the device, and
     * the call goes on living on the earpiece while the button says "Galaxy Buds".
     * Give the link a moment, and if nothing proves it took, fall back to phone
     * hardware, say so once, and let the UI show the route that is real.
     *
     * A headset that is merely slow is harmless here: the SCO broadcast re-commits
     * to Bluetooth the moment it arrives, whether or not this already fired.
     */
    private fun armScoWatchdog(ctx: Context) {
        btWatchdog?.let { main.removeCallbacks(it) }
        val r =
            Runnable {
                btWatchdog = null
                if (!inCall || wanted != AudioRoute.BLUETOOTH || scoUp || btCommitted) return@Runnable
                if (outputs(ctx).any { it.type in CALL_BT_TYPES }) return@Runnable
                val applied = apply(ctx, if (videoCall) AudioRoute.SPEAKER else AudioRoute.EARPIECE)
                onNotice?.invoke("This Bluetooth device can't carry calls — using the phone.")
                onRouteChanged?.invoke(applied)
            }
        btWatchdog = r
        main.postDelayed(r, 1500)
    }

    private fun stopSco(a: AudioManager) {
        runCatching { @Suppress("DEPRECATION") a.setBluetoothScoOn(false) }
        runCatching { a.stopBluetoothSco() }
        scoUp = false
        btCommitted = false
    }

    /** A device at ~0 in-call volume is the classic "I can't hear anything". */
    private fun raiseCallVolume(a: AudioManager) {
        runCatching {
            val max = a.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            if (a.getStreamVolume(AudioManager.STREAM_VOICE_CALL) <= max / 10) {
                a.setStreamVolume(
                    AudioManager.STREAM_VOICE_CALL,
                    (max * 0.45f).toInt().coerceAtLeast(1),
                    0,
                )
            }
        }
    }

    // ── call lifecycle: watching for hot-plug ─────────────────────────────────

    /** Take the audio stack for a call and start watching devices. */
    fun begin(ctx: Context, kind: String?): AudioRoute {
        app = ctx.applicationContext
        inCall = true
        videoCall = kind == "VIDEO"
        val applied = apply(ctx, defaultRoute(ctx, kind))
        watchDevices(ctx)
        watchSco(ctx)
        return applied
    }

    /** A call turned on its camera: speaker becomes the fallback for hot-unplug. */
    fun setVideoCall(video: Boolean) {
        videoCall = video
    }

    @Synchronized
    fun end(ctx: Context) {
        inCall = false
        videoCall = false
        wanted = AudioRoute.EARPIECE
        scoUp = false
        btCommitted = false
        btWatchdog?.let { main.removeCallbacks(it) }
        btWatchdog = null
        unwatch()
        val a = manager(ctx)
        if (Build.VERSION.SDK_INT >= 31) runCatching { a.clearCommunicationDevice() }
        runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = false }
        stopSco(a)
        runCatching { a.mode = AudioManager.MODE_NORMAL }
    }

    private fun watchDevices(ctx: Context) {
        if (deviceCb != null) return
        val cb =
            object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
                    onChanged(ctx)
                }

                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
                    onChanged(ctx)
                }
            }
        runCatching { manager(ctx).registerAudioDeviceCallback(cb, Handler(Looper.getMainLooper())) }
        deviceCb = cb
    }

    private fun watchSco(ctx: Context) {
        if (scoRx != null) return
        val rx =
            object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    if (intent.action != AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED || !inCall) return
                    val state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1)
                    scoUp = state == AudioManager.SCO_AUDIO_STATE_CONNECTED
                    if (scoUp) {
                        // SCO just opened: the headset is now genuinely selectable,
                        // so commit to it. This is what makes "connect the buds in
                        // the middle of a call" land in the buds.
                        if (wanted != AudioRoute.BLUETOOTH) {
                            val applied = apply(ctx, AudioRoute.BLUETOOTH)
                            if (applied == AudioRoute.BLUETOOTH) onRouteChanged?.invoke(applied)
                        } else {
                            apply(ctx, AudioRoute.BLUETOOTH)
                        }
                    } else if (wanted == AudioRoute.BLUETOOTH) {
                        val applied =
                            apply(ctx, if (videoCall) AudioRoute.SPEAKER else AudioRoute.EARPIECE)
                        onRouteChanged?.invoke(applied)
                    }
                }
            }
        val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
        val main = Handler(Looper.getMainLooper())
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(rx, filter, Context.RECEIVER_NOT_EXPORTED, main)
            } else {
                ctx.registerReceiver(rx, filter, null, main)
            }
        }
        scoRx = rx
    }

    private fun unwatch() {
        val cb = deviceCb
        deviceCb = null
        val rx = scoRx
        scoRx = null
        val ctx = app ?: return
        if (cb != null) runCatching { manager(ctx).unregisterAudioDeviceCallback(cb) }
        if (rx != null) runCatching { ctx.unregisterReceiver(rx) }
    }

    /**
     * A device appeared or disappeared. Newly connected personal output takes
     * over (voice AND video), and a route whose device is gone hands on to the
     * next best one — a dialer's behaviour, applied instantly.
     */
    @Synchronized
    fun onChanged(ctx: Context) {
        if (!inCall) return
        if (needsExternalDevice(wanted) && deviceFor(ctx, wanted) == null) {
            val avail = available(ctx)
            val fallback =
                avail.firstOrNull { it != wanted && needsExternalDevice(it) && deviceFor(ctx, it) != null }
                    ?: if (videoCall) AudioRoute.SPEAKER else AudioRoute.EARPIECE
            onRouteChanged?.invoke(apply(ctx, fallback))
            return
        }
        if (wanted == AudioRoute.EARPIECE || wanted == AudioRoute.SPEAKER) {
            val avail = available(ctx)
            val external =
                when {
                    AudioRoute.BLUETOOTH in avail && !needsBluetoothPermission(ctx) -> AudioRoute.BLUETOOTH
                    AudioRoute.WIRED in avail -> AudioRoute.WIRED
                    else -> null
                }
            if (external != null && deviceFor(ctx, external) != null) {
                onRouteChanged?.invoke(apply(ctx, external))
            }
        }
    }
}
