package app.kuchupuchu.android

/**
 * The outbox queue's retry clock, as pure arithmetic (§48: retry/backoff, and the
 * crash-recovery rule in §11/§40). Kept out of `Outbox` for one reason: while the
 * numbers lived inside an object that owns a CoroutineScope, a ConnectivityCallback
 * and a JSON file, nothing could assert what they meant. Every rule here is total —
 * no argument shape, however wrong, is allowed to throw or to produce a negative
 * deadline (a negative `nextAt` means "due" forever, i.e. a hot retry loop).
 */
object OutboxPolicy {
    /** How long one message waits after each failed attempt (1.5s → 5min). */
    val backoffMs = longArrayOf(1_500L, 4_000L, 12_000L, 30_000L, 60_000L, 180_000L, 300_000L)

    /** Beyond this many automatic attempts only an explicit trigger retries it. */
    const val MAX_AUTO = 12

    /** Parked "forever" without overflowing a `Long` addition against `currentTimeMillis`. */
    private const val PARKED = Long.MAX_VALUE / 4

    /**
     * Delay to apply after the [attempts]th failed attempt (1-based). Past
     * [MAX_AUTO] the item is parked rather than retried forever; the clamp keeps a
     * caller that mis-counts (0 or a negative) on the first backoff instead of
     * indexing out of bounds.
     */
    fun waitMs(attempts: Int): Long =
        when {
            attempts >= MAX_AUTO -> PARKED
            attempts <= 1 -> backoffMs[0]
            else -> backoffMs[minOf(attempts - 1, backoffMs.size - 1)]
        }

    /**
     * A deadline that already passed is "now": a device restart must never leave a
     * queued message parked behind a backoff value computed before it went to sleep.
     * A future deadline is carried over untouched, and 0 means "immediate".
     */
    fun rearmOnLoad(nextAt: Long, nowMs: Long): Long =
        if (nextAt in 1 until nowMs) 0L else nextAt

    /** `true` when the item may be flushed now. Mirrors the queue's own gate. */
    fun isDue(nextAt: Long, nowMs: Long, force: Boolean): Boolean =
        force || nextAt <= nowMs
}
