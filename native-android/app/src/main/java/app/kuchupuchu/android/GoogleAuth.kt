package app.kuchupuchu.android

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
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

    /**
     * Runs the account picker and returns a fresh Google ID token.
     * Null = the user cancelled (no error UI for that case). Throws on real
     * failures (not configured, no Play services, auth error).
     *
     * MUST be called with the Activity context from the Main dispatcher —
     * Credential Manager shows system UI.
     */
    suspend fun idToken(ctx: Context): String? {
        val clientId = webClientId()
        val manager = CredentialManager.create(ctx)
        val option =
            GetGoogleIdOption.Builder()
                .setServerClientId(clientId)
                // Show the full account picker, not just previously-used
                // accounts: binding a specific Gmail is the whole point.
                .setFilterByAuthorizedAccounts(false)
                .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        return try {
            val response = manager.getCredential(ctx, request)
            val credential = response.credential
            if (credential is GoogleIdTokenCredential && credential.idToken.isNotBlank()) {
                credential.idToken
            } else {
                throw IllegalStateException("Google returned no ID token")
            }
        } catch (_: GetCredentialCancellationException) {
            null
        }
    }
}
