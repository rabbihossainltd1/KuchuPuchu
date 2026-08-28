package app.kuchupuchu.android

import android.view.WindowManager
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PersonAddAlt1
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

/**
 * The call screens — one shared flow for BOTH sides:
 *   incoming (ringing) → in-call voice #2 / in-call video #6.
 * Both the caller and the callee see the exact same screen once the call
 * connects, and the same dark look while ringing.
 */
@Composable
fun CallGate() {
    val engine = CallEngine.instance ?: return
    val call = engine.active ?: return

    LaunchedEffect(call.status, call.kind) {
        MainActivity.current?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Dark screens → status/navigation icons must be light. (Bar colors
        // themselves are ignored on targetSdk 35's enforced edge-to-edge.)
        MainActivity.current?.window?.let { w ->
            androidx.core.view.WindowCompat.getInsetsController(w, w.decorView).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }

    val connected = call.status == "ACTIVE" || engine.hasRemote
    when {
        connected ->
            if (call.kind == "VIDEO") InCallVideoScreen(call) else InCallVoiceScreen(call)
        call.incoming && call.status == "RINGING" -> IncomingCallScreen(call)
        call.kind == "VIDEO" -> OutgoingVideoScreen(call)
        else -> OutgoingVoiceScreen(call)
    }

    if (engine.toast.isNotBlank()) {
        Box(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(top = 52.dp),
            contentAlignment = Alignment.TopCenter,
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xE61C1917))
                    .padding(horizontal = 18.dp, vertical = 10.dp),
            ) {
                Text(engine.toast, color = Color.White, fontSize = 13.sp)
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* INCOMING (voice + video) — dark, pulse ring, accept / decline       */
/* ------------------------------------------------------------------ */

@Composable
fun IncomingCallScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    DarkCallScaffold {
        Column(
            // navigationBarsPadding (not a fixed bottom padding) so the
            // Accept/Decline circles clear the bar on both gesture and
            // 3-button navigation.
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.7f))
            PulseRing {
                KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 108.dp, ring = false)
            }
            Spacer(Modifier.height(26.dp))
            Text(call.otherName, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(
                if (call.kind == "VIDEO") "Incoming video call…" else "Incoming voice call…",
                color = Color(0xB3FFFFFF),
                fontSize = 14.sp,
            )
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 48.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CallCircle(Green, 70.dp, onClick = { engine.answer() }) {
                    Icon(
                        if (call.kind == "VIDEO") Icons.Filled.Videocam else Icons.Filled.Call,
                        "Accept",
                        tint = Color.White,
                        modifier = Modifier.size(if (call.kind == "VIDEO") 33.dp else 30.dp),
                    )
                }
                CallCircle(Red, 70.dp, onClick = { if (engine.active?.incoming == true) engine.decline() else engine.hangup() }) {
                    Icon(Icons.Filled.CallEnd, "Decline", tint = Color.White, modifier = Modifier.size(30.dp))
                }
            }
            Spacer(Modifier.height(20.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 40.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                Text(
                    "Message",
                    color = Color(0x99FFFFFF),
                    fontSize = 13.sp,
                    modifier = Modifier.clickable {
                        engine.decline()
                        engine.sendQuickReply(call, "Can't talk right now — message diye reply korbo!")
                    },
                )
                Text(
                    "Remind me",
                    color = Color(0x99FFFFFF),
                    fontSize = 13.sp,
                    modifier = Modifier.clickable {
                        engine.decline()
                        Reminders.schedule(engineApp(), call.otherName, call.otherId)
                    },
                )
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* OUTGOING VOICE — dark, pulse ring, early controls + cancel          */
/* ------------------------------------------------------------------ */

@Composable
fun OutgoingVoiceScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    DarkCallScaffold {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(bottom = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.7f))
            PulseRing {
                KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 108.dp, ring = false)
            }
            Spacer(Modifier.height(26.dp))
            Text(call.otherName, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(
                when {
                    call.connecting -> "Connecting…"
                    call.otherOnline -> "Ringing…"
                    else -> "Calling…"
                },
                color = Color(0xB3FFFFFF),
                fontSize = 14.sp,
            )
            Spacer(Modifier.weight(1f))
            /* frosted early controls while ringing */
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                FrostedPill(
                    if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                    if (engine.muted) "Unmute" else "Mute",
                    active = engine.muted,
                ) { engine.toggleMute() }
                FrostedPill(
                    if (engine.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
                    if (engine.speaker) "Speaker on" else "Speaker",
                    active = engine.speaker,
                ) { engine.toggleSpeaker() }
            }
            Spacer(Modifier.height(34.dp))
            CallCircle(Red, 66.dp, onClick = { engine.hangup() }) {
                Icon(Icons.Filled.CallEnd, "Cancel", tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* OUTGOING VIDEO — dark, same look as the in-call video screen        */
/* ------------------------------------------------------------------ */

@Composable
fun OutgoingVideoScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    Box(Modifier.fillMaxSize().background(Dark)) {
        /* local preview fills the screen while ringing */
        VideoRenderer(engine, remote = false)

        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(top = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.55f))
            Text(call.otherName, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(
                when {
                    call.connecting -> "Connecting…"
                    call.otherOnline -> "Ringing…"
                    else -> "Calling…"
                },
                color = Color(0xB3FFFFFF),
                fontSize = 14.sp,
            )
            Spacer(Modifier.weight(1f))
        }

        /* bottom control strip — same style as the in-call video strip */
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 14.dp)
                .clip(RoundedCornerShape(26.dp))
                .background(Color(0x99000000))
                .padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StripAction(
                if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                if (engine.muted) "Unmute" else "Mute",
                active = engine.muted,
            ) { engine.toggleMute() }
            StripAction(
                if (engine.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                if (engine.cameraOff) "Camera on" else "Camera off",
                active = engine.cameraOff,
            ) { engine.toggleCamera() }
            StripAction(Icons.Filled.CallEnd, "Cancel", active = false, danger = true) { engine.hangup() }
        }
    }
}

/* ------------------------------------------------------------------ */
/* IN-CALL VOICE — light airy: cream top + white sheet grid            */
/* controls: Mute / Speaker / Hold / Add call / End                    */
/* ------------------------------------------------------------------ */

@Composable
fun InCallVoiceScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    val haptics = rememberHaptics()
    val secs = rememberTick(call.startedAt, call.connecting)

    Column(Modifier.fillMaxSize().background(Cream)) {
        Column(
            Modifier
                .fillMaxWidth()
                .background(Cream)
                .statusBarsPadding()
                .padding(bottom = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(26.dp))
            KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 92.dp)
            Spacer(Modifier.height(14.dp))
            Text(call.otherName, color = Ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Text(
                when {
                    engine.onHold -> "On hold"
                    call.connecting && !engine.hasRemote -> "Connecting…"
                    secs > 0 -> clockText(secs)
                    else -> "00:00"
                },
                color = if (engine.onHold) GoldDeep else Ink,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Color.White)
                .navigationBarsPadding()
                .padding(horizontal = 26.dp, vertical = 30.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                GridAction(
                    if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                    if (engine.muted) "Unmute" else "Mute",
                    active = engine.muted,
                ) { engine.toggleMute() }
                GridAction(
                    Icons.Filled.VolumeUp,
                    if (engine.speaker) "Speaker on" else "Speaker",
                    active = engine.speaker,
                ) { engine.toggleSpeaker() }
                GridAction(
                    Icons.Filled.Pause,
                    if (engine.onHold) "Resume" else "Hold",
                    active = engine.onHold,
                ) { engine.toggleHold() }
            }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                GridAction(
                    Icons.Filled.PersonAddAlt1,
                    "Add call",
                    active = false,
                ) { engine.notify("Adding calls is coming in a future update.") }
                GridAction(
                    Icons.Filled.CallEnd,
                    "End call",
                    active = false,
                    danger = true,
                ) { haptics.heavy(); engine.hangup() }
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* IN-CALL VIDEO — authentic minimal dark                              */
/* strip: Mute / Camera / Screen share / End                           */
/* ------------------------------------------------------------------ */

@Composable
fun InCallVideoScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    val haptics = rememberHaptics()
    val secs = rememberTick(call.startedAt, call.connecting)

    Box(Modifier.fillMaxSize().background(Dark)) {
        /* remote video full-bleed */
        VideoRenderer(engine, remote = true)

        if (!engine.hasRemote) {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 84.dp, ring = false)
                Spacer(Modifier.height(12.dp))
                Text(
                    if (call.connecting) "Connecting…" else "Waiting for video…",
                    color = Color.White,
                    fontSize = 14.sp,
                )
            }
        }

        /* top: name + timer */
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 18.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(call.otherName, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    when {
                        engine.sharing -> "You are sharing your screen"
                        secs > 0 -> clockText(secs)
                        else -> "00:00"
                    },
                    color = Color(0xB3FFFFFF),
                    fontSize = 12.sp,
                )
            }
        }

        /* PiP self-view */
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .padding(bottom = 150.dp, end = 14.dp)
                .size(width = 96.dp, height = 132.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color(0xFF33302B))
                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(14.dp)),
        ) {
            VideoRenderer(engine, remote = false, fit = true)
        }

        /* bottom control strip */
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 14.dp)
                .clip(RoundedCornerShape(26.dp))
                .background(Color(0x99000000))
                .padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StripAction(
                if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                if (engine.muted) "Unmute" else "Mute",
                active = engine.muted,
            ) { engine.toggleMute() }
            StripAction(
                if (engine.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                if (engine.cameraOff) "Camera on" else "Camera",
                active = engine.cameraOff,
            ) { engine.toggleCamera() }
            StripAction(Icons.Filled.ScreenShare, "Share", active = engine.sharing) { engine.toggleShare() }
            StripAction(Icons.Filled.CallEnd, "End", active = false, danger = true) { haptics.heavy(); engine.hangup() }
        }
    }
}

/* ------------------------------------------------------------------ */
/* shared pieces                                                       */
/* ------------------------------------------------------------------ */

@Composable
private fun DarkCallScaffold(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Dark)) {
        content()
    }
}

@Composable
private fun CallCircle(
    color: Color,
    size: androidx.compose.ui.unit.Dp,
    onClick: () -> Unit,
    icon: @Composable () -> Unit,
) {
    val haptics = rememberHaptics()
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(color)
            .clickable {
                haptics.confirm()
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) { icon() }
}

@Composable
private fun FrostedPill(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    val haptics = rememberHaptics()
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(if (active) Color(0x66FFFFFF) else Color(0x26FFFFFF))
                .border(1.dp, Color(0x40FFFFFF), CircleShape)
                .clickable { haptics.tap(); onClick() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(label, color = Color(0x99FFFFFF), fontSize = 11.sp)
    }
}

@Composable
private fun GridAction(
    icon: ImageVector,
    label: String,
    active: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val haptics = rememberHaptics()
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable { haptics.tap(); onClick() },
    ) {
        Box(
            Modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(
                    when {
                        danger -> Red
                        active -> Gold
                        else -> Cream
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = label,
                tint = if (danger || active) Color.White else Ink,
                modifier = Modifier.size(27.dp),
            )
        }
        Spacer(Modifier.height(7.dp))
        Text(label, color = if (danger) Red else Muted, fontSize = 12.sp)
    }
}

@Composable
private fun StripAction(
    icon: ImageVector,
    label: String,
    active: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val haptics = rememberHaptics()
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable { haptics.tap(); onClick() }.padding(horizontal = 2.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(
                    when {
                        danger -> Red
                        active -> Gold
                        else -> Color(0x26FFFFFF)
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = label,
                tint = Color.White,
                modifier = Modifier.size(21.dp),
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(label, color = Color(0x99FFFFFF), fontSize = 9.5.sp, textAlign = TextAlign.Center)
    }
}

/** Avatar wrapper with a soft breathing pulse (ringing screens). */
@Composable
private fun PulseRing(content: @Composable () -> Unit) {
    val t = rememberInfiniteTransition(label = "pulse")
    val s by t.animateFloat(
        initialValue = 1f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(
            tween(1100),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )
    Box(Modifier.scale(s)) { content() }
}

/** WebRTC video renderer (remote full-bleed or local PiP). */
@Composable
fun VideoRenderer(engine: CallEngine, remote: Boolean, fit: Boolean = false) {
    AndroidView(
        factory = { c ->
            SurfaceViewRenderer(c).apply {
                init(engine.egl.eglBaseContext, null)
                setEnableHardwareScaler(true)
                setMirror(!remote)
                setScalingType(
                    if (fit) RendererCommon.ScalingType.SCALE_ASPECT_FIT
                    else RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                )
                if (remote) engine.attachRemote(this) else engine.attachLocal(this)
            }
        },
        onRelease = { view ->
            if (remote) engine.detachRemote(view) else engine.detachLocal(view)
            runCatching { view.release() }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun rememberTick(startedAt: Long, paused: Boolean): Int {
    var secs by remember(startedAt) { mutableIntStateOf(0) }
    LaunchedEffect(startedAt, paused) {
        while (true) {
            // On hold: FREEZE the reading (real phone apps do) — it used to
            // reset to 00:00, which reads like the call just dropped.
            if (startedAt > 0 && !paused) {
                secs = ((System.currentTimeMillis() - startedAt) / 1000).toInt()
            }
            kotlinx.coroutines.delay(500)
        }
    }
    return secs
}

private fun clockText(secs: Int): String = "%d:%02d".format(secs / 60, secs % 60)

private fun engineApp(): android.content.Context =
    CallEngine.instance?.appContext ?: MainActivity.current
    ?: android.app.Application()
