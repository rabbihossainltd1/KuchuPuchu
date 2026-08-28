package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GroupAdd
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Group creation — the chat menu's "New group" used to drop the user into the
 * 1:1 new-chat search (a dead end: no group was ever created). This screen
 * talks to the real endpoint: POST /api/conversations/group {title, memberIds}.
 */
@Composable
fun CreateGroupScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    val found = remember { mutableStateListOf<JSONObject>() }
    val picked = remember { mutableStateListOf<JSONObject>() }
    var searching by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    LaunchedEffect(query) {
        if (query.trim().length < 2) {
            found.clear()
            return@LaunchedEffect
        }
        delay(250)
        searching = true
        try {
            val data = withContext(Dispatchers.IO) { Api.get("/api/users?q=${Api.q(query.trim())}", true) }
            found.clear()
            found.addAll(data.arr("users").objects())
        } catch (_: Exception) {
        } finally {
            searching = false
        }
    }

    fun toggle(u: JSONObject) {
        val id = u.optString("id")
        if (picked.any { it.optString("id") == id }) {
            picked.removeAll { it.optString("id") == id }
        } else if (picked.size < 50) {
            picked.add(u)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        /* top bar */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text("New group", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }

        OutlinedTextField(
            title,
            { title = it.take(50) },
            label = { Text("Group name") },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        )

        /* picked member chips */
        if (picked.isNotEmpty()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${picked.size} member${if (picked.size == 1) "" else "s"}",
                    fontSize = 12.5.sp,
                    color = Muted,
                )
                picked.forEach { u ->
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(18.dp))
                            .background(GoldSoft)
                            .padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            u.optString("displayName").ifBlank { "User" },
                            fontSize = 12.5.sp,
                            color = GoldDeep,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(end = 2.dp),
                        )
                        IconButton(onClick = { toggle(u) }, Modifier.size(24.dp)) {
                            Icon(Icons.Filled.Close, "Remove ${u.optString("displayName")}", tint = GoldDeep, modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
        }

        OutlinedTextField(
            query,
            { query = it },
            label = { Text("Add members — search by name or username") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        )

        if (query.trim().length < 2) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                EmptyState(
                    icon = Icons.Filled.GroupAdd,
                    title = "Add members",
                    note = "Pick at least one person, name the group, and create it",
                )
            }
        } else {
            LazyColumn(
                Modifier.weight(1f),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(found, key = { it.optString("id") }) { user ->
                    val on = picked.any { it.optString("id") == user.optString("id") }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (on) GoldSoft else Card)
                            .clickable { toggle(user) }
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        KpAvatar(user.optString("displayName"), user.optString("avatarUrl"), 46.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                user.optString("displayName"),
                                fontSize = 15.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            val uname = user.optString("username")
                            Text(
                                if (uname.isNotBlank()) "@$uname" else "Tap to ${if (on) "remove" else "add"}",
                                fontSize = 12.5.sp,
                                color = Muted,
                            )
                        }
                        Box(
                            Modifier
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(if (on) Gold else Line),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (on) {
                                Text("✓", color = AmberInk, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                if (found.isEmpty() && !searching) {
                    item {
                        Text(
                            "No one found for \"$query\"",
                            Modifier
                                .fillMaxWidth()
                                .padding(24.dp),
                            fontSize = 14.sp,
                            color = Muted,
                        )
                    }
                }
            }
        }

        if (error.isNotBlank()) {
            Text(
                error,
                color = Red,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }

        GoldBtn(
            if (busy) "Creating…" else "Create group",
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            enabled = !busy && title.isNotBlank() && picked.isNotEmpty(),
        ) {
            busy = true
            error = ""
            scope.launch {
                try {
                    val body = JSONObject()
                        .put("title", title.trim())
                        .put(
                            "memberIds",
                            JSONArray().apply { picked.forEach { put(it.optString("id")) } },
                        )
                    val data = withContext(Dispatchers.IO) { Api.post("/api/conversations/group", body) }
                    val convId = data.optJSONObject("conversation")?.optString("id").orEmpty()
                    if (convId.isBlank()) throw Exception("Could not create the group. Try again.")
                    nav.navigate("chat/$convId") { popUpTo("main") }
                } catch (e: Exception) {
                    error = e.message ?: "Could not create the group."
                } finally {
                    busy = false
                }
            }
        }
    }
}
