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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.LocalPinnableContainer
import androidx.compose.ui.layout.PinnableContainer
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalGraphicsContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The one live Compose item that opened a focused action sheet. Its source
 * composition stays in its measured list slot; while focused, one GraphicsLayer
 * records that content and the root overlay replays the same display list.
 * This avoids transferring movable content across LazyColumn/NavHost slots.
 */
internal data class KpModalFocusItem(
    val key: String,
    val sourceBoundsOnScreen: Rect,
    val returnBoundsOnScreen: Rect = sourceBoundsOnScreen,
    val targetBoundsOnScreen: Rect? = null,
    val targetScale: Float,
    val graphicsLayer: GraphicsLayer,
    val releaseFocusResources: () -> Unit,
)

internal object KpModalFocusState {
    var focusedItem by mutableStateOf<KpModalFocusItem?>(null)
        private set
    var pendingFocusKey by mutableStateOf<String?>(null)
        private set
    private var returning by mutableStateOf(false)
    private var pendingFocusCleanup: (() -> Unit)? = null
    val isReturning: Boolean
        get() = returning

    fun beginCapture(key: String) {
        if (focusedItem == null) pendingFocusKey = key
    }

    fun cancelCapture(key: String) {
        if (pendingFocusKey == key) pendingFocusKey = null
    }

    fun focus(
        key: String,
        sourceBoundsOnScreen: Rect,
        graphicsLayer: GraphicsLayer,
        releaseFocusResources: () -> Unit,
        targetScale: Float = 1f,
    ) {
        if (focusedItem != null) return
        pendingFocusKey = null
        returning = false
        KpFocusSheetState.updateOverlayProgress(0f)
        focusedItem =
            KpModalFocusItem(
                key = key,
                sourceBoundsOnScreen = sourceBoundsOnScreen,
                returnBoundsOnScreen = sourceBoundsOnScreen,
                targetScale = targetScale,
                graphicsLayer = graphicsLayer,
                releaseFocusResources = releaseFocusResources,
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
        val previous = focusedItem
        focusedItem = null
        pendingFocusKey = null
        returning = false
        if (previous != null) pendingFocusCleanup = previous.releaseFocusResources
    }

    /** Release a retained Lazy item only after the root overlay stopped drawing its layer. */
    fun releasePendingCleanup() {
        val release = pendingFocusCleanup ?: return
        pendingFocusCleanup = null
        release()
    }
}

internal data class KpFocusSheetRequest(
    val key: String,
    val ownerRoute: String,
    val focusKey: String?,
    val onDismiss: () -> Unit,
    val content: @Composable ColumnScope.() -> Unit,
    val floatingContent: (@Composable () -> Unit)? = null,
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
        val current = this.request
        if (current?.key == request.key && !closing) {
            if (current.focusKey != request.focusKey) this.request = request
            return
        }
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
 * Keeps one original list/thread item in its source slot. While focused, the
 * source records (but does not display) its drawing commands; the root overlay
 * displays that same GraphicsLayer. It is allocated only on focus and pinned so
 * a LazyColumn keeps the source composed through return. No second tree or bitmap.
 */
@Composable
internal fun KpLiveFocusItem(
    key: String,
    modifier: Modifier = Modifier,
    targetScale: Float = 1f,
    content: @Composable (requestFocus: () -> Unit) -> Unit,
) {
    val view = LocalView.current
    val graphicsContext = LocalGraphicsContext.current
    val pinnableContainer = LocalPinnableContainer.current
    var focusLayer by remember(key, graphicsContext) { mutableStateOf<GraphicsLayer?>(null) }
    val sourceBounds = remember(key) { mutableStateOf<Rect?>(null) }
    var pinnedHandle by remember(key) { mutableStateOf<PinnableContainer.PinnedHandle?>(null) }
    var capturePending by remember(key, graphicsContext) { mutableStateOf(false) }
    val layerCaptureRecorded = remember(key, graphicsContext) { AtomicBoolean(false) }
    val captureScope = rememberCoroutineScope()
    val releaseFocusResources = remember(key, graphicsContext) {
        {
            capturePending = false
            layerCaptureRecorded.set(false)
            KpModalFocusState.cancelCapture(key)
            val layer = focusLayer
            focusLayer = null
            if (layer != null) graphicsContext.releaseGraphicsLayer(layer)
            val handle = pinnedHandle
            pinnedHandle = null
            handle?.release()
            Unit
        }
    }

    val requestFocus = remember(key, targetScale, graphicsContext, pinnableContainer, captureScope, releaseFocusResources) {
        {
            val bounds = sourceBounds.value
            if (
                bounds != null && bounds.width > 0f && bounds.height > 0f &&
                KpModalFocusState.focusedItem == null && !capturePending
            ) {
                KpModalFocusState.beginCapture(key)
                val layer = focusLayer ?: graphicsContext.createGraphicsLayer().also { focusLayer = it }
                if (pinnedHandle == null) pinnedHandle = pinnableContainer?.pin()
                // Keep the source visible while its first real draw is recorded.
                // Only hand it to the root overlay after recording has completed.
                layerCaptureRecorded.set(false)
                capturePending = true
                captureScope.launch {
                    var waitedFrames = 0
                    while (
                        (!layerCaptureRecorded.get() || layer.size.width <= 0 || layer.size.height <= 0) &&
                        waitedFrames < 8
                    ) {
                        withFrameNanos { }
                        waitedFrames++
                    }
                    val readyBounds = sourceBounds.value
                    val requestedFocusKey = KpFocusSheetState.request?.focusKey
                    if (
                        capturePending && layerCaptureRecorded.get() && layer.size.width > 0 && layer.size.height > 0 &&
                        readyBounds != null && readyBounds.width > 0f && readyBounds.height > 0f &&
                        KpModalFocusState.pendingFocusKey == key &&
                        (requestedFocusKey == null || requestedFocusKey == key) &&
                        !KpFocusSheetState.closing && KpModalFocusState.focusedItem == null
                    ) {
                        capturePending = false
                        KpModalFocusState.focus(
                            key = key,
                            sourceBoundsOnScreen = readyBounds,
                            graphicsLayer = layer,
                            releaseFocusResources = releaseFocusResources,
                            targetScale = targetScale,
                        )
                    } else {
                        releaseFocusResources()
                    }
                }
            }
        }
    }

    val focused = KpModalFocusState.focusedItem?.key == key
    DisposableEffect(key, graphicsContext, releaseFocusResources) {
        onDispose {
            // A Lazy item can still be removed by a data update while pinned.
            // Clear first so the root stops drawing its retained layer before release.
            if (KpModalFocusState.focusedItem?.key == key) {
                KpModalFocusState.clear()
            } else {
                releaseFocusResources()
            }
        }
    }

    Box(
        modifier
            .onGloballyPositioned { coordinates ->
                val currentBounds = coordinates.boundsOnScreen(view)
                sourceBounds.value = currentBounds
                if (focused) KpModalFocusState.updateSource(key, currentBounds)
            }
            .drawWithContent {
                val layer = focusLayer
                if (focused && layer != null) {
                    layer.record {
                        this@drawWithContent.drawContent()
                    }
                } else if (capturePending && layer != null) {
                    // Capture at the source while it remains visible; the next
                    // frame can safely replace it with the root overlay copy.
                    layer.record {
                        this@drawWithContent.drawContent()
                    }
                    layerCaptureRecorded.set(true)
                    drawContent()
                } else {
                    drawContent()
                }
            },
    ) {
        content(requestFocus)
    }
}

/** Root-level, stable call site for the live display layer during every sheet phase. */
@Composable
internal fun KpRootFocusOverlayHost() {
    val item = KpModalFocusState.focusedItem
    SideEffect {
        if (item == null) KpModalFocusState.releasePendingCleanup()
    }
    if (item != null) KpModalFocusOverlay(KpFocusSheetState.overlayProgress)
}

/** Replay the original item's recorded Compose drawing over the root-hosted sheet. */
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
    val floatingContent =
        KpFocusSheetState.request
            ?.takeIf { it.focusKey == item.key }
            ?.floatingContent
    // Keep the live source layer and its anchored reaction strip explicitly
    // above the sheet, regardless of sibling draw-order changes at the root.
    BoxWithConstraints(Modifier.fillMaxSize().zIndex(1f)) {
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
                }
                .drawWithContent {
                    val layerSize = item.graphicsLayer.size
                    if (layerSize.width > 0 && layerSize.height > 0) {
                        scale(
                            scaleX = size.width / layerSize.width.toFloat(),
                            scaleY = size.height / layerSize.height.toFloat(),
                            pivot = Offset.Zero,
                        ) {
                            drawLayer(item.graphicsLayer)
                        }
                    }
                    drawContent()
                },
        ) {
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
        if (floatingContent != null && t > 0.78f && !KpFocusSheetState.closing) {
            val floatingBarHeight = 52.dp
            val floatingBarWidth = (maxWidth - 24.dp).coerceAtLeast(1.dp).coerceAtMost(320.dp)
            val barWidthPx = with(density) { floatingBarWidth.roundToPx() }
            val barHeightPx = with(density) { floatingBarHeight.roundToPx() }
            val rootWidthPx = with(density) { maxWidth.roundToPx() }
            val sideInsetPx = with(density) { 12.dp.roundToPx() }
            val centerX = left + source.width / 2f - location[0]
            val barLeftPx = (centerX - barWidthPx / 2f).roundToInt().coerceIn(
                sideInsetPx,
                (rootWidthPx - barWidthPx - sideInsetPx).coerceAtLeast(sideInsetPx),
            )
            val barTopPx =
                (top - location[1] - barHeightPx - with(density) { 8.dp.roundToPx() })
                    .roundToInt()
                    .coerceAtLeast(with(density) { 24.dp.roundToPx() })
            val barProgress = ((t - 0.78f) / 0.22f).coerceIn(0f, 1f)
            Box(
                Modifier
                    .offset { IntOffset(barLeftPx, barTopPx) }
                    .size(floatingBarWidth, floatingBarHeight)
                    .graphicsLayer {
                        alpha = barProgress
                        scaleX = 0.94f + 0.06f * barProgress
                        scaleY = 0.94f + 0.06f * barProgress
                        transformOrigin = TransformOrigin.Center
                    }
                    .zIndex(2f),
            ) {
                floatingContent()
            }
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
    var sheetBoundsOnScreen by remember(request.key) { mutableStateOf<Rect?>(null) }
    var dragOffsetPx by remember(request.key) { mutableStateOf(0f) }
    BackHandler(enabled = true) {
        if (!KpFocusSheetState.closing) KpFocusSheetState.dismiss()
    }

    LaunchedEffect(request.key, request.focusKey, closing) {
        if (!closing) {
            // Wait for the wrapped menu to report its natural height, then use
            // that exact distance for the slide (no first-frame position jump).
            snapshotFlow { sheetHeightPx }.first { it > 0 }
            if (request.focusKey != null) {
                // Do not let the sheet cover the source while its first graphics
                // layer is still empty. The source records and stays visible until
                // the root host has a measured live layer and a real target.
                snapshotFlow {
                    KpModalFocusState.focusedItem
                        ?.takeIf { it.key == request.focusKey }
                        ?.targetBoundsOnScreen
                }.first { it != null }
            }
            coroutineScope {
                launch {
                    sheetProgress.animateTo(
                        0f,
                        tween(durationMillis = 320, easing = FastOutSlowInEasing),
                    )
                }
                if (request.focusKey != null) {
                    launch {
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
        val focusKey = request.focusKey
        val focusedItemKey = KpModalFocusState.focusedItem?.key
        val measuredSheetBounds = sheetBoundsOnScreen
        SideEffect {
            if (focusKey != null && focusedItemKey == focusKey && measuredSheetBounds != null) {
                KpModalFocusState.updateTargetAboveSheet(
                    focusKey,
                    measuredSheetBounds,
                    sheetOffsetYPx,
                    with(density) { 12.dp.toPx() },
                )
            }
        }
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
                    val bounds = coordinates.boundsOnScreen(view)
                    sheetBoundsOnScreen = bounds
                    sheetHeightPx = coordinates.size.height
                    request.focusKey?.let { focusKey ->
                        KpModalFocusState.updateTargetAboveSheet(
                            focusKey,
                            bounds,
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
