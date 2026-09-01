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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PersonAddAlt1
import androidx.compose.material.icons.filled.PhoneInTalk
import androidx.compose.material.icons.filled.ScreenShare
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.scale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.zIndex
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import androidx.compose.ui.graphics.Brush
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
    if (engine.minimized) return
    androidx.activity.compose.BackHandler {
        // Minimize only the call overlay; keep MainActivity and the underlying
        // app navigation alive while CallService's ongoing notification stays.
        engine.minimizeCall()
    }
    // The gate only composes while a call exists, so this dispose is exactly
    // "the call ended" (hangup / decline / remote end / cancel) — play the
    // user's short end-tone once. Purely audible, renders nothing.
    // GUARD: a mid-call activity recreate (split-screen, dark-mode toggle,
    // locale change) also disposes this composition WITHOUT ending the call —
    // engine.active is still set then, so only speak when it's really over.
    val gateCtx = androidx.compose.ui.platform.LocalContext.current
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose {
            if (engine.active == null) runCatching { CallSounds.playEnd(gateCtx) }
        }
    }

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
    Box(Modifier.fillMaxSize()) {
        // Tap shield: the call overlay's root Box carries only a background,
        // which is not a pointer hit-target, so a tap on its empty region fell
        // through to the underlying chat/enabled screen ("voice-call in-call UI
        // te blank space click korle chat er message er upor pore"). This
        // full-screen node sits UNDER the call UI and consumes every pointer
        // event, blank-area taps stay on the call; the dialer buttons are drawn
        // above it and keep working.
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent()
                            e.changes.forEach { it.consume() }
                        }
                    }
                },
        )
        when {
            connected ->
                // hasRemoteVideo: the server row can still say AUDIO after the
                // other phone upgraded to video mid-call — follow the actual
                // media so both sides always render the SAME in-call screen.
                if (call.kind == "VIDEO" || engine.hasRemoteVideo) InCallVideoScreen(call) else VoiceCallScreen(call)
            // Incoming ringing needs its own Accept/Decline screen; everything
            // else voice (outgoing ringing, connecting, in-call) is THE SAME
            // screen on caller and receiver — one UI, per design.
            call.incoming && call.status == "RINGING" -> IncomingCallScreen(call)
            call.kind == "VIDEO" -> OutgoingVideoScreen(call)
            else -> VoiceCallScreen(call)
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
/* VOICE CALL — THE single screen for BOTH sides: while ringing only   */
/* Speaker is enabled; once connected Speaker / Mute / Add call all    */
/* come alive. Caller and receiver see exactly this same UI.           */
/* ------------------------------------------------------------------ */

@Composable
fun VoiceCallScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    val haptics = rememberHaptics()
    val secs = rememberTick(call.startedAt, call.connecting)
    val connected = call.status == "ACTIVE" || engine.hasRemote

    DarkCallScaffold {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.62f))
            PulseRing {
                KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 116.dp, ring = false)
            }
            Spacer(Modifier.height(28.dp))
            Text(call.otherName, color = Color.White, fontSize = 27.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(
                when {
                    engine.onHold -> "On hold"
                    call.status == "ACTIVE" && (call.connecting || call.startedAt <= 0L) -> "Connecting…"
                    connected -> clockText(secs)
                    call.incoming -> "Ringing…"
                    call.otherOnline -> "Ringing…"
                    else -> "Calling…"
                },
                color = Color(0xB3FFFFFF),
                fontSize = 15.sp,
            )
            Spacer(Modifier.weight(1f))

            /* control grid — 3 x 2, every slot the same width, disabled
               buttons dim to 35% while ringing. Video opens THIS user's
               camera (both phones land on the video screen; the opponent
               can turn theirs on too). */
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                // Audio output button: shows WHERE sound is going right now
                // (Bluetooth / headset / earpiece / speaker) and cycles to the
                // next available output on tap — a headset plugged mid-call is
                // picked up automatically.
                CallAction(
                    routeIcon(engine.audioRoute),
                    routeLabel(engine.audioRoute),
                    active = engine.audioRoute != AudioRoute.EARPIECE,
                    enabled = true,
                ) { engine.cycleAudioRoute() }
                CallAction(
                    if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                    if (engine.muted) "Unmute" else "Mute",
                    active = engine.muted,
                    enabled = connected,
                ) { engine.toggleMute() }
                CallAction(
                    if (engine.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                    "Video",
                    active = call.kind == "VIDEO" && !engine.cameraOff,
                    enabled = connected,
                ) { engine.toggleCamera() }
            }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                CallAction(
                    Icons.Filled.PersonAddAlt1,
                    "Add call",
                    active = false,
                    enabled = connected,
                ) { engine.notify("Adding calls is coming in a future update.") }
                CallAction(
                    Icons.Filled.ScreenShare,
                    if (engine.sharing) "Stop share" else "Share screen",
                    active = engine.sharing,
                    enabled = connected,
                ) { engine.toggleShare() }
                CallAction(
                    Icons.Filled.CallEnd,
                    if (connected) "End call" else "Cancel",
                    active = false,
                    danger = true,
                    enabled = true,
                ) { haptics.heavy(); engine.hangup() }
            }
            Spacer(Modifier.weight(0.25f))
        }
    }
}

/** Dark rounded call-control button with an explicit enabled state. */
@Composable
private fun CallAction(
    icon: ImageVector,
    label: String,
    active: Boolean,
    enabled: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val haptics = rememberHaptics()
    val alpha = if (enabled) 1f else 0.35f
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.alpha(alpha)) {
        Box(
            Modifier
                .size(64.dp)
                .shadow(6.dp, CircleShape)
                .clip(CircleShape)
                .background(
                    when {
                        danger -> Brush.verticalGradient(
                            listOf(
                                androidx.compose.ui.graphics.lerp(Red, Color.White, 0.25f),
                                Red,
                                androidx.compose.ui.graphics.lerp(Red, Color.Black, 0.22f),
                            ),
                        )
                        active -> Brush.verticalGradient(
                            listOf(
                                androidx.compose.ui.graphics.lerp(Gold, Color.White, 0.3f),
                                Gold,
                                androidx.compose.ui.graphics.lerp(Gold, Color.Black, 0.2f),
                            ),
                        )
                        else -> Brush.verticalGradient(listOf(Color(0x42FFFFFF), Color(0x1AFFFFFF)))
                    },
                )
                .border(1.dp, Color.White.copy(alpha = 0.33f), CircleShape)
                .clickable(enabled = enabled) { haptics.tap(); onClick() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = label,
                tint = Color.White,
                modifier = Modifier.size(26.dp),
            )
        }
        Spacer(Modifier.height(7.dp))
        Text(label, color = if (danger) Color(0xFFFFB4AB) else Color(0xB3FFFFFF), fontSize = 12.sp)
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
/* IN-CALL VIDEO — authentic minimal dark                              */
/* strip: Mute / Camera / Screen share / End                           */
/* ------------------------------------------------------------------ */

@Composable
fun InCallVideoScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    val haptics = rememberHaptics()
    val secs = rememberTick(call.startedAt, call.connecting)
    var controlsVisible by remember { mutableStateOf(true) }
    var swapped by remember { mutableStateOf(false) }
    // mutableFloatStateOf avoids boxing a Float on every drag delta —
    // with the boxed mutableStateOf<Float>, each pixel of drag allocated
    // and triggered a state read/write cycle that showed up as PiP drag
    // lag, worse the longer the call ran.
    // -1f means: not placed yet; the first layout pass parks the tile in the
    // bottom-right corner inside the safe area.
    var pipX by remember { mutableFloatStateOf(-1f) }
    var pipY by remember { mutableFloatStateOf(-1f) }
    LaunchedEffect(controlsVisible) {
        if (controlsVisible) {
            kotlinx.coroutines.delay(3_000)
            controlsVisible = false
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Dark)
            // Consume the full video surface so taps never fall through to
            // the chat below; the same gesture toggles the controls.
            .clickable { controlsVisible = !controlsVisible },
    ) {
        /* Either feed can be promoted full-screen by tapping the PiP. */
        VideoRenderer(engine, remote = !swapped)

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
                        call.connecting || call.startedAt <= 0L -> "Connecting…"
                        secs > 0 -> clockText(secs)
                        else -> "Connecting…"
                    },
                    color = Color(0xB3FFFFFF),
                    fontSize = 12.sp,
                )
            }
        }

        /* PiP self-view — draggable anywhere on the frame.
         *
         * The old clamp used `size` from INSIDE the tile's own pointerInput,
         * i.e. the tile's own 96x132dp box rather than the screen — so the
         * reachable area was roughly 60x80dp next to the corner it was pinned
         * to. That is the whole "freely move kora jai na" report. Offsets are
         * now absolute coordinates inside the full-screen BoxWithConstraints,
         * clamped to (parent - self), so the tile reaches every edge while
         * staying fully visible. */
        BoxWithConstraints(Modifier.fillMaxSize().zIndex(1f)) {
            val dm = LocalDensity.current
            val parentW = with(dm) { maxWidth.toPx() }
            val parentH = with(dm) { maxHeight.toPx() }
            val selfW = with(dm) { 96.dp.toPx() }
            val selfH = with(dm) { 132.dp.toPx() }
            val edge = with(dm) { 14.dp.toPx() }
            val topLimit = with(dm) { 54.dp.toPx() }
            val bottomLimit = with(dm) { 150.dp.toPx() }
            LaunchedEffect(parentW, parentH) {
                if (pipX < 0f) {
                    pipX = (parentW - selfW - edge).coerceAtLeast(0f)
                    pipY = (parentH - selfH - bottomLimit).coerceAtLeast(topLimit)
                }
                // Rotation / a resize must not leave the tile off-screen.
                pipX = pipX.coerceIn(0f, (parentW - selfW).coerceAtLeast(0f))
                pipY = pipY.coerceIn(topLimit, (parentH - selfH).coerceAtLeast(topLimit))
            }
            Box(
                Modifier
                    .offset { IntOffset(pipX.roundToInt(), pipY.roundToInt()) }
                    // One pointerInput for BOTH drag and tap-to-swap: layering a
                    // separate .clickable on the same box made two gesture
                    // detectors arbitrate every touch (the old drag lag). The
                    // first down is consumed too, so a tap no longer leaks
                    // through to the full-screen Box and flickers the controls.
                    .pointerInput(parentW, parentH) {
                        awaitEachGesture {
                            val down = awaitFirstDown().also { it.consume() }
                            var moved = false
                            drag(down.id) { change ->
                                change.consume()
                                val d = change.positionChange()
                                if (d.x != 0f || d.y != 0f) moved = true
                                pipX = (pipX + d.x).coerceIn(0f, (parentW - selfW).coerceAtLeast(0f))
                                pipY = (pipY + d.y).coerceIn(topLimit, (parentH - selfH).coerceAtLeast(topLimit))
                            }
                            // Tap the self-view and the two feeds swap places:
                            // own camera full-screen, opponent's video in the
                            // tile (and back).
                            if (!moved) swapped = !swapped
                        }
                    }
                    .size(width = 96.dp, height = 132.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFF33302B))
                    .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(14.dp)),
            ) {
                VideoRenderer(engine, remote = swapped, fit = true, pip = true)
            }
        }

        /* bottom control strip */
        if (controlsVisible) Row(
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
    // 3D: soft drop shadow + top-lit gradient so the circle reads raised.
    Box(
        Modifier
            .size(size)
            .shadow(7.dp, CircleShape)
            .clip(CircleShape)
            .background(
                Brush.verticalGradient(
                    listOf(
                        androidx.compose.ui.graphics.lerp(color, Color.White, 0.28f),
                        color,
                        androidx.compose.ui.graphics.lerp(color, Color.Black, 0.18f),
                    ),
                ),
            )
            .border(1.dp, Color.White.copy(alpha = 0.35f), CircleShape)
            .clickable {
                haptics.confirm()
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) { icon() }
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
                .shadow(5.dp, CircleShape)
                .clip(CircleShape)
                .background(
                    when {
                        danger -> Brush.verticalGradient(
                            listOf(
                                androidx.compose.ui.graphics.lerp(Red, Color.White, 0.28f),
                                Red,
                                androidx.compose.ui.graphics.lerp(Red, Color.Black, 0.2f),
                            ),
                        )
                        active -> Brush.verticalGradient(
                            listOf(
                                androidx.compose.ui.graphics.lerp(Gold, Color.White, 0.3f),
                                Gold,
                                androidx.compose.ui.graphics.lerp(Gold, Color.Black, 0.2f),
                            ),
                        )
                        else -> Brush.verticalGradient(listOf(Color(0x3DFFFFFF), Color(0x14FFFFFF)))
                    },
                )
                .border(1.dp, Color.White.copy(alpha = 0.3f), CircleShape),
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

/**
 * WebRTC video renderer (remote full-bleed or local PiP).
 *
 * `pip` decides the SURFACE LAYER, and it must not be derived from `remote`.
 * Both feeds are SurfaceViews: the plain one is composited *behind* the window
 * (punch-through), the `setZOrderMediaOverlay(true)` one above it. As long as
 * "small tile" and "local camera" were the same thing that worked — but tap to
 * swap them and the opponent's video landed in the tile on the base layer,
 * under the main feed, i.e. the swap appeared to do nothing (the
 * "preview e click korle opponent er video choto preview er jaigay dekha jay na"
 * report). The small tile is now always the overlay, whoever is inside it.
 */
@Composable
fun VideoRenderer(engine: CallEngine, remote: Boolean, fit: Boolean = false, pip: Boolean = false) {
    key(remote, pip) {
    AndroidView(
        factory = { c ->
            SurfaceViewRenderer(c).apply {
                init(engine.egl.eglBaseContext, null)
                if (pip) {
                    setZOrderMediaOverlay(true)
                    clipToOutline = true
                    outlineProvider = object : android.view.ViewOutlineProvider() {
                        override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
                            outline.setRoundRect(0, 0, view.width, view.height, 14f * resources.displayMetrics.density)
                        }
                    }
                }
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

/** Icon + label for the audio-route button (voice call screen). */
private fun routeIcon(route: AudioRoute): ImageVector =
    when (route) {
        AudioRoute.BLUETOOTH -> Icons.Filled.Bluetooth
        AudioRoute.WIRED -> Icons.Filled.Headset
        AudioRoute.SPEAKER -> Icons.Filled.VolumeUp
        AudioRoute.EARPIECE -> Icons.Filled.PhoneInTalk
    }

private fun routeLabel(route: AudioRoute): String =
    when (route) {
        AudioRoute.BLUETOOTH -> "Bluetooth"
        AudioRoute.WIRED -> "Headset"
        AudioRoute.SPEAKER -> "Speaker"
        AudioRoute.EARPIECE -> "Earpiece"
    }

private fun engineApp(): android.content.Context =
    CallEngine.instance?.appContext ?: MainActivity.current
    ?: android.app.Application()
