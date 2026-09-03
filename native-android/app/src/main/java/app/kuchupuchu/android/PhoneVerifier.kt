package app.kuchupuchu.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/**
 * Phone auth (OTP-less) — client side of PHONE_AUTH_PLAN.md.
 *
 * Two jobs, both telephony-logic-only (no UI):
 *  1. Normalize whatever the user typed into E.164, BD-first, with the exact
 *     same rules as the worker's normalizePhone().
 *  2. Try to match that number against the numbers the active SIMs expose
 *     (SubscriptionManager → per-subscription TelephonyManager). The result is
 *     REPORTED to the worker, never trusted by it; and per the spec, a number
 *     Android will not expose is UNAVAILABLE — not a mismatch, not a pass.
 */

/** Mirrors the worker's `sim` contract exactly (see /api/auth/verify-phone). */
sealed class PhoneVerificationResult {
    /** An active SIM literally exposes the entered number. */
    data object Verified : PhoneVerificationResult()

    /** A SIM exposes a real, parseable, DIFFERENT number — the block signal. */
    data object NumberMismatch : PhoneVerificationResult()

    /** SIM(s) present but none expose a usable number (most BD carriers). */
    data object NumberUnavailable : PhoneVerificationResult()

    /** No active subscription at all. */
    data object NoSim : PhoneVerificationResult()

    /** READ_PHONE_STATE not granted right now. */
    data object PermissionRequired : PhoneVerificationResult()

    /** Malformed input — never leaves the app. */
    data object InvalidNumber : PhoneVerificationResult()

    /** Anything unexpected (telephony stack crash, OEM weirdness). */
    data object Error : PhoneVerificationResult()

    /** Wire string for the worker's `sim` field. Fail-safe: unknown states
     *  report "no signal" (UNAVAILABLE), never a fake MATCH. */
    fun wire(): String =
        when (this) {
            Verified -> "MATCH"
            NumberMismatch -> "MISMATCH"
            NumberUnavailable -> "UNAVAILABLE"
            NoSim -> "NO_SIM"
            PermissionRequired -> "PERMISSION_DENIED"
            InvalidNumber -> "UNAVAILABLE"
            Error -> "UNAVAILABLE"
        }
}

object PhoneVerifier {

    fun hasPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * E.164 normalization: 01XXXXXXXXX / 8801… / +8801… are Bangladeshi
     * mobiles; anything else must carry an explicit "+" country code.
     * Character-for-character the same rules as the worker's normalizePhone()
     * — the worker re-normalizes and rejects on any disagreement, so the two
     * can never drift. Returns null when the input is not a usable number.
     */
    fun normalize(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val cleaned = trimmed.replace(Regex("[\\s\\-().]"), "")
        val hasPlus = cleaned.startsWith("+")
        val digits = cleaned.filter { it.isDigit() }
        if (digits.isEmpty()) return null
        if (!hasPlus) {
            var d = if (digits.startsWith("880")) digits.substring(3) else digits
            if (!d.startsWith("0")) d = "0$d"
            return if (Regex("^01[3-9]\\d{8}$").matches(d)) "+880${d.substring(1)}" else null
        }
        if (digits.startsWith("880")) {
            // +880 form is E.164 — no trunk zero after the country code.
            return if (Regex("^8801[3-9]\\d{8}$").matches(digits)) "+$digits" else null
        }
        return if (Regex("^\\d{8,15}$").matches(digits)) "+$digits" else null
    }

    /** True when the string is a complete, submittable number. */
    fun isValid(raw: String): Boolean = normalize(raw) != null

    /**
     * Attempts the OTP-less SIM match. Call after the runtime permission is
     * granted (hasPermission first); a SecurityException here still maps to
     * PermissionRequired, never a crash.
     */
    fun verify(ctx: Context, e164: String): PhoneVerificationResult {
        if (normalize(e164) != e164) return PhoneVerificationResult.InvalidNumber
        val app = ctx.applicationContext
        if (!hasPermission(app)) return PhoneVerificationResult.PermissionRequired
        return try {
            val sm =
                app.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                    ?: return PhoneVerificationResult.Error
            // Null/empty list is a normal outcome on some OEM/carrier setups,
            // not an error state.
            val subs = sm.activeSubscriptionInfoList ?: return PhoneVerificationResult.NoSim
            if (subs.isEmpty()) return PhoneVerificationResult.NoSim
            val tm =
                app.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                    ?: return PhoneVerificationResult.Error
            var sawUsableNumber = false
            for (sub in subs) {
                val raw =
                    runCatching { tm.createForSubscriptionId(sub.subscriptionId).line1Number }
                        .getOrNull() ?: continue
                if (raw.isBlank()) continue
                val candidate = normalize(raw) ?: continue
                sawUsableNumber = true
                if (candidate == e164) return PhoneVerificationResult.Verified
            }
            // A real, exposed, different number: mismatch. Nothing exposed at
            // all: unavailable (grace path on the worker, DEVICE_ONLY).
            if (sawUsableNumber) PhoneVerificationResult.NumberMismatch
            else PhoneVerificationResult.NumberUnavailable
        } catch (_: SecurityException) {
            PhoneVerificationResult.PermissionRequired
        } catch (_: Exception) {
            PhoneVerificationResult.Error
        }
    }
}
