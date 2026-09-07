package app.kuchupuchu.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Owner round 31: the GROUP PROFILE — opened from the chat header. Real and
 * complete: picture + name (admin edits them in place), members with the
 * admin marked, add members (admin), remove a member (admin, via the member
 * sheet), open a member's profile, leave the group.
 *
 * Admin = the creator (`ownerId`); when the admin leaves the worker hands the
 * group to the longest-standing member.
 */
@Composable
fun GroupInfoScreen(nav: NavController, convId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var conv by remember { mutableStateOf(ScreenStore.convDetailOf(convId)) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var memberSheet by remember { mutableStateOf<JSONObject?>(null) }
    var confirmKick by remember { mutableStateOf<JSONObject?>(null) }
    var confirmLeave by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var addOpen by remember { mutableStateOf(false) }

    suspend fun reload() {
        runCatching {
            val data = withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId", true) }
            data.optJSONObject("conversation")?.let {
                conv = it
                ScreenStore.setConvDetail(convId, it)
            }
        }.onFailure { error = it.message ?: "Could not load the group." }
    }
    LaunchedEffect(convId, ScreenStore.profileVersion, ScreenStore.poke) { reload() }

    val c = conv
    val myId = Store.myId()
    val ownerId = c?.optText("ownerId").orEmpty()
    val isAdmin = ownerId.isNotBlank() && ownerId == myId
    val title = c?.optText("title")?.ifBlank { "Group" } ?: "Group"
    val members = c?.arr("members")?.objects().orEmpty()
    val avatarRef = c?.optIso("avatarRef")
    val shownAvatar = rememberAvatarUrl(c?.optIso("avatarUrl"), avatarRef)
    var viewerUrl by remember { mutableStateOf<String?>(null) }
    viewerUrl?.let { url -> KpPhotoViewer(url = url, title = title, onClose = { viewerUrl = null }) }

    fun patch(body: JSONObject, onDone: () -> Unit = {}) {
        scope.launch {
            busy = true
            error = ""
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.patch("/api/conversations/$convId", body) }
                data.optJSONObject("conversation")?.let {
                    conv = it
                    ScreenStore.setConvDetail(convId, it)
                }
            }.onFailure { error = it.message ?: "Could not save." }
            busy = false
            onDone()
        }
    }

    val photoPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                scope.launch {
                    busy = true
                    val dataUrl =
                        withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx, maxSide = 512, maxChars = 76_000) }
                    if (dataUrl == null) {
                        error = "Could not read that photo."
                        busy = false
                    } else {
                        patch(JSONObject().put("avatarUrl", dataUrl))
                    }
                }
            }
        }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Text("Group", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.weight(1f))
            if (busy) CircularProgressIndicator(color = ActionBlueDeep, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(16.dp))
        }

        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box {
                        KpAvatar(title, shownAvatar, 88.dp, avatarRef = avatarRef)
                        // Admin: tap picks a new picture. Everyone else: tap
                        // opens the current one in the app's own viewer.
                        Box(
                            Modifier
                                .matchParentSize()
                                .clip(CircleShape)
                                .clickable {
                                    if (isAdmin) {
                                        photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                    } else {
                                        shownAvatar?.takeIf { it.isNotBlank() }?.let { viewerUrl = it }
                                    }
                                },
                        )
                        if (isAdmin) {
                            Box(
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .size(26.dp)
                                    .clip(CircleShape)
                                    .background(ActionBlue),
                                contentAlignment = Alignment.Center,
                            ) { Icon(Icons.Filled.Photo, "Change picture", tint = ActionBlueInk, modifier = Modifier.size(14.dp)) }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.let { m -> if (isAdmin) m.clickable { rename = true } else m },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            title,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (isAdmin) {
                            Spacer(Modifier.width(6.dp))
                            Icon(Icons.Filled.Edit, "Rename", tint = ActionBlueDeep, modifier = Modifier.size(16.dp))
                        }
                    }
                    Text(
                        "${members.size} member${if (members.size == 1) "" else "s"}",
                        fontSize = 13.sp,
                        color = Muted,
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(error, color = Red, fontSize = 12.5.sp)
                    }
                }
            }
            if (isAdmin) {
                item {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 6.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Card)
                            .clickable { haptics.tap(); addOpen = true }
                            .padding(horizontal = 16.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.PersonAdd, null, tint = ActionBlueDeep, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.width(14.dp))
                        Text("Add members", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Ink, maxLines = 1)
                    }
                }
            }
            items(members, key = { it.optJSONObject("user")?.optString("id") ?: it.toString() }) { m ->
                val u = m.optJSONObject("user") ?: JSONObject()
                val uid = u.optString("id")
                val admin = uid == ownerId
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 3.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Card)
                        .clickable { memberSheet = u }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    KpAvatar(u.optText("displayName"), u.optIso("avatarUrl"), 44.dp, avatarRef = u.optIso("avatarRef"))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (uid == myId) "You" else u.optText("displayName").ifBlank { "User" },
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val uname = u.optText("username")
                        if (uname.isNotBlank()) Text("@$uname", fontSize = 12.5.sp, color = Muted, maxLines = 1)
                    }
                    if (admin) {
                        Text(
                            "Admin",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = ActionBlueDeep,
                            modifier =
                                Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(ActionBlue.copy(alpha = 0.16f))
                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
            }
            item {
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Red.copy(alpha = 0.12f))
                        .clickable { confirmLeave = true }
                        .padding(horizontal = 16.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, null, tint = Red, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(14.dp))
                    Text("Leave group", color = Red, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                }
            }
        }
    }

    // ---- member sheet: profile / remove (admin) ----
    memberSheet?.let { u ->
        val uid = u.optString("id")
        KpSheet(onDismiss = { memberSheet = null }, title = u.optText("displayName").ifBlank { "Member" }) {
            if (uid != myId) {
                KpSheetRow(Icons.Filled.Person, "View profile") {
                    memberSheet = null
                    nav.navigate("profile/$uid")
                }
            }
            if (isAdmin && uid != myId) {
                KpSheetRow(Icons.Filled.PersonRemove, "Remove from group", tint = Red) {
                    memberSheet = null
                    confirmKick = u
                }
            }
        }
    }
    confirmKick?.let { u ->
        KpConfirmSheet(
            title = "Remove ${u.optText("displayName").ifBlank { "this member" }}?",
            confirmLabel = "Remove",
            danger = true,
            onDismiss = { confirmKick = null },
            onConfirm = {
                confirmKick = null
                scope.launch {
                    busy = true
                    runCatching {
                        withContext(Dispatchers.IO) { Api.delete("/api/conversations/$convId/members/${u.optString("id")}") }
                    }.onFailure { error = it.message ?: "Could not remove." }
                    reload()
                    busy = false
                }
            },
        )
    }
    if (confirmLeave) {
        KpConfirmSheet(
            title = "Leave group?",
            text = if (isAdmin && members.size > 1) "The oldest member becomes admin." else null,
            confirmLabel = "Leave",
            danger = true,
            onDismiss = { confirmLeave = false },
            onConfirm = {
                confirmLeave = false
                scope.launch {
                    busy = true
                    val ok =
                        runCatching {
                            withContext(Dispatchers.IO) { Api.delete("/api/conversations/$convId/members/$myId") }
                        }.isSuccess
                    busy = false
                    if (ok) {
                        ScreenStore.convs.removeAll { it.optString("id") == convId }
                        nav.popBackStack("main", inclusive = false)
                    } else {
                        error = "Could not leave."
                    }
                }
            },
        )
    }
    // ---- rename sheet ----
    if (rename) {
        var draft by remember { mutableStateOf(title) }
        KpSheet(onDismiss = { rename = false }, title = "Group name") {
            Column(Modifier.padding(horizontal = 14.dp).imePadding()) {
                CompactSearchBar(
                    draft,
                    { draft = it.take(50) },
                    placeholder = "Name",
                    icon = Icons.Filled.Edit,
                    imeAction = ImeAction.Done,
                )
                Spacer(Modifier.height(12.dp))
                GoldBtn("Save", Modifier.fillMaxWidth(), enabled = draft.isNotBlank() && draft.trim() != title) {
                    rename = false
                    patch(JSONObject().put("title", draft.trim()))
                }
                Spacer(Modifier.height(6.dp))
            }
        }
    }
    // ---- add members sheet ----
    if (addOpen) {
        val memberIds = members.mapNotNull { it.optJSONObject("user")?.optString("id") }.toSet()
        AddMembersSheet(
            exclude = memberIds,
            onDismiss = { addOpen = false },
            onAdd = { picked ->
                addOpen = false
                scope.launch {
                    busy = true
                    for (u in picked) {
                        runCatching {
                            withContext(Dispatchers.IO) {
                                Api.post("/api/conversations/$convId/members", JSONObject().put("userId", u.optString("id")))
                            }
                        }.onFailure { error = it.message ?: "Could not add ${u.optText("displayName")}." }
                    }
                    reload()
                    busy = false
                }
            },
        )
    }
}

/** Pick people to add: chat-list peers first, server search for the rest. */
@Composable
private fun AddMembersSheet(exclude: Set<String>, onDismiss: () -> Unit, onAdd: (List<JSONObject>) -> Unit) {
    var query by remember { mutableStateOf("") }
    val picked = remember { mutableStateListOf<JSONObject>() }
    val found = remember { mutableStateListOf<JSONObject>() }
    val known =
        remember {
            ScreenStore.convs
                .filter { !it.optBoolean("isGroup") }
                .mapNotNull { it.optJSONObject("other") }
                .filter { it.optString("id").isNotBlank() && !isKpBot(it.optString("id")) && it.optString("id") !in exclude }
                .distinctBy { it.optString("id") }
        }
    LaunchedEffect(query) {
        val q = query.trim()
        found.clear()
        if (q.length < 2) {
            found.addAll(known)
            return@LaunchedEffect
        }
        found.addAll(known.filter { it.optString("displayName").contains(q, true) || it.optString("username").contains(q, true) })
        delay(250)
        runCatching {
            val data = withContext(Dispatchers.IO) { Api.get("/api/users?q=${Api.q(q)}", true) }
            data.arr("users").objects()
                .filter { u -> u.optString("id") !in exclude && !isKpBot(u.optString("id")) && found.none { it.optString("id") == u.optString("id") } }
                .let { found.addAll(it) }
        }
    }
    KpSheet(onDismiss = onDismiss, title = "Add members") {
        Column(Modifier.padding(horizontal = 14.dp).imePadding()) {
            CompactSearchBar(query, { query = it }, placeholder = "Search")
            Spacer(Modifier.height(8.dp))
            LazyColumn(Modifier.height(320.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(found, key = { it.optString("id") }) { u ->
                    val on = picked.any { it.optString("id") == u.optString("id") }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (on) ActionBlue.copy(alpha = 0.14f) else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable {
                                if (on) picked.removeAll { it.optString("id") == u.optString("id") } else picked.add(u)
                            }
                            .padding(horizontal = 10.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        KpAvatar(u.optText("displayName"), u.optIso("avatarUrl"), 40.dp, avatarRef = u.optIso("avatarRef"))
                        Spacer(Modifier.width(12.dp))
                        Text(
                            u.optText("displayName").ifBlank { "User" },
                            fontSize = 14.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Box(
                            Modifier
                                .size(22.dp)
                                .clip(CircleShape)
                                .background(if (on) ActionBlue else Line),
                            contentAlignment = Alignment.Center,
                        ) { if (on) Text("✓", color = ActionBlueInk, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            GoldBtn(
                if (picked.isEmpty()) "Add" else "Add (${picked.size})",
                Modifier.fillMaxWidth(),
                enabled = picked.isNotEmpty(),
            ) { onAdd(picked.toList()) }
            Spacer(Modifier.height(6.dp))
        }
    }
}
