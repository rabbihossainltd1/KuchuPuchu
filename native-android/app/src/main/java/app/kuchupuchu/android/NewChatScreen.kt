package app.kuchupuchu.android

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * New chat — search people by name / username and start a 1:1 conversation.
 * (Groups are created from the chat screen in the chat round.)
 */
@Composable
fun NewChatScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    val users = remember { mutableStateListOf<JSONObject>() }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        if (query.trim().length < 2) {
            users.clear()
            return@LaunchedEffect
        }
        delay(250)
        searching = true
        try {
            val data =
                withContext(Dispatchers.IO) {
                    Api.get("/api/users?q=${Api.q(query.trim())}", true)
                }
            users.clear()
            users.addAll(data.arr("users").objects())
        } catch (_: Exception) {
        } finally {
            searching = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        /* top bar */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink, modifier = Modifier.padding(4.dp))
            }
            Text("New chat", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }

        OutlinedTextField(
            query,
            { query = it },
            label = { Text("Name or username") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        )

        if (query.trim().length < 2) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(
                    icon = Icons.Filled.PersonSearch,
                    title = "New chat",
                    note = "Search someone by their name or username to start chatting",
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(users, key = { it.optString("id") }) { user ->
                    UserRow(user) {
                        scope.launch {
                            try {
                                val data =
                                    withContext(Dispatchers.IO) {
                                        Api.post(
                                            "/api/conversations",
                                            JSONObject().put("userId", user.optString("id")),
                                        )
                                    }
                                val conv = data.optJSONObject("conversation")
                                if (conv != null) {
                                    nav.navigate("chat/${conv.optString("id")}") {
                                        popUpTo("main")
                                    }
                                }
                            } catch (e: Exception) {
                            }
                        }
                    }
                }
                if (users.isEmpty() && !searching) {
                    item {
                        Text(
                            "No one found for \"$query\"",
                            Modifier.fillMaxWidth().padding(24.dp),
                            fontSize = 14.sp,
                            color = Muted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UserRow(user: JSONObject, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Card)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KpAvatar(user.optString("displayName"), user.optString("avatarUrl"), 46.dp)
        Spacer(Modifier.width(12.dp))
        Column {
            Text(
                user.optString("displayName"),
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
            )
            val uname = user.optString("username")
            Text(
                if (uname.isNotBlank()) "@$uname" else "Tap to chat",
                fontSize = 12.5.sp,
                color = Muted,
            )
        }
    }
}
