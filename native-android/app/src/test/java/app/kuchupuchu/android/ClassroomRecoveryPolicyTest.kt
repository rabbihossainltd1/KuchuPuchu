package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassroomRecoveryPolicyTest {
    @Test
    fun `unexpected disconnect gets exactly one automatic token refresh`() {
        assertTrue(ClassroomRecoveryPolicy.shouldAutoRefresh(manuallyLeft = false, refreshAttempts = 0))
        assertFalse(ClassroomRecoveryPolicy.shouldAutoRefresh(manuallyLeft = false, refreshAttempts = 1))
        assertFalse(ClassroomRecoveryPolicy.shouldAutoRefresh(manuallyLeft = true, refreshAttempts = 0))
    }

    @Test
    fun `authorization and link failures require reauthentication`() {
        assertTrue(ClassroomRecoveryPolicy.needsRelink(401, ""))
        assertTrue(ClassroomRecoveryPolicy.needsRelink(403, "CLASSROOM_LINK_REQUIRED"))
        assertTrue(ClassroomRecoveryPolicy.needsRelink(409, "APPROVAL_REQUIRED"))
        assertFalse(ClassroomRecoveryPolicy.needsRelink(503, "CLASSROOM_UNAVAILABLE"))
    }

    @Test
    fun `manual retry is hidden after leave or when relinking is required`() {
        assertTrue(ClassroomRecoveryPolicy.canRetryConnection(manuallyLeft = false, needsRelink = false))
        assertFalse(ClassroomRecoveryPolicy.canRetryConnection(manuallyLeft = true, needsRelink = false))
        assertFalse(ClassroomRecoveryPolicy.canRetryConnection(manuallyLeft = false, needsRelink = true))
    }
}
