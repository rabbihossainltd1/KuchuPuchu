package app.kuchupuchu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phone auth: the E.164 normalizer is the one piece of the OTP-less flow that
 * MUST agree with the worker character-for-character (the worker re-normalizes
 * and rejects on disagreement — a mismatching client means nobody can log in).
 * These cases mirror the worker's normalizePhone() inputs one for one.
 *
 * Pure JVM on purpose (see testOptions in app/build.gradle.kts): no Context,
 * no telephony — PhoneVerifier.normalize() is deliberately context-free.
 */
class PhoneNormalizerTest {
    @Test
    fun `bangladeshi local formats all normalize to the same e164`() {
        for (raw in listOf("01712345678", "8801712345678", "+8801712345678", "+880 1712-345678")) {
            assertEquals("input <$raw>", "+8801712345678", PhoneVerifier.normalize(raw))
        }
    }

    @Test
    fun `every bangladeshi operator prefix is accepted`() {
        // 013/014/015/016/017/018/019 — the [3-9] class in the regex.
        for (second in '3'..'9') {
            assertEquals("+8801${second}12345678", PhoneVerifier.normalize("01${second}12345678"))
        }
    }

    @Test
    fun `invalid bangladeshi numbers are rejected`() {
        for (raw in listOf("0171234567", "017123456789", "01212345678", "0212345", "abc", "")) {
            assertTrue("input <$raw> must be invalid", PhoneVerifier.normalize(raw) == null)
        }
    }

    @Test
    fun `international numbers need an explicit plus`() {
        assertEquals("+447911123456", PhoneVerifier.normalize("+44 7911 123456"))
        // Without the plus, a non-BD number is NOT guessed into a country.
        assertFalse(PhoneVerifier.isValid("447911123456"))
    }

    @Test
    fun `international numbers are length-checked`() {
        assertEquals(null, PhoneVerifier.normalize("+44")) // too short
        assertEquals(null, PhoneVerifier.normalize("+441234567890123456")) // too long
    }

    @Test
    fun `bd numbers with plus never carry the trunk zero`() {
        // +880 form is E.164: no trunk 0 after the country code. Typing it
        // anyway is treated as invalid, exactly like the worker does.
        assertEquals(null, PhoneVerifier.normalize("+88001712345678"))
    }

    @Test
    fun `wire mapping fails safe`() {
        // Unknown/unparsable states must never report MATCH.
        assertEquals("UNAVAILABLE", PhoneVerificationResult.Error.wire())
        assertEquals("UNAVAILABLE", PhoneVerificationResult.NumberUnavailable.wire())
        assertEquals("UNAVAILABLE", PhoneVerificationResult.InvalidNumber.wire())
        assertEquals("MATCH", PhoneVerificationResult.Verified.wire())
        assertEquals("MISMATCH", PhoneVerificationResult.NumberMismatch.wire())
        assertEquals("NO_SIM", PhoneVerificationResult.NoSim.wire())
        assertEquals("PERMISSION_DENIED", PhoneVerificationResult.PermissionRequired.wire())
    }
}
