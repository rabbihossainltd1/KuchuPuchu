package app.kuchupuchu.android

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.RtpTransceiver
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class CallUi(
    val id: String,
    val kind: String,
    val status: String,
    val incoming: Boolean,
    val otherName: String,
    val otherId: String,
    val otherOnline: Boolean = false,
    val otherAvatar: String = "",
    val startedAt: Long = 0L,
    val connecting: Boolean = false,
    /** Owner round 31 item 21: the other side is a private profile → no capture. */
    val otherPrivate: Boolean = false,
    /** Owner round 32 (item 30): the peer's user object (badges) for the call screens. */
    val otherUser: JSONObject? = null,
    /**
     * Owner round 32 (item 5b): a GROUP call. `otherName` / `otherAvatar` carry
     * the group's title + picture ref so every consumer that names the call
     * (Telecom line, ongoing / ring cards, missed card) keeps working;
     * `otherId` is the group CONVERSATION id; `participants` = every invited
     * member with their state (RINGING / JOINED / LEFT / DECLINED / MISSED).
     */
    val group: Boolean = false,
    val starterName: String = "",
    val participants: List<JSONObject> = emptyList(),
) {
    /** Members currently on the call (excluding nobody — the caller filters itself). */
    val joined: List<JSONObject> get() = participants.filter { it.optString("state") == "JOINED" }
}

/**
 * WebRTC call engine for v3 — polls /api/calls/active, drives the peer
 * connection, relays ICE through the worker, and exposes Compose state
 * (active call, muted, speaker, camera, sharing) for the call screens.
 *
 * Both sides of every call now land on the SAME screens: incoming
 * (ringing) → in-call (voice or video). No per-side variants.
 */
class CallEngine(private val app: Application) {
    var onChange: ((CallUi?) -> Unit)? = null

    /** Compose state: call screens recompose when this changes. */
    var active by mutableStateOf<CallUi?>(null)
    var minimized by mutableStateOf(false)
        private set

    /** When `active` last CHANGED identity — zombie detection for startCall. */
    private var activeSince = 0L

    fun minimizeCall() { minimized = true }
    fun restoreCallUi() { minimized = false }

    var speaker by mutableStateOf(false)

    /** Current audio output — drives the voice-screen button's icon/label. */
    var audioRoute by mutableStateOf(AudioRoute.EARPIECE)
        private set
    var muted by mutableStateOf(false)
    var cameraOff by mutableStateOf(false)
    var sharing by mutableStateOf(false)
    var hasRemote by mutableStateOf(false)

    /**
     * Owner round 31 item 19: the OTHER phone is sharing its screen (from the
     * call's `media` flags — a WS frame and the /active poll both carry them).
     * On a voice call this draws the small preview card under the buttons
     * instead of flipping the call to the video UI; a camera, by contrast,
     * converts the call for both sides (the server re-labels it VIDEO).
     */
    var peerScreen by mutableStateOf(false)
        private set

    /**
     * Owner round 32 item 47: the OTHER phone said its camera is off on a
     * video call (media flags: no camera, no screen, row VIDEO). The video
     * screen then shows their avatar — exactly what a normal video call does
     * for an off camera — instead of black frames or a "waiting" state. A
     * peer that never announced anything counts as on; the first real frame
     * (hasRemote) decides for them.
     */
    var peerCameraOff by mutableStateOf(false)
        private set

    /** The preview card was tapped: the shared screen fills the display. */
    var shareFull by mutableStateOf(false)
        private set

    fun openShareFullscreen() { if (peerScreen) shareFull = true }
    fun exitShareFullscreen() { shareFull = false }

    private fun resetPeerMedia() {
        peerScreen = false
        peerCameraOff = false
        shareFull = false
    }

    /** Our own camera is live (not off, not replaced by a screen share). */
    private val cameraLive: Boolean get() = videoTrack != null && !cameraOff && !sharing

    /**
     * Tell the server (and through it the other phone) what this side sends
     * now. Camera on = the call becomes VIDEO on the row, so BOTH phones'
     * polls, the ongoing notification and the call log agree; a screen share
     * never changes the kind — an audio call with a shared screen is still an
     * audio call. Fire-and-forget: the poll re-reads the flags either way.
     */
    private fun postMedia(camera: Boolean? = null, screen: Boolean? = null) {
        val id = active?.id?.takeIf { it.isNotBlank() && !it.startsWith("pending") } ?: return
        val body = JSONObject()
        camera?.let { body.put("camera", it) }
        screen?.let { body.put("screen", it) }
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { Api.post("/api/calls/$id/media", body) } }
        }
    }

    /**
     * A `media` frame / poll entry about the OTHER side. `kind` is the server
     * row's label (VIDEO once anyone's camera is on, never for a screen).
     */
    private fun applyPeerMedia(camera: Boolean, screen: Boolean, kind: String) {
        val cur = active ?: return
        peerCameraOff = !camera && !screen && kind == "VIDEO"
        if (peerScreen != screen) {
            peerScreen = screen
            if (!screen) {
                shareFull = false
                if (!camera) {
                    // Their screen is gone and no camera replaced it: the
                    // remote video is over. Forget the frame we saw (else a
                    // stale "remote video seen" pulls the voice UI to the
                    // video screen) and re-arm the gate after the last
                    // in-flight frames have landed.
                    hasRemote = false
                    scope.launch {
                        delay(1_500)
                        if (!peerScreen && !hasRemote) rearmRemoteGate()
                    }
                }
            }
        }
        when {
            // Their camera came on: this side switches to the video-call UI
            // too (own camera stays as it is — the strip's button turns it on).
            kind == "VIDEO" && cur.kind != "VIDEO" -> {
                active = cur.copy(kind = "VIDEO")
                markVideoRoute()
                publishChange()
            }
            // The server says AUDIO (a screen share on a voice call) while a
            // first frame already promoted this side: undo — only a camera
            // converts, the screen gets the preview card.
            kind == "AUDIO" && cur.kind == "VIDEO" && !cameraLive -> {
                active = cur.copy(kind = "AUDIO")
                publishChange()
            }
        }
    }

    // Owner round 32 item 47: no auto-join. The old autoJoinCamera() (R25)
    // turned OUR camera on when theirs came on; it never actually fired on a
    // voice call (capture(false) leaves cameraOff true) and the screen sat on
    // "Waiting for video" for a camera that was never coming. A camera is
    // each side's own choice: theirs off shows their avatar, ours is one tap.

    private fun rearmRemoteGate() {
        remoteVideo?.let { v ->
            frameGate?.let { runCatching { v.removeSink(it) } }
            frameGate = FirstFrameGate().also { runCatching { v.addSink(it) } }
        }
    }

    private var proximityLock: android.os.PowerManager.WakeLock? = null

    private fun updateProximityLock() {
        // A voice call holds the screen-off lock in EVERY live phase —
        // ringing, outgoing "Calling…", "Connecting…" and connected. Gating on
        // ACTIVE alone meant a phone in a pocket could press mute / speaker /
        // decline for the whole first seconds of the call, which is the
        // "sensor only connected hole kore" report. The route check still lets
        // the screen back on as soon as sound leaves the earpiece.
        val call = active
        val shouldHold = call?.kind == "AUDIO" &&
            (call.status == "ACTIVE" || call.status == "RINGING") &&
            audioRoute == AudioRoute.EARPIECE
        if (shouldHold) {
            if (proximityLock?.isHeld != true) {
                val pm = app.getSystemService(android.os.PowerManager::class.java)
                if (pm.isWakeLockLevelSupported(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                    proximityLock = pm.newWakeLock(
                        android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                        "KuchuPuchu:voice-proximity",
                    ).also { runCatching { it.acquire() } }
                }
            }
        } else {
            proximityLock?.let { if (it.isHeld) runCatching { it.release() } }
            proximityLock = null
        }
    }

    /** True between posting our re-offer and receiving the remote re-answer. */
    @Volatile
    private var awaitingReanswer: Boolean = false

    /** The re-offer SDP we already applied (dedupe across poll ticks). */
    @Volatile
    private var lastAppliedReoffer: String? = null

    private val renegotiating = java.util.concurrent.atomic.AtomicBoolean(false)
    /**
     * A renegotiation that could not run right now (an answer still in flight,
     * a non-STABLE signalling state) is remembered and retried later instead of
     * being dropped. Dropping it is exactly how "screen share dileo opponent
     * kichu dekhe na" happened: the sharer had the track, the peer was never
     * told about it, and nothing ever re-offered.
     */
    private val renegotiationQueued = java.util.concurrent.atomic.AtomicBoolean(false)
    /** One relay-only retry per call after ICE FAILED (see the FAILED branch). */
    @Volatile
    private var relayRetryUsed = false

    /** True once the remote side is actually sending video — how an
     *  audio→video upgrade is detected, so BOTH phones land on the same
     *  in-call screen even though the server row still says "AUDIO". */
    val hasRemoteVideo: Boolean get() = hasRemote && remoteVideo != null
    var onHold by mutableStateOf(false)

    /** Short-lived message shown by the call screens, e.g. "User offline". */
    var toast by mutableStateOf("")
        private set

    val egl = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var audioModule: JavaAudioDeviceModule? = null
    private var pc: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var remoteVideo: VideoTrack? = null
    private var capturer: VideoCapturer? = null
    private var helper: SurfaceTextureHelper? = null
    private var localView: SurfaceViewRenderer? = null
    private var remoteView: SurfaceViewRenderer? = null
    private val seenIce = mutableSetOf<String>()
    // Owner round 32 (item 5b): GROUP call mesh — one PeerConnection per
    // other JOINED member, all sending the same local audio track. Keyed by
    // the peer's user id. `groupOffered` = pairs we already posted an offer
    // for; `groupAnswered` = their offers we already answered (dedupe across
    // poll ticks — the server keeps the SDP rows until the call ends).
    private val groupPeers = java.util.concurrent.ConcurrentHashMap<String, PeerConnection>()
    private val groupOffered = mutableSetOf<String>()
    private val groupAnswered = mutableMapOf<String, String>()
    private val groupSyncing = java.util.concurrent.atomic.AtomicBoolean(false)
    // Owner round 32 (item 5c): video on the mesh. Each leg carries a video
    // m-line (our camera swapped in with setTrack, no renegotiation — the
    // 1:1 trick); the other side's track lands here keyed by their id, the
    // first REAL frame marks it live, and an explicit camera:false flag from
    // them hides it again (item 47: an off camera shows the avatar).
    private val groupRemoteVideo = java.util.concurrent.ConcurrentHashMap<String, VideoTrack>()
    private val groupRemoteViews = java.util.concurrent.ConcurrentHashMap<String, SurfaceViewRenderer>()
    private val groupFramesSeen = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private val groupCameraOff = java.util.concurrent.ConcurrentHashMap<String, Boolean>()

    /** Bumped on every per-member video change; the group grid recomposes on it. */
    var groupVideoVersion by mutableStateOf(0)
        private set

    /** Is [peerId]'s picture flowing (track bound, a frame seen, camera not declared off)? */
    fun groupVideoLive(peerId: String): Boolean =
        groupRemoteVideo.containsKey(peerId) && peerId in groupFramesSeen && groupCameraOff[peerId] != true

    fun attachGroupRemote(peerId: String, view: SurfaceViewRenderer) {
        val old = groupRemoteViews[peerId]
        if (old != null && old !== view) groupRemoteVideo[peerId]?.let { t -> runCatching { t.removeSink(old) } }
        groupRemoteViews[peerId] = view
        groupRemoteVideo[peerId]?.let { runCatching { it.addSink(view) } }
    }

    fun detachGroupRemote(peerId: String, view: SurfaceViewRenderer) {
        groupRemoteVideo[peerId]?.let { runCatching { it.removeSink(view) } }
        if (groupRemoteViews[peerId] === view) groupRemoteViews.remove(peerId)
    }

    private fun bindGroupRemote(peerId: String, track: VideoTrack) {
        groupRemoteVideo[peerId]?.let { old -> groupRemoteViews[peerId]?.let { v -> runCatching { old.removeSink(v) } } }
        groupRemoteVideo[peerId] = track
        track.setEnabled(true)
        groupRemoteViews[peerId]?.let { runCatching { track.addSink(it) } }
        // Live only from the first real frame — the sendrecv m-line surfaces
        // an empty placeholder track at connect on a voice call.
        runCatching {
            track.addSink(
                object : org.webrtc.VideoSink {
                    @Volatile
                    private var seen = false

                    override fun onFrame(frame: org.webrtc.VideoFrame) {
                        if (seen) return
                        seen = true
                        Handler(Looper.getMainLooper()).post {
                            groupFramesSeen.add(peerId)
                            groupVideoVersion++
                            // Their camera reached us on a call the row still
                            // labels AUDIO (an announcement in flight): the
                            // grid is the right screen for a picture.
                            val cur = active
                            if (cur != null && cur.group && cur.kind != "VIDEO" && groupCameraOff[peerId] != true) {
                                active = cur.copy(kind = "VIDEO")
                                markVideoRoute()
                                publishChange()
                            }
                        }
                    }
                },
            )
        }
        Handler(Looper.getMainLooper()).post { groupVideoVersion++ }
    }

    /** A member's own media flags (poll row or `media` frame) on a group call. */
    private fun applyGroupPeerMedia(peerId: String, camera: Boolean, kind: String) {
        val was = groupCameraOff[peerId]
        groupCameraOff[peerId] = !camera
        if (was != !camera) groupVideoVersion++
        val cur = active ?: return
        if (kind == "VIDEO" && cur.kind != "VIDEO") {
            active = cur.copy(kind = "VIDEO")
            markVideoRoute()
            publishChange()
        }
    }
    private val left = AtomicBoolean(false)
    private var poll: Job? = null
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            // Owner rule (2026-09-04): no log capture anywhere in the app.
            // The handler stays — swallowing silently is still better than a
            // crash — it just no longer writes anywhere.
            CoroutineExceptionHandler { _, _ -> }
    )

    // v3.7 realtime: the call's signalling socket + one shared event listener.
    private var wsListener: (() -> Unit)? = null
    private var wsCallId = ""
    private val pokeRequested = java.util.concurrent.atomic.AtomicBoolean(false)
    private val pokeDraining = java.util.concurrent.atomic.AtomicBoolean(false)
    @Volatile
    private var iceCallId: String = ""

    // Written by WebRTC's signalling thread, drained on the main thread — a plain
    // ArrayList here could lose candidates or throw ConcurrentModificationException.
    private val pendingIce = java.util.Collections.synchronizedList(mutableListOf<JSONObject>())
    private var ringingId: String? = null
    private val answering = AtomicBoolean(false)
    var pendingAccept = false

    /**
     * True only while the poll loop is actually running. Push handling uses this
     * to decide whether the engine will raise its own ringing UI; the previous
     * "instance != null" test was always true after MainActivity ran, so FCM
     * heads-up notifications were suppressed even when nothing was polling.
     */
    @Volatile
    var polling = false
        private set

    /** Consecutive tick() failures — drives the "Reconnecting…" toast. */
    private var netFailStreak = 0

    /** When the outgoing call started ringing — drives the 60s no-answer hangup. */
    private var outgoingRingAt = 0L

    /**
     * A "call answered" push arrived for OUR outgoing call: poll immediately
     * instead of waiting for the next tick, so the caller's ringing screen
     * flips to connected the moment the callee accepts (push latency only).
     */
    /**
     * Owner round 25 (the recurring "app open thakle fullscreen call ashe na"):
     * an unconditional tick from ANY trigger. onResume fires this so coming
     * back to the app surfaces a ring that landed while the socket/push paths
     * were mid-reconnect — the poll loop alone would still catch it, this
     * just removes the wait.
     */
    fun syncNow() {
        scope.launch { runCatching { tick() } }
    }

    fun kickPoll(callId: String) {
        // Owner round 23: a NEW incoming call has active == null, so the old
        // `active?.id == callId` guard made every kick a NO-OP exactly when it
        // mattered — an in-app ring then depended purely on the 1.5-2s poll
        // timer, and on a slow mobile-data link that window stretched out
        // ("app open thakle call screen e ashe na"). Kick for NEW calls too.
        if (active?.id == callId || active == null) scope.launch { runCatching { tick() } }
    }

    /**
     * The single place a call state change is announced. The Compose screens and the §31
     * Telecom mirror hang off the same call, which is the point: a `Connection` that lags
     * the UI is worse than none (a headset button would then act on a stale row), and
     * wiring the mirror at each of the ~11 sites it was previously needed at is how such
     * a lag is born. Never throws — a mirror failure must not end a working call.
     */
    private fun publishChange() {
        onChange?.invoke(active)
        runCatching { KpTelecom.syncNow(app) }
        // Owner round 13d: the voice-call backdrop used to pop in LATE — the
        // caller photo was only fetched when the call screen composed. Warm
        // Coil's cache (software bitmap, the blur needs one) while the phone
        // is still ringing, once per call.
        active?.let {
            if (it.otherAvatar.isNotBlank() && warmedAvatarFor != it.id) {
                warmedAvatarFor = it.id
                warmAvatar(it.otherAvatar)
            }
        }
    }

    private var warmedAvatarFor: String? = null

    private fun warmAvatar(url: String) {
        // Owner round 14: data: URIs have nothing to warm over the network —
        // the backdrop decodes them inline. Warming a bogus Api.BASE+data
        // request just poisons the cache slot.
        if (url.startsWith("data:")) return
        runCatching {
            val full = if (url.startsWith("http")) url else Api.BASE + url
            coil.Coil.imageLoader(app).enqueue(
                coil.request.ImageRequest.Builder(app)
                    .data(full)
                    .memoryCacheKey("callbg:$full")
                    .diskCacheKey("callbg:$full")
                    .allowHardware(false)
                    .size(coil.size.Size.ORIGINAL)
                    .build(),
            )
        }
    }

    fun notify(message: String) {
        toast = message
        scope.launch {
            delay(3500)
            if (toast == message) toast = ""
        }
    }

    init {
        instance = this
        // The router owns the audio stack; when it moves the call by itself
        // (headset plugged in mid-call, SCO just finished opening, the chosen
        // device disappeared) the button has to follow immediately.
        AudioRouter.onNotice = { message -> Handler(Looper.getMainLooper()).post { notify(message) } }
        AudioRouter.onRouteChanged = { route ->
            Handler(Looper.getMainLooper()).post {
                if (audioRoute != route) audioRoute = route
                speaker = route == AudioRoute.SPEAKER
                updateProximityLock()
                // A tone still playing (the caller's ringback during
                // "Ringing…") has to move with the route, otherwise the phone
                // keeps ringing out loud beside a call that just went to the
                // headset.
                CallSounds.retuneTones(app)
                publishChange()
            }
        }
    }

    fun start(ctx: Context) {
        CallNotify.ensure(ctx)
        // §31: registering the self-managed calling account is cheap and idempotent, and
        // doing it here means it happens once per process, after the user is signed in,
        // rather than on the first ring when there is no time to spare.
        runCatching { KpTelecom.ensureAccount(app) }
        loadIceConfig()
        // PeerConnectionFactory.initialize + factory creation used to happen
        // inside the first startCall()/answer() — 100-200ms of it landed on
        // the "Connecting…" path of the very first call of every session.
        // Warm it here, off the UI thread; ensureFactory is idempotent.
        scope.launch(Dispatchers.IO) { runCatching { ensureFactory(ctx) } }
        // v3.7 realtime: state/ICE/renegotiation frames for OUR call — and
        // incoming-call pokes when we have none — trigger an immediate tick().
        // The timer loop below stays as the safety net for whenever the
        // socket is down (backgrounded app, flaky network).
        if (wsListener == null) {
            wsListener = KpSocket.onEvent { ev ->
                val t = ev.optString("type")
                val cid = ev.optString("callId")
                val mine = active?.id
                when {
                    t == "call" && mine == null && cid.isNotBlank() -> {
                        pokeTick()
                        // Round 24: the server hides a RINGING call from the
                        // callee for its first 1.6s (anti-phantom gate). A
                        // tick inside that window sees NOTHING — one more tick
                        // after the window so the ring never waits for the
                        // poll timer.
                        scope.launch { delay(1_200); pokeTick() }
                    }
                    t == "media" && cid.isNotBlank() && cid == mine -> {
                        // Socket callbacks arrive off the main thread; the
                        // flags are Compose state, so hop over (scope = Main).
                        if (ev.optString("userId") != Store.myId()) {
                            val camera = ev.optBoolean("camera")
                            val screen = ev.optBoolean("screen")
                            val kind = ev.optString("kind")
                            val who = ev.optString("userId")
                            scope.launch {
                                // Owner round 32 (item 5c): per member on a group call.
                                if (active?.group == true) applyGroupPeerMedia(who, camera, kind)
                                else applyPeerMedia(camera, screen, kind)
                            }
                        }
                        pokeTick()
                    }
                    cid.isNotBlank() && cid == mine -> pokeTick()
                }
            }
        }
        poll?.cancel()
        poll =
            scope.launch {
                polling = true
                // Owner round 32 (item 9): an Accept / return-to-call tap that
                // reached MainActivity before this engine existed is applied
                // now, on the first tick (scope = Main, so this is the UI thread).
                replayPendingIntents()
                try {
                    while (isActive) {
                        // A throw out of tick() used to kill this coroutine, which
                        // meant no more call polling at all for the process.
                        runCatching { tick() }.onFailure { notify("Call update failed. Retrying.") }
                        // Once a second, ask the framework whether the call is
                        // still where the button says it is — and make it stop
                        // carrying the audio anywhere else. OEM stacks move
                        // communication output on their own, and "headset AND
                        // speaker" has to be impossible, not merely unlikely.
                        runCatching { AudioRouter.enforceExclusive(app) }
                        val wsId =
                            active?.id?.takeIf { it.isNotBlank() && !it.startsWith("pending") }
                                ?: iceCallId.takeIf { it.isNotBlank() }
                        delay(
                            when {
                                // Signalling socket live: the timer is a
                                // safety net, not the delivery path.
                                // 5s, not 500ms: with live frames the net
                                // only covers missed-edge cases, but it stays
                                // low enough that a dropped frame is bounded.
                                wsId != null && KpSocket.callLive(wsId) -> 5_000L
                                active != null -> 500L
                                // Round 24: back to 1.5s — the r23 2s cadence
                                // added up to half a second of ring latency;
                                // calls must feel instant, data savings come
                                // from the WS path instead.
                                Store.foreground -> 1500L
                                else -> 4000L
                            },
                        )
                    }
                } finally {
                    polling = false
                }
            }
    }

    /**
     * Realtime-triggered tick, coalesced WITHOUT dropping: frames arriving
     * while a tick is in flight (an ANSWER landing mid-ICE-burst) set a flag
     * and cost exactly one more tick afterwards — a dropped ANSWER frame
     * would otherwise park the caller on "Ringing…" until the safety net.
     */
    private fun pokeTick() {
        pokeRequested.set(true)
        if (pokeDraining.getAndSet(true)) return
        scope.launch {
            try {
                do {
                    pokeRequested.set(false)
                    runCatching { tick() }
                } while (pokeRequested.get())
            } finally {
                pokeDraining.set(false)
            }
        }
    }

    @Synchronized
    private fun ensureFactory(ctx: Context) {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(ctx).createInitializationOptions(),
        )
        audioModule =
            JavaAudioDeviceModule.builder(ctx)
                // Several budget devices ship a broken hardware AEC/NS that
                // makes call audio silent — WebRTC's software chain is safer.
                .setUseHardwareAcousticEchoCanceler(false)
                .setUseHardwareNoiseSuppressor(false)
                // Owner round 31 item 20: every ~10ms mic buffer passes through
                // here before the encoder — the screen-share audio tap mixes
                // the phone's playback into it (a no-op while nothing is tapped).
                // Owner round 32 (item 41): voice isolation FIRST (the room
                // noise goes before anything is mixed in), then the tap.
                .setAudioRecordDataCallback { audioFormat, channelCount, sampleRate, audioBuffer ->
                    VoiceIsolation.process(audioFormat, channelCount, sampleRate, audioBuffer)
                    SystemAudioTap.mixInto(audioFormat, channelCount, sampleRate, audioBuffer)
                }
                .createAudioDeviceModule()
        factory =
            PeerConnectionFactory.builder()
                .setAudioDeviceModule(audioModule)
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
                .createPeerConnectionFactory()
    }

    /* ---- audio routing: everything lives in AudioRouter.kt ---------------- */

    /**
     * Push the wanted route to the audio stack and mirror whatever it actually
     * took effect (a device can vanish, or Bluetooth can still lack its runtime
     * permission) so the button never lies about where sound is going.
     */
    fun applyAudio() {
        val applied = AudioRouter.apply(app, audioRoute)
        if (applied != audioRoute) audioRoute = applied
        speaker = applied == AudioRoute.SPEAKER
        updateProximityLock()
    }

    /** Tap: step to the next output that physically exists. */
    fun cycleAudioRoute() {
        selectAudioRoute(AudioRouter.next(app, audioRoute))
    }

    fun selectAudioRoute(route: AudioRoute) {
        audioRoute = route
        applyAudio()
        publishChange()
    }

    /**
     * Called back from the BLUETOOTH_CONNECT prompt. Granted → take the headset
     * now; refused → re-assert whatever the stack can actually do so the button
     * stops pointing at a route that cannot be programmed.
     */
    fun retryBluetoothRoute(granted: Boolean) {
        if (granted && AudioRoute.BLUETOOTH in AudioRouter.available(app)) {
            selectAudioRoute(AudioRoute.BLUETOOTH)
        } else {
            applyAudio()
            if (!granted) notify("Bluetooth unavailable — call stays on the phone.")
        }
    }

    /** An audio call that became video: speaker is the fallback, not the earpiece. */
    private fun markVideoRoute() {
        AudioRouter.setVideoCall(true)
        if (audioRoute == AudioRoute.EARPIECE) {
            selectAudioRoute(AudioRouter.defaultRoute(app, "VIDEO"))
        }
    }

    private suspend fun tick() {
        // A hung request must not stall the whole poll loop: on slow networks
        // the 45s read timeout meant the caller sat on "Ringing…" forever even
        // after the other side had answered.
        // Owner round 23: 6s held the whole loop hostage on one slow
        // mobile-data request; 4.5s fails faster and retries sooner.
        val data =
            withTimeout(4_500) {
                withContext(Dispatchers.IO) {
                    runCatching { Api.get("/api/calls/active", true) }.getOrNull()
                }
            } ?: run {
                netFailStreak += 1
                if (netFailStreak == 3 && active != null) notify("Reconnecting…")
                return
            }
        netFailStreak = 0
        val items = data.arr("items").objects().filter { !ignoredCalls.contains(it.optString("id")) }
        val current = active
        var next = items.firstOrNull()
        if (current != null && !current.id.startsWith("pending")) {
            next = items.find { it.optString("id") == current.id } ?: next
        }
        if (next == null) {
            if (current != null && !current.id.startsWith("pending") && current.status in listOf("RINGING", "ACTIVE")) {
                hangupLocal()
            }
            return
        }
        var status = next.optString("status")
        // The callee already answered locally: never downgrade back to RINGING
        // while the server catches up, otherwise the ringing screen returns.
        if (
            current != null &&
            current.id == next.optString("id") &&
            current.status == "ACTIVE" &&
            (status == "RINGING" || status == "ACTIVE")
        ) {
            status = "ACTIVE"
        }
        if (status in listOf("ENDED", "DECLINED", "MISSED", "CANCELLED")) {
            ignoredCalls.add(next.optString("id"))
            hangupLocal()
            return
        }
        val other = next.optJSONObject("other") ?: JSONObject()
        val incoming = next.optBoolean("incoming")
        // Owner round 32 (item 5b): a GROUP call row. Our own state on it
        // decides the phase: RINGING = the invite screen (even while the call
        // is already ACTIVE for others), JOINED = in the call.
        val isGroup = next.optBoolean("group")
        val myState = next.optIso("myState").orEmpty()
        if (isGroup && incoming && myState == "RINGING" && current?.status != "ACTIVE") status = "RINGING"
        val participants = next.arr("participants").objects()
        // Outgoing call nobody picked up within a minute: end it like the
        // server's missed-call sweep does, instead of ringing forever.
        if (!incoming && status == "RINGING") {
            if (outgoingRingAt == 0L) outgoingRingAt = System.currentTimeMillis()
            else if (System.currentTimeMillis() - outgoingRingAt > 60_000) {
                notify("No answer")
                hangupLocal()
                return
            }
        } else {
            outgoingRingAt = 0L
        }
        // optIso(), not optString(): Android's org.json turns a JSON null into
        // the literal string "null", which is *not* blank. With optString() this
        // was always true, so the caller's screen flipped to "connected" the
        // moment the call was created and then fed the string "null" to
        // setRemoteDescription() as if it were an SDP answer.
        val answerSdp = next.optIso("answerSdp").orEmpty()
        if (!incoming && status == "RINGING" && answerSdp.isNotBlank()) {
            status = "ACTIVE"
        }
        val suppressed = isIncomingSuppressed()
        val autoAnswer = incoming && status == "RINGING" && (pendingAccept || suppressed)
        // Owner round 31 item 19: our camera just came on and the row has not
        // been re-labelled yet (or the peer's camera frames arrived from an
        // app that does not announce them) — keep VIDEO for that window
        // instead of letting one poll bounce the screen back to the voice UI.
        val sameCall = current?.id == next.optString("id")
        val kind =
            if (sameCall && current?.kind == "VIDEO" && next.optString("kind") != "VIDEO" &&
                (cameraLive || (hasRemoteVideo && !peerScreen))
            ) {
                "VIDEO"
            } else {
                next.optString("kind")
            }
        val ui =
            CallUi(
                id = next.optString("id"),
                kind = kind,
                status = status,
                incoming = incoming,
                otherName =
                    if (isGroup) next.optText("title").ifBlank { current?.otherName ?: "Group" }
                    else other.optString("displayName").ifBlank { current?.otherName ?: "KuchuPuchu" },
                otherId =
                    if (isGroup) next.optText("conversationId").ifBlank { current?.otherId.orEmpty() }
                    else other.optString("id").ifBlank { current?.otherId.orEmpty() },
                otherOnline = other.optBoolean("online"),
                otherAvatar =
                    if (isGroup) next.optIso("avatarRef").orEmpty().ifBlank { current?.otherAvatar.orEmpty() }
                    else other.optIso("avatarUrl").orEmpty().ifBlank { current?.otherAvatar.orEmpty() },
                otherPrivate =
                    if (isGroup) next.optBoolean("privateGroup") || current?.otherPrivate == true
                    else other.optBoolean("privateProfile") || current?.otherPrivate == true,
                otherUser = if (!isGroup && other.has("id")) other else current?.otherUser,
                group = isGroup,
                starterName = if (isGroup) other.optString("displayName") else "",
                participants = if (isGroup) participants else emptyList(),
                startedAt =
                    when {
                        status != "ACTIVE" -> 0L
                        // The SERVER's started_at is the single clock both
                        // phones share — local clocks made the callee's timer
                        // start instantly while the caller still rang (2-3s skew).
                        else -> {
                            val serverMs =
                                runCatching {
                                    java.time.Instant.parse(next.optIso("startedAt")).toEpochMilli()
                                }.getOrDefault(0L)
                            when {
                                // Once ICE establishes the local display epoch,
                                // polling must not replace it with the earlier
                                // server answer timestamp and jump the clock.
                                current?.connecting == false && (current.startedAt > 0L) -> current.startedAt
                                serverMs > 0L -> serverMs
                                (current?.startedAt ?: 0L) > 0L -> current!!.startedAt
                                else -> 0L
                            }
                        }
                    },
                connecting =
                    autoAnswer ||
                        (status == "ACTIVE" && next.optIso("startedAt").isNullOrBlank()) ||
                        // Polling must not clear the media gate merely because
                        // answer-time startedAt has arrived. ICE owns the
                        // transition from Connecting to the running timer.
                        current?.connecting == true,
            )
        if (current?.id != ui.id) activeSince = System.currentTimeMillis()
        if (current?.id?.startsWith("pending") == true) {
            active = ui.copy(otherName = current.otherName, otherAvatar = current.otherAvatar, otherUser = ui.otherUser ?: current.otherUser)
        } else {
            active = ui
        }
        // The other side's live media flags ride the same row — the safety net
        // for a `media` frame that arrived while this process was asleep.
        next.optJSONObject("media")?.optJSONObject(ui.otherId)?.let { m ->
            val off = !m.optBoolean("camera") && !m.optBoolean("screen") && next.optString("kind") == "VIDEO"
            if (m.optBoolean("screen") != peerScreen || off != peerCameraOff) {
                applyPeerMedia(m.optBoolean("camera"), m.optBoolean("screen"), next.optString("kind"))
            }
        }
        // The row went VIDEO under us (their camera): speaker becomes the
        // default, the ongoing notification and Telecom follow — and, as
        // before (R25), our camera joins so they are not left waiting.
        if (sameCall && current?.kind != "VIDEO" && ui.kind == "VIDEO" && status == "ACTIVE") {
            markVideoRoute()
            publishChange()
        }
        // v3.7: hold the call's realtime signalling socket while it lives.
        if (!ui.id.startsWith("pending") && wsCallId != ui.id) {
            if (wsCallId.isNotBlank()) KpSocket.leaveCall(wsCallId)
            wsCallId = ui.id
            KpSocket.joinCall(ui.id)
        }
        // Caller side: ringback tone so the waiting isn't silent.
        if (!incoming && status == "RINGING") {
            CallSounds.startRingback(app)
        }
        if (incoming && status == "RINGING" && !suppressed) {
            if (ringingId != ui.id) {
                ringingId = ui.id
                // Owner round 22: a NEW incoming ring always brings the
                // fullscreen UI back — `minimized` used to survive from the
                // previous call, so in-app the ring only ever showed as a
                // notification ("app er vetor thakle fullscreen ashe na").
                minimized = false
                // Sweep the plain FCM payload card ONCE, immediately before our
                // own ringing UI takes over. It used to run on EVERY poll tick
                // (~2s) and `cancelSystemCallCards` also matches CATEGORY_CALL —
                // i.e. our own heads-up card — while the re-post below was
                // skipped because ringingId was already set. Net effect: the
                // incoming-call notification appeared and then erased itself
                // 2 seconds later ("call receive er notification 2 seconds por
                // auto chole jai"). Now the sweep happens exactly once, before
                // the post, so the card lives for the whole ring.
                KpNotify.cancelSystemCallCards(app)
                CallSounds.startRing(app)
                CallNotify.incoming(
                    app,
                    if (ui.group) "${ui.starterName} · ${ui.otherName}" else ui.otherName,
                    ui.kind == "VIDEO",
                    ui.id,
                )
            }
            if (ui.kind == "VIDEO" && videoTrack == null) {
                withContext(Dispatchers.IO) { runCatching { capture(true) } }
            }
        }
        if (autoAnswer) {
            // Jump straight past the ringing screen into the connecting state.
            if (active?.status != "ACTIVE") {
                active = ui.copy(status = "ACTIVE", startedAt = 0L, connecting = true)
            }
            if (pendingAccept) {
                pendingAccept = false
                answer()
            }
        }
        if (status == "ACTIVE") {
            CallSounds.stopRingback()
            clearIncomingSuppression()
            if (ringingId != null) {
                CallNotify.cancelIncoming(app)
                ringingId = null
            }
            CallService.start(app, "In a call with ${ui.otherName}")
        }
        if (isGroup) {
            // Owner round 32 (item 5c): each member's camera flag from the row
            // (the safety net for a `media` frame that arrived while asleep).
            next.optJSONObject("media")?.let { media ->
                val me = Store.myId()
                for (peerId in media.keys()) {
                    if (peerId == me) continue
                    val m = media.optJSONObject(peerId) ?: continue
                    if (!m.has("camera")) continue
                    val camera = m.optBoolean("camera")
                    if (groupCameraOff[peerId] != !camera) applyGroupPeerMedia(peerId, camera, next.optString("kind"))
                }
            }
            // Owner round 32 (item 5b): the mesh follows the member list —
            // offer to newcomers, answer their offers, drop leavers.
            if (status == "ACTIVE" && myState == "JOINED") groupSync(ui)
            return
        }
        if (status == "ACTIVE") {
            val answer = next.optIso("answerSdp").orEmpty()
            if (answer.isNotBlank() && pc?.remoteDescription == null && pc != null) {
                runCatching {
                    pc?.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.ANSWER, answer))
                }
            }
        }
        if (status == "ACTIVE" || status == "RINGING") pullIce(ui.id)
        if (status == "ACTIVE") {
            rebindRemoteVideo()
            handleRenegotiation(next)
        }
    }

    /**
     * Owner round 32 (item 5b): start a GROUP call in [convId]. The server
     * rings every other member; media is a mesh that forms as they join (see
     * [groupSync]) — so unlike a 1:1 call there is no offer to post here.
     */
    fun startGroupCall(convId: String, kind: String, title: String, avatarRef: String = "") {
        if (active != null) {
            if (!hasRemote && System.currentTimeMillis() - activeSince > 2 * 60_000L) {
                hangupLocal()
            } else {
                return
            }
        }
        minimized = false
        left.set(false)
        hasRemote = false
        resetPeerMedia()
        onHold = false
        relayRetryUsed = false
        renegotiationQueued.set(false)
        val start = AudioRouter.begin(app, kind)
        audioRoute = start
        speaker = start == AudioRoute.SPEAKER
        ensureFactory(app)
        VoiceIsolation.prepare(app)
        activeSince = System.currentTimeMillis()
        active = CallUi("pending", kind, "RINGING", false, title, convId, otherAvatar = avatarRef, group = true)
        CallService.start(app, if (kind == "VIDEO") "Video calling $title" else "Calling $title")
        scope.launch {
            try {
                val streamOk = withContext(Dispatchers.IO) { capture(kind == "VIDEO") }
                if (!streamOk || left.get()) return@launch
                publishChange()
                val created =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/calls/group",
                            JSONObject().put("conversationId", convId).put("kind", kind),
                        )
                    }
                val call = created.optJSONObject("call") ?: JSONObject()
                val callId = call.optString("id")
                if (left.get()) {
                    withContext(Dispatchers.IO) { runCatching { Api.post("/api/calls/$callId/end") } }
                    hangupLocal()
                    return@launch
                }
                iceCallId = callId
                if (callId.isNotBlank() && wsCallId != callId) {
                    if (wsCallId.isNotBlank()) KpSocket.leaveCall(wsCallId)
                    wsCallId = callId
                    KpSocket.joinCall(callId)
                }
                // Already running (someone else started it a moment ago): we
                // are a joiner, not the starter — go straight in.
                if (created.optBoolean("existing")) {
                    active = active?.copy(id = callId, status = "ACTIVE", connecting = true, incoming = true)
                    joinGroup(callId)
                    return@launch
                }
                val prev = active
                if (prev != null && prev.id == callId && prev.status == "ACTIVE") return@launch
                active =
                    CallUi(
                        callId,
                        kind,
                        call.optString("status").ifBlank { "RINGING" },
                        false,
                        title,
                        convId,
                        otherAvatar = avatarRef,
                        group = true,
                        participants = call.arr("participants").objects(),
                    )
                // Owner round 32 (item 5c): a video start tells the others our
                // camera is on (their grid shows the picture, not the avatar).
                if (cameraLive) postMedia(camera = true)
            } catch (e: Exception) {
                notify((e as? ApiException)?.message ?: "Couldn't start the call. Try again.")
                hangupLocal()
            }
        }
    }

    /** POST /join, then let the next tick's [groupSync] build the mesh. */
    private suspend fun joinGroup(callId: String) {
        val joined =
            withContext(Dispatchers.IO) { runCatching { Api.post("/api/calls/$callId/join") }.getOrNull() }
        val call = joined?.optJSONObject("call")
        if (call == null) {
            answering.set(false)
            notify("Couldn't connect the call. Try again.")
            hangupLocal()
            return
        }
        answering.set(false)
        runCatching {
            val ms = java.time.Instant.parse(call.optIso("startedAt")).toEpochMilli()
            if (ms > 0L) active = active?.copy(startedAt = ms)
        }
        active = active?.copy(status = "ACTIVE", participants = call.arr("participants").objects())
        publishChange()
        if (cameraLive) postMedia(camera = true)
        pokeTick()
    }

    /**
     * One pass of mesh maintenance for a group call we are JOINED on:
     *  - every OTHER joined member without a connection gets one; the side
     *    with the lexically smaller id offers (deterministic, no glare);
     *  - offers addressed to us are answered; answers to ours are applied;
     *  - candidates addressed to us go to the right connection;
     *  - members who left / declined have their connection closed.
     * Serialized: a tick that arrives while a pass is running is skipped —
     * the next one (they are frequent) finishes the job.
     */
    private suspend fun groupSync(ui: CallUi) {
        if (!groupSyncing.compareAndSet(false, true)) return
        try {
            val me = Store.myId()
            val others = ui.joined.map { it.optString("id") }.filter { it.isNotBlank() && it != me }.toSet()
            // Leavers: close and forget.
            for (gone in groupPeers.keys.filter { it !in others }) {
                groupPeers.remove(gone)?.let { runCatching { it.close() } }
                groupOffered.remove(gone)
                groupAnswered.remove(gone)
                dropGroupVideo(gone)
            }
            if (groupPeers.isEmpty() && others.isEmpty()) {
                // Alone on the call: media is not live.
                if (hasRemote) { hasRemote = false; publishChange() }
            }
            // Newcomers we should offer to.
            for (peerId in others) {
                if (me < peerId && peerId !in groupOffered) {
                    groupOffered.add(peerId)
                    val peer = groupPeers.getOrPut(peerId) { newGroupPc(peerId) }
                    runCatching {
                        val offer = peer.createOfferAwait(sdpConstraints())
                        peer.setLocalDescriptionAwait(offer)
                        withContext(Dispatchers.IO) {
                            Api.post(
                                "/api/calls/${ui.id}/peer",
                                JSONObject().put("to", peerId).put("sdp", offer.description),
                            )
                        }
                    }.onFailure { groupOffered.remove(peerId) }
                }
            }
            // Their offers / their answers.
            val rows =
                withContext(Dispatchers.IO) { runCatching { Api.get("/api/calls/${ui.id}/peer", true) }.getOrNull() }
                    ?.arr("items")?.objects().orEmpty()
            for (row in rows) {
                val from = row.optString("from")
                val to = row.optString("to")
                val offerSdp = row.optIso("offerSdp").orEmpty()
                val answerSdp = row.optIso("answerSdp").orEmpty()
                if (to == me && from in others && offerSdp.isNotBlank() && groupAnswered[from] != offerSdp) {
                    // Answer their offer (a fresh offer from the same peer = a
                    // rebuilt connection on their side: rebuild ours too).
                    groupAnswered[from] = offerSdp
                    val stale = groupPeers.remove(from)
                    stale?.let { runCatching { it.close() } }
                    val peer = newGroupPc(from)
                    groupPeers[from] = peer
                    runCatching {
                        peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, offerSdp))
                        // Owner round 32 (item 5c): keep the video m-line two-way
                        // so a camera can be swapped in later on either side.
                        peer.transceivers
                            .firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                            ?.let { t ->
                                if (t.direction != RtpTransceiver.RtpTransceiverDirection.SEND_RECV) {
                                    runCatching { t.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_RECV) }
                                }
                            }
                        val answer = peer.createAnswerAwait(sdpConstraints())
                        peer.setLocalDescriptionAwait(answer)
                        withContext(Dispatchers.IO) {
                            Api.post(
                                "/api/calls/${ui.id}/peer",
                                JSONObject().put("to", from).put("sdp", answer.description).put("answer", true),
                            )
                        }
                    }.onFailure { groupAnswered.remove(from) }
                } else if (from == me && to in others && answerSdp.isNotBlank()) {
                    val peer = groupPeers[to] ?: continue
                    if (peer.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                        runCatching {
                            peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.ANSWER, answerSdp))
                        }
                    }
                }
            }
            // Candidates addressed to us, routed by sender.
            val ice =
                withContext(Dispatchers.IO) { runCatching { Api.get("/api/calls/${ui.id}/ice") }.getOrNull() }
                    ?.arr("items")?.objects().orEmpty()
            for (item in ice) {
                val id = item.optString("id")
                if (id.isNotBlank() && id in seenIce) continue
                val peer = groupPeers[item.optString("from")] ?: continue
                if (peer.remoteDescription == null) continue
                val c = item.optJSONObject("candidate") ?: continue
                val cand = c.optString("candidate")
                if (cand.isBlank()) continue
                runCatching {
                    peer.addIceCandidate(IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), cand))
                    if (id.isNotBlank()) seenIce.add(id)
                }
            }
        } finally {
            groupSyncing.set(false)
        }
    }

    /**
     * A mesh leg to one group member: our shared audio track goes out, their
     * audio plays through the same route as a 1:1 call. Candidates are posted
     * addressed to [peerId]; the first connected leg marks media live.
     */
    private fun newGroupPc(peerId: String): PeerConnection {
        val rtc =
            PeerConnection.RTCConfiguration(iceServers()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
                iceCandidatePoolSize = 1
                tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
                iceTransportsType = PeerConnection.IceTransportsType.ALL
            }
        val peer =
            factory!!.createPeerConnection(
                rtc,
                object : PeerConnection.Observer {
                    override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
                    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                        when (state) {
                            PeerConnection.IceConnectionState.CONNECTED,
                            PeerConnection.IceConnectionState.COMPLETED,
                            -> Handler(Looper.getMainLooper()).post {
                                val cur = active ?: return@post
                                hasRemote = true
                                active = cur.copy(
                                    connecting = false,
                                    startedAt = if (cur.startedAt > 0L) cur.startedAt else System.currentTimeMillis(),
                                )
                                publishChange()
                                updateProximityLock()
                                CallService.start(app, "In a call with ${cur.otherName}")
                            }
                            PeerConnection.IceConnectionState.FAILED ->
                                Handler(Looper.getMainLooper()).post {
                                    // One leg failed: drop it; the next sync
                                    // pass re-offers (the offerer side) or
                                    // re-answers their fresh offer.
                                    groupPeers.remove(peerId)?.let { runCatching { it.close() } }
                                    groupOffered.remove(peerId)
                                    groupAnswered.remove(peerId)
                                    pokeTick()
                                }
                            else -> {}
                        }
                    }
                    override fun onIceConnectionReceivingChange(p0: Boolean) {}
                    override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
                    override fun onIceCandidate(c: IceCandidate?) {
                        if (c == null) return
                        val callId = iceCallId
                        if (callId.isBlank() || callId.startsWith("pending")) return
                        val payload =
                            JSONObject()
                                .put("candidate", c.sdp)
                                .put("sdpMid", c.sdpMid)
                                .put("sdpMLineIndex", c.sdpMLineIndex)
                        val body = JSONObject().put("candidate", payload).put("to", peerId)
                        scope.launch(Dispatchers.IO) {
                            runCatching { Api.post("/api/calls/$callId/ice", body) }
                        }
                    }
                    override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
                    override fun onAddStream(p0: MediaStream?) {}
                    override fun onRemoveStream(p0: MediaStream?) {}
                    override fun onDataChannel(p0: DataChannel?) {}
                    override fun onRenegotiationNeeded() {}
                    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                        val track = receiver?.track()
                        // Owner round 32 (item 5c): their camera, keyed by member.
                        if (track is VideoTrack) bindGroupRemote(peerId, track)
                        if (track is AudioTrack) {
                            track.setEnabled(true)
                            Handler(Looper.getMainLooper()).post { applyAudio() }
                        }
                    }
                },
            )!!
        audioTrack?.let { peer.addTrack(it, listOf("kp")) }
        // Owner round 32 (item 5c): the camera rides the leg when it is already
        // on; otherwise a sendrecv video m-line waits for it (setTrack later
        // needs no renegotiation — the same shape a 1:1 voice call negotiates).
        val cam = videoTrack
        if (cam != null) {
            peer.addTrack(cam, listOf("kp"))
        } else {
            runCatching {
                peer.addTransceiver(
                    MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                    RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV),
                )
            }
        }
        return peer
    }

    private fun dropGroupVideo(peerId: String) {
        val track = groupRemoteVideo.remove(peerId)
        val view = groupRemoteViews[peerId]
        if (track != null && view != null) runCatching { track.removeSink(view) }
        groupFramesSeen.remove(peerId)
        groupCameraOff.remove(peerId)
        groupVideoVersion++
    }

    fun startCall(userId: String, kind: String, name: String, avatar: String = "") {
        if (active != null) {
            // Owner round 24: a call that died server-side while this process
            // was frozen left `active` set forever — every NEW call then hit
            // this return and the caller's screen never came up ("je user call
            // dei se call screen dekhte pai na"). A stuck call with no media
            // for 2+ minutes is a zombie: clear it and take the new call.
            if (!hasRemote && System.currentTimeMillis() - activeSince > 2 * 60_000L) {
                hangupLocal()
            } else {
                return
            }
        }
        minimized = false
        left.set(false)
        hasRemote = false
        resetPeerMedia()
        onHold = false
        // Fresh call, fresh relay-retry budget (see the ICE FAILED branch).
        relayRetryUsed = false
        renegotiationQueued.set(false)
        // Start wherever the user's audio actually is: a connected
        // headset/earbud wins for voice AND video; else video on the speaker,
        // voice on the earpiece. Also starts the hot-plug watch.
        val start = AudioRouter.begin(app, kind)
        audioRoute = start
        speaker = start == AudioRoute.SPEAKER
        ensureFactory(app)
        VoiceIsolation.prepare(app)
        activeSince = System.currentTimeMillis()
        active = CallUi("pending", kind, "RINGING", false, name, userId, otherAvatar = avatar)
        CallService.start(app, if (kind == "VIDEO") "Video calling $name" else "Calling $name")
        scope.launch {
            try {
                val streamOk = withContext(Dispatchers.IO) { capture(kind == "VIDEO") }
                if (!streamOk || left.get()) return@launch
                publishChange()
                val peer = newPc()
                val offer = peer.createOfferAwait(sdpConstraints())
                peer.setLocalDescriptionAwait(offer)
                val created =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/calls",
                            JSONObject().put("userId", userId).put("kind", kind).put("offerSdp", offer.description),
                        )
                    }
                val call = created.optJSONObject("call") ?: JSONObject()
                if (left.get()) {
                    withContext(Dispatchers.IO) {
                        runCatching { Api.post("/api/calls/${call.optString("id")}/end") }
                    }
                    hangupLocal()
                    return@launch
                }
                iceCallId = call.optString("id")
                if (iceCallId.isNotBlank() && wsCallId != iceCallId) {
                    if (wsCallId.isNotBlank()) KpSocket.leaveCall(wsCallId)
                    wsCallId = iceCallId
                    KpSocket.joinCall(iceCallId)
                }
                flushIce()
                // If the other side answered while the offer was still being
                // posted (fast accept), the poll already flipped us ACTIVE —
                // don't clobber that back to RINGING here.
                val prev = active
                if (prev != null && prev.id == iceCallId && prev.status == "ACTIVE") return@launch
                active =
                    CallUi(
                        iceCallId,
                        kind,
                        "RINGING",
                        false,
                        name,
                        userId,
                        otherAvatar = avatar,
                    )
            } catch (e: Exception) {
                val api = e as? ApiException
                val message = api?.message ?: "Couldn't start the call. Try again."
                if (api?.status == 486) {
                    // Owner round 12 (2026-09-05): the callee is already on a
                    // call — show "Line busy" ON the calling screen for a beat
                    // (no endless ringing) before it closes. 486 = LINE_BUSY
                    // from POST /api/calls.
                    // Owner round 21: his line-busy sound.
                    runCatching { KpSounds.lineBusy(app) }
                    CallSounds.stopRingback()
                    active = active?.copy(status = "BUSY")
                    publishChange()
                    delay(2200)
                }
                notify(message)
                hangupLocal()
            }
        }
    }

    fun answer() {
        minimized = false
        // A stale true from a previous call would drop this side straight
        // onto the in-call screen instead of ringing.
        hasRemote = false
        resetPeerMedia()
        val rec = active
        if (rec == null || rec.id.startsWith("pending")) {
            pendingAccept = true
            return
        }
        if (pc != null && rec.status == "ACTIVE") return
        if (!answering.compareAndSet(false, true)) return
        CallNotify.cancelIncoming(app)
        ringingId = null
        clearIncomingSuppression()
        ensureFactory(app)
        VoiceIsolation.prepare(app)
        // Same rule as the caller: a connected personal output first, else
        // video → speaker, audio → earpiece.
        val start = AudioRouter.begin(app, rec.kind)
        audioRoute = start
        speaker = start == AudioRoute.SPEAKER
        CallService.start(app, "In a call with ${rec.otherName}")
        // startedAt stays 0 (unknown): the timer runs from the SERVER's
        // started_at (parsed from the answer response / poll) so both phones
        // show the exact same duration.
        active = rec.copy(status = "ACTIVE", startedAt = 0L, connecting = true)
        // Owner round 32 (item 5b): picking up a GROUP ring = /join; the mesh
        // legs are negotiated by groupSync() on the ticks that follow.
        if (rec.group) {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { capture(rec.kind == "VIDEO") } }
                iceCallId = rec.id
                joinGroup(rec.id)
            }
            return
        }
        scope.launch {
            try {
                // `repeat(24) { ... return@repeat }` here NEVER left the loop —
                // return@repeat only skips one iteration, so the callee kept
                // re-fetching for the whole 6s while ITS OWN screen already
                // showed "connected". The caller kept hearing the ringtone the
                // whole time because the answer wasn't on the server yet.
                // Opening the camera (a cold one costs 300-900ms) used to sit
                // between the Accept tap and the SDP answer, so the caller kept
                // hearing ringback on "Connecting…" for that whole time. Start
                // capture now, in parallel with fetching the offer, and join
                // before the answer is built.
                val capturing = async(Dispatchers.IO) { runCatching { capture(rec.kind == "VIDEO") } }
                var offer = ""
                for (attempt in 0 until 100) {
                    offer =
                        withContext(Dispatchers.IO) {
                            Api.get("/api/calls/active", true).arr("items").objects()
                                .find { it.optString("id") == rec.id }
                                ?.optIso("offerSdp")
                                .orEmpty()
                        }
                    if (offer.isNotBlank() || left.get()) break
                    // 250ms was a full extra poll-tick of latency on the answer
                    // path for no benefit: the offer is already on the server by
                    // the time the callee taps Accept in the overwhelming
                    // majority of cases, so this loop usually runs once.
                    delay(120)
                }
                if (offer.isBlank() || left.get()) {
                    capturing.await()
                    answering.set(false)
                    hangupLocal()
                    return@launch
                }
                capturing.await()
                iceCallId = rec.id
                val peer = newPc()
                peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, offer))
                // Belt & braces: the answering side must also offer to SEND
                // video from the start — a recvonly answer would make any
                // later camera/screen track silently droppable.
                runCatching {
                    peer.transceivers
                        .firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                        ?.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_RECV)
                }
                val answer = peer.createAnswerAwait(sdpConstraints())
                peer.setLocalDescriptionAwait(answer)
                flushIce()
                val answered =
                    withContext(Dispatchers.IO) {
                        Api.post("/api/calls/${rec.id}/answer", JSONObject().put("answerSdp", answer.description))
                    }
                // Adopt the server clock for the call timer (both sides identical).
                runCatching {
                    val ms = java.time.Instant.parse(answered.optJSONObject("call")?.optIso("startedAt")).toEpochMilli()
                    if (ms > 0L) {
                        // Answer time is the shared timer base, but media may
                        // not be connected yet. Keep the UI on Connecting
                        // until ICE explicitly reports CONNECTED/COMPLETED.
                        active = active?.copy(startedAt = ms, connecting = true)
                        publishChange()
                    }
                }
                pullIce(rec.id)
            } catch (e: Exception) {
                answering.set(false)
                notify("Couldn't connect the call. Try again.")
                hangupLocal()
            }
        }
    }

    fun decline() {
        val id = active?.id
        CallNotify.cancelIncoming(app)
        ringingId = null
        clearIncomingSuppression()
        if (id != null) {
            ignoredCalls.add(id)
            scope.launch(Dispatchers.IO) { runCatching { Api.post("/api/calls/$id/decline") } }
        }
        hangupLocal()
    }

    /** "Message" from the incoming screen: decline + send a quick reply. */
    fun sendQuickReply(call: CallUi, text: String) {
        if (call.otherId.isBlank()) return
        scope.launch(Dispatchers.IO) {
            runCatching {
                // Owner round 32 (item 5b): on a group call otherId IS the chat.
                val convId =
                    if (call.group) call.otherId
                    else Api.post("/api/conversations", JSONObject().put("userId", call.otherId))
                        .optJSONObject("conversation")?.optString("id")
                Api.post("/api/conversations/$convId/messages", JSONObject().put("body", text))
            }
        }
    }

    val appContext: Application get() = app

    fun hangup() {
        val rec = active
        left.set(true)
        rec?.id?.let { ignoredCalls.add(it) }
        val id = rec?.id
        val seconds =
            if ((rec?.startedAt ?: 0L) > 0L) ((System.currentTimeMillis() - rec!!.startedAt) / 1000).toInt() else 0
        hangupLocal()
        if (id != null && !id.startsWith("pending")) {
            scope.launch(Dispatchers.IO) {
                runCatching { Api.post("/api/calls/$id/end", JSONObject().put("seconds", seconds)) }
            }
        }
    }

    fun toggleMute() {
        muted = !muted
        onHold = false
        audioTrack?.setEnabled(!muted)
        publishChange()
    }

    fun toggleHold() {
        onHold = !onHold
        if (onHold) muted = false
        audioTrack?.setEnabled(!(onHold || muted))
        publishChange()
    }

    fun toggleSpeaker() {
        // The old blind earpiece↔speaker flip ignored Bluetooth/wired
        // headsets entirely; the button now cycles every available output.
        cycleAudioRoute()
    }

    fun toggleCamera() {
        if (sharing) return
        if (active?.group == true) {
            // Owner round 32 (item 5c): one camera, every leg — the track goes
            // into each connection's video sender (setTrack, no renegotiation),
            // the row is re-labelled VIDEO through /media so everyone's screen
            // switches to the grid.
            scope.launch {
                if (videoTrack == null) {
                    withContext(Dispatchers.IO) { runCatching { capture(true) } }
                    val track = videoTrack
                    if (track == null) {
                        cameraOff = true
                        notify("Camera couldn't start. Please try again.")
                        return@launch
                    }
                    for (peer in groupPeers.values) {
                        val sender =
                            peer.senders.find { it.track()?.kind() == "video" }
                                ?: peer.transceivers
                                    .firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                                    ?.sender
                        runCatching { if (sender != null) sender.setTrack(track, true) else peer.addTrack(track, listOf("kp")) }
                    }
                    localView?.let { runCatching { track.addSink(it) } }
                    cameraOff = false
                } else {
                    cameraOff = !cameraOff
                    videoTrack?.setEnabled(!cameraOff)
                }
                if (!cameraOff && active?.kind != "VIDEO") {
                    active = active?.copy(kind = "VIDEO")
                    markVideoRoute()
                }
                publishChange()
                postMedia(camera = !cameraOff)
            }
            return
        }
        if (videoTrack == null) {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { capture(true) } }
                if (videoTrack == null) {
                    // No capturer (permission denied, enumeration failed, the
                    // surface is gone). capture() left cameraOff true; say so
                    // instead of flipping the call to a VIDEO label with nothing
                    // behind it — that is the "opponent kichu dekhe na" case.
                    cameraOff = true
                    notify("Camera couldn't start. Please try again.")
                    return@launch
                }
                videoTrack?.let { track ->
                    val sender = pc?.senders?.find { it.track()?.kind() == "video" }
                        ?: // Voice call: reuse the always-present sendrecv video
                           // transceiver (addTrack would need renegotiation).
                        pc?.transceivers
                            ?.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                            ?.sender
                    if (sender != null) sender.setTrack(track, true) else pc?.addTrack(track)
                    localView?.let { runCatching { track.addSink(it) } }
                }
                cameraOff = false
                active = active?.copy(kind = "VIDEO")
                // Audio→video conversion: speaker becomes the default (user
                // rule), Bluetooth/wired headsets keep the audio.
                markVideoRoute()
                // Every other transition publishes and this one used not to: the
                // call UI and §31's Telecom record kept the AUDIO shape after the
                // tap, so the call "never converted" locally while the frames were
                // already flowing to the peer.
                publishChange()
                // Owner round 31 item 19: the row becomes VIDEO server-side, so
                // the other phone converts too (not just this one's memory).
                postMedia(camera = true)
            }
            return
        }
        cameraOff = !cameraOff
        videoTrack?.setEnabled(!cameraOff)
        if (!cameraOff && active?.kind == "AUDIO") {
            active = active?.copy(kind = "VIDEO")
            markVideoRoute()
        }
        publishChange()
        postMedia(camera = !cameraOff)
    }

    fun toggleShare() {
        if (active?.group == true) {
            notify("Screen share isn't available on group calls yet.")
            return
        }
        if (active == null || pc == null) {
            // A call and a connected peer are all that is needed: startShare()
            // swaps its track into the sendrecv video transceiver that every
            // call — voice included — already negotiated, so sharing on a voice
            // call IS the way that call becomes a video call. The old message
            // ("start a video call first") refused exactly the request the user
            // reported: "voice call e screen share start korle convert hoy na".
            notify("Start a call first to share your screen.")
            return
        }
        if (sharing) {
            stopShare()
            return
        }
        MainActivity.current?.askShare { code, data ->
            if (code == Activity.RESULT_OK && data != null) {
                scope.launch {
                    runCatching { startShare(data) }
                        .onSuccess {
                            if (sharing) {
                                android.widget.Toast.makeText(
                                    app,
                                    "You're Sharing Your Screen",
                                    android.widget.Toast.LENGTH_LONG,
                                ).show()
                                MainActivity.current?.moveTaskToBack(true)
                            } else {
                                // Announced early, never started: take it back
                                // or the other phone keeps an empty preview.
                                postMedia(screen = false)
                            }
                        }
                        .onFailure {
                        postMedia(screen = false)
                        // Named so the user's next report tells us exactly
                        // which stage broke (service/FGS/projection/capturer).
                        notify("Screen share failed (${it.javaClass.simpleName}). Please try again.")
                    }
                }
            }
        }
    }

    private var cameraBeforeShare = false
    private var routeBeforeShare = AudioRoute.EARPIECE

    private suspend fun startShare(data: Intent) {
        // Owner round 21: his screen-share sound (plays when it really starts).
        runCatching { KpSounds.screenShare(app) }
        // Owner round 31 item 19: announce BEFORE the first frame can leave, so
        // the other phone knows this video is a screen (preview card on its
        // voice UI) and not a camera (which would switch it to the video UI).
        cameraBeforeShare = cameraLive
        routeBeforeShare = audioRoute
        postMedia(camera = false, screen = true)
        // Android 14+: the foreground service must re-declare the
        // mediaProjection type BEFORE getMediaProjection() is called, so
        // restart the service with share=true and wait for it to be ready.
        CallService.start(app, "Sharing screen", share = true)
        var waits = 0
        while (!CallService.fgReady.get() && waits++ < 60) delay(50)
        if (!CallService.fgReady.get()) {
            notify("Screen share couldn't start. Try again.")
            return
        }
        try {
            capturer?.stopCapture()
        } catch (_: Exception) {
        }
        capturer?.dispose()
        videoTrack?.let { track -> localView?.let { runCatching { track.removeSink(it) } } }
        val screen =
            KpScreenCapturer(app, data) {
                scope.launch { if (sharing) stopShare() }
            }
        val src = factory?.createVideoSource(true) ?: return
        val nextHelper = SurfaceTextureHelper.create("kp-share", egl.eglBaseContext)
        screen.initialize(nextHelper, app, src.capturerObserver)
        screen.startCapture(720, 1280, 20)
        val track = factory!!.createVideoTrack("kp-share", src)
        val sender = pc?.senders?.find { it.track()?.kind() == "video" }
            ?: // Voice call: the always-created sendrecv video transceiver
               // provides the sender — no renegotiation needed.
            pc?.transceivers
                ?.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                ?.sender
        if (sender != null) sender.setTrack(track, true) else pc?.addTrack(track)
        helper?.dispose()
        helper = nextHelper
        runCatching { videoSource?.dispose() }
        videoSource = src
        videoTrack = track
        capturer = screen
        sharing = true
        cameraOff = false
        localView?.setMirror(false)
        localView?.let { runCatching { track.addSink(it) } }
        // The call's KIND is not touched here (owner round 31 item 19): a
        // shared screen on a voice call keeps the voice UI on both phones —
        // the other side gets the preview card. Only a camera converts.
        markVideoRoute()
        // stopShare published and startShare did not, so a screen shared on a
        // voice call left the other phone on its voice screen — no renderer, no
        // path to the share at all — until an unrelated re-render saved it.
        publishChange()
    }

    private fun stopShare() {
        sharing = false
        try {
            capturer?.stopCapture()
        } catch (_: Exception) {
        }
        capturer?.dispose()
        capturer = null
        videoTrack?.let { track -> localView?.let { runCatching { track.removeSink(it) } } }
        runCatching { videoSource?.dispose() }
        videoSource = null
        helper?.dispose()
        helper = null
        videoTrack = null
        // Owner round 31 item 19: the camera comes back only if it was on
        // before the share. On a voice call it was not — re-opening it here
        // used to turn "stop sharing" into a video call nobody asked for.
        capture(cameraBeforeShare)
        val sender = pc?.senders?.find { it.track()?.kind() == "video" }
            ?: pc?.transceivers
                ?.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                ?.sender
        val track = videoTrack
        if (track != null) {
            if (sender != null) sender.setTrack(track, true) else pc?.addTrack(track)
            localView?.setMirror(currentFacingFront)
            localView?.let { runCatching { track.addSink(it) } }
        } else {
            runCatching { sender?.setTrack(null, false) }
            if (active?.kind != "VIDEO") {
                // Still a voice call: the share moved the sound to the speaker
                // (markVideoRoute); put it back where it was before the share.
                AudioRouter.setVideoCall(false)
                if (audioRoute != routeBeforeShare) selectAudioRoute(routeBeforeShare)
            }
        }
        publishChange()
        postMedia(camera = track != null, screen = false)
    }

    fun attachLocal(view: SurfaceViewRenderer) {
        if (localView !== view) {
            localView?.let { old -> videoTrack?.let { runCatching { it.removeSink(old) } } }
            runCatching { view.init(egl.eglBaseContext, null) }
            view.setMirror(currentFacingFront && !sharing)
            view.setEnableHardwareScaler(true)
            localView = view
        }
        videoTrack?.let { runCatching { it.addSink(view) } }
    }

    fun attachRemote(view: SurfaceViewRenderer) {
        if (remoteView !== view) {
            remoteView?.let { old -> remoteVideo?.let { runCatching { it.removeSink(old) } } }
            runCatching { view.init(egl.eglBaseContext, null) }
            view.setMirror(false)
            view.setEnableHardwareScaler(true)
            remoteView = view
        }
        remoteVideo?.let { runCatching { it.addSink(view) } }
    }

    fun detachLocal(view: SurfaceViewRenderer) {
        videoTrack?.let { runCatching { it.removeSink(view) } }
        if (localView === view) localView = null
    }

    fun detachRemote(view: SurfaceViewRenderer) {
        remoteVideo?.let { runCatching { it.removeSink(view) } }
        if (remoteView === view) remoteView = null
    }

    private fun hangupLocal() {
        CallSounds.stopRingback()
        CallNotify.cancelAll(app)
        CallService.stop(app)
        ringingId = null
        try {
            capturer?.stopCapture()
        } catch (_: Exception) {
        }
        capturer?.dispose()
        capturer = null
        helper?.dispose()
        helper = null
        audioSource?.dispose()
        audioSource = null
        videoSource?.dispose()
        videoSource = null
        localView?.let { v ->
            videoTrack?.let { runCatching { it.removeSink(v) } }
            runCatching { v.release() }
        }
        remoteView?.let { v ->
            remoteVideo?.let { runCatching { it.removeSink(v) } }
            runCatching { v.release() }
        }
        audioTrack = null
        videoTrack = null
        remoteVideo = null
        localView = null
        remoteView = null
        pc?.close()
        pc = null
        // Owner round 32 (item 5b): every mesh leg goes with the call.
        groupPeers.values.forEach { runCatching { it.close() } }
        groupPeers.clear()
        groupOffered.clear()
        groupAnswered.clear()
        groupRemoteVideo.clear()
        groupRemoteViews.clear()
        groupFramesSeen.clear()
        groupCameraOff.clear()
        groupVideoVersion++
        seenIce.clear()
        iceWatchdog?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        iceWatchdog = null
        speaker = false
        audioRoute = AudioRoute.EARPIECE
        proximityLock?.let { if (it.isHeld) runCatching { it.release() } }
        proximityLock = null
        // Release the audio stack: clear the communication device, close SCO,
        // drop out of MODE_IN_COMMUNICATION, stop watching for hot-plug.
        AudioRouter.end(app)
        VoiceIsolation.release()
        muted = false
        cameraOff = false
        sharing = false
        onHold = false
        hasRemote = false
        resetPeerMedia()
        frameGate = null
        netFailStreak = 0
        outgoingRingAt = 0L
        iceCallId = ""
        if (wsCallId.isNotBlank()) {
            KpSocket.leaveCall(wsCallId)
            wsCallId = ""
        }
        pendingIce.clear()
        left.set(false)
        answering.set(false)
        pendingAccept = false
        clearIncomingSuppression()
        Handler(Looper.getMainLooper()).post { MainActivity.current?.restoreChrome() }
        // Owner round 33 (item 2): the Calls tab learns about the row this
        // call just left behind (its own history GET, forced). A beat later,
        // so the /end POST that follows hangupLocal() has landed first.
        if (active != null) Handler(Looper.getMainLooper()).postDelayed({ ScreenStore.pokeCalls() }, 1_500)
        active = null
        // Publishing here as well (not only from the callers that reach hangupLocal by
        // accident) is what guarantees the §31 mirror cannot outlive the call: the poll
        // path drops a row that ENDED on the server without going through hangup().
        publishChange()
    }

    /**
     * STUN for same-network calls + a public TURN relay so calls also
     * connect across mobile networks (CGNAT), where STUN-only P2P fails.
     */
    /**
     * ICE servers.
     *
     * The two TURN entries were bare `turn:host:port`, which in a WebRTC URL
     * means UDP - so nothing in the list ever used the TCP or TLS listeners.
     * Probing the host directly (kp-lab/turncheck.py) showed TCP/80 answering
     * plain TURN as METERED-TURN-SERVER with realm metered.ca, and TCP/443
     * terminating TLS with a CN=*.relay.metered.ca certificate. The UDP
     * listeners could not be verified from that network, so they are kept and
     * the measured TCP and TLS transports are added alongside them: more
     * candidates, and relay now has a path that works where UDP is blocked or
     * throttled, which is common on mobile networks.
     */
    private fun iceServers(): List<PeerConnection.IceServer> =
        customTurnServers() + builtInIceServers()

    /** Built-ins: public STUN + the free openrelay TURN as a last resort. */
    private fun builtInIceServers(): List<PeerConnection.IceServer> =
        listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer(),
            // Owner round 12 (2026-09-05): carrier NATs (mobile data) need a
            // TURN relay on TCP/443. The openrelay free service got flaky, so
            // Nextcloud's public relay (tcp+udp on 443) leads the list now.
            PeerConnection.IceServer.builder("turn:turn.nextcloud.com:443?transport=tcp")
                .setUsername("nextcloud")
                .setPassword("nextcloud")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:turn.nextcloud.com:443")
                .setUsername("nextcloud")
                .setPassword("nextcloud")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:standard.relay.metered.ca:80")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:80")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:443")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:80?transport=tcp")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turns:openrelay.metered.ca:443?transport=tcp")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
        )

    /**
     * Same relays, minus the STUN-only entries and TCP/TLS-first: used for the
     * single automatic retry after ICE FAILED. Direct + peer-reflexive pairing
     * is what dies behind a VPN / carrier-grade NAT / restrictive networks,
     * while a relay still works there — that is the difference between "call
     * connected hoy na" and a call that connects one second later.
     */
    private fun relayFirstIceServers(): List<PeerConnection.IceServer> =
        customTurnServers() + listOf(
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:80?transport=tcp")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:443?transport=tcp")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turns:openrelay.metered.ca:443?transport=tcp")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
        )

    private fun relayConfig(): PeerConnection.RTCConfiguration =
        PeerConnection.RTCConfiguration(relayFirstIceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            iceTransportsType = PeerConnection.IceTransportsType.RELAY
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
        }

    @Volatile private var turnUrls: List<String> = emptyList()
    @Volatile private var turnUser: String = ""
    @Volatile private var turnPass: String = ""
    @Volatile private var turnLoaded: Boolean = false

    /**
     * TURN credentials served by the worker (/api/config/ice — set the
     * TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL worker secrets). Fetched
     * once at startup and placed FIRST, so a real relay beats the flaky free
     * fallbacks. Without a config the built-ins carry on as before.
     */
    private fun customTurnServers(): List<PeerConnection.IceServer> {
        if (!turnLoaded) return emptyList()
        return turnUrls.map { url ->
            PeerConnection.IceServer.builder(url)
                .setUsername(turnUser)
                .setPassword(turnPass)
                .createIceServer()
        }
    }

    fun loadIceConfig() {
        scope.launch {
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/config/ice", true) }
                val ice = data.optJSONObject("ice") ?: return@runCatching
                val arr = ice.optJSONArray("urls") ?: return@runCatching
                val urls = (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
                if (urls.isNotEmpty()) {
                    turnUrls = urls
                    turnUser = ice.optString("username")
                    turnPass = ice.optString("credential")
                    turnLoaded = true
                }
            }
        }
    }

    private var iceWatchdog: Runnable? = null

    /**
     * ICE can get permanently stuck in CHECKING on weak/asymmetric mobile
     * networks (one bar, carrier NAT) with no callback ever firing again —
     * that left the callee's screen on "Connecting…" forever with nothing
     * to recover it. If we're not CONNECTED within 12s of entering
     * CHECKING/DISCONNECTED, force an ICE restart (fresh candidates,
     * same call) instead of hanging silently.
     */
    private fun armIceWatchdog() {
        iceWatchdog?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        val callId = active?.id ?: return
        val runnable = Runnable {
            if (active?.id != callId) return@Runnable
            if (active?.connecting != true) return@Runnable
            val peer = pc ?: return@Runnable
            if (peer.iceConnectionState() == PeerConnection.IceConnectionState.CONNECTED ||
                peer.iceConnectionState() == PeerConnection.IceConnectionState.COMPLETED
            ) {
                return@Runnable
            }
            notify("Reconnecting…")
            scope.launch {
                try {
                    if (peer.signalingState() != PeerConnection.SignalingState.STABLE) return@launch
                    val constraints = sdpConstraints().apply {
                        mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
                    }
                    val offer = peer.createOfferAwait(constraints)
                    peer.setLocalDescriptionAwait(offer)
                    withContext(Dispatchers.IO) {
                        Api.post("/api/calls/$callId/reoffer", JSONObject().put("sdp", offer.description))
                    }
                    awaitingReanswer = true
                    // If the restart itself doesn't recover either, don't
                    // loop forever — one retry is enough to not leave the
                    // user stuck with no recourse but hanging up.
                } catch (_: Exception) {
                }
            }
        }
        iceWatchdog = runnable
        Handler(Looper.getMainLooper()).postDelayed(runnable, 12_000L)
    }

    /**
     * Build + send a reoffer. Returns false when it could not run yet — and
     * REMEMBERS to try again (on the answer landing, or when ICE reconnects)
     * rather than dropping the change like the old `return@launch` guards did.
     */
    private suspend fun renegotiateNow(): Boolean {
        val peer = pc ?: return false
        val id = active?.id
        if (id.isNullOrBlank() || id.startsWith("pending")) return false
        if (awaitingReanswer || peer.signalingState() != PeerConnection.SignalingState.STABLE) {
            renegotiationQueued.set(true)
            return false
        }
        val offer = peer.createOfferAwait(sdpConstraints())
        peer.setLocalDescriptionAwait(offer)
        withContext(Dispatchers.IO) {
            Api.post("/api/calls/$id/reoffer", JSONObject().put("sdp", offer.description))
        }
        awaitingReanswer = true
        renegotiationQueued.set(false)
        return true
    }

    private fun sdpConstraints() =
        MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }

    private fun newPc(): PeerConnection {
        val rtc =
            PeerConnection.RTCConfiguration(iceServers()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
                iceCandidatePoolSize = 2
                // UDP is blocked by plenty of VPNs / office & hotel Wi-Fi while
                // 443/TLS is open; without TCP candidates those networks have no
                // fallback and the call simply fails.
                tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
                iceTransportsType = PeerConnection.IceTransportsType.ALL
            }
        val peer =
            factory!!.createPeerConnection(
                rtc,
                object : PeerConnection.Observer {
                    override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
                    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                        when (state) {
                            PeerConnection.IceConnectionState.CHECKING ->
                                Handler(Looper.getMainLooper()).post { armIceWatchdog() }
                            PeerConnection.IceConnectionState.CONNECTED,
                            PeerConnection.IceConnectionState.COMPLETED,
                            -> Handler(Looper.getMainLooper()).post {
                                iceWatchdog?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
                                val cur = active ?: return@post
                                active = cur.copy(
                                    // The visible duration starts when media is
                                    // actually usable, not at answer time. This
                                    // prevents Connecting from revealing a
                                    // counter already at 0:05/0:06.
                                    connecting = false,
                                    // …but only the FIRST time media is live.
                                    // CONNECTED/COMPLETED re-fires after every ICE
                                    // restart, Wi-Fi→data handover and every
                                    // mid-call renegotiation (screen share, camera
                                    // on). Re-stamping the epoch there rewound the
                                    // running timer to 0:00 minutes into a call —
                                    // the "2 minute er beshi hole time reset hoye
                                    // jay / wrong time" report — and hangup()
                                    // derives the stored duration from the same
                                    // field, so the call HISTORY was wrong too.
                                    startedAt =
                                        if (cur.startedAt > 0L) cur.startedAt
                                        else System.currentTimeMillis(),
                                )
                                publishChange()
                                // The far side may have swapped a track in via
                                // setTrack() (screen share on a voice call),
                                // which never re-fires onAddTrack — re-detect.
                                rebindRemoteVideo()
                                if (renegotiationQueued.compareAndSet(true, false)) {
                                    scope.launch { runCatching { renegotiateNow() } }
                                }
                                // Proximity screen-off only re-evaluated inside
                                // applyAudio() before — a voice call becoming
                                // ACTIVE here didn't call that, so the sensor
                                // stayed off until the user touched the audio
                                // route button. Arm it the instant media is
                                // actually live.
                                updateProximityLock()
                                // Rebuild the ongoing notification with the
                                // media-ready chronometer epoch and call kind.
                                CallService.start(app, "In a call with ${cur.otherName}")
                            }
                            PeerConnection.IceConnectionState.FAILED ->
                                Handler(Looper.getMainLooper()).post {
                                    // One automatic rescue before blaming the
                                    // user's network: reconfigure TURN-first /
                                    // relay-only and restart ICE. VPN, symmetric
                                    // NAT and hostile-country routes fail exactly
                                    // at this step and succeed over a relay.
                                    if (!relayRetryUsed && pc != null) {
                                        relayRetryUsed = true
                                        notify("Network is limited — connecting through a relay…")
                                        runCatching { pc?.setConfiguration(relayConfig()) }
                                        scope.launch {
                                            try {
                                                val peer = pc ?: return@launch
                                                if (peer.signalingState() != PeerConnection.SignalingState.STABLE) {
                                                    renegotiationQueued.set(true)
                                                    return@launch
                                                }
                                                val cons = sdpConstraints().apply {
                                                    mandatory.add(
                                                        MediaConstraints.KeyValuePair("IceRestart", "true"),
                                                    )
                                                }
                                                val off = peer.createOfferAwait(cons)
                                                peer.setLocalDescriptionAwait(off)
                                                val cid = active?.id
                                                if (!cid.isNullOrBlank() && !cid.startsWith("pending")) {
                                                    withContext(Dispatchers.IO) {
                                                        Api.post(
                                                            "/api/calls/$cid/reoffer",
                                                            JSONObject().put("sdp", off.description),
                                                        )
                                                    }
                                                    awaitingReanswer = true
                                                }
                                            } catch (_: Exception) {
                                            }
                                        }
                                        return@post
                                    }
                                    notify("Call connection failed. Check your internet and try again.")
                                }
                            PeerConnection.IceConnectionState.DISCONNECTED ->
                                Handler(Looper.getMainLooper()).post { armIceWatchdog() }
                            else -> {}
                        }
                    }
                    override fun onIceConnectionReceivingChange(p0: Boolean) {}
                    override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
                    override fun onIceCandidate(c: IceCandidate?) {
                        if (c == null) return
                        val payload =
                            JSONObject()
                                .put("candidate", c.sdp)
                                .put("sdpMid", c.sdpMid)
                                .put("sdpMLineIndex", c.sdpMLineIndex)
                        val body = JSONObject().put("candidate", payload)
                        if (iceCallId.isBlank() || iceCallId.startsWith("pending")) {
                            pendingIce.add(body)
                        } else {
                            scope.launch(Dispatchers.IO) {
                                runCatching { Api.post("/api/calls/$iceCallId/ice", body) }
                            }
                        }
                    }
                    override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
                    override fun onAddStream(stream: MediaStream?) {
                        val track = stream?.videoTracks?.firstOrNull() ?: return
                        bindRemote(track)
                    }
                    override fun onRemoveStream(p0: MediaStream?) {}
                    override fun onDataChannel(p0: DataChannel?) {}
override fun onRenegotiationNeeded() {
                        // Mid-call track changes (screen share, camera on a
                        // voice call) that need fresh SDP go through here.
                        if (!renegotiating.compareAndSet(false, true)) return
                        scope.launch {
                            try {
                                renegotiateNow()
                            } catch (_: Exception) {
                            } finally {
                                renegotiating.set(false)
                            }
                        }
                    }
                    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                        val track = receiver?.track()
                        if (track is VideoTrack) bindRemote(track)
                        if (track is AudioTrack) {
                            track.setEnabled(true)
                            Handler(Looper.getMainLooper()).post { applyAudio() }
                        }
                    }
                },
            )!!
        audioTrack?.let { peer.addTrack(it, listOf("kp")) }
        videoTrack?.let { peer.addTrack(it, listOf("kp")) }
        if (videoTrack == null) {
            // Voice calls still get a sendrecv VIDEO m-line: without it there
            // is nowhere to put a screen-share track later, and mid-call
            // addTrack would need renegotiation (which we don't do) — the
            // other phone then saw nothing at all.
            runCatching {
                peer.addTransceiver(
                    MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                    RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV),
                )
            }
        }
        pc = peer
        return peer
    }

    /** Counts the first real frame before the UI believes remote video. */
    private inner class FirstFrameGate : org.webrtc.VideoSink {
        @Volatile
        private var seen = false

        override fun onFrame(frame: org.webrtc.VideoFrame) {
            if (seen) return
            seen = true
            Handler(Looper.getMainLooper()).post {
                hasRemote = true
                publishChange()
                // Remote video arrived on a call this side still labels AUDIO.
                // A phone on THIS build announces what it sends before the
                // first frame leaves (the `media` route): a camera already
                // re-labelled the row VIDEO, a screen never will — owner round
                // 31 item 19: that one stays on the voice UI with the preview
                // card. So this promotion is only the fallback for a peer that
                // announces nothing (an older build), and it waits a moment
                // for an announcement that may still be in flight; otherwise
                // a shared screen could flip the voice call to video for the
                // 300ms until the frame arrived, and take our camera with it.
                if (active?.kind != "VIDEO" && !peerScreen) {
                    scope.launch {
                        delay(1_000)
                        if (hasRemote && active?.kind != "VIDEO" && !peerScreen) {
                            active = active?.copy(kind = "VIDEO")
                            publishChange()
                        }
                    }
                }
            }
        }
    }

    private var frameGate: org.webrtc.VideoSink? = null

    private fun bindRemote(track: VideoTrack) {
        scope.launch {
            val old = remoteVideo
            old?.let { v ->
                remoteView?.let { runCatching { v.removeSink(it) } }
                frameGate?.let { runCatching { v.removeSink(it) } }
            }
            remoteVideo = track
            track.setEnabled(true)
            // The renderer sink draws frames whenever they start flowing.
            remoteView?.let { runCatching { track.addSink(it) } }
            // Promotion (voice -> video UI, hasRemote) waits for the FIRST
            // REAL frame: the sendrecv voice-call transceiver surfaces an
            // empty placeholder video track at connect, and promoting on that
            // flipped every voice call straight to the video screen.
            frameGate = FirstFrameGate().also { runCatching { track.addSink(it) } }
        }
    }

    /**
     * Poll-driven renegotiation: the OTHER side's re-offer gets answered,
     * our own posted re-offer gets its answer applied. "mine" is detected
     * via reofferFrom.
     */
    private suspend fun handleRenegotiation(row: JSONObject) {
        val peer = pc ?: return
        val reoffer = row.optIso("reofferSdp").orEmpty()
        val reofferFrom = row.optString("reofferFrom")
        val reanswer = row.optIso("reanswerSdp").orEmpty()

        // 1) Their offer arrived: answer it.
        if (
            reoffer.isNotBlank() &&
            reofferFrom != Store.myId() &&
            reoffer != lastAppliedReoffer
        ) {
            if (peer.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                // GLARE: both sides fired renegotiation and OUR offer was
                // overwritten on the server. The old STABLE-only check left
                // BOTH phones stuck in HAVE_LOCAL_OFFER forever (the
                // audio→video "waiting forever" wedge). Roll ours back and
                // answer theirs — directions never change here (always
                // sendrecv), so a rollback to the last stable SDP is safe.
                val rolled =
                    runCatching {
                        peer.setLocalDescriptionAwait(SessionDescription(SessionDescription.Type.ROLLBACK, ""))
                    }.isSuccess
                if (!rolled) return
                awaitingReanswer = false
            } else if (peer.signalingState() != PeerConnection.SignalingState.STABLE) {
                return
            }
            lastAppliedReoffer = reoffer
            try {
                peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, reoffer))
                // keep our tracks flowing in the new SDP
                peer.transceivers
                    .firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                    ?.let { t ->
                        if (t.direction != RtpTransceiver.RtpTransceiverDirection.SEND_RECV && videoTrack != null) {
                            runCatching { t.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_RECV) }
                        }
                    }
                val answer = peer.createAnswerAwait(sdpConstraints())
                peer.setLocalDescriptionAwait(answer)
                withContext(Dispatchers.IO) {
                    Api.post(
                        "/api/calls/${row.optString("id")}/reanswer",
                        JSONObject().put("sdp", answer.description),
                    )
                }
            } catch (e: Exception) {
                lastAppliedReoffer = null
            }
            return
        }

        // 2) The answer to OUR offer arrived.
        if (
            awaitingReanswer &&
            reanswer.isNotBlank() &&
            peer.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER
        ) {
            try {
                peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.ANSWER, reanswer))
                awaitingReanswer = false
                lastAppliedReoffer = null
                // The renegotiated SDP may have re-created the remote video
                // receiver — re-detect it so the gate/renderer reattach.
                rebindRemoteVideo()
                // Anything that had to wait for this answer goes out now.
                if (renegotiationQueued.compareAndSet(true, false)) {
                    runCatching { renegotiateNow() }
                }
            } catch (_: Exception) {
            }
        }
    }

    /** setTrack() swaps don't re-fire onAddTrack — re-detect replaced video. */
    private fun rebindRemoteVideo() {
        val peer = pc ?: return
        val current =
            peer.receivers
                .firstNotNullOfOrNull { it.track() as? VideoTrack }
                ?: return
        // A voice call already carries an empty placeholder video track (the
        // sendrecv transceiver), and a mid-call setTrack() — screen share, or
        // the other side switching their camera on — can keep that SAME track
        // object. Nothing to rebind then, but a track the audio-only answer
        // left disabled delivers no frames, so the first-frame gate (and with
        // it the whole voice→video promotion) would never fire: this is why an
        // incoming screen share showed nothing on a voice call.
        if (current === remoteVideo) {
            if (!hasRemote) runCatching { current.setEnabled(true) }
            return
        }
        bindRemote(current)
    }

    private fun flushIce() {
        val id = iceCallId
        if (id.isBlank() || id.startsWith("pending")) return
        // Snapshot and clear atomically; toList()+clear() on a live list dropped
        // anything WebRTC emitted in between.
        val batch = synchronized(pendingIce) {
            val copy = pendingIce.toList()
            pendingIce.clear()
            copy
        }
        scope.launch(Dispatchers.IO) {
            for (body in batch) {
                runCatching { Api.post("/api/calls/$id/ice", body) }
            }
        }
    }

    /** Camera always opens front-facing first (no flip button anymore). */
    private val currentFacingFront = true

    private suspend fun pullIce(callId: String) {
        val pc = pc ?: return
        if (pc.remoteDescription == null) return
        val data = withContext(Dispatchers.IO) { runCatching { Api.get("/api/calls/$callId/ice") }.getOrNull() } ?: return
        for (item in data.arr("items").objects()) {
            val id = item.optString("id")
            if (id.isNotBlank()) {
                if (id in seenIce) continue
            }
            val c = item.optJSONObject("candidate") ?: continue
            val cand = c.optString("candidate")
            if (cand.isBlank()) continue
            try {
                pc.addIceCandidate(IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), cand))
                if (id.isNotBlank()) seenIce.add(id)
            } catch (_: Exception) {
            }
        }
    }

    private fun capture(video: Boolean): Boolean {
        val f = factory ?: return false
        applyAudio()
        if (audioTrack == null) {
            audioSource = f.createAudioSource(MediaConstraints())
            audioTrack = f.createAudioTrack("kp-a", audioSource)
            audioTrack?.setEnabled(!(muted || onHold))
        }
        if (video && videoTrack == null) {
            val enum = Camera2Enumerator(app)
            val name =
                enum.deviceNames.firstOrNull { enum.isFrontFacing(it) }
                    ?: enum.deviceNames.firstOrNull()
            if (name != null) {
                capturer = enum.createCapturer(name, null)
                helper = SurfaceTextureHelper.create("kp-cap", egl.eglBaseContext)
                videoSource = f.createVideoSource(false)
                capturer?.initialize(helper, app, videoSource!!.capturerObserver)
                capturer?.startCapture(720, 1280, 24)
                videoTrack = f.createVideoTrack("kp-v", videoSource)
                localView?.let { view ->
                    view.setMirror(true)
                    runCatching { videoTrack?.addSink(view) }
                }
            }
        }
        cameraOff = videoTrack == null
        return true
    }

    companion object {
        /**
         * Owner round 32 (item 9): Compose state, not a plain @Volatile var. The
         * engine is built on MainActivity's starter thread, usually AFTER the
         * first frame; CallGate() / ReturnToCallBanner() / the app shell read
         * `instance` during composition, and a plain var never told Compose it
         * had changed — a ring that landed while the gate had composed against
         * null stayed invisible until something unrelated recomposed ("call
         * screen majhe majhe ashe na" from a cold start).
         */
        var instance: CallEngine? by mutableStateOf<CallEngine?>(null)
            private set

        /**
         * A notification action that arrived before the engine existed (cold
         * start from an Accept tap or an ongoing-call card). MainActivity's
         * handleIntent used to `CallEngine.instance?.let { … }` — a silent
         * no-op on exactly the cold start — so the tap opened the app on the
         * chat list with the call still ringing in the shade. Replayed by
         * start() the moment the engine is up.
         */
        @Volatile
        private var pendingIntentAccept = false

        @Volatile
        private var pendingIntentRestore = false

        fun onAcceptIntent() {
            val e = instance
            if (e == null) {
                pendingIntentAccept = true
                return
            }
            suppressIncomingFor(15_000)
            e.pendingAccept = true
            e.answer()
        }

        fun onRestoreIntent() {
            val e = instance
            if (e == null) {
                pendingIntentRestore = true
                return
            }
            e.restoreCallUi()
        }

        /** Runs the actions that arrived before [instance] existed. */
        internal fun replayPendingIntents() {
            if (pendingIntentAccept) {
                pendingIntentAccept = false
                onAcceptIntent()
            }
            if (pendingIntentRestore) {
                pendingIntentRestore = false
                onRestoreIntent()
            }
        }

        /** Oldest ids are dropped past this; only recent ones can still poll in. */
        private const val MAX_IGNORED_CALLS = 200

        /**
         * Call ids that must never ring again (declined / ended / hung up).
         *
         * Bounded now. This set is static for the whole process and nothing ever
         * removed from it, so a phone that stayed open accumulated every call id
         * the user had ever seen - an unbounded leak that also had to be scanned
         * on every incoming push.
         */
        val ignoredCalls: MutableSet<String> =
            java.util.Collections.synchronizedSet(
                object : java.util.LinkedHashSet<String>() {
                    override fun add(element: String): Boolean {
                        val added = super.add(element)
                        val it = iterator()
                        while (size > MAX_IGNORED_CALLS && it.hasNext()) {
                            it.next()
                            it.remove()
                        }
                        return added
                    }
                }
            )

        /**
         * When the user accepts a call from the notification we must not show
         * the ringing screen again while the answer is being set up.
         */
        @Volatile
        private var suppressIncomingUntil: Long = 0L

        fun suppressIncomingFor(millis: Long) {
            suppressIncomingUntil = System.currentTimeMillis() + millis
        }

        fun isIncomingSuppressed(): Boolean = System.currentTimeMillis() < suppressIncomingUntil

        fun clearIncomingSuppression() {
            suppressIncomingUntil = 0L
        }
    }
}

private suspend fun PeerConnection.createOfferAwait(constraints: MediaConstraints): SessionDescription =
    suspendCancellableCoroutine { cont ->
        createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    // sdp is nullable in the WebRTC API; `sdp!!` used to throw on
                    // the signalling thread and leave the coroutine hung forever.
                    if (sdp != null) cont.resume(sdp)
                    else cont.resumeWithException(RuntimeException("createOffer: empty SDP"))
                }
                override fun onSetSuccess() {}
                override fun onCreateFailure(error: String?) {
                    cont.resumeWithException(RuntimeException("createOffer: ${error ?: "failed"}"))
                }
                override fun onSetFailure(error: String?) {}
            },
            constraints,
        )
    }

private suspend fun PeerConnection.createAnswerAwait(constraints: MediaConstraints): SessionDescription =
    suspendCancellableCoroutine { cont ->
        createAnswer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    if (sdp != null) cont.resume(sdp)
                    else cont.resumeWithException(RuntimeException("createAnswer: empty SDP"))
                }
                override fun onSetSuccess() {}
                override fun onCreateFailure(error: String?) {
                    cont.resumeWithException(RuntimeException("createAnswer: ${error ?: "failed"}"))
                }
                override fun onSetFailure(error: String?) {}
            },
            constraints,
        )
    }

private suspend fun PeerConnection.setLocalDescriptionAwait(sdp: SessionDescription): Unit =
    suspendCancellableCoroutine { cont ->
        setLocalDescription(
            object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() {
                    cont.resume(Unit)
                }
                // An empty onCreateFailure left the awaiting coroutine suspended
                // forever, which wedged the whole CallEngine poll loop.
                override fun onCreateFailure(error: String?) {
                    cont.resumeWithException(RuntimeException("setLocalDescription create: ${error ?: "failed"}"))
                }
                override fun onSetFailure(error: String?) {
                    cont.resumeWithException(RuntimeException("setLocalDescription: ${error ?: "failed"}"))
                }
            },
            sdp,
        )
    }

private suspend fun PeerConnection.setRemoteDescriptionAwait(sdp: SessionDescription): Unit =
    suspendCancellableCoroutine { cont ->
        setRemoteDescription(
            object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() {
                    cont.resume(Unit)
                }
                override fun onCreateFailure(error: String?) {
                    cont.resumeWithException(RuntimeException("setRemoteDescription create: ${error ?: "failed"}"))
                }
                override fun onSetFailure(error: String?) {
                    cont.resumeWithException(RuntimeException("setRemoteDescription: ${error ?: "failed"}"))
                }
            },
            sdp,
        )
    }
