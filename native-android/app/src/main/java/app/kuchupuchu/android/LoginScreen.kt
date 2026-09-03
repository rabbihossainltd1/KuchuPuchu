package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Phone auth (PHONE_AUTH_PLAN.md) — a real fullscreen page (no popup card):
 * big brand header at the top, single-line controls below. No OTP, no
 * email, no password.
 *
 * PHONE → VERIFYING → VERIFY_OK →
 *   same device   → DONE → home
 *   other device  → WAITING (≤60s for the approval message on the old device;
 *                   then "Failed to verify" + Try another way → Google. A late
 *                   approval still signs in.) · deviceGone → Google directly.
 *   new number    → BIND (Google) → PROFILE → DONE → home
 * "Recover account" → Google recovery for a lost previous device.
 */
private enum class LoginStage {
    PHONE,
    VERIFYING,
    VERIFY_OK,
    BIND,
    PROFILE,
    SAVING,
    DONE,
    WAITING,
    RECOVERY,
}

/** How long to wait for the old device's answer before offering the way out. */
private const val APPROVAL_WAIT_MS = 60_000L

/** One KuchuPuchu-AI welcome check per process — the server no-ops (one cheap
 *  SELECT) for accounts that already have their welcome message. */
private var aiWelcomeAsked = false

private val FieldShape = RoundedCornerShape(14.dp)

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
    var country by remember { mutableStateOf(DEFAULT_COUNTRY) }
    var showCountries by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var requestId by remember { mutableStateOf("") }
    var deviceOnly by remember { mutableStateOf(false) }
    var isNewSignup by remember { mutableStateOf(false) }
    var sessionPayload by remember { mutableStateOf<JSONObject?>(null) }
    var afterVerify by remember { mutableStateOf({}) } // () -> Unit
    val scrollState = rememberScrollState()

    // waiting state
    var waitStartedAt by remember { mutableStateOf(0L) }
    var waitFailed by remember { mutableStateOf(false) }
    var waitFailReason by remember { mutableStateOf("") }
    var showAnotherWay by remember { mutableStateOf(false) }
    var googlePressed by remember { mutableStateOf(false) }

    // profile setup state
    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var about by remember { mutableStateOf("") }
    var avatarDataUrl by remember { mutableStateOf<String?>(null) }
    var profileError by remember { mutableStateOf("") }

    fun finish(data: JSONObject) {
        Api.saveToken(ctx, data.optString("token"))
        Store.saveMe(data.optJSONObject("user") ?: JSONObject())
        onAuthed()
        val appCtx = ctx.applicationContext
        scope.launch(Dispatchers.IO) {
            runCatching { if (KpPush.tryInit(appCtx)) KpPush.registerToken(appCtx) }
        }
        // First login in this process → make sure KuchuPuchu AI said hello
        // (idempotent server-side; returning accounts get a silent no-op).
        if (!aiWelcomeAsked) {
            aiWelcomeAsked = true
            scope.launch(Dispatchers.IO) {
                runCatching { Api.post("/api/ai/welcome", JSONObject()) }
            }
        }
    }

    /** Runs the local SIM check and submits the number to the worker. */
    fun startVerify(simOverride: String? = null) {
        busy = true
        error = ""
        stage = LoginStage.VERIFYING
        scope.launch {
            try {
                val e164 =
                    buildE164(country, phone)
                        ?: throw IllegalStateException(
                            if (country.iso == "BD") {
                                "Enter a valid Bangladeshi mobile number, e.g. 1792929202."
                            } else {
                                "Enter a valid phone number."
                            },
                        )
                val sim =
                    simOverride
                        ?: withContext(Dispatchers.IO) { PhoneVerifier.verify(ctx, e164).wire() }
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
                deviceOnly = data.optString("method", "") == "DEVICE_ONLY"
                when (data.optString("status")) {
                    "SESSION" -> {
                        sessionPayload = data
                        isNewSignup = false
                        afterVerify = { stage = LoginStage.DONE }
                        stage = LoginStage.VERIFY_OK
                    }
                    "ACCOUNT_CREATED", "BIND_REQUIRED" -> {
                        isNewSignup = true
                        afterVerify = { stage = LoginStage.BIND }
                        stage = LoginStage.VERIFY_OK
                    }
                    "APPROVAL_REQUIRED" -> {
                        requestId = data.optString("requestId")
                        waitStartedAt = System.currentTimeMillis()
                        waitFailed = false
                        waitFailReason = ""
                        showAnotherWay = false
                        googlePressed = false
                        if (data.optBoolean("deviceGone")) {
                            // The previous install is gone (uninstalled/no push
                            // handle for weeks) — nobody can approve. Straight
                            // to the Google way out (owner rule).
                            waitFailed = true
                            waitFailReason =
                                "We couldn't reach your previous device. Verify with Google to sign in here."
                            showAnotherWay = true
                        }
                        afterVerify = { stage = LoginStage.WAITING }
                        stage = LoginStage.VERIFY_OK
                    }
                    else -> {
                        stage = LoginStage.PHONE
                        error = "Something went wrong. Please try again."
                    }
                }
            } catch (e: Exception) {
                stage = LoginStage.PHONE
                error = e.message ?: "Could not sign in. Please try again."
            } finally {
                busy = false
            }
        }
    }

    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            startVerify(if (granted) null else PhoneVerificationResult.PermissionRequired.wire())
        }

    fun onContinue() {
        focusManager.clearFocus()
        keyboard?.hide()
        if (busy) return
        if (buildE164(country, phone) == null) {
            error =
                if (country.iso == "BD") {
                    "Enter a valid Bangladeshi mobile number, e.g. 1792929202."
                } else {
                    "Enter a valid phone number."
                }
            return
        }
        val granted =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) ==
                PackageManager.PERMISSION_GRANTED
        if (granted) startVerify()
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
                val e164 =
                    buildE164(country, phone)
                        ?: throw IllegalStateException("Enter your phone number again.")
                val data =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/google/bind",
                            JSONObject()
                                .put("phone", e164)
                                .put("idToken", idToken)
                                .put("deviceId", deviceId)
                                .put("deviceName", deviceName),
                        )
                    }
                sessionPayload = data
                // The session exists from HERE — profile setup PATCHes /api/me
                // next, so the token must be installed immediately (this was
                // the "Sign in first." bug: the token only landed in finish()).
                Api.saveToken(ctx, data.optString("token"))
                Store.saveMe(data.optJSONObject("user") ?: JSONObject())
                if (isNewSignup) stage = LoginStage.PROFILE else stage = LoginStage.DONE
            } catch (e: Exception) {
                error = e.message ?: "Google account binding failed. Please try again."
            } finally {
                busy = false
            }
        }
    }

    /** Saves the profile (one PATCH) and moves to the success animation. */
    fun saveProfile() {
        if (busy) return
        val first = firstName.trim()
        if (first.isBlank()) {
            profileError = "Please enter your first name."
            return
        }
        if (username.isNotBlank() && !Regex("^[a-z0-9_]{3,20}$").matches(username.trim())) {
            profileError = "Username: 3–20 characters — a-z, 0-9, _"
            return
        }
        busy = true
        profileError = ""
        stage = LoginStage.SAVING
        scope.launch {
            try {
                val body = JSONObject()
                    .put(
                        "displayName",
                        if (lastName.isBlank()) first else "$first ${lastName.trim()}",
                    )
                    .put("about", about.trim())
                if (username.isNotBlank()) body.put("username", username.trim().lowercase())
                avatarDataUrl?.let { body.put("avatarUrl", it) }
                val updated =
                    withContext(Dispatchers.IO) { Api.patch("/api/me", body).optJSONObject("user") }
                if (updated != null) {
                    Store.saveMe(updated)
                    sessionPayload?.put("user", updated)
                }
                stage = LoginStage.DONE
            } catch (e: Exception) {
                stage = LoginStage.PROFILE
                profileError = e.message ?: "Could not save your profile. Please try again."
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
                val e164 =
                    buildE164(country, phone)
                        ?: throw IllegalStateException("Enter your phone number first.")
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

    // Poll loop for the approval wait (§14). The OLD device answers from the
    // official chat message; THIS device just polls the worker — and keeps
    // polling past the 1-minute failure UI, because a LATE approval must
    // still sign in (owner rule).
    LaunchedEffect(stage, requestId) {
        if (stage != LoginStage.WAITING || requestId.isBlank()) return@LaunchedEffect
        val started = System.currentTimeMillis()
        while (true) {
            if (!waitFailed && System.currentTimeMillis() - started > APPROVAL_WAIT_MS) {
                waitFailed = true
                waitFailReason = "No response from your other device yet."
            }
            try {
                val data =
                    withContext(Dispatchers.IO) {
                        Api.post(
                            "/api/auth/login/poll",
                            JSONObject().put("requestId", requestId).put("deviceId", deviceId),
                        )
                    }
                when (data.optString("status")) {
                    "PENDING" -> {}
                    "SESSION" -> {
                        finish(data)
                        return@LaunchedEffect
                    }
                    "DECLINED" -> {
                        waitFailed = true
                        showAnotherWay = true
                        waitFailReason = "The login was declined on the active device."
                    }
                    "EXPIRED", "UNKNOWN" -> {
                        waitFailed = true
                        showAnotherWay = true
                        waitFailReason = "The login request expired."
                    }
                }
                if (waitFailed && showAnotherWay && data.optString("status") != "PENDING") {
                    // terminal state — stop polling
                    return@LaunchedEffect
                }
            } catch (_: Exception) {
                // transient network blip — keep polling
            }
            delay(3000)
        }
    }

    // Auto-advance from the success animation to whatever came next.
    LaunchedEffect(stage) {
        if (stage == LoginStage.VERIFY_OK) {
            delay(1000)
            afterVerify()
        } else if (stage == LoginStage.DONE) {
            delay(1000)
            sessionPayload?.let { finish(it) }
        }
    }

    val avatarPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
            if (uri != null) {
                scope.launch {
                    profileError = ""
                    val dataUrl =
                        withContext(Dispatchers.IO) {
                            FilesUtil.imageToDataUrl(uri, ctx, maxSide = 512, maxChars = 190_000)
                        }
                    if (dataUrl == null) profileError = "Could not read that photo. Pick another one."
                    else avatarDataUrl = dataUrl
                }
            }
        }

    // System back owns navigation everywhere (owner rule) — the login screens
    // carry NO on-screen Back buttons. Inside the flow, back returns to the
    // phone entry; from the approval wait it cancels the request first.
    BackHandler(enabled = stage == LoginStage.WAITING) { cancelApproval() }
    BackHandler(
        enabled =
            stage == LoginStage.BIND || stage == LoginStage.PROFILE || stage == LoginStage.RECOVERY,
    ) {
        error = ""
        stage = LoginStage.PHONE
    }

    if (showCountries) {
        CountryPickerSheet(
            current = country,
            onPick = {
                country = it
                showCountries = false
            },
            onDismiss = { showCountries = false },
        )
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .imePadding()
            .navigationBarsPadding()
            .verticalScroll(scrollState)
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        // Fullscreen page — no floating card: the content flows from the top
        // of the screen under a big brand header.
        Column(Modifier.fillMaxWidth()) {
            // Compact single-line header: small logo + name + subtitle.
            when (stage) {
                LoginStage.PHONE, LoginStage.VERIFYING, LoginStage.VERIFY_OK -> {
                    AuthHeader("KuchuPuchu", "Sign in with your phone number", wordmark = true)
                    Spacer(Modifier.height(32.dp))

                    when (stage) {
                        LoginStage.PHONE -> {
                            PhoneField(
                                phone = phone,
                                onPhone = { phone = it; error = "" },
                                country = country,
                                onPickCountry = { showCountries = true },
                                imeAction = ImeAction.Done,
                                onDone = {
                                    focusManager.clearFocus()
                                    keyboard?.hide()
                                },
                            )
                            if (error.isNotBlank()) {
                                Spacer(Modifier.height(6.dp))
                                Text(error, color = Red, fontSize = 12.sp, maxLines = 2)
                            }
                            Spacer(Modifier.height(10.dp))
                            GoldBtn("Continue", Modifier.fillMaxWidth(), enabled = !busy) { onContinue() }
                            TextButton(onClick = { stage = LoginStage.RECOVERY; error = "" }) {
                                Text("Recover account", color = GoldDeep, maxLines = 1)
                            }
                        }

                        LoginStage.VERIFYING -> VerifyingPane("Verifying your number")

                        LoginStage.VERIFY_OK -> SuccessPane("Number verified")
                        else -> {}
                    }
                }

                LoginStage.BIND -> {
                    AuthHeader("Bind your Gmail", "For recovery if you lose this device", compact = true)
                    Spacer(Modifier.height(20.dp))
                    if (deviceOnly) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "This number couldn't be verified automatically on this device.",
                            fontSize = 11.sp,
                            color = Muted,
                            maxLines = 2,
                        )
                    }
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(error, color = Red, fontSize = 12.sp, maxLines = 2)
                    }
                    Spacer(Modifier.height(24.dp))
                    GoogleButton(text = "Continue with Google", busy = busy, enabled = !busy) { bindGoogle() }
                }

                LoginStage.PROFILE -> {
                    AuthHeader("Set up your profile", "This is how friends will see you", compact = true)
                    Spacer(Modifier.height(16.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(54.dp)
                                .clip(CircleShape)
                                .background(Card)
                                .border(1.dp, Muted.copy(alpha = 0.3f), CircleShape)
                                .clickable {
                                    avatarPicker.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                    )
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            val preview =
                                remember(avatarDataUrl) { decodeDataUrlBitmap(avatarDataUrl) }
                            if (preview != null) {
                                Image(
                                    bitmap = preview.asImageBitmap(),
                                    contentDescription = "Profile photo",
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Crop,
                                )
                                Box(Modifier.fillMaxSize().background(Color(0x55000000)), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Filled.CameraAlt, "Change photo", tint = Color.White, modifier = Modifier.size(18.dp))
                                }
                            } else {
                                Icon(Icons.Filled.AccountCircle, "Add photo", tint = Muted.copy(alpha = 0.6f), modifier = Modifier.size(34.dp))
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Text("Add a photo (optional)", fontSize = 11.sp, color = Muted, maxLines = 1)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            firstName,
                            { firstName = it.take(25); profileError = "" },
                            label = { Text("First name") },
                            singleLine = true,
                            shape = FieldShape,
                            keyboardOptions =
                                KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        OutlinedTextField(
                            lastName,
                            { lastName = it.take(25); profileError = "" },
                            label = { Text("Last name") },
                            singleLine = true,
                            shape = FieldShape,
                            keyboardOptions =
                                KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        username,
                        { username = it.lowercase().take(20); profileError = "" },
                        label = { Text("Username (optional)") },
                        placeholder = { Text("e.g. rabbi_ff", color = Muted.copy(alpha = 0.45f)) },
                        singleLine = true,
                        shape = FieldShape,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        about,
                        { about = it.take(160); profileError = "" },
                        label = { Text("About (optional)") },
                        placeholder = { Text("Hey! I'm using KuchuPuchu", color = Muted.copy(alpha = 0.45f)) },
                        singleLine = true,
                        shape = FieldShape,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (profileError.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(profileError, color = Red, fontSize = 12.sp, maxLines = 2)
                    }
                    Spacer(Modifier.height(12.dp))
                    GoldBtn("Continue", Modifier.fillMaxWidth(), enabled = !busy) { saveProfile() }
                }

                LoginStage.SAVING -> {
                    AuthHeader("KuchuPuchu", null, wordmark = true)
                    Spacer(Modifier.height(40.dp))
                    VerifyingPane("Setting up your profile")
                }

                LoginStage.DONE -> {
                    AuthHeader("KuchuPuchu", null, wordmark = true)
                    Spacer(Modifier.height(40.dp))
                    SuccessPane("All set!")
                }

                LoginStage.WAITING -> {
                    AuthHeader("KuchuPuchu", null, wordmark = true)
                    Spacer(Modifier.height(40.dp))
                    if (!waitFailed) {
                        VerifyingPane(
                            "Waiting for approval",
                            "Check KuchuPuchu's message on your other device.",
                        )
                        Spacer(Modifier.height(8.dp))
                        GoldBtn("Cancel", Modifier.fillMaxWidth(), enabled = true) { cancelApproval() }
                    } else {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Failed to verify", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                waitFailReason,
                                fontSize = 12.sp,
                                color = Muted,
                                textAlign = TextAlign.Center,
                                maxLines = 3,
                            )
                            Spacer(Modifier.height(12.dp))
                            if (showAnotherWay) {
                                if (waitFailReason.startsWith("We couldn't reach")) {
                                    // The previous device is gone — Google is the
                                    // primary path, not an alternative.
                                    GoogleButton(text = "Verify with Google", busy = busy, enabled = !busy) { recoverWithGoogle() }
                                } else {
                                    if (busy) {
                                        CircularProgressIndicator(color = Gold, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                                    } else if (!googlePressed) {
                                        TextButton(onClick = { googlePressed = true }) {
                                            Text("Try another way", color = GoldDeep, maxLines = 1)
                                        }
                                        TextButton(onClick = { cancelApproval() }) { Text("Try again", color = Muted, maxLines = 1) }
                                    } else {
                                        GoogleButton(text = "Verify with Google", busy = busy, enabled = !busy) { recoverWithGoogle() }
                                    }
                                }
                            } else {
                                GoldBtn("Try again", Modifier.fillMaxWidth(), enabled = true) { cancelApproval() }
                            }
                            if (error.isNotBlank()) {
                                Spacer(Modifier.height(6.dp))
                                Text(error, color = Red, fontSize = 12.sp, maxLines = 2, textAlign = TextAlign.Center)
                            }
                        }
                    }
                }

                LoginStage.RECOVERY -> {
                    AuthHeader("Recover account", "Sign in with the linked Google account", compact = true)
                    Spacer(Modifier.height(20.dp))
                    PhoneField(
                        phone = phone,
                        onPhone = { phone = it; error = "" },
                        country = country,
                        onPickCountry = { showCountries = true },
                        imeAction = ImeAction.Done,
                        onDone = {},
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(error, color = Red, fontSize = 12.sp, maxLines = 2)
                    }
                    Spacer(Modifier.height(10.dp))
                    GoogleButton(text = "Continue with Google", busy = busy, enabled = !busy) { recoverWithGoogle() }
                }
            }
        }
    }
}

/** data:image/...;base64 → Bitmap (Coil does not fetch data URIs — this was
 *  the invisible profile-photo preview bug). */
private fun decodeDataUrlBitmap(dataUrl: String?): android.graphics.Bitmap? {
    if (dataUrl.isNullOrBlank()) return null
    val comma = dataUrl.indexOf(',') 
    if (!dataUrl.startsWith("data:image") || comma < 0) return null
    return runCatching {
        val bytes = android.util.Base64.decode(dataUrl.substring(comma + 1), android.util.Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }.getOrNull()
}

/** Google button: logo + label on ONE line; busy shows a small in-button
 *  spinner, the label never becomes "…". */
@Composable
private fun GoogleButton(text: String, busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Card, contentColor = Ink),
        border = androidx.compose.foundation.BorderStroke(1.dp, Muted.copy(alpha = 0.35f)),
    ) {
        if (busy) {
            CircularProgressIndicator(color = Gold, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        } else {
            Image(GoogleLogo, contentDescription = "Google", modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(8.dp))
        Text(text, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Typographic brand wordmark: "Kuchu" ink + "Puchu" gold, extra-bold. */
@Composable
private fun Wordmark() {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = Ink, fontWeight = FontWeight.ExtraBold)) { append("Kuchu") }
            withStyle(SpanStyle(color = GoldDeep, fontWeight = FontWeight.ExtraBold)) { append("Puchu") }
        },
        fontSize = 34.sp,
        letterSpacing = (-0.5).sp,
        maxLines = 1,
    )
}

/** Fullscreen auth header: brand wordmark or (compact) icon + stage title. */
@Composable
private fun AuthHeader(
    title: String,
    subtitle: String?,
    wordmark: Boolean = false,
    compact: Boolean = false,
) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (!compact) Spacer(Modifier.height(8.dp))
        if (wordmark) {
            Wordmark()
        } else {
            Image(
                painterResource(R.drawable.icon_gold),
                contentDescription = "KuchuPuchu",
                modifier = Modifier.size(if (compact) 40.dp else 76.dp),
                contentScale = ContentScale.Fit,
            )
            Spacer(Modifier.height(if (compact) 8.dp else 16.dp))
            Text(
                title,
                fontSize = if (compact) 20.sp else 26.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
                maxLines = 1,
            )
        }
        if (subtitle != null) {
            Spacer(Modifier.height(4.dp))
            Text(subtitle, fontSize = if (compact) 12.sp else 13.sp, color = Muted, maxLines = 1)
        }
    }
}

/**
 * WhatsApp-style phone input: a country chip (flag + dial code, tappable —
 * the user NEVER types a code) next to the national-number field. Digits
 * only, capped at E.164 length.
 */
@Composable
private fun PhoneField(
    phone: String,
    onPhone: (String) -> Unit,
    country: KpCountry,
    onPickCountry: () -> Unit,
    imeAction: ImeAction,
    onDone: () -> Unit,
) {
    val maxDigits = if (country.iso == "BD") 11 else maxOf(6, 15 - country.dial.length)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .heightIn(min = 56.dp)
                .clip(FieldShape)
                .background(Card)
                .border(1.dp, Muted.copy(alpha = 0.35f), FieldShape)
                .clickable(onClick = onPickCountry)
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Real bundled flag image — Android emoji don't render country
                // flags, which drew as broken letter pairs on most devices.
                val flag = Flags.of(country.iso)
                if (flag != null) {
                    Image(
                        painterResource(flag),
                        contentDescription = country.name,
                        modifier =
                            Modifier
                                .width(22.dp)
                                .height(16.dp)
                                .clip(RoundedCornerShape(3.dp)),
                        contentScale = ContentScale.FillBounds,
                    )
                    Spacer(Modifier.width(7.dp))
                }
                Text(
                    "+${country.dial}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        OutlinedTextField(
            phone,
            { raw -> onPhone(raw.filter { it.isDigit() }.take(maxDigits)) },
            label = { Text("Phone number") },
            placeholder = {
                Text(
                    if (country.iso == "BD") "1XXXXXXXXX" else "Phone number",
                    color = Muted.copy(alpha = 0.45f),
                )
            },
            singleLine = true,
            shape = FieldShape,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = imeAction),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            modifier = Modifier.weight(1f),
        )
    }
}

/** Country picker sheet: searchable A→Z list with flags, names and codes. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CountryPickerSheet(
    current: KpCountry,
    onPick: (KpCountry) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        var query by remember { mutableStateOf("") }
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp),
        ) {
            Text("Select country", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                query,
                { query = it },
                label = { Text("Search") },
                singleLine = true,
                shape = FieldShape,
                keyboardOptions =
                    KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            val needle = query.trim()
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
                items(
                    COUNTRIES.filter { c ->
                        needle.isEmpty() ||
                            c.name.contains(needle, ignoreCase = true) ||
                            c.dial.contains(needle)
                    },
                ) { c ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onPick(c) }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val flag = Flags.of(c.iso)
                        if (flag != null) {
                            Image(
                                painterResource(flag),
                                contentDescription = c.name,
                                modifier =
                                    Modifier
                                        .width(24.dp)
                                        .height(18.dp)
                                        .clip(RoundedCornerShape(3.dp)),
                                contentScale = ContentScale.FillBounds,
                            )
                        } else {
                            Text(c.iso, fontSize = 13.sp, color = Muted, maxLines = 1)
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(
                            c.name,
                            fontSize = 14.sp,
                            color = Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "+${c.dial}",
                            fontSize = 13.sp,
                            color = if (c.iso == current.iso) GoldDeep else Muted,
                            fontWeight = if (c.iso == current.iso) FontWeight.Bold else FontWeight.Normal,
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** Pulsing-ring "working" pane. */
@Composable
private fun VerifyingPane(title: String, subtitle: String? = null) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val pulse = rememberInfiniteTransition(label = "verify")
        val ringScale by pulse.animateFloat(
            0.75f,
            1.3f,
            infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Restart),
            label = "scale",
        )
        val ringAlpha by pulse.animateFloat(
            0.5f,
            0f,
            infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Restart),
            label = "alpha",
        )
        Box(Modifier.size(84.dp), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                val r = (size.minDimension / 2f) * ringScale
                drawCircle(color = Gold.copy(alpha = ringAlpha), radius = r, style = Stroke(width = 4f))
            }
            CircularProgressIndicator(color = Gold, strokeWidth = 2.5.dp, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1)
        if (subtitle != null) {
            Spacer(Modifier.height(3.dp))
            Text(subtitle, fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center, maxLines = 2)
        }
    }
}

/** Compact animated green check. */
@Composable
private fun SuccessPane(title: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val circle = remember { Animatable(0f) }
        val check = remember { Animatable(0f) }
        LaunchedEffect(Unit) {
            circle.animateTo(1f, tween(300))
            check.animateTo(1f, tween(340))
        }
        Box(Modifier.size(84.dp), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                val c = size.minDimension / 2f
                drawCircle(color = Color(0xFF16A34A), radius = c * circle.value)
                if (check.value > 0f) {
                    val p = check.value
                    val w = size.width
                    val h = size.height
                    val stroke = w * 0.075f
                    val seg1 = minOf(1f, p / 0.5f)
                    if (seg1 > 0f) {
                        val from = androidx.compose.ui.geometry.Offset(w * 0.28f, h * 0.52f)
                        val to =
                            from +
                                (androidx.compose.ui.geometry.Offset(w * 0.45f, h * 0.68f) - from) * seg1
                        drawLine(Color.White, from, to, strokeWidth = stroke, cap = StrokeCap.Round)
                    }
                    val seg2 = ((p - 0.5f) / 0.5f).coerceIn(0f, 1f)
                    if (seg2 > 0f) {
                        val from = androidx.compose.ui.geometry.Offset(w * 0.45f, h * 0.68f)
                        val to =
                            from +
                                (androidx.compose.ui.geometry.Offset(w * 0.72f, h * 0.36f) - from) * seg2
                        drawLine(Color.White, from, to, strokeWidth = stroke, cap = StrokeCap.Round)
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1)
    }
}
