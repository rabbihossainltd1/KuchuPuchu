package app.kuchupuchu.android

/** Pure, device-independent policy for classroom reconnect and re-auth decisions. */
object ClassroomRecoveryPolicy {
    fun shouldAutoRefresh(manuallyLeft: Boolean, refreshAttempts: Int): Boolean =
        !manuallyLeft && refreshAttempts == 0

    fun needsRelink(status: Int, code: String): Boolean =
        status == 401 || status == 403 ||
            code == "CLASSROOM_LINK_REQUIRED" ||
            code == "APPROVAL_REQUIRED"

    fun canRetryConnection(manuallyLeft: Boolean, needsRelink: Boolean): Boolean =
        !manuallyLeft && !needsRelink
}
