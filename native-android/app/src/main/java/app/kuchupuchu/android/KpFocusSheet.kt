package app.kuchupuchu.android

import android.view.View
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The live item that opened a focused action sheet. Its movable Compose
 * content is transferred from its list slot to the root overlay; the source
 * slot remains measured as a placeholder until the return animation finishes.
 * This crosses LazyColumn/NavHost subcompositions, so the app pins Compose
 * Runtime 1.12.1+ for the movable-content invalidation and slot-table fixes.
 */
internal data class KpModalFocusItem(
    val key: String,
    val sourceBoundsOnScreen: Rect,
    val returnBoundsOnScreen: Rect = sourceBoundsOnScreen,
    val targetBoundsOnScreen: Rect? = null,
    val targetScale: Float,
    val content: @Composable () -> Unit,
)

internal object KpModalFocusState {
    var focusedItem by mutableStateOf<KpModalFocusItem?>(null)
        private set
    private var returning by mutableStateOf(false)
    val isReturning: Boolean
        get() = returning

    fun focus(
        key: String,
        sourceBoundsOnScreen: Rect,
        content: @Composable () -> Unit,
        targetScale: Float = 1f,
    ) {
        returning = false
        KpFocusSheetState.updateOverlayProgress(0f)
        focusedItem =
            KpModalFocusItem(
                key = key,
                sourceBoundsOnScreen = sourceBoundsOnScreen,
                returnBoundsOnScreen = sourceBoundsOnScreen,
                targetScale = targetScale,
                content = content,
            )
    }

    fun updateTargetAboveSheet(
        key: String,
        sheetBoundsOnScreen: Rect,
        sheetOffsetYPx: Float,
        gapPx: Float,
    ) {
        val item = focusedItem ?: return
        if (item.key != key || returning) return
        val source = item.sourceBoundsOnScreen
        // The same live row/bubble rests in the clear space directly above the
        // sheet. Subtract Modifier.offset's rounded displacement so the target
        // stays fixed while the sheet slides into place beneath it.
        val finalSheetTop = sheetBoundsOnScreen.top - sheetOffsetYPx.roundToInt()
        val left = sheetBoundsOnScreen.center.x - source.width / 2f
        val top = finalSheetTop - source.height - gapPx
        val target = Rect(left, top, left + source.width, top + source.height)
        if (item.targetBoundsOnScreen != target) {
            focusedItem = item.copy(targetBoundsOnScreen = target)
        }
    }

    fun updateSource(key: String, boundsOnScreen: Rect) {
        val item = focusedItem ?: return
        if (item.key != key || returning) return
        if (item.returnBoundsOnScreen != boundsOnScreen) {
            focusedItem = item.copy(returnBoundsOnScreen = boundsOnScreen)
        }
    }

    fun beginReturn() {
        returning = true
    }

    fun clear() {
        focusedItem = null
        returning = false
    }
}

internal data class KpFocusSheetRequest(
    val key: String,
    val ownerRoute: String,
    val focusKey: String?,
    val onDismiss: () -> Unit,
    val content: @Composable ColumnScope.() -> Unit,
)

/** One root-hosted sheet at a time, so the lifted item and the sheet share the same Compose tree. */
internal object KpFocusSheetState {
    var request by mutableStateOf<KpFocusSheetRequest?>(null)
        private set
    var closing by mutableStateOf(false)
        private set
    var overlayProgress by mutableFloatStateOf(0f)
        private set

    private var notifyDismiss = false
    private var afterClose: (() -> Unit)? = null

    fun updateOverlayProgress(value: Float) {
        overlayProgress = value.coerceIn(0f, 1f)
    }

    fun open(request: KpFocusSheetRequest) {
        if (this.request?.key == request.key && !closing) return
        this.request = request
        closing = false
        notifyDismiss = false
        afterClose = null
    }

    fun close(after: (() -> Unit)? = null) {
        if (request == null || closing) return
        closing = true
        notifyDismiss = false
        afterClose = after
    }

    fun dismiss() {
        if (request == null || closing) return
        closing = true
        notifyDismiss = true
        afterClose = null
    }

    fun finishClose() {
        val finished = request
        val dismiss = notifyDismiss
        val action = afterClose
        request = null
        closing = false
        overlayProgress = 0f
        notifyDismiss = false
        afterClose = null
        if (dismiss) finished?.onDismiss?.invoke() else action?.invoke()
    }
}

/**
 * Wraps one original list/thread item in movable content. Call requestFocus()
 * from its long-press handler; no bitmap or second visual copy is created.
 */
@Composable
internal fun KpLiveFocusItem(
    key: String,
    modifier: Modifier = Modifier,
    targetScale: Float = 1f,
    content: @Composable (requestFocus: () -> Unit) -> Unit,
) {
    val density = LocalDensity.current
    val view = LocalView.current
    val sourceBounds = remember(key) { mutableStateOf<Rect?>(null) }
    val sourceWidthPx = remember(key) { mutableIntStateOf(0) }
    val sourceHeightPx = remember(key) { mutableIntStateOf(0) }
    val focusContentRef = remember(key) { mutableStateOf<(@Composable () -> Unit)?>(null) }

    val requestFocus = remember(key, targetScale) {
        {
            val bounds = sourceBounds.value
            val heightPx = sourceHeightPx.intValue
            val liveContent = focusContentRef.value
            if (bounds != null && sourceWidthPx.intValue > 0 && heightPx > 0 && liveContent != null) {
                KpModalFocusState.focus(
                    key = key,
                    sourceBoundsOnScreen = bounds,
                    content = liveContent,
                    targetScale = targetScale,
                )
            }
        }
    }

    val currentContent: @Composable () -> Unit = { content(requestFocus) }
    val latestContent = rememberUpdatedState(currentContent)
    val movable = remember(key) {
        androidx.compose.runtime.movableContentOf {
            latestContent.value()
        }
    }
    val focusContent: @Composable () -> Unit = remember(key) { { movable() } }
    SideEffect { focusContentRef.value = focusContent }

    val focused = KpModalFocusState.focusedItem?.key == key
    Box(
        modifier.onGloballyPositioned { coordinates ->
            // The wrapper remains measured as a placeholder while the live
            // content is lifted; only its return endpoint follows list reflow.
            val currentBounds = coordinates.boundsOnScreen(view)
            sourceBounds.value = currentBounds
            if (!focused) {
                sourceWidthPx.intValue = coordinates.size.width
                sourceHeightPx.intValue = coordinates.size.height
            } else {
                // The list/thread may reflow behind the sheet while realtime
                // updates arrive. Keep the return endpoint aligned to the live
                // placeholder without moving the lifted item off the sheet.
                KpModalFocusState.updateSource(key, currentBounds)
            }
        },
    ) {
        if (focused) {
            Spacer(
                Modifier
                    .width(with(density) { sourceWidthPx.intValue.toDp() })
                    .height(with(density) { sourceHeightPx.intValue.toDp() }),
            )
        } else {
            movable()
        }
    }
}

/** Root-level, stable call site for the live item during every sheet phase. */
@Composable
internal fun KpRootFocusOverlayHost() {
    val item = KpModalFocusState.focusedItem
    if (item != null) KpModalFocusOverlay(KpFocusSheetState.overlayProgress)
}

/** Draw the same live movable item over the root-hosted sheet. */
@Composable
internal fun KpModalFocusOverlay(progress: Float) {
    val item = KpModalFocusState.focusedItem ?: return
    val density = LocalDensity.current
    val rootView = LocalView.current
    val location = remember(rootView) { IntArray(2) }
    rootView.getLocationOnScreen(location)
    val source = if (KpModalFocusState.isReturning) item.returnBoundsOnScreen else item.sourceBoundsOnScreen
    val target = item.targetBoundsOnScreen ?: item.sourceBoundsOnScreen
    val t = progress.coerceIn(0f, 1f)
    val left = source.left + (target.left - source.left) * t
    val top = source.top + (target.top - source.top) * t
    val width = with(density) { source.width.toDp() }
    val height = with(density) { source.height.toDp() }
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .offset {
                    IntOffset(
                        (left - location[0]).roundToInt(),
                        (top - location[1]).roundToInt(),
                    )
                }
                .size(width, height)
                .graphicsLayer {
                    val scale = 1f + (item.targetScale - 1f) * t
                    scaleX = scale
                    scaleY = scale
                    transformOrigin = TransformOrigin.Center
                },
        ) {
            item.content()
            // The lifted row/bubble is a visual focus target, not an action
            // surface. Keep taps from accidentally opening media beneath the
            // context menu; the reserved slot has no sheet options underneath.
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable(
                        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                        indication = null,
                    ) {},
            )
        }
    }
}

/** Convert a Compose window-relative rectangle into physical display coordinates. */
internal fun LayoutCoordinates.boundsOnScreen(view: View): Rect {
    val local = boundsInWindow()
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    return Rect(
        left = local.left + location[0],
        top = local.top + location[1],
        right = local.right + location[0],
        bottom = local.bottom + location[1],
    )
}

/**
 * Root-hosted counterpart of KpSheet for the two long-press menus that need a
 * live shared item. The ordinary KpSheet remains Material3-owned and unchanged.
 */
@Composable
internal fun KpFocusedSheetHost() {
    val request = KpFocusSheetState.request ?: return
    val closing = KpFocusSheetState.closing
    val blurRegistration = KpRegisterModalBlur()
    val density = LocalDensity.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()
    val sheetProgress = remember(request.key) { Animatable(1f) }
    val focusProgress = remember(request.key) { Animatable(0f) }
    LaunchedEffect(focusProgress) {
        snapshotFlow { focusProgress.value }.collect(KpFocusSheetState::updateOverlayProgress)
    }
    var sheetHeightPx by remember(request.key) { mutableIntStateOf(0) }
    var dragOffsetPx by remember(request.key) { mutableStateOf(0f) }
    BackHandler(enabled = true) {
        if (!KpFocusSheetState.closing) KpFocusSheetState.dismiss()
    }

    LaunchedEffect(request.key, closing) {
        if (!closing) {
            // Wait for the wrapped menu to report its natural height, then use
            // that exact distance for the slide (no first-frame position jump).
            snapshotFlow { sheetHeightPx }.first { it > 0 }
            coroutineScope {
                launch {
                    sheetProgress.animateTo(
                        0f,
                        tween(durationMillis = 320, easing = FastOutSlowInEasing),
                    )
                }
                if (request.focusKey != null) {
                    launch {
                        snapshotFlow {
                            KpModalFocusState.focusedItem
                                ?.takeIf { it.key == request.focusKey }
                                ?.targetBoundsOnScreen
                        }.first { it != null }
                        focusProgress.animateTo(
                            1f,
                            tween(durationMillis = 320, easing = FastOutSlowInEasing),
                        )
                    }
                }
            }
        } else {
            blurRegistration.release()
            KpModalFocusState.beginReturn()
            coroutineScope {
                launch {
                    focusProgress.animateTo(
                        0f,
                        tween(durationMillis = 240, easing = FastOutSlowInEasing),
                    )
                }
                launch {
                    sheetProgress.animateTo(
                        1f,
                        tween(durationMillis = 280, easing = FastOutSlowInEasing),
                    )
                }
            }
            // Move the one live composition back into its source slot before
            // any follow-up dialog/route action is allowed to appear.
            KpModalFocusState.clear()
            dragOffsetPx = 0f
            KpFocusSheetState.finishClose()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxSheetHeight = maxHeight * 0.94f
        // Use the cap until the sheet is measured so its first frame starts
        // below the viewport instead of flashing at the final position.
        val slideDistancePx =
            (if (sheetHeightPx > 0) sheetHeightPx else with(density) { maxSheetHeight.roundToPx() }).toFloat()
        val sheetOffsetYPx = slideDistancePx * sheetProgress.value + dragOffsetPx
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.10f * (1f - sheetProgress.value).coerceIn(0f, 1f)))
                .clickable(
                    interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                    indication = null,
                ) {
                    if (!KpFocusSheetState.closing) KpFocusSheetState.dismiss()
                },
        )
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .heightIn(max = maxSheetHeight)
                .offset { IntOffset(0, sheetOffsetYPx.roundToInt()) }
                .onGloballyPositioned { coordinates ->
                    sheetHeightPx = coordinates.size.height
                    request.focusKey?.let { focusKey ->
                        KpModalFocusState.updateTargetAboveSheet(
                            focusKey,
                            coordinates.boundsOnScreen(view),
                            sheetOffsetYPx,
                            with(density) { 12.dp.toPx() },
                        )
                    }
                }
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(GlassSheetSurface),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 8.dp)
                    .padding(bottom = 10.dp),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(32.dp)
                        .pointerInput(request.key, closing) {
                            detectVerticalDragGestures(
                                onVerticalDrag = { change, dragAmount ->
                                    if (!KpFocusSheetState.closing && (dragAmount > 0f || dragOffsetPx > 0f)) {
                                        dragOffsetPx = (dragOffsetPx + dragAmount).coerceAtLeast(0f)
                                        change.consume()
                                    }
                                },
                                onDragEnd = {
                                    if (dragOffsetPx > with(density) { 76.dp.toPx() }) {
                                        KpFocusSheetState.dismiss()
                                    } else {
                                        val start = dragOffsetPx
                                        scope.launch {
                                            androidx.compose.animation.core.animate(
                                                initialValue = start,
                                                targetValue = 0f,
                                                animationSpec = tween(180, easing = FastOutSlowInEasing),
                                            ) { value, _ -> dragOffsetPx = value }
                                        }
                                    }
                                },
                                onDragCancel = {
                                    val start = dragOffsetPx
                                    scope.launch {
                                        androidx.compose.animation.core.animate(
                                            initialValue = start,
                                            targetValue = 0f,
                                            animationSpec = tween(180, easing = FastOutSlowInEasing),
                                        ) { value, _ -> dragOffsetPx = value }
                                    }
                                },
                            )
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .width(32.dp)
                            .height(4.dp)
                            .clip(CircleShape)
                            .background(Muted.copy(alpha = 0.58f)),
                    )
                }
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = false)
                        .verticalScroll(scrollState),
                ) {
                    request.content(this)
                }
            }
        }
        if (closing) {
            // Eat input while the row is travelling home and the sheet exits.
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable(
                        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                        indication = null,
                    ) {},
            )
        }
    }
}
