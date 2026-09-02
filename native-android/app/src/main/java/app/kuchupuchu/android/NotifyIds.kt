package app.kuchupuchu.android

/**
 * The notification id of a message card, as ONE function used by both the posting
 * side and the action buttons (§48: notification ID generation / cancellation rules).
 *
 * This indirection is the fix for a mismatch, not a refactor: the notify path used
 * `mid.hashCode() and Int.MAX_VALUE` while KpNotifActionReceiver recomputed the same
 * id as a bare `mid.hashCode()`. `String.hashCode()` is negative for roughly half of
 * all ids (221 of the last 400 real message ids in production D1), so for those the
 * card was posted under a positive id and `cancel()` was called with the negative
 * one — Reply / Like / Mark-as-read dismissed nothing and the card sat in the tray.
 * Both sides now call this, so the two expressions cannot drift again, and the
 * equality is asserted in app/src/test rather than by eye.
 */
object NotifyIds {
    /**
     * Stable id for the card of message [mid], or null when the push carried no
     * message id (pre-`mid` payloads). Never negative: NotificationManager treats the
     * id as an opaque key, but a sign bit that one caller masks and another does not
     * is exactly the bug this file exists to prevent.
     */
    fun messageCard(mid: String?): Int? =
        mid?.takeIf { it.isNotBlank() }?.hashCode()?.and(Int.MAX_VALUE)

    /**
     * Id for a card the server never named. High bits come from [nanoTime] so two
     * messages of the same conversation do not silently replace each other — which
     * also means this id is NOT recomputable, so its card cannot be dismissed by an
     * action button. That is the trade the no-`mid` case accepts; the worker always
     * sends `mid` now, so this path only runs for payloads that predate it.
     */
    fun messageCardFallback(convId: String, nanoTime: Long): Int =
        (convId.hashCode() and 0x00FFFFFF) or ((nanoTime and 0x7F).toInt() shl 24)

    /** What [android.app.NotificationManager.notify] is called with. */
    fun messageCard(mid: String?, convId: String, nanoTime: Long): Int =
        messageCard(mid) ?: messageCardFallback(convId, nanoTime)
}
