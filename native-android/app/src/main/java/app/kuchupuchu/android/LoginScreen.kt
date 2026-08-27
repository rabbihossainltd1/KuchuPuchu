package app.kuchupuchu.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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

@Composable
fun LoginScreen(onAuthed: (JSONObject) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("login") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().background(Bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp)).padding(22.dp),
        ) {
            Image(painterResource(R.drawable.icon_gold), null, Modifier.size(56.dp), contentScale = ContentScale.Fit)
            Spacer(Modifier.height(10.dp))
            Image(painterResource(R.drawable.logo_wordmark), "KuchuPuchu", Modifier.height(32.dp), contentScale = ContentScale.Fit)
            Spacer(Modifier.height(18.dp))
            Text(if (mode == "login") "Welcome back" else "Create account", fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            Spacer(Modifier.height(16.dp))
            if (mode == "signup") {
                OutlinedTextField(displayName, { displayName = it }, label = { Text("Display name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(10.dp))
            }
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
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
                Text(error, color = Rose, fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
            AccentBtn(if (busy) "…" else if (mode == "login") "Sign in" else "Create account") {
                if (busy) return@AccentBtn
                busy = true
                error = ""
                scope.launch {
                    try {
                        val path = if (mode == "login") "/api/auth/session" else "/api/auth/register"
                        val body =
                            JSONObject().put("email", email.trim()).put("password", password).apply {
                                if (mode == "signup") put("displayName", displayName.trim())
                            }
                        val data = withContext(Dispatchers.IO) { Api.post(path, body) }
                        Api.saveToken(ctx, data.optString("token"))
                        val user = data.optJSONObject("user") ?: withContext(Dispatchers.IO) { Api.get("/api/me").optJSONObject("user") }
                        if (user != null) Disk.put("me", JSONObject().put("user", user))
                        onAuthed(user ?: JSONObject())
                    } catch (e: Exception) {
                        error = e.message ?: "Could not sign in."
                    } finally {
                        busy = false
                    }
                }
            }
            TextButton(onClick = { mode = if (mode == "login") "signup" else "login" }) {
                Text(if (mode == "login") "Create account" else "Have an account? Sign in", color = Accent)
            }
        }
    }
}
