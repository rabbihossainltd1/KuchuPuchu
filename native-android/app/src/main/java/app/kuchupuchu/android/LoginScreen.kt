package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.Icon
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
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
 * PHONE → VERIFYING (animation) → VERIFY_OK (success animation) →
 *   existing account, same device  → DONE → home
 *   existing account, new device   → WAITING (old device approves) → home
 *   new number                     → BIND (Google) → PROFILE setup → DONE → home
 * lost device → "Can't access my previous device?" → Google recovery.
 */
private enum class LoginStage { PHONE, VERIFYING, VERIFY_OK, BIND, PROFILE, SAVING, DONE, WAITING, RECOVERY }

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
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var requestId by remember { mutableStateOf("") }
    var deviceOnly by remember { mutableStateOf(false) }
    var isNewSignup by remember { mutableStateOf(false) }
    var sessionPayload by remember { mutableStateOf<JSONObject?>(null) }
    var afterVerify by remember { mutableStateOf({}) } // () -> Unit
    val scrollState = rememberScrollState()

    // ---- profile setup state ----
    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var about by remember { mutableStateOf("") }
    var avatarDataUrl by remember { mutableStateOf<String?>(null) }
    var profileError by remember { mutableStateOf("") }

    fun finish(data: JSONObject) {
        Api.saveToken(ctx, data.optString("token"))
        val user = data.optJSONObject("user")
        Store.saveMe(user ?: JSONObject())
        onAuthed()
        val appCtx = ctx.applicationContext
        scope.launch(Dispatchers.IO) {
            runCatching { if (KpPush.tryInit(appCtx)) KpPush.registerToken(appCtx) }
        }
    }

    /** Runs the local SIM check and submits the number to the worker. */
    fun startVerify(simOverride: String? = null) {
        busy = true
        error = ""
        stage = LoginStage.VERIFYING
        scope.launch {
            try {
                val e164 = PhoneVerifier.normalize(phone)
                    ?: throw IllegalStateException("Enter a valid phone number, e.g. 01712345678.")
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
        if (PhoneVerifier.normalize(phone) == null) {
            error = "Enter a valid phone number, e.g. 01712345678."
            return
        }
        val granted =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) ==
                PackageManager.PERMISSION_GRANTED
        // A denial is not fatal — the flow reports PERMISSION_DENIED and the
        // worker's grace path + device approval still protect the account.
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
                    PhoneVerifier.normalize(phone)
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
                if (isNewSignup) {
                    // Suggest a username from the chosen display-name path later;
                    // start clean here so the user types their own.
                    stage = LoginStage.PROFILE
                } else {
                    stage = LoginStage.DONE
                }
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
            profileError = "Username: 3–20 characters — lowercase letters, numbers, underscore."
            return
        }
        busy = true
        profileError = ""
        stage = LoginStage.SAVING
        scope.launch {
            try {
                val body = JSONObject()
                    .put("displayName", if (lastName.isBlank()) first else "$first ${lastName.trim()}")
                    .put("about", about.trim())
                if (username.isNotBlank()) body.put("username", username.trim().lowercase())
                avatarDataUrl?.let { body.put("avatarUrl", it) }
                val updated =
                    withContext(Dispatchers.IO) { Api.patch("/api/me", body).optJSONObject("user") }
                updated?.let {
                    Store.saveMe(it)
                    sessionPayload?.put("user", it)
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
                    PhoneVerifier.normalize(phone)
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
                    "PENDING" -> {}
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
                // transient network blip — keep polling
            }
        }
    }

    // Auto-advance from the success animation to whatever came next.
    LaunchedEffect(stage) {
        if (stage == LoginStage.VERIFY_OK) {
            delay(1100)
            afterVerify()
        } else if (stage == LoginStage.DONE) {
            delay(1100)
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
            when (stage) {
                LoginStage.PHONE, LoginStage.VERIFYING, LoginStage.VERIFY_OK -> {
                    Image(
                        painterResource(R.drawable.icon_gold),
                        contentDescription = "KuchuPuchu",
                        modifier = Modifier.size(58.dp),
                        contentScale = ContentScale.Fit,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("KuchuPuchu", fontSize = 27.sp, fontWeight = FontWeight.Bold, color = Ink)
                    Text("Sign in with your phone number", fontSize = 14.sp, color = Muted)
                    Spacer(Modifier.height(18.dp))

                    when (stage) {
                        LoginStage.PHONE -> {
                            OutlinedTextField(
                                phone,
                                { phone = it; error = "" },
                                label = { Text("Phone number") },
                                placeholder = {
                                    Text(
                                        "01712345678",
                                        color = Muted.copy(alpha = 0.45f),
                                    )
                                },
                                singleLine = true,
                                shape = FieldShape,
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
                            if (error.isNotBlank()) {
                                Spacer(Modifier.height(8.dp))
                                Text(error, color = Red, fontSize = 13.sp)
                            }
                            Spacer(Modifier.height(16.dp))
                            GoldBtn(
                                "Continue",
                                Modifier.fillMaxWidth(),
                                enabled = !busy,
                            ) { onContinue() }
                            TextButton(onClick = { stage = LoginStage.RECOVERY; error = "" }) {
                                Text("Can't access my previous device?", color = GoldDeep)
                            }
                        }

                        LoginStage.VERIFYING -> VerifyingPane("Verifying your number")

                        LoginStage.VERIFY_OK -> SuccessPane("Number verified")
                        else -> {}
                    }
                }

                LoginStage.BIND -> {
                    Text("Bind your Gmail", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Your account is created. Link a Google account so you can recover it if you lose this device.",
                        fontSize = 13.sp,
                        color = Muted,
                    )
                    if (deviceOnly) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "This number couldn't be verified automatically on this device.",
                            fontSize = 12.sp,
                            color = Muted.copy(alpha = 0.8f),
                        )
                    }
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(18.dp))
                    GoogleButton(
                        text = "Continue with Google",
                        busy = busy,
                        enabled = !busy,
                    ) { bindGoogle() }
                    TextButton(onClick = { stage = LoginStage.PHONE; error = "" }) {
                        Text("Back", color = Muted)
                    }
                }

                LoginStage.PROFILE -> {
                    Text("Set up your profile", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink)
                    Spacer(Modifier.height(14.dp))
                    // Profile photo
                    Box(
                        Modifier
                            .size(88.dp)
                            .clip(CircleShape)
                            .background(Cream)
                            .clickable {
                                avatarPicker.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                )
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (avatarDataUrl != null) {
                            coil.compose.AsyncImage(
                                model = avatarDataUrl,
                                contentDescription = "Profile photo",
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop,
                            )
                            Box(
                                Modifier
                                    .fillMaxSize()
                                    .background(Color(0x66000000)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Filled.CameraAlt, "Change photo", tint = Color.White, modifier = Modifier.size(22.dp))
                            }
                        } else {
                            Icon(
                                Icons.Filled.AccountCircle,
                                "Add photo",
                                tint = Muted.copy(alpha = 0.6f),
                                modifier = Modifier.size(46.dp),
                            )
                        }
                    }
                    Text("Tap to add a photo (optional)", fontSize = 12.sp, color = Muted)
                    Spacer(Modifier.height(14.dp))
                    Row(Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            firstName,
                            { firstName = it.take(25); profileError = "" },
                            label = { Text("First name") },
                            singleLine = true,
                            shape = FieldShape,
                            keyboardOptions =
                                KeyboardOptions(
                                    capitalization = KeyboardCapitalization.Words,
                                    imeAction = ImeAction.Next,
                                ),
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(10.dp))
                        OutlinedTextField(
                            lastName,
                            { lastName = it.take(25); profileError = "" },
                            label = { Text("Last name (optional)") },
                            singleLine = true,
                            shape = FieldShape,
                            keyboardOptions =
                                KeyboardOptions(
                                    capitalization = KeyboardCapitalization.Words,
                                    imeAction = ImeAction.Next,
                                ),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        username,
                        { username = it.lowercase().take(20); profileError = "" },
                        label = { Text("Username (optional)") },
                        placeholder = { Text("e.g. rabbi_ff", color = Muted.copy(alpha = 0.45f)) },
                        singleLine = true,
                        shape = FieldShape,
                        keyboardOptions =
                            KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "3–20 characters: lowercase letters, numbers, underscore. People can find you by this.",
                        fontSize = 11.sp,
                        color = Muted.copy(alpha = 0.8f),
                    )
                    Spacer(Modifier.height(10.dp))
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
                        Spacer(Modifier.height(8.dp))
                        Text(profileError, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoldBtn(
                        if (busy) "Saving…" else "Save and continue",
                        Modifier.fillMaxWidth(),
                        enabled = !busy,
                    ) { saveProfile() }
                }

                LoginStage.SAVING -> VerifyingPane("Setting up your profile")

                LoginStage.DONE -> SuccessPane("All set!")

                LoginStage.WAITING -> {
                    VerifyingPane("Waiting for approval", "Approve the login on your other device to continue here.")
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoldBtn("Cancel", Modifier.fillMaxWidth(), enabled = true) { cancelApproval() }
                }

                LoginStage.RECOVERY -> {
                    Text("Account recovery", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Enter your phone number, then sign in with the Google account linked to it. Your account will move to this device.",
                        fontSize = 13.sp,
                        color = Muted,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        phone,
                        { phone = it; error = "" },
                        label = { Text("Phone number") },
                        placeholder = { Text("01712345678", color = Muted.copy(alpha = 0.45f)) },
                        singleLine = true,
                        shape = FieldShape,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(error, color = Red, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    GoogleButton(text = "Continue with Google", busy = busy, enabled = !busy) { recoverWithGoogle() }
                    TextButton(onClick = { stage = LoginStage.PHONE; error = "" }) {
                        Text("Back", color = Muted)
                    }
                }
            }
        }
    }
}

/** Button that never swaps its label for "…" — busy shows a small spinner
 *  INSIDE the button, next to the unchanged text. */
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
            CircularProgressIndicator(
                color = Gold,
                strokeWidth = 2.dp,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
        } else {
            Image(
                GoogleLogo,
                contentDescription = "Google",
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}

/** Pulsing gold rings + spinner — the "working on it" pane. */
@Composable
private fun VerifyingPane(title: String, subtitle: String? = null) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val pulse = rememberInfiniteTransition(label = "verify")
        val ringScale by pulse.animateFloat(
            0.75f,
            1.35f,
            infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Restart),
            label = "scale",
        )
        val ringAlpha by pulse.animateFloat(
            0.5f,
            0f,
            infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Restart),
            label = "alpha",
        )
        Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                val r = (size.minDimension / 2f) * ringScale
                drawCircle(color = Gold.copy(alpha = ringAlpha), radius = r, style = Stroke(width = 5f))
            }
            CircularProgressIndicator(color = Gold, strokeWidth = 3.dp, modifier = Modifier.size(44.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        if (subtitle != null) {
            Spacer(Modifier.height(4.dp))
            Text(subtitle, fontSize = 13.sp, color = Muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

/** Green circle + animated checkmark — the success pane. */
@Composable
private fun SuccessPane(title: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val circle = remember { Animatable(0f) }
        val check = remember { Animatable(0f) }
        LaunchedEffect(Unit) {
            circle.animateTo(1f, tween(350))
            check.animateTo(1f, tween(380))
        }
        val boxSize: Dp = 96.dp
        Box(Modifier.size(boxSize), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                val c = size.minDimension / 2f
                drawCircle(color = Color(0xFF16A34A), radius = c * circle.value)
                if (check.value > 0f) {
                    val p = check.value
                    val w = size.width
                    val h = size.height
                    val stroke = Stroke(width = w * 0.07f, cap = StrokeCap.Round)
                    val seg1 = minOf(1f, p / 0.5f)
                    if (seg1 > 0f) {
                        val from = Offset(w * 0.28f, h * 0.52f)
                        val to = Offset(w * 0.28f, h * 0.52f) +
                            (Offset(w * 0.45f, h * 0.68f) - Offset(w * 0.28f, h * 0.52f)) * seg1
                        drawLine(Color.White, from, to, strokeWidth = stroke.width, cap = StrokeCap.Round)
                    }
                    val seg2 = ((p - 0.5f) / 0.5f).coerceIn(0f, 1f)
                    if (seg2 > 0f) {
                        val from = Offset(w * 0.45f, h * 0.68f)
                        val to = Offset(w * 0.45f, h * 0.68f) +
                            (Offset(w * 0.72f, h * 0.36f) - Offset(w * 0.45f, h * 0.68f)) * seg2
                        drawLine(Color.White, from, to, strokeWidth = stroke.width, cap = StrokeCap.Round)
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ink)
    }
}
