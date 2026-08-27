package app.kuchupuchu.android

import android.view.WindowManager
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
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
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PersonAddAlt1
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PhoneInTalk
import androidx.compose.material.icons.filled.PhotoCamera
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

/**
 * The six locked call screens (voice/video fully separate flows):
 *  incoming voice #1 · incoming video #3 · outgoing voice #4 ·
 *  outgoing video #5 · in-call voice #2 · in-call video #6
 */
@Composable
fun CallGate() {
    val engine = CallEngine.instance ?: return
    val call = engine.active ?: return

    LaunchedEffect(call.status, call.kind) {
        MainActivity.current?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    when {
        call.incoming && call.status == "RINGING" && call.kind == "VIDEO" -> IncomingVideoScreen(call)
        call.incoming && call.status == "RINGING" -> IncomingVoiceScreen(call)
        call.kind == "VIDEO" && (call.status == "RINGING" || call.connecting) -> OutgoingVideoScreen(call)
        call.status == "RINGING" || call.connecting -> OutgoingVoiceScreen(call)
        call.kind == "VIDEO" -> InCallVideoScreen(call)
        else -> InCallVoiceScreen(call)
    }

    if (engine.toast.isNotBlank()) {
        Box(Modifier.fillMaxWidth().padding(top = 60.dp), contentAlignment = Alignment.TopCenter) {
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
/* INCOMING VOICE — #1 classic dark                                    */
/* ------------------------------------------------------------------ */

@Composable
fun IncomingVoiceScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    DarkCallScaffold {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().padding(bottom = 42.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.7f))
            PulseRing {
                KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 108.dp, ring = false)
            }
            Spacer(Modifier.height(26.dp))
            Text(call.otherName, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text("Incoming voice call…", color = Color(0xB3FFFFFF), fontSize = 14.sp)
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 48.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CallCircle(Green, 66.dp) {
                    Icon(Icons.Filled.Call, "Accept", tint = Color.White, modifier = Modifier.size(30.dp))
                }
                CallCircle(Red, 66.dp) {
                    Icon(Icons.Filled.CallEnd, "Decline", tint = Color.White, modifier = Modifier.size(28.dp))
                }
            }
            Spacer(Modifier.height(22.dp))
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
                )            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* INCOMING VIDEO — #3 dark + amber pulse, three choices               */
/* ------------------------------------------------------------------ */

@Composable
fun IncomingVideoScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    DarkCallScaffold {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().padding(bottom = 46.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(0.7f))
            AmberPulseRing {
                KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 108.dp, ring = false)
            }
            Spacer(Modifier.height(26.dp))
            Text(call.otherName, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text("Incoming video call…", color = Color(0xB3FFFFFF), fontSize = 14.sp)
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 30.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                /* red decline */
                CallCircle(Red, 62.dp) {
                    Icon(Icons.Filled.CallEnd, "Decline", tint = Color.White, modifier = Modifier.size(26.dp))
                }
                /* frosted voice-only (green phone) */
                FrostedCircle {
                    Icon(Icons.Filled.Phone, "Answer with voice only", tint = Green, modifier = Modifier.size(27.dp))
                }
                /* green video accept */
                CallCircle(Green, 70.dp) {
                    Icon(Icons.Filled.Videocam, "Accept video", tint = Color.White, modifier = Modifier.size(33.dp))
                }
            }
            Spacer(Modifier.height(20.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 30.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                Text("Decline", color = Color(0x99FFFFFF), fontSize = 12.5.sp)
                Text("Voice only", color = Color(0x99FFFFFF), fontSize = 12.5.sp)
                Text("Video", color = Color(0x99FFFFFF), fontSize = 12.5.sp)
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* OUTGOING VOICE — #4 dark, pulse ring, early controls + cancel       */
/* ------------------------------------------------------------------ */

@Composable
fun OutgoingVoiceScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    DarkCallScaffold {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().padding(bottom = 46.dp),
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
                if (call.connecting) "Connecting…" else "Ringing…",
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
                FrostedPill(
                    Icons.Filled.Bluetooth,
                    if (engine.bluetooth) "Bluetooth on" else "Bluetooth",
                    active = engine.bluetooth,
                ) { engine.toggleBluetooth() }
            }
            Spacer(Modifier.height(34.dp))
            CallCircle(Red, 66.dp) {
                Icon(Icons.Filled.CallEnd, "Cancel", tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* OUTGOING VIDEO — #5 bottom sheet (callee top / white sheet)         */
/* ------------------------------------------------------------------ */

@Composable
fun OutgoingVideoScreen(call: CallUi) {
    val engine = CallEngine.instance ?: return
    Column(Modifier.fillMaxSize().background(Dark)) {
        /* cream top with callee */
        Column(
            Modifier
                .fillMaxWidth()
                .background(Cream)
                .statusBarsPadding()
                .padding(bottom = 34.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(30.dp))
            KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 96.dp, ring = false)
            Spacer(Modifier.height(18.dp))
            Text(call.otherName, color = Ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Text(
                if (call.connecting) "Connecting…" else "Ringing…",
                color = Muted,
                fontSize = 13.5.sp,
            )
            Spacer(Modifier.height(22.dp))
            /* local preview while ringing */
            Box(
                Modifier
                    .size(width = 110.dp, height = 150.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color(0xFF1C1917)),
            ) {
                VideoRenderer(engine, remote = false, fit = true)
            }
        }
        /* white sheet */
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Color.White)
                .navigationBarsPadding()
                .padding(vertical = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                SheetAction(Icons.Filled.Flip, "Flip") { engine.flipCamera() }
                SheetAction(
                    if (engine.cameraOff) Icons.Filled.Videocam else Icons.Filled.VideocamOff,
                    if (engine.cameraOff) "Camera on" else "Camera off",
                    tint = if (engine.cameraOff) Green else Ink,
                ) { engine.toggleCamera() }
                SheetAction(Icons.Filled.CallEnd, "Cancel", tint = Red) { engine.hangup() }
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* IN-CALL VOICE — #2 light airy: cream top + white sheet 3x2 grid     */
/* controls EXACTLY: Mute / Speaker / Bluetooth / Hold / Add call / End */
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
                color = if (engine.onHold) GoldDeep else Muted,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
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
            for (row in 0 until 2) {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    for (col in 0 until 3) {
                        when (row * 3 + col) {
                            0 -> GridAction(
                                if (engine.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                                if (engine.muted) "Unmute" else "Mute",
                                active = engine.muted,
                            ) { engine.toggleMute() }
                            1 -> GridAction(
                                Icons.Filled.VolumeUp,
                                if (engine.speaker) "Speaker on" else "Speaker",
                                active = engine.speaker,
                            ) { engine.toggleSpeaker() }
                            2 -> GridAction(
                                Icons.Filled.Bluetooth,
                                if (engine.bluetooth) "Bluetooth on" else "Bluetooth",
                                active = engine.bluetooth,
                            ) { engine.toggleBluetooth() }
                            3 -> GridAction(
                                Icons.Filled.Pause,
                                if (engine.onHold) "Resume" else "Hold",
                                active = engine.onHold,
                            ) { engine.toggleHold() }
                            4 -> GridAction(
                                Icons.Filled.PersonAddAlt1,
                                "Add call",
                                active = false,
                            ) { engine.notify("Adding calls is coming in a future update.") }
                            5 -> GridAction(
                                Icons.Filled.CallEnd,
                                "End call",
                                active = false,
                                danger = true,
                            ) { haptics.heavy(); engine.hangup() }
                        }
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* IN-CALL VIDEO — #6 authentic minimal dark                           */
/* strip: Mute / Camera off / Flip / Screen share / Voice only / End    */
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
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
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
                .padding(bottom = 190.dp, end = 14.dp)
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
                if (engine.cameraOff) "Camera off" else "Camera",
                active = engine.cameraOff,
            ) { engine.toggleCamera() }
            StripAction(Icons.Filled.Flip, "Flip", active = false) { engine.flipCamera() }
            StripAction(Icons.Filled.ScreenShare, "Share", active = engine.sharing) { engine.toggleShare() }
            StripAction(Icons.Filled.PhoneInTalk, "Voice only", active = false) {
                engine.toggleCamera()
            }
            StripAction(Icons.Filled.CallEnd, "End", active = false, danger = true) { haptics.heavy(); engine.hangup() }
        }
    }
}

/* ------------------------------------------------------------------ */
/* shared pieces                                                       */
/* ------------------------------------------------------------------ */

@Composable
private fun DarkCallScaffold(content: @Composable () -> Unit) {
    val engine = CallEngine.instance ?: return
    Box(Modifier.fillMaxSize().background(Dark)) {
        content()
        /* taps: green accept / red decline handled by children */
    }
}

@Composable
private fun CallCircle(color: Color, size: androidx.compose.ui.unit.Dp, icon: @Composable () -> Unit) {
    val engine = CallEngine.instance ?: return
    val haptics = rememberHaptics()
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(color)
            .clickable {
                haptics.confirm()
                when (color) {
                    Green -> engine.answer()
                    Red -> if (engine.active?.incoming == true) engine.decline() else engine.hangup()
                }
            },
        contentAlignment = Alignment.Center,
    ) { icon() }
}

@Composable
private fun FrostedCircle(icon: @Composable () -> Unit) {
    val engine = CallEngine.instance ?: return
    val haptics = rememberHaptics()
    Box(
        Modifier
            .size(62.dp)
            .clip(CircleShape)
            .background(Color(0x26FFFFFF))
            .border(1.dp, Color(0x40FFFFFF), CircleShape)
            .clickable {
                haptics.confirm()
                engine.answerVoiceOnly()
            },
        contentAlignment = Alignment.Center,
    ) { icon() }
}

@Composable
private fun FrostedPill(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(if (active) Color(0x66FFFFFF) else Color(0x26FFFFFF))
                .border(1.dp, Color(0x40FFFFFF), CircleShape)
                .clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(label, color = Color(0x99FFFFFF), fontSize = 11.sp)
    }
}

@Composable
private fun SheetAction(icon: ImageVector, label: String, tint: Color = Ink, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(58.dp)
                .clip(CircleShape)
                .background(Cream)
                .clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(26.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Muted, fontSize = 12.sp)
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
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable { onClick() },
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
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable { onClick() }.padding(horizontal = 2.dp),
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
            androidx.compose.animation.core.tween(1100),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )
    Box(Modifier.scale(s)) { content() }
}

@Composable
private fun AmberPulseRing(content: @Composable () -> Unit) {
    val t = rememberInfiniteTransition(label = "amberpulse")
    val s by t.animateFloat(
        initialValue = 1f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            androidx.compose.animation.core.tween(900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )
    Box(Modifier.scale(s)) {
        Box(
            Modifier
                .size(128.dp)
                .clip(CircleShape)
                .background(Color(0x26F59E0B)),
        )
        Box(Modifier.scale(s), contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(120.dp)
                    .clip(CircleShape)
                    .background(goldRing()),
            )
        }
        Box(contentAlignment = Alignment.Center) { content() }
    }
}

/** WebRTC video renderer (remote full-bleed or local PiP). */
@Composable
fun VideoRenderer(engine: CallEngine, remote: Boolean, fit: Boolean = false) {
    val ctx = LocalContext.current
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
            secs = if (startedAt > 0 && !paused) {
                ((System.currentTimeMillis() - startedAt) / 1000).toInt()
            } else 0
            kotlinx.coroutines.delay(1000)
        }
    }
    return secs
}

private fun clockText(secs: Int): String = "%d:%02d".format(secs / 60, secs % 60)

private fun engineApp(): android.content.Context =
    CallEngine.instance?.appContext ?: MainActivity.current
    ?: android.app.Application()
