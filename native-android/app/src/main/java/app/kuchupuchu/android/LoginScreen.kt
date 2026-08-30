package app.kuchupuchu.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LoginScreen(onAuthed: () -> Unit) {
    // onAuthed flips Store.authed via KpApp
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("login") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scrollState = rememberScrollState()

    // Auto-scroll to bottom when keyboard appears so the submit button stays visible.
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(imeVisible) {
        if (imeVisible) {
            // Small delay to let the keyboard animation settle, then scroll to bottom.
            kotlinx.coroutines.delay(300)
            scrollState.animateScrollTo(scrollState.maxValue)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            // imePadding BEFORE verticalScroll: in edge-to-edge mode the IME
            // inset must shrink the viewport (so the scrollable area fits above
            // the keyboard), not pad the content inside the scroll area.
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
            Text(
                "KuchuPuchu",
                fontSize = 27.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
            )
            Text(
                if (mode == "login") "Welcome back" else "Create your account",
                fontSize = 14.sp,
                color = Muted,
            )
            Spacer(Modifier.height(18.dp))
            if (mode == "signup") {
                OutlinedTextField(
                    displayName,
                    { displayName = it },
                    label = { Text("Display name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
            }
            OutlinedTextField(
                email,
                { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                password,
                { password = it },
                label = { Text("Password") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (error.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(error, color = Red, fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
            GoldBtn(
                if (busy) "…" else if (mode == "login") "Sign in" else "Create account",
                Modifier.fillMaxWidth(),
                enabled = !busy,
            ) {
                if (busy) return@GoldBtn
                busy = true
                error = ""
                scope.launch {
                    try {
                        val path = if (mode == "login") "/api/auth/login" else "/api/auth/register"
                        val body =
                            JSONObject()
                                .put("email", email.trim())
                                .put("password", password)
                                .apply {
                                    if (mode == "signup") put("displayName", displayName.trim())
                                }
                        val data = withContext(Dispatchers.IO) { Api.post(path, body) }
                        Api.saveToken(ctx, data.optString("token"))
                        val user = data.optJSONObject("user")
                            ?: withContext(Dispatchers.IO) { Api.get("/api/me").optJSONObject("user") }
                        Store.saveMe(user ?: JSONObject())
                        // Navigate first, then register push in background.
                        // Setting authed.value removes this composable from the tree,
                        // so all context-dependent work must finish BEFORE that flip.
                        onAuthed()
                        // Register for push now that we're signed in.
                        // Use applicationContext to avoid referencing a stale composable scope.
                        val appCtx = ctx.applicationContext
                        withContext(Dispatchers.IO) {
                            runCatching {
                                if (KpPush.tryInit(appCtx)) KpPush.registerToken(appCtx)
                            }
                        }
                    } catch (e: Exception) {
                        error = e.message ?: "Could not sign in."
                    } finally {
                        busy = false
                    }
                }
            }
            TextButton(onClick = { mode = if (mode == "login") "signup" else "login" }) {
                Text(
                    if (mode == "login") "Create account" else "Have an account? Sign in",
                    color = GoldDeep,
                )
            }
        }
    }
}
