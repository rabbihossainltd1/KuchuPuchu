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

    /**
     * Runs the account picker and returns a fresh Google ID token.
     * Null = the user cancelled. One-tap is tried first; when it answers
     * "16: Cannot find a matching credential" (a Play-services cache/propagation
     * hiccup right after new SHA fingerprints are registered — the documented
     * workaround is the plain Sign-in-with-Google sheet, same serverClientId),
     * that fallback runs automatically before giving up.
     *
     * MUST be called with the Activity context from the Main dispatcher —
     * Credential Manager shows system UI.
     */
    suspend fun idToken(ctx: Context): String? {
        val clientId = webClientId()
        val manager = CredentialManager.create(ctx)
        val oneTap =
            GetGoogleIdOption.Builder()
                .setServerClientId(clientId)
                // Show the full account picker, not just previously-used
                // accounts: binding a specific Gmail is the whole point.
                .setFilterByAuthorizedAccounts(false)
                .build()
        val response =
            try {
                manager.getCredential(ctx, GetCredentialRequest.Builder().addCredentialOption(oneTap).build())
            } catch (cancellation: GetCredentialCancellationException) {
                return null
            } catch (_: GetCredentialException) {
                // One-tap refused (the classic "16: Cannot find a matching
                // credential" right after SHA changes). The bottom-sheet
                // "Sign in with Google" flow uses a different code path in
                // Play services and typically still works.
                try {
                    manager.getCredential(
                        ctx,
                        GetCredentialRequest.Builder()
                            .addCredentialOption(
                                GetSignInWithGoogleOption.Builder().setServerClientId(clientId).build(),
                            )
                            .build(),
                    )
                } catch (cancellation: GetCredentialCancellationException) {
                    return null
                } catch (e: GetCredentialException) {
                    throw IllegalStateException(
                        "Google sign-in couldn't start. Make sure a Google account is signed in on " +
                            "this phone and Google Play services is up to date, then try again.",
                        e,
                    )
                }
            }
        val credential = response.credential
        return if (credential is GoogleIdTokenCredential && credential.idToken.isNotBlank()) {
            credential.idToken
        } else {
            throw IllegalStateException("Google returned no ID token")
        }
    }
}
