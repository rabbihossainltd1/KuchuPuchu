package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallNegotiationPolicyTest {
    @Test
    fun addTrackAndSetDirectionDuringAcceptCannotRaceTheFirstSdp() {
        assertFalse(canRenegotiateCall(false, false, false))
        assertFalse(canRenegotiateCall(false, true, false))
        assertFalse(canRenegotiateCall(false, false, true))
        // Even both local descriptions being present is insufficient until
        // the answer POST has committed the initial exchange to the authority.
        assertFalse(canRenegotiateCall(false, true, true))
    }

    @Test
    fun establishedCallsCanStillRenegotiateCameraScreenAndIce() {
        assertTrue(canRenegotiateCall(true, true, true))
        assertFalse(canRenegotiateCall(true, false, true))
        assertFalse(canRenegotiateCall(true, true, false))
    }
}
