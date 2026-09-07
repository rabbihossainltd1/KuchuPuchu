package app.kuchupuchu.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Info
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun ProfileScreen(nav: NavController, userId: String) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    // Paint INSTANTLY from the cached conversation data (name/avatar/username/
    // about all ride along with the chat list) — the network call only
    // refreshes. First open used to sit on "Loading…" like a web page.
    // Owner round 28: the home ⋮ menu opens MY profile through this same
    // screen — calls/search/block make no sense against yourself, so the
    // action rows give way to an "Edit profile" row that opens Settings.
    val isMe = userId.isNotBlank() && userId == Store.myId()
    var user by remember { mutableStateOf(if (isMe) Store.me else profileSnapshot(userId)) }
    var error by remember { mutableStateOf("") }
    // The API answers `blocked` on the profile now (it has to, so the profile can
    // be shown at all to someone who blocked this user). Starting from `false`
    // meant an already-blocked contact showed "Block"; tapping it POSTed a second
    // block and the UI said "blocked" while the server said nothing changed.
    var blocked by remember { mutableStateOf(user?.optBoolean("blocked") == true) }

    // Owner round 31 (item 18): re-read when a live "profile" frame lands.
    LaunchedEffect(userId, ScreenStore.profileVersion) {
        runCatching {
            if (isMe) {
                val fresh = withContext(Dispatchers.IO) { Api.get("/api/me", true) }
                fresh.optJSONObject("user")?.let { user = it; Store.saveMe(it) }
                error = ""
                return@runCatching
            }
            val cached = withContext(Dispatchers.IO) { Api.get("/api/users/$userId") }
            user = cached.optJSONObject("user") ?: user
            error = ""
            val fresh = withContext(Dispatchers.IO) { Api.get("/api/users/$userId", true) }
            user = fresh.optJSONObject("user") ?: user
        }.onSuccess {
            // Re-read from the row we actually ended up showing, so a stale cache
            // can never disagree with the button.
            user?.takeIf { it.has("blocked") }?.let { blocked = it.optBoolean("blocked") }
        }.onFailure {
            if (user == null) error = it.message ?: "Could not load profile."
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
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text(if (isMe) "My profile" else "Contact", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        val u = user
        if (u == null) {
            // Owner round 13: skeleton placeholders while the profile loads —
            // only a real error shows as text now.
            if (error.isNotBlank()) {
                Text(error, color = Muted, modifier = Modifier.padding(24.dp))
            } else {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // Owner round 14: one shared alpha pulse replaces the
                    // moving-gradient brushes (several infinite animations).
                    val sh = rememberShimmerAlpha()
                    Spacer(Modifier.height(18.dp))
                    Box(
                        Modifier.size(110.dp).clip(androidx.compose.foundation.shape.CircleShape)
                            .background(Line.copy(alpha = sh)),
                    )
                    Spacer(Modifier.height(16.dp))
                    Box(
                        Modifier.width(170.dp).height(18.dp)
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                            .background(Line.copy(alpha = sh)),
                    )
                    Spacer(Modifier.height(10.dp))
                    Box(
                        Modifier.width(120.dp).height(13.dp)
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                            .background(Line.copy(alpha = sh)),
                    )
                    Spacer(Modifier.height(22.dp))
                    repeat(3) {
                        Box(
                            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 6.dp, vertical = 6.dp)
                                .clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                                .background(Line.copy(alpha = sh)),
                        )
                    }
                }
            }
            return
        }
        // Compact header: avatar, name, @username, online, about — no big
        // empty blocks in between (optText keeps JSON-null fields from
        // rendering as the literal string "null").
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            var viewerUrl by remember { mutableStateOf<String?>(null) }
            // THE REFERENCE, NOT THE PAYLOAD FIELD. `/api/users/:id` light rows (the
            // chat-list snapshot this screen paints from) carry `avatarUrl: null` and
            // only an `avatarRef`; the bytes live in the per-version avatar cache.
            // Reading `u.optText("avatarUrl")` here meant: nothing to show until the
            // network answered, then a fresh 80KB data-URI decode — so an already
            // downloaded photo reloaded on every app start, while offline it "stayed
            // loaded" because the cached payload still had the old bytes.
            val avatarRef = u.optIso("avatarRef")
            val shownAvatar = rememberAvatarUrl(u.optText("avatarUrl").ifBlank { null }, avatarRef)
            // Owner round 31: MY profile edits in place — tapping my photo picks
            // a new one (no separate "Edit profile" screen in between).
            val ctx = LocalContext.current
            var photoBusy by remember { mutableStateOf(false) }
            val avatarPicker =
                rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
                    if (uri != null) {
                        scope.launch {
                            photoBusy = true
                            // The worker stores avatars inline with a 200KB budget —
                            // compress below it and show real errors instead of
                            // failing silently.
                            val dataUrl =
                                withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx, maxSide = 512, maxChars = 190_000) }
                            if (dataUrl == null) {
                                error = "Could not read that photo."
                            } else {
                                runCatching {
                                    val updated =
                                        withContext(Dispatchers.IO) {
                                            Api.patch("/api/me", JSONObject().put("avatarUrl", dataUrl))
                                        }
                                    updated.optJSONObject("user")?.let {
                                        user = it
                                        Store.saveMe(it)
                                    }
                                }.onFailure { error = it.message ?: "Could not set the photo." }
                            }
                            photoBusy = false
                        }
                    }
                }
            Box {
                KpAvatar(
                    u.optText("displayName").ifBlank { "?" },
                    shownAvatar,
                    88.dp, // Owner round 26: profile e ager motoi boro
                    avatarRef = avatarRef,
                )
                // Tapping the photo opens it full-screen (zoom + save) — the resolved
                // value, so the viewer works from the cache too.
                Box(
                    Modifier
                        .matchParentSize()
                        .clickable {
                            if (isMe) {
                                avatarPicker.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                )
                            } else {
                                shownAvatar?.takeIf { it.isNotBlank() }?.let { viewerUrl = it }
                            }
                        },
                )
                if (isMe) {
                    Box(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(ActionBlue),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (photoBusy) {
                            androidx.compose.material3.CircularProgressIndicator(
                                color = ActionBlueInk,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(14.dp),
                            )
                        } else {
                            Icon(Icons.Filled.Edit, "Change photo", tint = ActionBlueInk, modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
            viewerUrl?.let { url ->
                // Owner round 31: the app's own photo viewer (MediaViewer.kt).
                KpPhotoViewer(
                    url = url,
                    title = u.optText("displayName").ifBlank { "Photo" },
                    onClose = { viewerUrl = null },
                )
            }
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.align(Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(u.optText("displayName").ifBlank { "—" }, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
                if (u.optBoolean("verified")) {
                    Spacer(Modifier.width(6.dp))
                    VerifiedBadge(16.dp)
                }
                if (u.optBoolean("moderator")) {
                    Spacer(Modifier.width(6.dp))
                    ModeratorBadge(16.dp)
                }
            }
            val uname = u.optText("username")
            if (uname.isNotBlank()) Text("@$uname", fontSize = 13.5.sp, color = Muted)
            // Owner round 31 (item 9): the number the server lets me see — a
            // Public number (or Contacts-only when we are contacts). The screen
            // simply never rendered it before; the worker was already right.
            val peerPhone = if (isMe) "" else u.optText("phone")
            if (peerPhone.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Row(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            runCatching {
                                ctx.startActivity(
                                    android.content.Intent(
                                        android.content.Intent.ACTION_DIAL,
                                        android.net.Uri.parse("tel:$peerPhone"),
                                    ),
                                )
                            }
                        }
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Call, null, tint = ActionBlueDeep, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(peerPhone, fontSize = 13.5.sp, color = ActionBlueDeep, fontWeight = FontWeight.Medium, maxLines = 1)
                }
            }
            val about = u.optText("about")
            if (about.isNotBlank() && !isMe) {
                Spacer(Modifier.height(6.dp))
                // Owner round 31: full width + soft wrap — the text used to break
                // early because the Column centred a narrow intrinsic width.
                Text(
                    about,
                    fontSize = 13.5.sp,
                    color = Ink,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    softWrap = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (isMe) {
            // Owner round 31: the profile fields edit RIGHT HERE (one screen per
            // field) — no intermediate "Edit profile" screen.
            Spacer(Modifier.height(8.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card),
            ) {
                ProfileEditRow(Icons.Filled.Badge, "Name", u.optText("displayName").ifBlank { "—" }) {
                    haptics.tap()
                    nav.navigate("editfield/name")
                }
                ProfileEditRow(Icons.Filled.AlternateEmail, "Username", u.optText("username").ifBlank { "not set" }) {
                    haptics.tap()
                    nav.navigate("editfield/username")
                }
                ProfileEditRow(Icons.Filled.Info, "About", u.optText("about").ifBlank { "Hey! I'm using KuchuPuchu" }) {
                    haptics.tap()
                    nav.navigate("editfield/about")
                }
                // Phone auth: the login identity now. Change needs the new SIM
                // literally present on this device (MATCH).
                ProfileEditRow(Icons.Filled.Call, "Phone", u.optText("phone").ifBlank { "not set" }) {
                    haptics.tap()
                    nav.navigate("editfield/phone")
                }
            }
            Spacer(Modifier.height(12.dp))
        }
        // Owner round 31: the call / search buttons take this chat's theme
        // accent (the in-chat theme used to stop at the chat screen).
        val peerConv = ScreenStore.convs.firstOrNull { !it.optBoolean("isGroup") && it.optJSONObject("other")?.optString("id") == userId }
        val peerAccent = chatAccent(cTheme(peerConv))
        // Owner round 7: the owner's account can never be blocked.
        if (!isMe && !isKpBot(userId) && u.optText("username") != "rabbihossainltd") {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                ProfileHeaderCallBtn(onClick = {
                    haptics.tap()
                    gateMicCamera(video = false) {
                        CallEngine.instance?.startCall(userId, "AUDIO", u.optText("displayName"), u.optText("avatarUrl"))
                    }
                }) {
                    Icon(Icons.Filled.Call, "Voice call", tint = peerAccent, modifier = Modifier.size(25.dp))
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                ProfileHeaderCallBtn(onClick = {
                    haptics.tap()
                    gateMicCamera(video = true) {
                        CallEngine.instance?.startCall(userId, "VIDEO", u.optText("displayName"), u.optText("avatarUrl"))
                    }
                }) {
                    Icon(Icons.Filled.Videocam, "Video call", tint = peerAccent, modifier = Modifier.size(27.dp))
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                ProfileHeaderCallBtn(onClick = {
                    haptics.tap()
                    // Owner round 26 (bug): this button used to WAIT on a
                    // network create-conversation round trip before navigating
                    // — that was the "friend profile theke search a jete late".
                    // Cache-first: an existing chat opens the SAME frame.
                    val cached = ScreenStore.convIdForUser[userId]
                    if (cached != null) {
                        ScreenStore.pendingChatSearch = cached
                        nav.navigate("chat/$cached")
                        return@ProfileHeaderCallBtn
                    }
                    scope.launch {
                        runCatching {
                            val data = withContext(Dispatchers.IO) {
                                Api.post("/api/conversations", JSONObject().put("userId", userId))
                            }
                            val cid = data.optJSONObject("conversation")?.optString("id").orEmpty()
                            if (cid.isNotBlank()) {
                                ScreenStore.convIdForUser[userId] = cid
                                ScreenStore.pendingChatSearch = cid
                                nav.navigate("chat/$cid")
                            }
                        }
                    }
                }) {
                    Icon(Icons.Filled.Search, "Search", tint = peerAccent, modifier = Modifier.size(25.dp))
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        if (!isMe) Column(Modifier.padding(horizontal = 16.dp)) {
            // Real shared-media strip: recent photos from this user's chat.
            // (The card here used to be a dead placeholder.)
            val convId0 = ScreenStore.convs
                .firstOrNull { !it.optBoolean("isGroup") && it.optJSONObject("other")?.optString("id") == userId }
                ?.optString("id")
            val photos = remember(convId0, ScreenStore.msgsVersion.value) {
                if (convId0 == null) emptyList()
                else ScreenStore.msgsOf(convId0).filter { m ->
                    val k = m.optString("kind")
                    (k == "IMAGE" && m.optText("mediaUrl").isNotBlank()) ||
                        (k == "FILE" && (m.optText("fileType").startsWith("image") ||
                            listOf(".jpg", ".jpeg", ".png", ".webp").any { m.optText("fileName").lowercase().endsWith(it) }))
                }.takeLast(9).reversed()
            }
            if (convId0 != null) {
                if (photos.isNotEmpty()) {
                    LazyRow(
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
                    ) {
                        items(photos.size) { i ->
                            val m = photos[i]
                            val url =
                                m.optText("mediaUrl").takeIf { it.isNotBlank() }
                                    ?: m.optText("fileKey").takeIf { it.isNotBlank() }?.let { k ->
                                        if (k.startsWith("data:") || k.startsWith("http") || k.startsWith("/")) k else "/api/files/$k"
                                    } ?: ""
                            Box(
                                Modifier
                                    .size(86.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { nav.navigate("chatmedia/$convId0") },
                            ) {
                                KpNetImage(url, "Shared photo", Modifier.fillMaxSize())
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Shared media — tap to see all",
                        color = Muted,
                        fontSize = 12.sp,
                        modifier = Modifier.clickable { nav.navigate("chatmedia/$convId0") },
                    )
                } else {
                    Text("No shared media yet — photos you send will appear here.", color = Muted, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        }
        if (!isMe && !isKpBot(userId)) {
            androidx.compose.foundation.layout.Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card)
                    .padding(4.dp),
            ) {
                androidx.compose.material3.TextButton(
                    onClick = {
                        scope.launch {
                            runCatching {
                                val res = withContext(Dispatchers.IO) {
                                    if (blocked) Api.delete("/api/blocks/$userId")
                                    else Api.post("/api/blocks", JSONObject().put("userId", userId))
                                }
                                // Flip on the server's answer only: these calls
                                // return an error body (403/429) instead of
                                // throwing, and the old code marked the user blocked
                                // even when the write was refused.
                                if (!res.has("error")) blocked = !blocked
                            }
                        }
                    },
                ) {
                    Icon(Icons.Filled.Block, null, tint = Red, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (blocked) "Unblock" else "Block", color = Red)
                }
            }
        }
    }
}

/** Owner round 31: one compact edit row — label left, current value right. */
@Composable
private fun ProfileEditRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = label, tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = Ink, maxLines = 1)
        Spacer(Modifier.width(12.dp))
        Text(
            value,
            fontSize = 13.sp,
            color = Muted,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ProfileHeaderCallBtn(onClick: () -> Unit, icon: @Composable () -> Unit) {
    val haptics = rememberHaptics()
    Box(
        Modifier
            .padding(horizontal = 3.dp)
            .size(50.dp)
            .shadow(5.dp, CircleShape)
            .clip(CircleShape)
            .background(circleButtonFill())
            .border(1.dp, CircleButtonEdge, CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { icon() }
}

private fun profileSnapshot(userId: String): JSONObject? {
    ScreenStore.convs.forEach { c ->
        val o = c.optJSONObject("other")
        if (o != null && o.optString("id") == userId) return o
    }
    return Cache.peek("/api/users/$userId")?.optJSONObject("user")
}
