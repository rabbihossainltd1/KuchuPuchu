package app.kuchupuchu.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
        Modifier.fillMaxSize().background(Bg).padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.logo_wordmark), "KuchuPuchu", Modifier.fillMaxWidth(0.7f).height(56.dp))
        Spacer(Modifier.height(28.dp))
        Text(if (mode == "login") "Welcome back" else "Create account", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Spacer(Modifier.height(18.dp))
        if (mode == "signup") {
            Field("Display name", displayName) { displayName = it }
            Spacer(Modifier.height(10.dp))
        }
        Field("Email", email, KeyboardType.Email) { email = it }
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
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
        Button(
            onClick = {
                if (busy) return@Button
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
                        val tok = data.optString("token")
                        Api.saveToken(ctx, tok)
                        val user = data.optJSONObject("user") ?: withContext(Dispatchers.IO) { Api.get("/api/me").optJSONObject("user") }
                        onAuthed(user ?: JSONObject())
                    } catch (e: Exception) {
                        error = e.message ?: "Could not sign in."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Ink),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text(if (busy) "…" else if (mode == "login") "Log in" else "Sign up")
        }
        TextButton(onClick = { mode = if (mode == "login") "signup" else "login" }) {
            Text(if (mode == "login") "Need an account? Sign up" else "Have an account? Log in", color = Accent)
        }
    }
}

@Composable
private fun Field(label: String, value: String, type: KeyboardType = KeyboardType.Text, on: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = on,
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = type),
        modifier = Modifier.fillMaxWidth(),
    )
}
