package app.kuchupuchu.android

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
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
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

data class CallUi(
    val id: String,
    val kind: String,
    val status: String,
    val incoming: Boolean,
    val otherName: String,
    val otherId: String,
    val otherOnline: Boolean = false,
)

class CallEngine(private val app: Application) {
    var onChange: ((CallUi?) -> Unit)? = null
    var active: CallUi? = null
        private set(value) {
            field = value
            onChange?.invoke(value)
        }

    var speaker = false
    var muted = false
    var cameraOff = false
    var sharing = false

    val egl = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var capturer: VideoCapturer? = null
    private var helper: SurfaceTextureHelper? = null
    private val seenIce = mutableSetOf<String>()
    private val ignored = mutableSetOf<String>()
    private val left = AtomicBoolean(false)
    private var poll: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main)
    private var iceCallId: String = ""
    private val pendingIce = mutableListOf<JSONObject>()

    fun start(ctx: Context) {
        ensureFactory(ctx)
        poll?.cancel()
        poll =
            scope.launch {
                while (isActive) {
                    tick()
                    delay(700)
                }
            }
    }

    private fun ensureFactory(ctx: Context) {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(ctx).createInitializationOptions(),
        )
        factory =
            PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
                .createPeerConnectionFactory()
    }

    private suspend fun tick() {
        val data =
            withContext(Dispatchers.IO) {
                runCatching { Api.get("/api/calls/active") }.getOrNull()
            } ?: return
        val items = data.arr("items").objects().filter { !ignored.contains(it.optString("id")) }
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
        val status = next.optString("status")
        if (status in listOf("ENDED", "DECLINED", "MISSED", "CANCELLED")) {
            ignored.add(next.optString("id"))
            hangupLocal()
            return
        }
        val other = next.optJSONObject("other") ?: JSONObject()
        val ui =
            CallUi(
                id = next.optString("id"),
                kind = next.optString("kind"),
                status = status,
                incoming = next.optBoolean("incoming"),
                otherName = other.optString("displayName", "Player"),
                otherId = other.optString("userId"),
                otherOnline = other.optBoolean("online"),
            )
        if (current?.id?.startsWith("pending") == true) {
            active = ui.copy(otherName = current.otherName)
        } else {
            active = ui
        }
        if (ui.incoming && ui.status == "RINGING" && ui.kind == "VIDEO" && videoTrack == null) {
            withContext(Dispatchers.IO) { runCatching { capture(true) } }
        }
        if (status == "ACTIVE" && next.optString("answerSdp").isNotBlank() && pc?.remoteDescription == null) {
            pc?.setRemoteDescription(EmptySdp(), SessionDescription(SessionDescription.Type.ANSWER, next.optString("answerSdp")))
        }
        if (status == "ACTIVE" || status == "RINGING") pullIce(ui.id)
    }

    fun startCall(userId: String, kind: String, name: String) {
        if (active != null) return
        left.set(false)
        active = CallUi("pending", kind, "RINGING", false, name, userId)
        scope.launch {
            try {
                val streamOk = withContext(Dispatchers.IO) { capture(kind == "VIDEO") }
                if (!streamOk || left.get()) return@launch
                val peer = newPc()
                val offer = peer.createOfferAwait()
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
                        Api.post("/api/calls/${call.optString("id")}/hangup", JSONObject().put("seconds", 0))
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
                    )
            } catch (_: Exception) {
                hangupLocal()
            }
        }
    }

    fun answer() {
        val rec = active ?: return
        scope.launch {
            try {
                val offer =
                    withContext(Dispatchers.IO) {
                        Api.get("/api/calls/active").arr("items").objects()
                            .find { it.optString("id") == rec.id }
                            ?.optString("offerSdp")
                    } ?: return@launch
                capture(rec.kind == "VIDEO")
                if (left.get()) return@launch
                iceCallId = rec.id
                val peer = newPc()
                peer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, offer))
                val answer = peer.createAnswerAwait()
                peer.setLocalDescriptionAwait(answer)
                withContext(Dispatchers.IO) {
                    Api.post("/api/calls/${rec.id}/answer", JSONObject().put("answerSdp", answer.description))
                }
                active = rec.copy(status = "ACTIVE")
            } catch (_: Exception) {
                /* keep ringing */
            }
        }
    }

    fun decline() {
        val id = active?.id
        if (id != null) {
            ignored.add(id)
            scope.launch(Dispatchers.IO) { runCatching { Api.post("/api/calls/$id/decline") } }
        }
        hangupLocal()
    }

    fun hangup() {
        val rec = active
        left.set(true)
        rec?.id?.let { ignored.add(it) }
        val id = rec?.id
        hangupLocal()
        if (id != null && !id.startsWith("pending")) {
            scope.launch(Dispatchers.IO) {
                runCatching { Api.post("/api/calls/$id/hangup", JSONObject().put("seconds", 0)) }
                runCatching { Api.post("/api/calls/clear") }
            }
        }
    }

    fun toggleMute() {
        muted = !muted
        audioTrack?.setEnabled(!muted)
        onChange?.invoke(active)
    }

    fun toggleSpeaker() {
        speaker = !speaker
        onChange?.invoke(active)
    }

    fun toggleCamera() {
        cameraOff = !cameraOff
        videoTrack?.setEnabled(!cameraOff)
        if (!cameraOff && active?.kind == "AUDIO") {
            active = active?.copy(kind = "VIDEO")
        }
        onChange?.invoke(active)
    }

    fun toggleShare() {
        sharing = !sharing
        if (sharing) active = active?.copy(kind = "VIDEO")
        onChange?.invoke(active)
    }

    fun attachLocal(view: SurfaceViewRenderer) {
        view.init(egl.eglBaseContext, null)
        view.setMirror(true)
        videoTrack?.addSink(view)
    }

    fun attachRemote(view: SurfaceViewRenderer) {
        view.init(egl.eglBaseContext, null)
        view.setMirror(false)
    }

    private fun hangupLocal() {
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
        audioTrack = null
        videoTrack = null
        pc?.close()
        pc = null
        seenIce.clear()
        speaker = false
        muted = false
        cameraOff = false
        sharing = false
        iceCallId = ""
        pendingIce.clear()
        active = null
    }

    private fun iceServers(): List<PeerConnection.IceServer> =
        listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer(),
            PeerConnection.IceServer.builder("turn:staticauth.openrelay.metered.ca:80")
                .setUsername("openrelayproject")
                .setPassword("openrelayprojectsecret")
                .createIceServer(),
        )

    private fun newPc(): PeerConnection {
        val rtc = PeerConnection.RTCConfiguration(iceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val peer =
            factory!!.createPeerConnection(
                rtc,
                object : PeerConnection.Observer {
                    override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
                    override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState?) {}
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
                    override fun onAddStream(p0: MediaStream?) {}
                    override fun onRemoveStream(p0: MediaStream?) {}
                    override fun onDataChannel(p0: DataChannel?) {}
                    override fun onRenegotiationNeeded() {}
                    override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, streams: Array<out MediaStream>?) {}
                },
            )!!
        audioTrack?.let { peer.addTrack(it) }
        videoTrack?.let { peer.addTrack(it) }
        pc = peer
        return peer
    }

    private fun wirePc(peer: PeerConnection, callId: String) {
        peer.let { /* ice posted in observer replacement */ }
        val old = pc
        pc = peer
        old
        val rtc = PeerConnection.RTCConfiguration(iceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        // observer already set; post ICE via extra observer not replaceable — send after gather
        scope.launch {
            delay(400)
            // candidates gathered into local description
        }
        peer
        // Use onIceCandidate by recreating is hard; poll remote only.
        pc = peer
        callId.toString()
    }

    private suspend fun pullIce(callId: String) {
        val pc = pc ?: return
        if (pc.remoteDescription == null) return
        val data = withContext(Dispatchers.IO) { runCatching { Api.get("/api/calls/$callId/ice") }.getOrNull() } ?: return
        for (item in data.arr("items").objects()) {
            val id = item.optString("id")
            if (id in seenIce) continue
            val c = item.optJSONObject("candidate") ?: continue
            try {
                pc.addIceCandidate(
                    IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.optString("candidate")),
                )
                seenIce.add(id)
            } catch (_: Exception) {
            }
        }
    }

    private fun capture(video: Boolean): Boolean {
        val f = factory ?: return false
        audioSource = f.createAudioSource(MediaConstraints())
        audioTrack = f.createAudioTrack("kp-a", audioSource)
        if (video) {
            val enum = Camera2Enumerator(app)
            val name = enum.deviceNames.firstOrNull { enum.isFrontFacing(it) } ?: enum.deviceNames.firstOrNull()
            if (name != null) {
                capturer = enum.createCapturer(name, null)
                helper = SurfaceTextureHelper.create("kp-cap", egl.eglBaseContext)
                videoSource = f.createVideoSource(false)
                capturer?.initialize(helper, app, videoSource!!.capturerObserver)
                capturer?.startCapture(640, 860, 24)
                videoTrack = f.createVideoTrack("kp-v", videoSource)
            }
        }
        cameraOff = !video
        return true
    }
}

private class EmptySdp : SdpObserver {
    override fun onCreateSuccess(p0: SessionDescription?) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(p0: String?) {}
    override fun onSetFailure(p0: String?) {}
}

private suspend fun PeerConnection.createOfferAwait(): SessionDescription =
    suspendCoroutine { cont ->
        createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    cont.resume(sdp!!)
                }
                override fun onSetSuccess() {}
                override fun onCreateFailure(p0: String?) {}
                override fun onSetFailure(p0: String?) {}
            },
            MediaConstraints(),
        )
    }

private suspend fun PeerConnection.createAnswerAwait(): SessionDescription =
    suspendCoroutine { cont ->
        createAnswer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    cont.resume(sdp!!)
                }
                override fun onSetSuccess() {}
                override fun onCreateFailure(p0: String?) {}
                override fun onSetFailure(p0: String?) {}
            },
            MediaConstraints(),
        )
    }

private suspend fun PeerConnection.setLocalDescriptionAwait(sdp: SessionDescription) =
    suspendCoroutine { cont ->
        setLocalDescription(
            object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() {
                    cont.resume(Unit)
                }
                override fun onCreateFailure(p0: String?) {}
                override fun onSetFailure(p0: String?) {}
            },
            sdp,
        )
    }

private suspend fun PeerConnection.setRemoteDescriptionAwait(sdp: SessionDescription) =
    suspendCoroutine { cont ->
        setRemoteDescription(
            object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() {
                    cont.resume(Unit)
                }
                override fun onCreateFailure(p0: String?) {}
                override fun onSetFailure(p0: String?) {}
            },
            sdp,
        )
    }
