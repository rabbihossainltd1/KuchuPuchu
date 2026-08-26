package app.kuchupuchu.android

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

private val EndRed = Color(0xFFE11D48)
private val AcceptGreen = Color(0xFF3F6212)
private val BtnStone = Color(0xFF44403C)

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

    Box(Modifier.fillMaxSize().background(Color(0xFF1C1917))) {
        if (video) {
            AndroidView(
                factory = { c ->
                    SurfaceViewRenderer(c).apply {
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
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
                        else Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 14.dp).size(92.dp, 124.dp).clip(RoundedCornerShape(14.dp)),
                )
            }
            Column(
                Modifier.align(if (incoming) Alignment.Center else Alignment.TopCenter)
                    .padding(top = if (incoming) 0.dp else 28.dp)
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(call.otherName, color = Color.White, fontSize = if (incoming) 28.sp else 18.sp, fontWeight = FontWeight.SemiBold)
                Text(label, color = Color(0xFFE7E5E4), fontSize = 13.sp)
            }
        } else {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Avatar(JSONObject().put("displayName", call.otherName), 148.dp)
                Spacer(Modifier.height(12.dp))
                Text(call.otherName, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Box(Modifier.clip(RoundedCornerShape(99.dp)).background(Color(0xFF292524)).padding(horizontal = 12.dp, vertical = 6.dp)) {
                    Text(label, color = Color(0xFFD6D3D1), fontSize = 13.sp)
                }
                if (!live) {
                    Text(if (call.otherOnline) "Active now" else "Last seen recently", color = Color(0xFFA8A29E), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }

        if (incoming) {
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(36.dp, 48.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                Round(if (video) Icons.Filled.Videocam else Icons.Filled.Call, AcceptGreen, 72.dp) { engine.answer() }
                Round(Icons.Filled.CallEnd, EndRed, 72.dp) { engine.decline() }
            }
        } else {
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .then(if (video) Modifier.background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE00C0A09)))) else Modifier)
                    .padding(12.dp, 18.dp, 12.dp, 26.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Round(if (engine.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff, if (engine.speaker) Color(0xFFFAFAF9) else BtnStone, 52.dp, if (engine.speaker) Color(0xFF1C1917) else Color.White) {
                    engine.toggleSpeaker()
                }
                Round(if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (engine.muted) Color(0xFFFAFAF9) else BtnStone, 52.dp, if (engine.muted) Color(0xFF1C1917) else Color.White) {
                    if (live) engine.toggleMute()
                }
                Round(
                    if (engine.cameraOff || call.kind == "AUDIO") Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                    if (engine.cameraOff) Color(0xFFFAFAF9) else BtnStone,
                    52.dp,
                    if (engine.cameraOff) Color(0xFF1C1917) else Color.White,
                ) {
                    if (live) engine.toggleCamera()
                }
                Round(Icons.Filled.ScreenShare, if (engine.sharing) Color(0xFFFAFAF9) else BtnStone, 52.dp, if (engine.sharing) Color(0xFF1C1917) else Color.White) {
                    if (live) engine.toggleShare()
                }
                Round(Icons.Filled.CallEnd, EndRed, 58.dp) { engine.hangup() }
            }
        }
    }
}

@Composable
private fun Round(icon: ImageVector, bg: Color, size: Dp, tint: Color = Color.White, onClick: () -> Unit) {
    Box(
        Modifier.size(size).clip(CircleShape).background(bg).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(if (size >= 70.dp) 28.dp else 22.dp))
    }
}
