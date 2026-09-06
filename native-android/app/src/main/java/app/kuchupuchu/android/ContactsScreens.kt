package app.kuchupuchu.android

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val INVITE_TEXT =
    "Hey! I'm on KuchuPuchu — fast, private chats and calls. Get it here: " +
        "https://github.com/rabbihossainltd1/KuchuPuchu/releases/latest"

/** Open (or create) the 1:1 chat with a KP user and navigate there. */
private fun openChatWith(
    nav: NavController,
    scope: kotlinx.coroutines.CoroutineScope,
    userId: String,
) {
    if (userId.isBlank()) return
    val cached = ScreenStore.convIdForUser[userId]
    if (cached != null) {
        nav.navigate("chat/$cached") { popUpTo("main") }
        return
    }
    scope.launch {
        runCatching {
            val conv = withContext(Dispatchers.IO) {
                Api.post("/api/conversations", JSONObject().put("userId", userId))
            }
            conv.optJSONObject("conversation")?.optString("id")?.let {
                ScreenStore.convIdForUser[userId] = it
                nav.navigate("chat/$it") { popUpTo("main") }
            }
        }
    }
}

/** SMS composer pre-filled with the invite (falls back to the share sheet). */
private fun invite(ctx: android.content.Context, phone: String) {
    val sms =
        android.content.Intent(android.content.Intent.ACTION_SENDTO, android.net.Uri.parse("smsto:$phone"))
            .putExtra("sms_body", INVITE_TEXT)
    runCatching { ctx.startActivity(sms) }.onFailure {
        val share =
            android.content.Intent(android.content.Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(android.content.Intent.EXTRA_TEXT, INVITE_TEXT)
        runCatching { ctx.startActivity(android.content.Intent.createChooser(share, "Invite to KuchuPuchu")) }
    }
}

/**
 * Owner round 28: "All contacts" — the phone book, KP users first with a
 * Chat action on the right, everyone else with Invite. Asks for the contacts
 * permission itself the first time.
 */
@Composable
fun AllContactsScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var granted by remember { mutableStateOf(PhoneBook.granted(ctx)) }
    var asked by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
            granted = ok
            asked = true
            if (ok) scope.launch(Dispatchers.IO) { PhoneBook.sync(ctx, force = true) }
        }

    LaunchedEffect(granted) {
        if (granted) withContext(Dispatchers.IO) { PhoneBook.sync(ctx) }
        else if (!asked) launcher.launch(Manifest.permission.READ_CONTACTS)
    }

    val entries = PhoneBook.entries
    val syncing by PhoneBook.syncing
    val needle = query.trim().lowercase()
    val shown =
        if (needle.isBlank()) entries
        else entries.filter {
            it.name.lowercase().contains(needle) || it.phone.contains(needle) ||
                it.user?.optString("username").orEmpty().lowercase().contains(needle)
        }
    val onKp = shown.filter { it.user != null }
    val others = shown.filter { it.user == null }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Column(Modifier.weight(1f)) {
                Text("All contacts", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
                if (granted) {
                    Text(
                        if (syncing) "Syncing…" else "${entries.count { it.user != null }} on KuchuPuchu · ${entries.size} contacts",
                        fontSize = 12.sp,
                        color = Muted,
                    )
                }
            }
            IconButton(onClick = { haptics.tap(); nav.navigate("newcontact") }) {
                Icon(Icons.Filled.PersonAdd, "New contact", tint = Ink, modifier = Modifier.size(24.dp))
            }
            IconButton(
                enabled = granted && !syncing,
                onClick = {
                    haptics.tap()
                    scope.launch(Dispatchers.IO) { PhoneBook.sync(ctx, force = true) }
                },
            ) {
                if (syncing) CircularProgressIndicator(color = ActionBlue, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                else Icon(Icons.Filled.Refresh, "Refresh", tint = Ink, modifier = Modifier.size(24.dp))
            }
        }

        if (!granted) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    EmptyState(
                        icon = Icons.Filled.Contacts,
                        title = "See who's on KuchuPuchu",
                        note = "Allow contacts access to find friends from your phone book and invite the rest. " +
                            "Your contacts are matched, never stored.",
                    )
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = { launcher.launch(Manifest.permission.READ_CONTACTS) },
                        colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = ActionBlueInk),
                        shape = RoundedCornerShape(14.dp),
                    ) { Text("Allow contacts", fontWeight = FontWeight.SemiBold) }
                    if (asked) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "Denied? Enable it under Settings → Apps → KuchuPuchu → Permissions.",
                            fontSize = 12.sp,
                            color = Muted,
                            modifier = Modifier.clickable {
                                runCatching {
                                    ctx.startActivity(
                                        android.content.Intent(
                                            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                            android.net.Uri.parse("package:${ctx.packageName}"),
                                        ),
                                    )
                                }
                            },
                        )
                    }
                }
            }
            return@Column
        }

        // Owner round 30: the shared compact pill.
        CompactSearchBar(query, { query = it }, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))

        if (entries.isEmpty() && syncing) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ActionBlue)
            }
            return@Column
        }
        if (entries.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(icon = Icons.Filled.Contacts, title = "No contacts", note = "Your phone book is empty.")
            }
            return@Column
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (onKp.isNotEmpty()) {
                item { ContactsSection("On KuchuPuchu") }
                items(onKp, key = { "k" + it.phone }) { e ->
                    val u = e.user!!
                    ContactRow(
                        name = e.name,
                        sub = u.optString("username").takeIf { it.isNotBlank() }?.let { "@$it" } ?: e.phone,
                        avatarUrl = u.optIso("avatarUrl"),
                        avatarRef = u.optIso("avatarRef"),
                        onOpen = { haptics.tap(); nav.navigate("profile/${u.optString("id")}") },
                    ) {
                        ContactAction("Chat", primary = true) { haptics.tap(); openChatWith(nav, scope, u.optString("id")) }
                    }
                }
            }
            if (others.isNotEmpty()) {
                item { ContactsSection("Invite to KuchuPuchu") }
                items(others, key = { "o" + it.phone }) { e ->
                    ContactRow(name = e.name, sub = e.phone, avatarUrl = null, avatarRef = null, onOpen = null) {
                        ContactAction("Invite", primary = false) { haptics.tap(); invite(ctx, e.phone) }
                    }
                }
            }
            if (shown.isEmpty()) {
                item {
                    Text(
                        "No contact matches \"$query\"",
                        Modifier.fillMaxWidth().padding(24.dp),
                        fontSize = 14.sp,
                        color = Muted,
                    )
                }
            }
        }
    }
}

/**
 * Owner round 28: "New contact" — a name + number the app saves to the phone's
 * contacts (through the system contact editor, so it lands in the user's
 * Google/SIM account like any other contact) and immediately checks against
 * KuchuPuchu: a match offers Chat right here, otherwise Invite.
 */
@Composable
fun NewContactScreen(nav: NavController, initialName: String = "", initialPhone: String = "") {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var name by remember { mutableStateOf(initialName) }
    var phone by remember { mutableStateOf(initialPhone) }
    var error by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var match by remember { mutableStateOf<JSONObject?>(null) }
    var checkedPhone by remember { mutableStateOf("") }

    val home = remember { COUNTRIES.firstOrNull { it.iso == "BD" } ?: DEFAULT_COUNTRY }
    val e164 = PhoneBook.toE164(phone, home)

    fun lookup() {
        val p = e164 ?: run {
            error = "Enter a valid phone number, e.g. 01712345678 or +8801712345678."
            return
        }
        error = ""
        checking = true
        scope.launch {
            val res = runCatching {
                withContext(Dispatchers.IO) {
                    Api.post("/api/contacts/match", JSONObject().put("phones", org.json.JSONArray(listOf(p))))
                }
            }.getOrNull()
            match = res?.arr("users")?.objects()?.firstOrNull()
            checkedPhone = p
            checking = false
        }
    }

    fun saveToPhone() {
        val p = e164 ?: run {
            error = "Enter a valid phone number first."
            return
        }
        val intent =
            android.content.Intent(android.content.Intent.ACTION_INSERT)
                .setType(android.provider.ContactsContract.Contacts.CONTENT_TYPE)
                .putExtra(android.provider.ContactsContract.Intents.Insert.NAME, name.trim())
                .putExtra(android.provider.ContactsContract.Intents.Insert.PHONE, p)
        runCatching { ctx.startActivity(intent) }.onFailure { error = "No contacts app found on this phone." }
        // The phone book changed (or is about to) — refresh the match list.
        scope.launch(Dispatchers.IO) { PhoneBook.sync(ctx, force = true) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Text("New contact", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        Column(Modifier.padding(horizontal = 20.dp)) {
            OutlinedTextField(
                name,
                { name = it },
                label = { Text("Name") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = ActionBlue,
                    cursorColor = ActionBlue,
                    focusedLabelColor = ActionBlue,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                phone,
                { phone = it; match = null; checkedPhone = "" },
                label = { Text("Phone number") },
                placeholder = { Text("01712345678", color = Muted.copy(alpha = 0.45f)) },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                isError = phone.isNotBlank() && e164 == null,
                supportingText = {
                    if (e164 != null) Text(e164, color = Muted, fontSize = 12.sp)
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = ActionBlue,
                    cursorColor = ActionBlue,
                    focusedLabelColor = ActionBlue,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(error, color = Red, fontSize = 12.5.sp)
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = { haptics.tap(); lookup() },
                    enabled = e164 != null && !checking,
                    colors = ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = ActionBlueInk),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    if (checking) CircularProgressIndicator(color = ActionBlueInk, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                    else Text("Check on KuchuPuchu", fontWeight = FontWeight.SemiBold)
                }
                Button(
                    onClick = { haptics.tap(); saveToPhone() },
                    enabled = e164 != null,
                    colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Ink),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.weight(1f),
                ) { Text("Save to phone", fontWeight = FontWeight.SemiBold) }
            }
            Spacer(Modifier.height(18.dp))
            val m = match
            if (checkedPhone.isNotBlank() && checkedPhone == e164) {
                if (m != null) {
                    ContactRow(
                        name = m.optText("displayName").ifBlank { name.ifBlank { checkedPhone } },
                        sub = m.optString("username").takeIf { it.isNotBlank() }?.let { "@$it · on KuchuPuchu" } ?: "on KuchuPuchu",
                        avatarUrl = m.optIso("avatarUrl"),
                        avatarRef = m.optIso("avatarRef"),
                        onOpen = { nav.navigate("profile/${m.optString("id")}") },
                    ) {
                        ContactAction("Chat", primary = true) { haptics.tap(); openChatWith(nav, scope, m.optString("id")) }
                    }
                } else {
                    ContactRow(name = name.ifBlank { checkedPhone }, sub = "$checkedPhone · not on KuchuPuchu yet", avatarUrl = null, avatarRef = null, onOpen = null) {
                        ContactAction("Invite", primary = false) { haptics.tap(); invite(ctx, checkedPhone) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ContactsSection(label: String) {
    Text(
        label,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.SemiBold,
        color = Muted,
        modifier = Modifier.padding(start = 6.dp, top = 8.dp, bottom = 2.dp),
    )
}

@Composable
private fun ContactRow(
    name: String,
    sub: String,
    avatarUrl: String?,
    avatarRef: String?,
    onOpen: (() -> Unit)?,
    action: @Composable () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Card)
            .then(if (onOpen != null) Modifier.clickable { onOpen() } else Modifier)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KpAvatar(name, avatarUrl, 44.dp, ring = false, avatarRef = avatarRef)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, fontSize = 12.5.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        action()
    }
}

@Composable
private fun ContactAction(label: String, primary: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (primary) ActionBlue else ActionBlue.copy(alpha = 0.14f))
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (primary) ActionBlueInk else ActionBlueDeep,
        )
    }
}
