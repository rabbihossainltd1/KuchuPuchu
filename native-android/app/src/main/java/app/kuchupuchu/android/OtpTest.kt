package app.kuchupuchu.android

import android.app.Activity
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import java.util.concurrent.TimeUnit

/**
 * SMS OTP test path (owner round 8, 2026-09-04) — TEST ONLY.
 *
 * The owner's rule: OTP login goes to production ONLY if the OTP SMS
 * actually arrives on real phones; until then the existing phone/SIM +
 * new-device-approval system stays the login. This object runs a Firebase
 * Phone Auth round-trip on whatever number the owner typed and reports
 * exactly where it stops:
 *   • "ERROR_OPERATION_NOT_ALLOWED" → Phone sign-in is disabled in the
 *     Firebase console (Authentication → Sign-in method → Phone).
 *   • status 17028 / "app-not-authorized" style failures → the app's signing
 *     SHA-1/SHA-256 is missing in Firebase console → Project settings.
 *   • code sent + verified → SMS delivery works end to end.
 * It never creates a KuchuPuchu session.
 */
object OtpTest {
    @Volatile private var verificationId: String? = null

    /** cb(stage, detail): "sending" | "code-sent" | "ok" | "error". */
    fun start(activity: Activity, e164: String, cb: (String, String) -> Unit) {
        if (FirebaseApp.getApps(activity).isEmpty()) {
            cb("error", "Firebase is not configured on the server yet.")
            return
        }
        cb("sending", "")
        val auth = FirebaseAuth.getInstance()
        PhoneAuthProvider.verifyPhoneNumber(
            PhoneAuthOptions.newBuilder(auth)
                .setPhoneNumber(e164)
                .setTimeout(45L, TimeUnit.SECONDS)
                .setActivity(activity)
                .setCallbacks(object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                    override fun onVerificationCompleted(credential: PhoneAuthCredential) =
                        signIn(auth, credential, cb)

                    override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
                        verificationId = id
                        cb("code-sent", "OTP sent to $e164 — enter the 6-digit code.")
                    }

                    override fun onVerificationFailed(e: com.google.firebase.FirebaseException) =
                        cb("error", friendly(e))
                })
                .build(),
        )
    }

    /** Verify the code the user typed. cb(stage, detail) as above. */
    fun verify(code: String, cb: (String, String) -> Unit) {
        val id = verificationId
        if (id.isNullOrBlank()) {
            cb("error", "Request an OTP first.")
            return
        }
        cb("sending", "")
        signIn(FirebaseAuth.getInstance(), PhoneAuthProvider.getCredential(id, code), cb)
    }

    private fun signIn(auth: FirebaseAuth, credential: PhoneAuthCredential, cb: (String, String) -> Unit) {
        auth.signInWithCredential(credential).addOnCompleteListener { task ->
            if (task.isSuccessful) {
                // Test passed. Sign out immediately — this path must never
                // leave a stray Firebase session around.
                runCatching { auth.signOut() }
                cb("ok", "✅ OTP verified — SMS delivery works on this phone. Ready for production.")
            } else {
                cb("error", friendly(task.exception ?: IllegalStateException("Unknown failure")))
            }
        }
    }

    private fun friendly(e: Exception): String {
        val code = (e as? FirebaseAuthException)?.errorCode ?: e.javaClass.simpleName
        return when {
            code.contains("OPERATION_NOT_ALLOWED") ->
                "Phone sign-in is disabled in the Firebase console (Authentication → Sign-in method → Phone)."
            code.contains("17028") || code.contains("app-not-authorized", true) || code.contains("INVALID_APP_CREDENTIAL") ->
                "The app's signing key (SHA-1) is missing in Firebase console → Project settings."
            else -> "[$code] ${e.message ?: ""}"
        }
    }
}
