package app.kuchupuchu.android

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Phone auth: the Google binding / recovery half (PHONE_AUTH_PLAN.md §6).
 *
 * Credential Manager (no google-services.json — the app initializes Firebase
 * from the worker at runtime already) mints a Google ID token whose `aud` is
 * the worker's Web Client ID; the worker then verifies the token server-side
 * (tokeninfo + aud/iss/exp) before trusting the `sub`. A user-typed email is
 * never accepted as proof of anything.
 */
object GoogleAuth {

    class NotConfiguredException(message: String = "Google sign-in is not set up on the server yet.") :
        Exception(message)

    /**
     * The Web Client ID from the worker's public config. Null when the server
     * has no GOOGLE_WEB_CLIENT_ID secret — surfaced as a clear "not set up"
     * error rather than a dead Google button.
     */
    private suspend fun webClientId(): String = withContext(Dispatchers.IO) {
        val cfg = runCatching { Api.get("/api/config/firebase", force = true) }.getOrNull()
        val id = cfg?.optString("googleWebClientId")?.takeIf { it.isNotBlank() && it != "null" }
        id ?: throw NotConfiguredException()
    }

    /** One Credential-Manager attempt, classified. */
    private sealed class Attempt {
        data class Ok(val credential: androidx.credentials.Credential) : Attempt()
        object Cancelled : Attempt()
        data class Failed(val error: GetCredentialException) : Attempt()
    }

    /**
     * Runs the account picker and returns a fresh Google ID token.
     * Null = the user cancelled.
     *
     * Owner report (2026-09-04, permanent fix): "Continue with Google" opened
     * a NEW-account web login instead of the phone's account sheet on one
     * device, and on another the flow died with "Google returned no id
     * token". Root cause: the previous order led with the
     * GetSignInWithGoogleOption button flow — on several OEM/Play-services
     * combinations that option routes straight into the browser sign-in
     * experience, whose returned credential is not always a
     * GoogleIdTokenCredential (hence the "no ID token" dead end).
     *
     * The order is now the opposite and each layer is defensive:
     *
     *  1. GetGoogleIdOption with filterByAuthorizedAccounts = FALSE — this is
     *     the NATIVE bottom sheet and it ALWAYS lists every Google account
     *     signed in on this device, plus "Use another account". It never
     *     opens a web login by itself. This is the owner rule: the phone's own
     *     accounts, first, every time.
     *  2. If that surface returns something unusable (a credential with a
     *     blank token — a known transient Play-services hiccup), the sheet is
     *     relaunched ONCE instead of dead-ending.
     *  3. If the native surface cannot produce a sheet at all (a device with
     *     zero Google accounts, or a transient Play-services error),
     *     GetSignInWithGoogleOption runs ONCE as the last resort — that is
     *     the only case where a browser sign-in is legitimately the path.
     *  4. Cancellation is always null; every other failure carries a message
     *     the login screen can show as-is.
     *
     * MUST be called with the Activity context from the Main dispatcher —
     * Credential Manager shows system UI.
     */
    suspend fun idToken(ctx: Context): String? {
        val clientId = webClientId()
        val manager = CredentialManager.create(ctx)

        fun nativeOption() =
            GetGoogleIdOption.Builder()
                .setServerClientId(clientId)
                // The full account picker — every account on the device, not
                // just previously-authorized ones. This single flag is what
                // keeps the sheet from ever collapsing into "add a new
                // account".
                .setFilterByAuthorizedAccounts(false)
                .setAutoSelectEnabled(false)
                .build()

        suspend fun attempt(option: androidx.credentials.CredentialOption): Attempt =
            try {
                Attempt.Ok(
                    manager.getCredential(
                        ctx,
                        GetCredentialRequest.Builder().addCredentialOption(option).build(),
                    ).credential,
                )
            } catch (cancellation: GetCredentialCancellationException) {
                Attempt.Cancelled
            } catch (e: GetCredentialException) {
                Attempt.Failed(e)
            }

        // Primary + one relaunch: a blank-token credential from a healthy
        // sheet is transient; a dead end is not acceptable on the auth path.
        val noTokenMsg = "Google sign-in didn't return a token. Please try again."
        var webEligible = false
        when (val first = attempt(nativeOption())) {
            is Attempt.Cancelled -> return null
            is Attempt.Failed -> webEligible = true
            is Attempt.Ok -> {
                val token = tokenOf(first.credential)
                if (token.isNotBlank()) return token
                when (val second = attempt(nativeOption())) {
                    is Attempt.Cancelled -> return null
                    is Attempt.Ok -> return tokenOf(second.credential).ifBlank {
                        throw IllegalStateException(noTokenMsg)
                    }
                    is Attempt.Failed -> webEligible = true
                }
            }
        }

        // Last resort: the native surface could not produce a usable sheet —
        // typically a device with zero Google accounts, where the browser
        // sign-in is genuinely the only path. Runs at most once.
        if (!webEligible) return null
        return when (val web = attempt(GetSignInWithGoogleOption.Builder(clientId).build())) {
            is Attempt.Cancelled -> null
            is Attempt.Ok -> tokenOf(web.credential).ifBlank { throw IllegalStateException(noTokenMsg) }
            is Attempt.Failed ->
                throw IllegalStateException(
                    "Google sign-in couldn't start. Make sure a Google account is signed in on " +
                        "this phone and Google Play services is up to date, then try again.",
                    web.error,
                )
        }
    }

    /**
     * Extracts the ID token from whatever the Credential Manager handed back.
     * Only a real GoogleIdTokenCredential with a non-blank token counts —
     * anything else (password credential, web-flow pseudo-credential) maps to
     * "" so the caller can retry instead of dying with a cryptic error.
     */
    private fun tokenOf(c: androidx.credentials.Credential): String =
        if (c is GoogleIdTokenCredential && c.idToken.isNotBlank()) c.idToken else ""
}
