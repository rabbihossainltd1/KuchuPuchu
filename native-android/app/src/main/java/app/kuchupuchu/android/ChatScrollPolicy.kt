package app.kuchupuchu.android

/**
 * Policy for automatic tail-follow caused by background activity (polling,
 * typing indicators, or a live AI reveal). Explicit user actions such as Send
 * and a quote jump choose their own scroll behavior and do not use this gate.
 */
internal object ChatScrollPolicy {
    /** Compare against LazyColumn's rendered rows, not raw messages (albums fold several messages into one row). */
    fun isNearTail(lastVisibleItemIndex: Int?, renderedItemCount: Int, allowance: Int = 2): Boolean =
        renderedItemCount > 0 && lastVisibleItemIndex != null && lastVisibleItemIndex >= renderedItemCount - allowance

    /**
     * A live arrival may keep a reader pinned only when they were already near
     * the tail and the list is idle. isScrollInProgress covers a drag and fling;
     * auto-scrolls during either one compete with the user's gesture and make a
     * downward swipe feel like it stops after a few pixels.
     */
    fun shouldFollowTail(nearBottom: Boolean, scrollInProgress: Boolean): Boolean =
        nearBottom && !scrollInProgress
}
