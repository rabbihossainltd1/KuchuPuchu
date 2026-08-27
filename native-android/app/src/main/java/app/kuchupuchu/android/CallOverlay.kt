package app.kuchupuchu.android

import android.app.Activity
import android.graphics.Color as AndroidColor
import android.view.ViewGroup
import android.view.WindowManager
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlinx.coroutines.delay
import org.json.JSONObject
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

private val EndRed = Color(0xFFE11D48)
private val AcceptGreen = Color(0xFF22C55E)
private val BtnStone = Color(0xFF3F3A36)
private val AudioBg = Color(0xFF161210)
private val IncomingBg = Color(0xFF121212)

@Composable
fun CallOverlay(call: CallUi, engine: CallEngine) {
    val ctx = LocalContext.current
    val ringing = call.status == "RINGING"
    val live = call.status == "ACTIVE"
    val video = call.kind == "VIDEO" || engine.sharing
    val incoming = call.incoming && ringing
    val person = remember(call.otherName, call.otherAvatar) {
        JSONObject().put("displayName", call.otherName).put("avatarUrl", call.otherAvatar)
    }

    BackHandler {
        if (incoming) engine.decline() else engine.hangup()
    }

    DisposableEffect(Unit) {
        val window = (ctx as? Activity)?.window
        val prevStatus = window?.statusBarColor
        val prevNav = window?.navigationBarColor
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window?.statusBarColor = AndroidColor.BLACK
        window?.navigationBarColor = AndroidColor.BLACK
        window?.let {
            WindowCompat.setDecorFitsSystemWindows(it, false)
            WindowInsetsControllerCompat(it, it.decorView).isAppearanceLightStatusBars = false
        }
        onDispose {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (prevStatus != null) window.statusBarColor = prevStatus
            if (prevNav != null) window.navigationBarColor = prevNav
        }
    }

    val label =
        when {
            incoming && video -> "Incoming video"
            incoming -> "Incoming call"
            ringing && call.otherOnline -> "Ringing…"
            ringing -> "Calling…"
            live -> clock(call.startedAt)
            else -> call.status.lowercase()
        }

    when {
        incoming && video -> IncomingVideo(call, engine, person, label)
        incoming -> IncomingAudio(call, engine, person, label)
        video -> LiveVideo(call, engine, live, label)
        else -> LiveAudio(call, engine, person, live, label)
    }
}

@Composable
private fun IncomingAudio(call: CallUi, engine: CallEngine, person: JSONObject, label: String) {
    Box(Modifier.fillMaxSize().background(IncomingBg)) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(88.dp))
            Avatar(person, 128.dp)
            Spacer(Modifier.height(22.dp))
            Text(call.otherName, color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(label, color = Color(0xFFD6D3D1), fontSize = 16.sp)
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(bottom = 56.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                LabeledRound(Icons.Filled.CallEnd, EndRed, "Decline", 74.dp) { engine.decline() }
                LabeledRound(Icons.Filled.Call, AcceptGreen, "Accept", 74.dp) { engine.answer() }
            }
        }
    }
}

@Composable
private fun IncomingVideo(call: CallUi, engine: CallEngine, person: JSONObject, label: String) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        VideoSurface(local = true, engine = engine, modifier = Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent, Color(0xB3000000))),
            ),
        )
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(36.dp))
            Text(call.otherName, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(label, color = Color(0xFFE7E5E4), fontSize = 16.sp)
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(bottom = 48.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                LabeledRound(Icons.Filled.Videocam, AcceptGreen, "ACCEPT", 74.dp) { engine.answer() }
                LabeledRound(Icons.Filled.CallEnd, EndRed, "DECLINE", 74.dp) { engine.decline() }
            }
        }
    }
}

@Composable
private fun LiveAudio(call: CallUi, engine: CallEngine, person: JSONObject, live: Boolean, label: String) {
    Box(Modifier.fillMaxSize().background(AudioBg)) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(28.dp))
            Text("KuchuPuchu · Call", color = Color(0xFFA8A29E), fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(48.dp))
            Avatar(person, 148.dp)
            Spacer(Modifier.height(22.dp))
            Text(call.otherName, color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(12.dp))
            Box(Modifier.clip(RoundedCornerShape(99.dp)).background(Color(0xFF2A2420)).padding(horizontal = 14.dp, vertical = 6.dp)) {
                Text(label, color = Color(0xFFE7E5E4), fontSize = 13.sp)
            }
            if (!live) {
                Text(
                    if (call.otherOnline) "Active now" else "Last seen recently",
                    color = Color(0xFFA8A29E),
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            AudioControls(call, engine, live)
        }
    }
}

@Composable
private fun LiveVideo(call: CallUi, engine: CallEngine, live: Boolean, label: String) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (engine.hasRemote && live) {
            VideoSurface(local = false, engine = engine, modifier = Modifier.fillMaxSize())
        } else {
            VideoSurface(local = true, engine = engine, modifier = Modifier.fillMaxSize())
        }
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(Color(0x66000000), Color.Transparent, Color(0xCC0C0A09))),
            ),
        )
        Column(
            Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(call.otherName, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text(label, color = Color(0xFFE7E5E4), fontSize = 13.sp)
        }
        if (engine.hasRemote && live && !engine.cameraOff) {
            VideoSurface(
                local = true,
                engine = engine,
                modifier =
                    Modifier.align(Alignment.TopEnd).statusBarsPadding()
                        .padding(top = 12.dp, end = 14.dp)
                        .size(96.dp, 132.dp)
                        .clip(RoundedCornerShape(14.dp)),
                overlay = true,
            )
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding()
                .padding(12.dp, 16.dp, 12.dp, 28.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Round(
                if (engine.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
                if (engine.speaker) Color(0xFFFAFAF9) else BtnStone,
                54.dp,
                if (engine.speaker) Color(0xFF1C1917) else Color.White,
            ) { engine.toggleSpeaker() }
            Round(
                if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                if (engine.muted) Color(0xFFFAFAF9) else BtnStone,
                54.dp,
                if (engine.muted) Color(0xFF1C1917) else Color.White,
            ) { if (live) engine.toggleMute() }
            Round(
                if (engine.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                if (engine.cameraOff) Color(0xFFFAFAF9) else BtnStone,
                54.dp,
                if (engine.cameraOff) Color(0xFF1C1917) else Color.White,
            ) { if (live) engine.toggleCamera() }
            Round(
                Icons.Filled.ScreenShare,
                if (engine.sharing) Color(0xFFFAFAF9) else BtnStone,
                54.dp,
                if (engine.sharing) Color(0xFF1C1917) else Color.White,
            ) { if (live) engine.toggleShare() }
            Round(Icons.Filled.CallEnd, EndRed, 58.dp) { engine.hangup() }
        }
    }
}

@Composable
private fun AudioControls(call: CallUi, engine: CallEngine, live: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(bottom = 36.dp, start = 10.dp, end = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LabeledRound(
            if (engine.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
            if (engine.speaker) Color(0xFFFAFAF9) else BtnStone,
            "Speaker",
            56.dp,
            if (engine.speaker) Color(0xFF1C1917) else Color.White,
        ) { engine.toggleSpeaker() }
        LabeledRound(
            if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
            if (engine.muted) Color(0xFFFAFAF9) else BtnStone,
            "Mute",
            56.dp,
            if (engine.muted) Color(0xFF1C1917) else Color.White,
        ) { if (live) engine.toggleMute() }
        LabeledRound(
            if (engine.cameraOff || call.kind == "AUDIO") Icons.Filled.VideocamOff else Icons.Filled.Videocam,
            BtnStone,
            "Video",
            56.dp,
        ) { if (live) engine.toggleCamera() }
        LabeledRound(
            Icons.Filled.ScreenShare,
            if (engine.sharing) Color(0xFFFAFAF9) else BtnStone,
            "Share",
            56.dp,
            if (engine.sharing) Color(0xFF1C1917) else Color.White,
        ) { if (live) engine.toggleShare() }
        LabeledRound(Icons.Filled.CallEnd, EndRed, "Hang Up", 58.dp) { engine.hangup() }
    }
}

@Composable
private fun VideoControls(engine: CallEngine, live: Boolean, modifier: Modifier) {
    Row(
        modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp, 16.dp, 12.dp, 28.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Round(
            if (engine.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
            if (engine.speaker) Color(0xFFFAFAF9) else BtnStone,
            54.dp,
            if (engine.speaker) Color(0xFF1C1917) else Color.White,
        ) { engine.toggleSpeaker() }
        Round(
            if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
            if (engine.muted) Color(0xFFFAFAF9) else BtnStone,
            54.dp,
            if (engine.muted) Color(0xFF1C1917) else Color.White,
        ) { if (live) engine.toggleMute() }
        Round(
            if (engine.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
            if (engine.cameraOff) Color(0xFFFAFAF9) else BtnStone,
            54.dp,
            if (engine.cameraOff) Color(0xFF1C1917) else Color.White,
        ) { if (live) engine.toggleCamera() }
        Round(
            Icons.Filled.ScreenShare,
            if (engine.sharing) Color(0xFFFAFAF9) else BtnStone,
            54.dp,
            if (engine.sharing) Color(0xFF1C1917) else Color.White,
        ) { if (live) engine.toggleShare() }
        Round(Icons.Filled.CallEnd, EndRed, 58.dp) { engine.hangup() }
    }
}

@Composable
private fun VideoSurface(local: Boolean, engine: CallEngine, modifier: Modifier, overlay: Boolean = false) {
    AndroidView(
        factory = { c ->
            SurfaceViewRenderer(c).apply {
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                if (overlay) setZOrderMediaOverlay(true)
                if (local) engine.attachLocal(this) else engine.attachRemote(this)
            }
        },
        modifier = modifier,
        update = {},
        onRelease = { if (local) engine.detachLocal(it) else engine.detachRemote(it) },
    )
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

@Composable
private fun LabeledRound(
    icon: ImageVector,
    bg: Color,
    label: String,
    size: Dp,
    tint: Color = Color.White,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Round(icon, bg, size, tint, onClick)
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color(0xFFE7E5E4), fontSize = 11.sp)
    }
}

@Composable
private fun clock(startedAt: Long): String {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(startedAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val sec = if (startedAt <= 0L) 0 else ((now - startedAt) / 1000).toInt().coerceAtLeast(0)
    return "%d:%02d".format(sec / 60, sec % 60)
}
