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
        // TYPE_BLE_EARPHONE (31) is gone again from 33, so it cannot be named
        // against a modern compileSdk; an LE Audio earbud on 31/32 that the
        // framework accepted is covered by [btCommitted] instead.
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
    private var settle: Runnable? = null
    private var settleUntil = 0L
    private val SETTLE_MS = 4000L
    private val SETTLE_STEP_MS = 250L

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

    /**
     * Devices the framework will accept for a CALL. From API 31 that is a
     * different list from the output list, and it is the only one
     * setCommunicationDevice() takes — picking the headset out of the output list
     * alone is what made the commit throw at call start (so the call stayed on
     * the loudspeaker until the user tapped the button themselves).
     */
    private fun routable(ctx: Context): List<AudioDeviceInfo> =
        if (Build.VERSION.SDK_INT >= 31) {
            runCatching { manager(ctx).availableCommunicationDevices.toList() }.getOrDefault(emptyList())
        } else {
            emptyList()
        }

    /** Everything worth considering for a call: what plays, plus what can route. */
    private fun candidates(ctx: Context): List<AudioDeviceInfo> =
        (outputs(ctx) + routable(ctx)).distinctBy { it.type to it.id }

    fun deviceFor(ctx: Context, route: AudioRoute): AudioDeviceInfo? {
        val outs = candidates(ctx)
        return when (route) {
            AudioRoute.BLUETOOTH -> pick(outs, BT_TYPES)
            AudioRoute.WIRED -> pick(outs, WIRED_TYPES)
            AudioRoute.EARPIECE -> outs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
            AudioRoute.SPEAKER -> outs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        }
    }

    /**
     * First device of any of [types], in the order the list was built (so the
     * preferred profile wins). A loop rather than Collections sugar: there is no
     * firstNotNullOfOrNull for IntArray, and this runs on the call's hot path.
     */
    private fun pick(outs: List<AudioDeviceInfo>, types: IntArray): AudioDeviceInfo? {
        for (t in types) outs.firstOrNull { it.type == t }?.let { return it }
        return null
    }

    /** Outputs usable for a call right now, best first. */
    fun available(ctx: Context): List<AudioRoute> {
        // From 31 the framework's own "usable for communication" list is
        // authoritative; union it with the output list so a headset connected for
        // media (A2DP) but not yet for a call is still offered.
        val all = candidates(ctx)
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

    /** The route in effect, for the UI. */
    fun current(): AudioRoute = wanted

    /**
     * Whether call TONES should ride the communication stream instead of the
     * alarm stream.
     *
     * The alarm stream is what keeps this app's ring loud and DND-immune, but it
     * ignores communication routing completely — and `MediaPlayer` has no public
     * way to pin itself to a device, so the only correct lever is the usage
     * itself: USAGE_VOICE_COMMUNICATION follows whichever output [apply]
     * committed to, and only that one. Before a route exists (an incoming call
     * still ringing on a silent phone) this stays false and the alarm behaviour is
     * untouched.
     */
    fun toneFollowsCallRoute(ctx: Context): Boolean =
        inCall && needsExternalDevice(wanted) && deviceFor(ctx, wanted) != null

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
                }
            }
            AudioRoute.WIRED, AudioRoute.EARPIECE -> {
                runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = false }
                stopSco(a)
            }
            AudioRoute.SPEAKER -> {
                runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = true }
                stopSco(a)
            }
        }
        // Believing the framework is not the same as checking it: a Bluetooth
        // device only becomes committable a moment after SCO has come up.
        armSettle(ctx)
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
    /**
     * Is the call provably carried by ONE output?
     *
     * Asking the framework, not remembering what we asked for: from 31 the
     * committed communication device must be the wanted one, and below that the
     * loudspeaker must be off with SCO actually up for Bluetooth (speaker on +
     * SCO on IS the two-outputs state) or SCO closed for a phone route, since an
     * open SCO link keeps playing in the buds whatever else is committed.
     */
    private fun settled(ctx: Context): Boolean {
        val a = manager(ctx)
        if (Build.VERSION.SDK_INT >= 31) {
            val committed = runCatching { a.communicationDevice }.getOrNull()
            val want = deviceFor(ctx, wanted)
            return committed != null && want != null && committed.type == want.type
        }
        val speakerOff = !runCatching { a.isSpeakerphoneOn }.getOrDefault(false)
        val scoOn = scoUp || runCatching { a.isBluetoothScoOn }.getOrDefault(false)
        return when {
            wanted == AudioRoute.BLUETOOTH -> speakerOff && scoUp
            needsExternalDevice(wanted) -> speakerOff
            wanted == AudioRoute.SPEAKER -> !scoOn
            else -> !scoOn && speakerOff
        }
    }

    /**
     * The "never in two places at once" guard, run whenever the route is set,
     * whenever a device appears or disappears, and once a second while the call
     * is up (OEM stacks re-route behind our back).
     *
     * A headset route that the framework has not taken yet is not treated as a
     * failure — SCO is (re)asked for and the commit retried, which is what makes
     * "buds were already connected when I dialled" land in the buds by itself.
     * A phone route has the parallel paths shut: no SCO, no committed headset.
     */
    @Synchronized
    fun enforceExclusive(ctx: Context): AudioRoute {
        if (!inCall) return wanted
        app = ctx.applicationContext
        if (settled(ctx)) return wanted
        val a = manager(ctx)
        if (needsExternalDevice(wanted)) {
            runCatching { @Suppress("DEPRECATION") a.isSpeakerphoneOn = false }
            if (wanted == AudioRoute.BLUETOOTH &&
                !scoUp &&
                !runCatching { a.isBluetoothScoOn }.getOrDefault(false)
            ) {
                runCatching { @Suppress("DEPRECATION") a.setBluetoothScoOn(true) }
                runCatching { a.startBluetoothSco() }
            }
            if (Build.VERSION.SDK_INT >= 31) {
                deviceFor(ctx, wanted)?.let { dev ->
                    if (runCatching { a.setCommunicationDevice(dev) }.isSuccess) btCommitted = true
                }
            }
        } else {
            stopSco(a)
            if (Build.VERSION.SDK_INT >= 31) {
                val committed = runCatching { a.communicationDevice }.getOrNull()
                val want = deviceFor(ctx, wanted)
                if (committed != null && want != null && committed.type != want.type) {
                    runCatching { a.setCommunicationDevice(want) }
                }
            }
        }
        return wanted
    }

    /**
     * Bluetooth routing is not instant: SCO has to come up before the device can
     * be committed. Retry on a bounded window (the old code committed once, gave
     * up silently, and left the call on the loudspeaker) and only at the end of
     * it decide that the device cannot carry a call at all — a pair of media-only
     * buds — and fall back to the phone, saying so, instead of letting the button
     * claim a route the audio never took.
     */
    private fun armSettle(ctx: Context) {
        settleUntil = System.currentTimeMillis() + SETTLE_MS
        if (settle != null) return
        val r =
            object : Runnable {
                override fun run() {
                    settle = null
                    val c = app ?: return
                    if (!inCall) return
                    val before = wanted
                    enforceExclusive(c)
                    if (settled(c)) {
                        if (before != wanted) onRouteChanged?.invoke(wanted)
                        return
                    }
                    if (System.currentTimeMillis() < settleUntil) {
                        settle = this
                        main.postDelayed(this, SETTLE_STEP_MS)
                        return
                    }
                    if (wanted == AudioRoute.BLUETOOTH) {
                        val applied = apply(c, if (videoCall) AudioRoute.SPEAKER else AudioRoute.EARPIECE)
                        onNotice?.invoke("Bluetooth didn't take the call — using the phone.")
                        onRouteChanged?.invoke(applied)
                    }
                }
            }
        settle = r
        main.postDelayed(r, SETTLE_STEP_MS)
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
        // Listeners BEFORE the first apply(), on purpose: apply() opens SCO, and
        // its CONNECTED broadcast used to land on the floor because the receiver
        // was only registered afterwards. A headset that was already connected
        // when the call started is exactly that case — no broadcast comes at all
        // later, so the call sat on the phone until the user tapped the button.
        watchDevices(ctx)
        watchSco(ctx)
        return apply(ctx, defaultRoute(ctx, kind))
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
        settle?.let { main.removeCallbacks(it) }
        settle = null
        settleUntil = 0L
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
        // ContextCompat rather than Context's overload: the framework also has a
        // (permission: String) 4-arg form, and the raw call binds that one on a
        // modern compileSdk. Without a scheduler the receiver is delivered on the
        // main thread, which is exactly where the rest of routing runs.
        runCatching { ContextCompat.registerReceiver(ctx, rx, filter, ContextCompat.RECEIVER_NOT_EXPORTED) }
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
