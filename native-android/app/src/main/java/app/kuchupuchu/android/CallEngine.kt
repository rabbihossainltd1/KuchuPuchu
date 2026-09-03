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
)

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
    private val left = AtomicBoolean(false)
    private var poll: Job? = null
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, throwable ->
                android.util.Log.e("KP_CRASH", "CallEngine uncaught", throwable)
            }
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
    fun kickPoll(callId: String) {
        if (active?.id == callId) scope.launch { runCatching { tick() } }
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
                    t == "call" && mine == null && cid.isNotBlank() -> pokeTick()
                    cid.isNotBlank() && cid == mine -> pokeTick()
                }
            }
        }
        poll?.cancel()
        poll =
            scope.launch {
                polling = true
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
        val data =
            withTimeout(6_000) {
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
        val ui =
            CallUi(
                id = next.optString("id"),
                kind = next.optString("kind"),
                status = status,
                incoming = incoming,
                otherName = other.optString("displayName").ifBlank { current?.otherName ?: "KuchuPuchu" },
                otherId = other.optString("id").ifBlank { current?.otherId.orEmpty() },
                otherOnline = other.optBoolean("online"),
                otherAvatar = other.optIso("avatarUrl").orEmpty().ifBlank { current?.otherAvatar.orEmpty() },
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
        if (current?.id?.startsWith("pending") == true) {
            active = ui.copy(otherName = current.otherName, otherAvatar = current.otherAvatar)
        } else {
            active = ui
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
                CallNotify.incoming(app, ui.otherName, ui.kind == "VIDEO", ui.id)
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

    fun startCall(userId: String, kind: String, name: String, avatar: String = "") {
        if (active != null) return
        minimized = false
        left.set(false)
        hasRemote = false
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
                val message = (e as? ApiException)?.message ?: "Couldn't start the call. Try again."
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
                val conv = Api.post("/api/conversations", JSONObject().put("userId", call.otherId))
                Api.post(
                    "/api/conversations/${conv.optJSONObject("conversation")?.optString("id")}/messages",
                    JSONObject().put("body", text),
                )
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
        if (videoTrack == null) {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { capture(true) } }
                if (videoTrack == null) {
                    // No capturer (permission denied, enumeration failed, the
                    // surface is gone). capture() left cameraOff true; say so
                    // instead of flipping the call to a VIDEO label with nothing
                    // behind it — that is the "opponent kichu dekhe na" case.
                    cameraOff = true
                    notify("Camera couldn't start. Abar try koro.")
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
    }

    fun toggleShare() {
        if (active == null || pc == null) {
            notify("Start a video call first to share your screen.")
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
                            }
                        }
                        .onFailure {
                        // Named so the user's next report tells us exactly
                        // which stage broke (service/FGS/projection/capturer).
                        notify("Screen share failed (${it.javaClass.simpleName}). Abar try koro.")
                    }
                }
            }
        }
    }

    private suspend fun startShare(data: Intent) {
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
        active = active?.copy(kind = "VIDEO")
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
        capture(true)
        videoTrack?.let { track ->
            val sender = pc?.senders?.find { it.track()?.kind() == "video" }
                ?: pc?.transceivers
                    ?.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
                    ?.sender
            if (sender != null) sender.setTrack(track, true) else pc?.addTrack(track)
            localView?.setMirror(currentFacingFront)
            localView?.let { runCatching { track.addSink(it) } }
        }
        publishChange()
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
        muted = false
        cameraOff = false
        sharing = false
        onHold = false
        hasRemote = false
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
                                        notify("Network e direct hole na — relay theke try kora hochhe…")
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
                                    notify("Call connection failed — net check kore abar try koro")
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
                // Remote video arrived on a call this side still labels AUDIO
                // (the other phone shared its screen / turned the camera on):
                // promote this side too, otherwise one phone shows the video
                // screen and the other the voice screen for the same call.
                if (active?.kind != "VIDEO") {
                    active = active?.copy(kind = "VIDEO")
                    publishChange()
                    // TRUE audio→video conversion: the other side just turned
                    // their camera on — join with OURS too, otherwise they sit
                    // on "Waiting for video…" forever ("stuck" bug). They can
                    // still tap the camera off if they don't want to send.
                    if (!sharing && videoTrack == null && !cameraOff) {
                        markVideoRoute()
                        notify("Video call…")
                        toggleCamera()
                    }
                } else {
                    publishChange()
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
        @Volatile
        var instance: CallEngine? = null

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
