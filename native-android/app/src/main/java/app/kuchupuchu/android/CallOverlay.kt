package app.kuchupuchu.android

import android.media.AudioManager
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

private val CallInk = Color(0xFF1C1917)
private val CallAccept = Color(0xFF22C55E)
private val CallEnd = Color(0xFFE11D48)
private val CallBtn = Color(0xFF44403C)

@Composable
fun CallOverlay(call: CallUi, engine: CallEngine) {
    val ctx = LocalContext.current
    val ringing = call.status == "RINGING"
    val live = call.status == "ACTIVE"
    val video = call.kind == "VIDEO" || engine.sharing
    val incoming = call.incoming && ringing
    val label =
        when {
            incoming && video -> "Incoming video"
            incoming -> "Incoming call"
            ringing && call.otherOnline -> "Ringing…"
            ringing -> "Calling…"
            live -> "Live"
            else -> call.status.lowercase()
        }

    DisposableEffect(engine.speaker) {
        val am = ctx.getSystemService(AudioManager::class.java)
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        am.isSpeakerphoneOn = engine.speaker
        onDispose { }
    }

    Box(Modifier.fillMaxSize().background(CallInk)) {
        if (video) {
            AndroidView(
                factory = { c ->
                    SurfaceViewRenderer(c).apply {
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                        layoutParams =
                            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        engine.attachRemote(this)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            if (!engine.cameraOff) {
                AndroidView(
                    factory = { c ->
                        SurfaceViewRenderer(c).apply {
                            setZOrderMediaOverlay(true)
                            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                            engine.attachLocal(this)
                        }
                    },
                    modifier =
                        if (incoming) Modifier.fillMaxSize()
                        else Modifier.align(Alignment.TopEnd).padding(16.dp).size(110.dp, 150.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp)),
                )
            }
            Column(Modifier.align(Alignment.TopStart).padding(24.dp, 48.dp)) {
                Text(call.otherName, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text(label, color = Color.White.copy(0.75f), fontSize = 14.sp)
            }
        } else {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Avatar(org.json.JSONObject().put("displayName", call.otherName), 112.dp)
                Spacer(Modifier.height(16.dp))
                Text(call.otherName, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Text(label, color = Color.White.copy(0.7f), fontSize = 15.sp)
                if (!live) {
                    Text(if (call.otherOnline) "Active now" else "Last seen recently", color = Color.White.copy(0.45f), fontSize = 13.sp)
                }
            }
        }

        if (incoming) {
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(36.dp, 48.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                Round(if (video) Icons.Filled.Videocam else Icons.Filled.Call, CallAccept) { engine.answer() }
                Round(Icons.Filled.CallEnd, CallEnd) { engine.decline() }
            }
        } else {
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp, 36.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                Round(if (engine.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff, if (engine.speaker) Color.White else CallBtn, if (engine.speaker) CallInk else Color.White) {
                    engine.toggleSpeaker()
                }
                Round(if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (engine.muted) Color.White else CallBtn, if (engine.muted) CallInk else Color.White) {
                    if (live) engine.toggleMute()
                }
                Round(
                    if (engine.cameraOff || call.kind == "AUDIO") Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                    if (engine.cameraOff) Color.White else CallBtn,
                    if (engine.cameraOff) CallInk else Color.White,
                ) {
                    if (live) engine.toggleCamera()
                }
                Round(Icons.Filled.ScreenShare, if (engine.sharing) Color.White else CallBtn, if (engine.sharing) CallInk else Color.White) {
                    if (live) engine.toggleShare()
                }
                Round(Icons.Filled.CallEnd, CallEnd) { engine.hangup() }
            }
        }
    }
}

@Composable
private fun Round(icon: ImageVector, bg: Color, tint: Color = Color.White, onClick: () -> Unit) {
    Box(
        Modifier.size(58.dp).clip(CircleShape).background(bg).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(26.dp))
    }
}
