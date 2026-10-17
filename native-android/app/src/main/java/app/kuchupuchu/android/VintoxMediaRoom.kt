package app.kuchupuchu.android

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.*
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Six-person, VPS-free WebRTC mesh. The Worker transports signalling only;
 * audio/video flow directly between devices. No TURN or hidden relay fallback.
 */
class VintoxMediaRoom(
    context: Context,
    private val onState: (String) -> Unit,
    private val onVideo: (VideoTrack) -> Unit,
    private val onClosed: () -> Unit,
    private val onParticipants: (Int) -> Unit = {},
) {
    companion object {
        const val MAX_PARTICIPANTS = 6
        val egl: EglBase by lazy { EglBase.create() }
        private val initialized = AtomicBoolean(false)
    }

    private data class Peer(val connection: PeerConnection, val queuedIce: MutableList<IceCandidate> = mutableListOf())

    private val app = context.applicationContext
    private val http = OkHttpClient()
    private val peers = ConcurrentHashMap<String, Peer>()
    private var socket: WebSocket? = null
    private var factory: PeerConnectionFactory? = null
    private var localAudio: AudioTrack? = null
    private var localVideo: VideoTrack? = null
    private var videoSource: VideoSource? = null
    private var capturer: CameraVideoCapturer? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var selfId = ""
    private var instructor = false
    private var closed = false

    suspend fun connect(credentials: JSONObject) = withContext(Dispatchers.IO) {
        require(credentials.optString("transport") == "p2p-mesh") { "Unsupported classroom transport" }
        selfId = credentials.getString("participantId")
        instructor = credentials.optBoolean("instructor")
        initMedia()
        val separator = if (credentials.getString("url").contains('?')) '&' else '?'
        val url = credentials.getString("url") + separator + "ticket=" +
            URLEncoder.encode(credentials.getString("ticket"), Charsets.UTF_8.name())
        socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) = onState("Connecting…")
            override fun onMessage(ws: WebSocket, text: String) = receive(JSONObject(text))
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (!closed) { onState("Direct connection failed"); onClosed() }
            }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) { if (!closed) onClosed() }
        })
    }

    fun disconnect() {
        if (closed) return
        closed = true
        socket?.close(1000, "leave")
        socket = null
        peers.values.forEach { it.connection.close() }
        peers.clear()
        capturer?.stopCapture()
        capturer?.dispose()
        textureHelper?.dispose()
        localAudio?.dispose()
        localVideo?.dispose()
        videoSource?.dispose()
        factory?.dispose()
        onParticipants(0)
    }

    private fun initMedia() {
        if (initialized.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(app).createInitializationOptions(),
            )
        }
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
        val audioSource = factory!!.createAudioSource(MediaConstraints())
        localAudio = factory!!.createAudioTrack("class-audio-$selfId", audioSource).also { it.setEnabled(true) }
        if (instructor) startCamera()
    }

    private fun startCamera() {
        val enumerator = Camera2Enumerator(app)
        val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull() ?: return
        capturer = enumerator.createCapturer(name, null) ?: return
        textureHelper = SurfaceTextureHelper.create("ClassCamera", egl.eglBaseContext)
        videoSource = factory!!.createVideoSource(false)
        capturer!!.initialize(textureHelper, app, videoSource!!.capturerObserver)
        capturer!!.startCapture(960, 540, 24)
        localVideo = factory!!.createVideoTrack("class-video-$selfId", videoSource).also { it.setEnabled(true) }
    }

    private fun receive(message: JSONObject) {
        when (message.optString("type")) {
            "roster" -> {
                val rows = message.optJSONArray("participants") ?: JSONArray()
                if (rows.length() >= MAX_PARTICIPANTS) return onState("Class is full")
                (0 until rows.length()).map { rows.optString(it) }.filter { it.isNotBlank() && it != selfId }
                    .forEach { ensurePeer(it, selfId < it) }
                onParticipants(peers.size + 1)
                onState("Live")
            }
            "peer-joined" -> {
                val id = message.optString("participant")
                if (id.isNotBlank() && id != selfId && peers.size + 1 < MAX_PARTICIPANTS) ensurePeer(id, selfId < id)
            }
            "peer-left" -> {
                peers.remove(message.optString("participant"))?.connection?.close()
                onParticipants(peers.size + 1)
            }
            "offer" -> if (message.optString("to") == selfId) acceptOffer(message)
            "answer" -> if (message.optString("to") == selfId) acceptAnswer(message)
            "candidate" -> if (message.optString("to") == selfId) acceptCandidate(message)
            "peer-unavailable" -> onState("A participant left")
        }
    }

    private fun ensurePeer(id: String, makeOffer: Boolean): Peer {
        peers[id]?.let { return it }
        if (peers.size + 1 >= MAX_PARTICIPANTS) error("Class is full")
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        )
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            iceTransportsType = PeerConnection.IceTransportsType.ALL
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val connection = factory!!.createPeerConnection(config, observer(id)) ?: error("Peer unavailable")
        val peer = Peer(connection)
        peers[id] = peer
        localAudio?.let { connection.addTrack(it, listOf("class-$selfId")) }
        localVideo?.let { connection.addTrack(it, listOf("class-$selfId")) }
        onParticipants(peers.size + 1)
        if (makeOffer) connection.createOffer(createSdp(id, connection, true), MediaConstraints())
        return peer
    }

    private fun acceptOffer(message: JSONObject) {
        val from = message.getString("from")
        val peer = ensurePeer(from, false)
        peer.connection.setRemoteDescription(setSdp {
            flushIce(peer)
            peer.connection.createAnswer(createSdp(from, peer.connection, false), MediaConstraints())
        }, SessionDescription(SessionDescription.Type.OFFER, message.getString("sdp")))
    }

    private fun acceptAnswer(message: JSONObject) {
        val peer = ensurePeer(message.getString("from"), false)
        peer.connection.setRemoteDescription(setSdp { flushIce(peer) }, SessionDescription(SessionDescription.Type.ANSWER, message.getString("sdp")))
    }

    private fun acceptCandidate(message: JSONObject) {
        val peer = ensurePeer(message.getString("from"), false)
        val value = message.getJSONObject("candidate")
        val candidate = IceCandidate(value.optString("sdpMid"), value.optInt("sdpMLineIndex"), value.getString("candidate"))
        if (peer.connection.remoteDescription == null) peer.queuedIce += candidate else peer.connection.addIceCandidate(candidate)
    }

    private fun flushIce(peer: Peer) {
        peer.queuedIce.forEach(peer.connection::addIceCandidate)
        peer.queuedIce.clear()
    }

    private fun createSdp(id: String, connection: PeerConnection, offer: Boolean) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) {
            connection.setLocalDescription(setSdp {
                send(JSONObject().put("type", if (offer) "offer" else "answer").put("to", id).put("sdp", description.description))
            }, description)
        }
        override fun onCreateFailure(error: String?) = onState(error ?: "SDP failed")
        override fun onSetSuccess() = Unit
        override fun onSetFailure(error: String?) = onState(error ?: "SDP failed")
    }

    private fun setSdp(success: () -> Unit) = object : SdpObserver {
        override fun onSetSuccess() = success()
        override fun onSetFailure(error: String?) = onState(error ?: "SDP failed")
        override fun onCreateSuccess(description: SessionDescription?) = Unit
        override fun onCreateFailure(error: String?) = Unit
    }

    private fun observer(id: String) = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) = send(
            JSONObject().put("type", "candidate").put("to", id).put("candidate", JSONObject()
                .put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)),
        )
        override fun onTrack(transceiver: RtpTransceiver) { (transceiver.receiver.track() as? VideoTrack)?.let(onVideo) }
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) { (receiver.track() as? VideoTrack)?.let(onVideo) }
        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
            if (state == PeerConnection.PeerConnectionState.FAILED) onState("Direct connection failed")
        }
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) { stream.videoTracks.firstOrNull()?.let(onVideo) }
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onStandardizedIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent) = Unit
    }

    private fun send(value: JSONObject) { socket?.send(value.toString()) }
}
