package app.kuchupuchu.android

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * v166 (owner: "in app update downloading er somoy ei animation ta hobe ar
 * update available animation ta tumi ei animation er sathe sync kore create
 * kore daw … colour system ta app er sathe match korbe"): the in-app update
 * popup is the owner's own "maintenance crew" scene, ported from his web demo
 * (`app-update-animation/demo.html`) and recoloured into the app's palette.
 *
 * The demo, piece by piece — and where each piece lives here:
 *  • two gears turning in opposite directions at different speeds, with the
 *    demo's own non-linear curve (cubic-bezier(.45,0,.55,1) → 3.2 s and
 *    2.1 s) — the two spin animations;
 *  • a soft radial glow pulsing behind them (2.4 s) — the halo Box;
 *  • a hammer swinging through the demo's keyframes (0 → −32° at 32 % → +10°
 *    at 48 % → −3° at 62 % → 0, 900 ms, repeat) — the keyframes spec;
 *  • sparks spat from the impact point every 880 ms, each flying out on its own
 *    random dx/dy, shrinking and fading (380–540 ms) — [Spark] + the Canvas;
 *  • a status headline cycling through the demo's work lines, cross-fading
 *    with a 4 px slide (1.1 s apart);
 *  • the bar: a Gold → ActionBlue gradient with a travelling shimmer, its fill
 *    driven by the REAL download progress;
 *  • the walking figure riding the fill's leading edge, which becomes a
 *    checkmark with a spring pop and a green ring burst when the bytes land.
 *
 * The phase decides the mood, never a separate animation: [KpUpdatePhase.AVAILABLE]
 * plays the same crew at work (so the "update available" card and the download
 * card are visibly one family), [KpUpdatePhase.DOWNLOADING] adds the live bar
 * and the walking figure, [KpUpdatePhase.DONE] quiets the gears, lifts the
 * hammer away and throws the burst.
 */
enum class KpUpdatePhase { AVAILABLE, DOWNLOADING, DONE }

/** The demo's own lines, in its own order. */
private val KpUpdateMessages =
    listOf(
        "Fixing bugs…",
        "Optimizing performance…",
        "Applying patches…",
        "Polishing the UI…",
        "Finishing touches…",
    )

/** The demo's cubic-bezier(.45,0,.55,1): eased, never robotic. */
private val GearEase: Easing = CubicBezierEasing(0.45f, 0f, 0.55f, 1f)

/** Success green that sits next to the app's Blue / Gold family. */
private val KpUpdateGreen = Color(0xFF35C471)

/** One flying spark: born at the impact point, gone in ~500 ms. */
private class Spark(
    val x: Float,
    val y: Float,
    val dx: Float,
    val dy: Float,
    val radius: Float,
    val color: Color,
    val born: Long,
    val life: Int,
)

@Composable
fun KpUpdateScene(phase: KpUpdatePhase, progress: Float, modifier: Modifier = Modifier) {
    val working = phase != KpUpdatePhase.DONE
    val done = phase == KpUpdatePhase.DONE
    val accent = ActionBlue
    val track = Line
    val sparkColors = remember { listOf(Gold, GoldDeep, GoldLight) }

    // ---- gears: opposite spins (demo durations + easing); they calm on done.
    val spin = rememberInfiniteTransition(label = "gears")
    val bigTurn by
        spin.animateFloat(
            0f,
            360f,
            infiniteRepeatable(tween(3_200, easing = GearEase), RepeatMode.Restart),
            label = "gearBig",
        )
    val smallTurn by
        spin.animateFloat(
            0f,
            -360f,
            infiniteRepeatable(tween(2_100, easing = GearEase), RepeatMode.Restart),
            label = "gearSmall",
        )
    val glow by
        spin.animateFloat(
            0.6f,
            1f,
            infiniteRepeatable(tween(2_400, easing = GearEase), RepeatMode.Reverse),
            label = "glow",
        )
    val shimmer by
        spin.animateFloat(
            0f,
            1f,
            infiniteRepeatable(tween(1_400, easing = LinearEasing), RepeatMode.Restart),
            label = "shimmer",
        )
    // ---- the hammer: the demo's exact swing shape, looping while the crew works.
    val swing by
        spin.animateFloat(
            0f,
            0f,
            infiniteRepeatable(
                animation =
                    keyframes {
                        durationMillis = 900
                        0f at 0
                        -32f at 288
                        10f at 432
                        -3f at 558
                        0f at 675
                        0f at 900
                    },
                repeatMode = RepeatMode.Restart,
            ),
            label = "hammer",
        )
    val gearAlpha by animateFloatAsState(if (done) 0.2f else 1f, tween(280), label = "gearFade")
    val hammerAlpha by animateFloatAsState(if (done) 0f else 1f, tween(280), label = "hammerFade")
    val hammerLift by animateFloatAsState(if (done) (-10f) else 0f, tween(280), label = "hammerLift")

    // ---- sparks: four every 880 ms, from the hammer's impact point.
    val sparks = remember { mutableStateListOf<Spark>() }
    val impact = remember { mutableStateOf(Offset.Zero) }
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(working) {
        if (!working) {
            sparks.clear()
            return@LaunchedEffect
        }
        var nextSpawn = System.currentTimeMillis()
        while (true) {
            // One frame tick: this is what keeps the drifting sparks moving
            // (their position is time-based, so the draw needs invalidating).
            withFrameNanos { frame++ }
            val now = System.currentTimeMillis()
            if (now >= nextSpawn) {
                nextSpawn = now + 880
                val at = impact.value
                repeat(4) {
                    sparks.add(
                        Spark(
                            x = at.x,
                            y = at.y,
                            dx = (Random.nextFloat() - 0.5f) * 30f,
                            dy = -Random.nextFloat() * 20f - 4f,
                            radius = 1.5f + Random.nextFloat(),
                            color = sparkColors.random(),
                            born = now,
                            life = 380 + Random.nextInt(160),
                        ),
                    )
                }
            }
            if (sparks.isNotEmpty()) sparks.removeAll { now - it.born > it.life + 200L }
        }
    }

    // ---- headline: the demo's 1.1 s cross-fade with a 4 px slide.
    var mi by remember { mutableIntStateOf(0) }
    LaunchedEffect(phase) {
        mi = 0
        if (phase != KpUpdatePhase.DOWNLOADING) return@LaunchedEffect
        while (true) {
            delay(1_100)
            mi = (mi + 1) % KpUpdateMessages.size
        }
    }

    // ---- the ring burst behind the walking figure, once, on completion.
    val burst = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(done) {
        if (done) {
            burst.snapTo(0f)
            burst.animateTo(1f, tween(500))
        }
    }
    val frac = progress.coerceIn(0f, 1f)
    var barW by remember { mutableStateOf(0f) }
    val walkIconPx = with(LocalDensity.current) { 18.dp.toPx() }

    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        // ------------------------------------------------ the scene itself
        Box(Modifier.width(132.dp).height(112.dp)) {
            Box(
                Modifier
                    .size(120.dp)
                    .align(Alignment.Center)
                    .graphicsLayer {
                        val s = 0.92f + 0.16f * glow
                        scaleX = s
                        scaleY = s
                    }
                    .background(
                        Brush.radialGradient(
                            listOf(
                                if (done) {
                                    KpUpdateGreen.copy(alpha = 0.20f * glow)
                                } else {
                                    accent.copy(alpha = 0.22f * glow)
                                },
                                Color.Transparent,
                            ),
                        ),
                        CircleShape,
                    ),
            )
            Icon(
                Icons.Filled.Settings,
                contentDescription = null,
                tint = Muted,
                modifier =
                    Modifier
                        .offset(x = 6.dp, y = 22.dp)
                        .size(46.dp)
                        .graphicsLayer {
                            rotationZ = bigTurn
                            alpha = gearAlpha
                        },
            )
            Icon(
                Icons.Filled.Settings,
                contentDescription = null,
                tint = Gold,
                modifier =
                    Modifier
                        .offset(x = 50.dp, y = 6.dp)
                        .size(30.dp)
                        .graphicsLayer {
                            rotationZ = smallTurn
                            alpha = gearAlpha
                        },
            )
            Icon(
                Icons.Filled.Handyman,
                contentDescription = null,
                tint = GoldDeep,
                modifier =
                    Modifier
                        .offset(x = 92.dp, y = (-hammerLift).dp)
                        .size(30.dp)
                        .graphicsLayer {
                            rotationZ = swing
                            alpha = hammerAlpha
                            transformOrigin = TransformOrigin(0.8f, 0.15f)
                        },
            )
            Canvas(
                Modifier
                    .width(132.dp)
                    .height(112.dp)
                    .onSizeChanged { impact.value = Offset(it.width * 0.78f, it.height * 0.68f) },
            ) {
                // Reading `frame` invalidates the draw every frame, which is
                // what carries the sparks along their paths.
                @Suppress("UNUSED_EXPRESSION")
                frame
                val now = System.currentTimeMillis()
                sparks.forEach { s ->
                    val p = ((now - s.born).toFloat() / s.life).coerceIn(0f, 1f)
                    val cx = s.x + s.dx * p
                    val cy = s.y + s.dy * p
                    val r = s.radius * (1f - 0.8f * p)
                    if (r <= 0f) return@forEach
                    drawCircle(s.color.copy(alpha = 0.35f * (1f - p)), radius = r * 2.6f, center = Offset(cx, cy))
                    drawCircle(s.color.copy(alpha = 0.95f * (1f - p)), radius = r, center = Offset(cx, cy))
                }
            }
        }

        Spacer(Modifier.height(4.dp))
        // ------------------------------------------------ status headline
        AnimatedContent(
            targetState = if (phase == KpUpdatePhase.DOWNLOADING) mi else if (done) -1 else 9,
            transitionSpec = {
                (fadeIn(tween(280)) + slideInVertically { it / 5 }) togetherWith fadeOut(tween(160))
            },
            label = "status",
        ) { which ->
            val line =
                when {
                    done -> "All done!"
                    which in KpUpdateMessages.indices -> KpUpdateMessages[which]
                    else -> "Our crew is getting ready"
                }
            Text(
                line,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (done) KpUpdateGreen else Ink,
                textAlign = TextAlign.Center,
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(2.dp))
        Text(
            if (done) "The new version is ready to install" else "Our crew is working on it",
            fontSize = 12.sp,
            color = if (done) KpUpdateGreen.copy(alpha = 0.85f) else Muted,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )

        // -------------------------------- progress bar + the walking figure
        if (phase != KpUpdatePhase.AVAILABLE) {
            Spacer(Modifier.height(14.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(24.dp)
                    .onSizeChanged { barW = it.width.toFloat() },
            ) {
                Canvas(Modifier.fillMaxWidth().height(24.dp)) {
                    val barH = 5.dp.toPx()
                    val top = (size.height - barH) / 2f
                    val radius = CornerRadius(barH / 2f)
                    drawRoundRect(
                        color = track,
                        topLeft = Offset(0f, top),
                        size = Size(size.width, barH),
                        cornerRadius = radius,
                    )
                    val fillW = size.width * frac
                    if (fillW > 0f) {
                        if (done) {
                            drawRoundRect(
                                color = KpUpdateGreen,
                                topLeft = Offset(0f, top),
                                size = Size(fillW, barH),
                                cornerRadius = radius,
                            )
                        } else {
                            // The bar is the APP's accent in both themes —
                            // ActionBlue (blue in the dark app, the gold
                            // accent in the light one) with its lighter twin,
                            // so the demo's shimmer sweeps the gradient every
                            // 1.4 s and a soft highlight rides on top.
                            val span = size.width * 0.9f
                            val x0 = -span + shimmer * (size.width + span)
                            drawRoundRect(
                                brush =
                                    Brush.linearGradient(
                                        listOf(accent, ActionBlueDeep, accent),
                                        start = Offset(x0, 0f),
                                        end = Offset(x0 + span, 0f),
                                    ),
                                topLeft = Offset(0f, top),
                                size = Size(fillW, barH),
                                cornerRadius = radius,
                            )
                            val hx = x0 + span * 0.5f
                            if (hx > -40f && hx < fillW + 40f) {
                                drawRoundRect(
                                    brush =
                                        Brush.horizontalGradient(
                                            listOf(
                                                Color.Transparent,
                                                Color.White.copy(alpha = 0.35f),
                                                Color.Transparent,
                                            ),
                                            startX = hx - 24f,
                                            endX = hx + 24f,
                                        ),
                                    topLeft = Offset(0f, top),
                                    size = Size(fillW, barH),
                                    cornerRadius = radius,
                                )
                            }
                        }
                    }
                }
                if (walkIconPx > 0f && barW > 0f) {
                    val iconX = ((barW - walkIconPx) * frac).coerceAtLeast(0f)
                    val bp = burst.value
                    if (done && bp > 0f && bp < 1f) {
                        Canvas(Modifier.size(24.dp).offset { IntOffset(iconX.roundToInt() - 3, -6) }) {
                            drawCircle(
                                color = KpUpdateGreen.copy(alpha = 0.7f * (1f - bp)),
                                radius = size.minDimension / 2f * (0.3f + 2.1f * bp),
                                center = center,
                                style = Stroke(width = 2.dp.toPx()),
                            )
                        }
                    }
                    AnimatedContent(
                        targetState = done,
                        transitionSpec = {
                            scaleIn(spring(dampingRatio = Spring.DampingRatioMediumBouncy)) togetherWith
                                fadeOut(tween(120))
                        },
                        label = "walker",
                        modifier = Modifier.offset { IntOffset(iconX.roundToInt(), 0) },
                    ) { finished ->
                        Icon(
                            if (finished) Icons.Filled.Check else Icons.Filled.DirectionsWalk,
                            contentDescription = null,
                            tint = if (finished) KpUpdateGreen else accent,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                "${(frac * 100).roundToInt()}%",
                fontSize = 12.sp,
                color = if (done) KpUpdateGreen else Muted,
            )
        } else {
            Spacer(Modifier.height(10.dp))
        }
    }
}
