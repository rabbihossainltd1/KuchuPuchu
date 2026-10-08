package app.kuchupuchu.android

import kotlin.math.abs

/** Direction, threshold, and drag feedback shared by photo and album reply swipes. */
internal object MessageReplySwipePolicy {
    fun requiredDistance(baseThresholdPx: Float, mine: Boolean): Float =
        baseThresholdPx * if (mine) 1.5f else 1f

    fun isHorizontalIntent(deltaX: Float, deltaY: Float, touchSlopPx: Float): Boolean =
        abs(deltaX) > touchSlopPx && abs(deltaX) >= abs(deltaY) * 1.25f

    fun isReplyDirection(deltaX: Float, mine: Boolean): Boolean =
        if (mine) deltaX < 0f else deltaX > 0f

    fun dragOffset(deltaX: Float, mine: Boolean, baseThresholdPx: Float): Float {
        val limit = requiredDistance(baseThresholdPx, mine) * 1.4f
        return if (mine) deltaX.coerceIn(-limit, 0f) else deltaX.coerceIn(0f, limit)
    }

    fun shouldReply(
        deltaX: Float,
        deltaY: Float,
        mine: Boolean,
        baseThresholdPx: Float,
    ): Boolean =
        isReplyDirection(deltaX, mine) &&
            abs(deltaX) >= requiredDistance(baseThresholdPx, mine) &&
            abs(deltaX) >= abs(deltaY) * 1.25f
}
