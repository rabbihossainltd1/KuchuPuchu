package app.kuchupuchu.android

import kotlin.math.abs

/** Direction, threshold, and drag feedback shared by every reply-swipe row. */
internal object MessageReplySwipePolicy {
    /** One release distance for sent and received rows, regardless of media type. */
    fun requiredDistance(baseThresholdPx: Float): Float = baseThresholdPx * 1.4f

    fun isHorizontalIntent(deltaX: Float, deltaY: Float, touchSlopPx: Float): Boolean =
        abs(deltaX) > touchSlopPx && abs(deltaX) >= abs(deltaY) * 1.25f

    fun isReplyDirection(deltaX: Float, mine: Boolean): Boolean =
        if (mine) deltaX < 0f else deltaX > 0f

    fun dragOffset(deltaX: Float, mine: Boolean, baseThresholdPx: Float): Float {
        val limit = requiredDistance(baseThresholdPx) * 1.4f
        return if (mine) deltaX.coerceIn(-limit, 0f) else deltaX.coerceIn(0f, limit)
    }

    fun shouldReply(
        deltaX: Float,
        deltaY: Float,
        mine: Boolean,
        baseThresholdPx: Float,
    ): Boolean =
        isReplyDirection(deltaX, mine) &&
            abs(deltaX) >= requiredDistance(baseThresholdPx) &&
            abs(deltaX) >= abs(deltaY) * 1.25f
}
