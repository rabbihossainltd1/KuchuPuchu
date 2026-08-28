package app.kuchupuchu.android

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
        private set

    var speaker by mutableStateOf(false)
    var muted by mutableStateOf(false)
    var cameraOff by mutableStateOf(false)
    var sharing by mutableStateOf(false)
    var hasRemote by mutableStateOf(false)

    /** True once the remote side is actually sending video — how an
     *  audio→video upgrade is detected, so BOTH phones land on the same
     *  in-call screen even though the server row still says "AUDIO". */
    val hasRemoteVideo: Boolean get() = remoteVideo != null
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
    private val scope = CoroutineScope(Dispatchers.Main)
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

    fun notify(message: String) {
        toast = message
        scope.launch {
            delay(3500)
            if (toast == message) toast = ""
        }
    }

    init {
        instance = this
    }

    fun start(ctx: Context) {
        CallNotify.ensure(ctx)
        poll?.cancel()
        poll =
            scope.launch {
                polling = true
                try {
                    while (isActive) {
                        // A throw out of tick() used to kill this coroutine, which
                        // meant no more call polling at all for the process.
                        runCatching { tick() }.onFailure { notify("Call update failed. Retrying.") }
                        delay(
                            when {
                                active != null -> 700L
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

    fun applyAudio() {
        val am = app.getSystemService(android.media.AudioManager::class.java)
        am.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
        // A device sitting at ~0 in-call volume is the classic "I can't hear
        // anything" report — nudge it to a sane level if it's silenced.
        runCatching {
            val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_VOICE_CALL)
            if (am.getStreamVolume(android.media.AudioManager.STREAM_VOICE_CALL) <= max / 10) {
                am.setStreamVolume(android.media.AudioManager.STREAM_VOICE_CALL, (max * 0.45f).toInt().coerceAtLeast(1), 0)
            }
        }
        if (Build.VERSION.SDK_INT >= 31) {
            runCatching {
                val devices = am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)
                val wanted =
                    if (speaker) {
                        devices.firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                    } else {
                        devices.firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
                    }
                if (wanted != null) am.setCommunicationDevice(wanted)
            }
        } else {
            runCatching { @Suppress("DEPRECATION") am.isSpeakerphoneOn = speaker }
        }
    }

    private suspend fun tick() {
        val data =
            withContext(Dispatchers.IO) {
                runCatching { Api.get("/api/calls/active", true) }.getOrNull()
            } ?: return
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
                otherAvatar = other.optString("avatarUrl").ifBlank { current?.otherAvatar.orEmpty() },
                startedAt =
                    when {
                        status == "ACTIVE" && (current?.startedAt ?: 0L) > 0L -> current!!.startedAt
                        status == "ACTIVE" -> System.currentTimeMillis()
                        else -> 0L
                    },
                connecting = autoAnswer || (current?.connecting == true && status != "ACTIVE"),
            )
        if (current?.id?.startsWith("pending") == true) {
            active = ui.copy(otherName = current.otherName, otherAvatar = current.otherAvatar)
        } else {
            active = ui
        }
        if (incoming && status == "RINGING" && !suppressed) {
            if (ringingId != ui.id) {
                ringingId = ui.id
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
                active = ui.copy(status = "ACTIVE", startedAt = System.currentTimeMillis(), connecting = true)
            }
            if (pendingAccept) {
                pendingAccept = false
                answer()
            }
        }
        if (status == "ACTIVE") {
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
    }

    fun startCall(userId: String, kind: String, name: String, avatar: String = "") {
        if (active != null) return
        left.set(false)
        hasRemote = false
        speaker = false
        onHold = false
        ensureFactory(app)
        applyAudio()
        active = CallUi("pending", kind, "RINGING", false, name, userId, otherAvatar = avatar)
        CallService.start(app, if (kind == "VIDEO") "Video calling $name" else "Calling $name")
        scope.launch {
            try {
                val streamOk = withContext(Dispatchers.IO) { capture(kind == "VIDEO") }
                if (!streamOk || left.get()) return@launch
                onChange?.invoke(active)
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
                flushIce()
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
        applyAudio()
        CallService.start(app, "In a call with ${rec.otherName}")
        active = rec.copy(status = "ACTIVE", startedAt = System.currentTimeMillis(), connecting = true)
        scope.launch {
            try {
                var offer = ""
                repeat(10) {
                    offer =
                        withContext(Dispatchers.IO) {
                            Api.get("/api/calls/active", true).arr("items").objects()
                                .find { it.optString("id") == rec.id }
                                ?.optIso("offerSdp")
                                .orEmpty()
                        }
                    if (offer.isNotBlank()) return@repeat
                    delay(150)
                }
                if (offer.isBlank() || left.get()) {
                    answering.set(false)
                    hangupLocal()
                    return@launch
                }
                capture(rec.kind == "VIDEO")
                iceCallId = rec.id
                val peer = newPc()
                peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, offer))
                val answer = peer.createAnswerAwait(sdpConstraints())
                peer.setLocalDescriptionAwait(answer)
                flushIce()
                withContext(Dispatchers.IO) {
                    Api.post("/api/calls/${rec.id}/answer", JSONObject().put("answerSdp", answer.description))
                }
                pullIce(rec.id)
            } catch (_: Exception) {
                answering.set(false)
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
        onChange?.invoke(active)
    }

    fun toggleHold() {
        onHold = !onHold
        if (onHold) muted = false
        audioTrack?.setEnabled(!(onHold || muted))
        onChange?.invoke(active)
    }

    fun toggleSpeaker() {
        speaker = !speaker
        applyAudio()
    }

    fun toggleCamera() {
        if (sharing) return
        if (videoTrack == null) {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { capture(true) } }
                videoTrack?.let { track ->
                    val sender = pc?.senders?.find { it.track()?.kind() == "video" }
                    if (sender != null) sender.setTrack(track, true) else pc?.addTrack(track)
                    localView?.let { runCatching { track.addSink(it) } }
                }
                cameraOff = false
                active = active?.copy(kind = "VIDEO")
            }
            return
        }
        cameraOff = !cameraOff
        videoTrack?.setEnabled(!cameraOff)
        if (!cameraOff && active?.kind == "AUDIO") active = active?.copy(kind = "VIDEO")
        onChange?.invoke(active)
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
                scope.launch { runCatching { startShare(data) }.onFailure { notify("Screen share failed to start.") } }
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
            if (sender != null) sender.setTrack(track, true) else pc?.addTrack(track)
            localView?.setMirror(currentFacingFront)
            localView?.let { runCatching { track.addSink(it) } }
        }
        onChange?.invoke(active)
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
        speaker = false
        runCatching {
            val am = app.getSystemService(android.media.AudioManager::class.java)
            if (Build.VERSION.SDK_INT >= 31) {
                runCatching { am.clearCommunicationDevice() }
            } else {
                runCatching { @Suppress("DEPRECATION") am.isSpeakerphoneOn = false }
            }
            @Suppress("DEPRECATION")
            runCatching { am.stopBluetoothSco() }
            am.mode = android.media.AudioManager.MODE_NORMAL
        }
        muted = false
        cameraOff = false
        sharing = false
        onHold = false
        hasRemote = false
        iceCallId = ""
        pendingIce.clear()
        left.set(false)
        answering.set(false)
        pendingAccept = false
        clearIncomingSuppression()
        Handler(Looper.getMainLooper()).post { MainActivity.current?.restoreChrome() }
        active = null
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
            }
        val peer =
            factory!!.createPeerConnection(
                rtc,
                object : PeerConnection.Observer {
                    override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
                    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
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
                    override fun onRenegotiationNeeded() {}
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
        pc = peer
        return peer
    }

    private fun bindRemote(track: VideoTrack) {
        scope.launch {
            remoteView?.let { old -> remoteVideo?.let { runCatching { it.removeSink(old) } } }
            remoteVideo = track
            track.setEnabled(true)
            remoteView?.let { runCatching { track.addSink(it) } }
            hasRemote = true
            // Remote video arrived on a call this side still labels AUDIO
            // (the other phone turned its camera on): promote this side too,
            // otherwise one phone shows the video screen and the other the
            // voice screen for the same call.
            if (active?.kind != "VIDEO") active = active?.copy(kind = "VIDEO")
            onChange?.invoke(active)
        }
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
