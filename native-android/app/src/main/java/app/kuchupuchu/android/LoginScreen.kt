package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Phone auth screen (PHONE_AUTH_PLAN.md): ONE screen for login and signup,
 * no OTP, no email, no password.
 *
 * Phone → OTP-less SIM check →
 *   SESSION      → home
 *   ACCOUNT_NEW  → bind Gmail (Google) → home
 *   APPROVAL     → old device Accept/Decline while this screen polls → home
 *   lost device  → "Can't access my previous device?" → Google recovery
 */

private enum class LoginStage { PHONE, BINDING, WAITING, RECOVERY }

@Composable
fun LoginScreen(onAuthed: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val deviceId = remember { KpPush.deviceId(ctx) }
    val deviceName = remember { Build.MODEL.take(64) }

    var stage by remember { mutableStateOf(LoginStage.PHONE) }
    var phone by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var requestId by remember { mutableStateOf("") }
    val scrollState = rememberScrollState()

    fun finish(data: JSONObject) {
        Api.saveToken(ctx, data.optString("token"))
        val user = data.optJSONObject("user")
        Store.saveMe(user ?: JSONObject())
        // Navigate first, then register push in background — setting authed
        // removes this composable from the tree (same contract as the old
        // email screen).
        onAuthed()
        val appCtx = ctx.applicationContext
        scope.launch(Dispatchers.IO) {
            runCatching { if (KpPush.tryInit(appCtx)) KpPush.registerToken(appCtx) }
        }
    }

    /** Runs the local SIM check and submits the number to the worker. */
    fun submitPhone(simOverride: String? = null) {
        if (busy) return
        val e164 = PhoneVerifier.normalize(phone)
        if (e164 == null) {
            error = "Enter a valid phone number, e.g. 01712345678."
            return
        }
        busy = true
        error = ""
        note = ""
        scope.launch {
            try {
                val sim =
                    simOverride
                        ?: withContext(Dispatchers.IO) {
                            PhoneVerifier.verify(ctx, e164).wire()
                        }
                val data =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/verify-phone",
                            JSONObject()
                                .put("phone", e164)
                                .put("sim", sim)
                                .put("deviceId", deviceId)
                                .put("deviceName", deviceName),
                        )
                    }
                when (data.optString("status")) {
                    "SESSION" -> finish(data)
                    "ACCOUNT_CREATED", "BIND_REQUIRED" -> {
                        if (sim != "MATCH")
                            note = "We couldn't verify this number automatically on this device."
                        stage = LoginStage.BINDING
                    }
                    "APPROVAL_REQUIRED" -> {
                        requestId = data.optString("requestId")
                        stage = LoginStage.WAITING
                    }
                    else -> error = "Could not sign in. Please try again."
                }
            } catch (e: Exception) {
                error = e.message ?: "Could not sign in."
            } finally {
                busy = false
            }
        }
    }

    // Runtime permission: READ_PHONE_STATE gates SubscriptionManager. A denial
    // is NOT fatal — the worker's grace path treats it like "no signal"
    // (PERMISSION_DENIED) and the approval flow still protects the account.
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            submitPhone(if (granted) null else PhoneVerificationResult.PermissionRequired.wire())
        }

    fun onContinue() {
        focusManager.clearFocus()
        keyboard?.hide()
        if (busy) return
        if (PhoneVerifier.normalize(phone) == null) {
            error = "Enter a valid phone number, e.g. 01712345678."
            return
        }
        val granted =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) ==
                PackageManager.PERMISSION_GRANTED
        if (granted) submitPhone()
        else permissionLauncher.launch(Manifest.permission.READ_PHONE_STATE)
    }

    /** Google binding for a brand-new account (§8/§9). */
    fun bindGoogle() {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val idToken = GoogleAuth.idToken(ctx) // null = user cancelled
                if (idToken == null) {
                    busy = false
                    return@launch
                }
                val e164 = PhoneVerifier.normalize(phone) ?: throw IllegalStateException("Enter your phone number again.")
                val data =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/google/bind",
                            JSONObject()
                                .put("phone", e164)
                                .put("idToken", idToken)
                                .put("deviceId", deviceId)
                                .put("deviceName", deviceName)
                                .apply { if (displayName.isNotBlank()) put("displayName", displayName.trim()) },
                        )
                    }
                finish(data)
            } catch (e: Exception) {
                error = e.message ?: "Google account binding failed. Please try again."
            } finally {
                busy = false
            }
        }
    }

    /** Recovery when the previous device is lost/broken (§21). */
    fun recoverWithGoogle() {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val e164 = PhoneVerifier.normalize(phone) ?: throw IllegalStateException("Enter your phone number first.")
                val idToken = GoogleAuth.idToken(ctx)
                if (idToken == null) {
                    busy = false
                    return@launch
                }
                val started =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/recovery/start",
                            JSONObject()
                                .put("phone", e164)
                                .put("idToken", idToken)
                                .put("deviceId", deviceId),
                        )
                    }
                val data =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/recovery/complete",
                            JSONObject()
                                .put("requestId", started.optString("requestId"))
                                .put("deviceId", deviceId),
                        )
                    }
                finish(data)
            } catch (e: Exception) {
                error = e.message ?: "Recovery failed. Please try again."
            } finally {
                busy = false
            }
        }
    }

    fun cancelApproval() {
        val rid = requestId
        stage = LoginStage.PHONE
        requestId = ""
        error = ""
        if (rid.isNotBlank())
            scope.launch(Dispatchers.IO) {
                runCatching {
                    Api.post(
                        "/api/auth/login/cancel",
                        JSONObject().put("requestId", rid).put("deviceId", deviceId),
                    )
                }
            }
    }

    // Poll loop for the approval wait (§14): FCM is only the doorbell on the
    // OLD device; THIS device decides nothing — it polls the worker.
    LaunchedEffect(stage, requestId) {
        if (stage != LoginStage.WAITING || requestId.isBlank()) return@LaunchedEffect
        while (true) {
            delay(3000)
            try {
                val data =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/login/poll",
                            JSONObject().put("requestId", requestId).put("deviceId", deviceId),
                        )
                    }
                when (data.optString("status")) {
                    // PENDING: keep polling — the server owns the expiry
                    // (it lazily flips PENDING → EXPIRED once past it).
                    "SESSION" -> {
                        finish(data)
                        return@LaunchedEffect
                    }
                    "DECLINED" -> {
                        stage = LoginStage.PHONE
                        requestId = ""
                        error = "The login was declined on the active device."
                        return@LaunchedEffect
                    }
                    "EXPIRED", "UNKNOWN" -> {
                        stage = LoginStage.PHONE
                        requestId = ""
                        error = "The login request expired. Please try again."
                        return@LaunchedEffect
                    }
                }
            } catch (_: Exception) {
                // transient network blip — keep polling until the expiry
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(scrollState)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Card)
                .padding(22.dp),
        ) {
            Image(
                painterResource(R.drawable.icon_gold),
                contentDescription = "KuchuPuchu",
                modifier = Modifier.size(58.dp),
                contentScale = ContentScale.Fit,
            )
            Spacer(Modifier.height(12.dp))
            Text("KuchuPuchu", fontSize = 27.sp, fontWeight = FontWeight.Bold, color = Ink)
            Text(
                when (stage) {
                    LoginStage.PHONE -> "Sign in with your phone number"
                    LoginStage.BINDING -> "Bind your Gmail"
                    LoginStage.WAITING -> "Waiting for approval"
                    LoginStage.RECOVERY -> "Account recovery"
                },
                fontSize = 14.sp,
                color = Muted,
            )
            Spacer(Modifier.height(18.dp))

            when (stage) {
                LoginStage.PHONE -> {
                    OutlinedTextField(
                        phone,
                        { phone = it; error = ""; note = "" },
                        label = { Text("Phone number") },
                        placeholder = { Text("01712345678") },
                        singleLine = true,
                        keyboardOptions =
                            KeyboardOptions(
                                keyboardType = KeyboardType.Phone,
                                imeAction = ImeAction.Done,
                            ),
                        keyboardActions =
                            KeyboardActions(onDone = {
                                focusManager.clearFocus()
                                keyboard?.hide()
                            }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (note.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(note, color = Muted, fontSize = 13.sp)
                    }
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoldBtn(
                        if (busy) "…" else "Continue",
                        Modifier.fillMaxWidth(),
                        enabled = !busy,
                    ) { onContinue() }
                    TextButton(onClick = { stage = LoginStage.RECOVERY; error = "" }) {
                        Text("Can't access my previous device?", color = GoldDeep)
                    }
                }

                LoginStage.BINDING -> {
                    Text(
                        "Ei number e notun account hobe. Account recover korar jonno " +
                            "apnar Gmail bind korte hobe — password lagbe na.",
                        fontSize = 13.sp,
                        color = Muted,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        displayName,
                        { displayName = it.take(40) },
                        label = { Text("Your name (optional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoldBtn(
                        if (busy) "…" else "Continue with Google",
                        Modifier.fillMaxWidth(),
                        enabled = !busy,
                    ) { bindGoogle() }
                    TextButton(onClick = {
                        stage = LoginStage.PHONE
                        error = ""
                    }) { Text("Back", color = Muted) }
                }

                LoginStage.WAITING -> {
                    CircularProgressIndicator(color = Gold, modifier = Modifier.size(40.dp))
                    Spacer(Modifier.height(14.dp))
                    Text(
                        "Ei number er account onno ekta device e active. " +
                            "Shei device e notification ashbe — Accept chaplei ekhane dhukte parben.",
                        fontSize = 13.sp,
                        color = Ink,
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoldBtn("Cancel", Modifier.fillMaxWidth(), enabled = true) { cancelApproval() }
                }

                LoginStage.RECOVERY -> {
                    Text(
                        "Prothom e oi number diye account ta khujbe, tarpor apnar " +
                            "bound Google account diye verify korbo. Number field e phone number din, " +
                            "tarpor Google button chapun.",
                        fontSize = 13.sp,
                        color = Muted,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        phone,
                        { phone = it; error = "" },
                        label = { Text("Phone number") },
                        singleLine = true,
                        keyboardOptions =
                            KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoldBtn(
                        if (busy) "…" else "Continue with Google",
                        Modifier.fillMaxWidth(),
                        enabled = !busy,
                    ) { recoverWithGoogle() }
                    TextButton(onClick = {
                        stage = LoginStage.PHONE
                        error = ""
                    }) { Text("Back", color = Muted) }
                }
            }
        }
    }
}
