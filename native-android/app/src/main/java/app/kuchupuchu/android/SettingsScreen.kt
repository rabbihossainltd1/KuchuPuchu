package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Shield
import androidx.compose.ui.draw.scale
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PermMedia
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.ui.text.input.ImeAction
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Settings — locked design #10 "Warm Banner":
 * amber gradient profile banner + white list-card rows + red logout.
 */
/* ---------------- shared settings rows (owner round 30/31) ---------------- */

@Composable
private fun SectionCard(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Card),
    ) { content() }
}

/** Owner round 31: compact — one line of label, value on the right, 12dp tall. */
@Composable
private fun SettingRow(
    icon: ImageVector,
    label: String,
    value: String,
    clickable: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .let { m -> if (clickable) m.clickable { onClick() } else m }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = label, tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, fontSize = 14.5.sp, color = Ink, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.weight(1f))
        Text(value, fontSize = 13.sp, color = Muted, maxLines = 1, modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun kpSwitchColors() =
    androidx.compose.material3.SwitchDefaults.colors(
        checkedThumbColor = ActionBlueInk,
        checkedTrackColor = ActionBlue,
        checkedBorderColor = ActionBlue,
    )

@Composable
private fun ToggleRow(icon: ImageVector, label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, top = 2.dp, bottom = 2.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, label, tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, fontSize = 14.5.sp, color = Ink, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange, colors = kpSwitchColors(), modifier = Modifier.scale(0.85f))
    }
}

/** The hub entries: icon + name, chevron on the right. */
@Composable
private fun HubRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = label, tint = ActionBlueDeep, modifier = Modifier.size(21.dp))
        Spacer(Modifier.width(14.dp))
        Text(label, fontSize = 15.sp, color = Ink, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun SubScreenHeader(title: String, onBack: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
        }
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.weight(1f))
        trailing()
        Spacer(Modifier.width(16.dp))
    }
}

private val PRIVACY_LEVELS = listOf("nobody" to "No one", "contacts" to "Contacts only", "public" to "Public")

private fun privacyLabel(level: String): String = PRIVACY_LEVELS.firstOrNull { it.first == level }?.second ?: "Public"

/* ---------------- Settings hub (owner round 31) ---------------- */

/**
 * Owner round 31: Settings is a HUB — five entries, each its own screen
 * (Privacy / Appearance / Devices / Permissions / App). Nothing inline here.
 */
@Composable
fun SettingsScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmLogout by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        SubScreenHeader("Settings", onBack = { nav.popBackStack() })
        SectionCard {
            HubRow(Icons.Filled.Lock, "Privacy") { nav.navigate("settings/privacy") }
            HubRow(Icons.Filled.Palette, "Appearance") { nav.navigate("settings/appearance") }
            HubRow(Icons.Filled.PhoneAndroid, "Devices") { nav.navigate("settings/devices") }
            HubRow(Icons.Filled.Shield, "Permissions") { nav.navigate("settings/permissions") }
            HubRow(Icons.Filled.Info, "App") { nav.navigate("settings/app") }
        }
        Spacer(Modifier.height(18.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Red.copy(alpha = 0.12f))
                .clickable { confirmLogout = true }
                .padding(horizontal = 16.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Log out", tint = Red, modifier = Modifier.size(21.dp))
            Spacer(Modifier.width(12.dp))
            Text("Log out", color = Red, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
        Spacer(Modifier.height(32.dp))
    }

    if (confirmLogout) {
        KpConfirmSheet(
            title = "Log out?",
            confirmLabel = "Log out",
            danger = true,
            onDismiss = { confirmLogout = false },
            onConfirm = {
                confirmLogout = false
                scope.launch {
                    // deviceId travels with the logout so the worker removes
                    // this install's push row in the same request: while the
                    // bearer is still valid, and without touching the user's
                    // other devices.
                    // Owner round 28: the accepted FCM token travels too, so
                    // the worker deletes exactly this push row even if the
                    // session had already been revoked (a 401 here used to
                    // leave the row behind = notifications after logout).
                    runCatching {
                        withContext(Dispatchers.IO) {
                            Api.post(
                                "/api/auth/logout",
                                org.json.JSONObject()
                                    .put("deviceId", KpPush.deviceId(ctx))
                                    .put("pushToken", KpPush.registeredToken(ctx) ?: ""),
                            )
                        }
                    }
                    KpPush.unregister()
                    KpNotify.cancelAll(ctx)
                    Store.signOut(ctx)
                }
            },
        )
    }
}

/* ---------------- Settings › Privacy ---------------- */

@Composable
fun PrivacySettingsScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me = remember { mutableStateOf(Store.me ?: JSONObject()) }
    var picker by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching {
            me.value = withContext(Dispatchers.IO) { Api.get("/api/me", true).optJSONObject("user") ?: JSONObject() }
            Store.saveMe(me.value)
        }
    }

    val privacy = me.value.optJSONObject("privacy") ?: JSONObject()
    fun level(key: String, fallback: String) = privacy.optText(key).ifBlank { fallback }
    fun keyOf(field: String) =
        when (field) {
            "privPhone" -> "phone"
            "privAvatar" -> "avatar"
            "privMessages" -> "messages"
            "privLastSeen" -> "lastSeen"
            "privGroups" -> "groups"
            else -> field
        }

    fun savePrivacy(field: String, value: Any) {
        // Optimistic: the row flips at once, the server answer replaces it.
        val next = JSONObject(me.value.toString())
        val p = next.optJSONObject("privacy") ?: JSONObject().also { next.put("privacy", it) }
        p.put(keyOf(field), value)
        me.value = next
        scope.launch {
            busy = true
            runCatching {
                val updated = withContext(Dispatchers.IO) { Api.patch("/api/me", JSONObject().put(field, value)) }
                me.value = updated.optJSONObject("user") ?: me.value
                Store.saveMe(me.value)
            }
            busy = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        SubScreenHeader("Privacy", onBack = { nav.popBackStack() }) {
            if (busy) CircularProgressIndicator(color = ActionBlueDeep, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        }
        SectionCard {
            SettingRow(Icons.Filled.Call, "My number", privacyLabel(level("phone", "contacts"))) { picker = "privPhone" }
            SettingRow(Icons.Filled.AccountCircle, "Profile picture", privacyLabel(level("avatar", "public"))) { picker = "privAvatar" }
            SettingRow(Icons.AutoMirrored.Filled.Chat, "Messages", privacyLabel(level("messages", "public"))) { picker = "privMessages" }
            SettingRow(Icons.Filled.Schedule, "Last seen", privacyLabel(level("lastSeen", "public"))) { picker = "privLastSeen" }
            SettingRow(Icons.Filled.GroupAdd, "Add to groups", privacyLabel(level("groups", "public"))) { picker = "privGroups" }
        }
        Spacer(Modifier.height(12.dp))
        SectionCard {
            ToggleRow(Icons.Filled.DoneAll, "Read receipts", privacy.optBoolean("readReceipts", true)) { on ->
                savePrivacy("readReceipts", on)
            }
            ToggleRow(Icons.Filled.VisibilityOff, "Private profile", privacy.optBoolean("privateProfile", false)) { on ->
                savePrivacy("privateProfile", on)
            }
            // Owner round 32 (item 2): lives under Privacy now (was App) —
            // whether the phone's own sound travels with a shared screen is a
            // privacy choice. Android 10+ only (older systems cannot capture
            // playback, so the row is not offered).
            if (SystemAudioTap.supported) {
                var sysAudio by remember { mutableStateOf(SystemAudioTap.isEnabled(ctx)) }
                ToggleRow(Icons.Filled.VolumeUp, "Share Audio Via Screen Share", sysAudio) { on ->
                    sysAudio = on
                    SystemAudioTap.setEnabled(ctx, on)
                }
            }
        }
        Spacer(Modifier.height(32.dp))
    }

    picker?.let { field ->
        val key = keyOf(field)
        val current = level(key, if (key == "phone") "contacts" else "public")
        // Owner round 31: the picker is a bottom sheet (the status ⋮ pattern),
        // never a centred dialog.
        // Owner round 32 (item 1): every privacy sheet asks the question it
        // answers ("Who Can View Your Number?") instead of echoing the row.
        KpSheet(
            onDismiss = { picker = null },
            title =
                when (field) {
                    "privPhone" -> "Who Can View Your Number?"
                    "privAvatar" -> "Who Can View Your Profile Picture?"
                    "privMessages" -> "Who Can Message You?"
                    "privLastSeen" -> "Who Can See Your Last Seen?"
                    else -> "Who Can Add You To Groups?"
                },
        ) {
            PRIVACY_LEVELS.forEach { (lvl, label) ->
                KpSheetRow(icon = null, label = label, selected = lvl == current) {
                    picker = null
                    if (lvl != current) savePrivacy(field, lvl)
                }
            }
        }
    }
}

/* ---------------- Settings › Appearance ---------------- */

@Composable
fun AppearanceSettingsScreen(nav: NavController) {
    var showRingPicker by remember { mutableStateOf(false) }
    // Owner round 21: the Sounds row first asks WHICH tone (notification vs
    // call), then opens the same picker.
    var showSoundType by remember { mutableStateOf(false) }
    var soundKind by remember { mutableStateOf("call") }
    // Owner round 16: fullscreen theme picker.
    var showThemePicker by remember { mutableStateOf(false) }
    // Owner round 18: system back steps BACK one level — an open picker
    // closes first; it must never shoot straight out to the chat list.
    androidx.activity.compose.BackHandler(enabled = showThemePicker || showRingPicker || showSoundType) {
        when {
            showThemePicker -> showThemePicker = false
            showRingPicker -> showRingPicker = false
            else -> showSoundType = false
        }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        SubScreenHeader("Appearance", onBack = { nav.popBackStack() })
        SectionCard {
            // Owner round 10 (2026-09-04): his incoming-ringtone pack — the
            // user picks which one rings for calls. Default is the app's
            // ORIGINAL tone again (owner round 13); his "calling ringing"
            // file stays as the caller-side ringback only.
            // Owner round 25: just the section name — the tone names were
            // stacking into a wall of text on the row.
            SettingRow(Icons.Filled.NotificationsActive, "Sounds", "Calls & Notification") { showSoundType = true }
            // Owner round 16: the theme has its own FULLSCREEN picker now
            // (same pattern as the ringtone picker) — this row opens it.
            SettingRow(Icons.Filled.Palette, "Themes", if (KpThemeMode.darkBlue) "Dark Blue" else "Light Cream") {
                showThemePicker = true
            }
        }
    }
    // Owner round 11: FULLSCREEN ringtone picker — tap previews, Save keeps.
    if (showThemePicker) {
        ThemePickerScreen(onClose = { showThemePicker = false })
    }
    if (showSoundType) {
        SoundTypePickerScreen(
            onClose = { showSoundType = false },
            onPick = { kind ->
                showSoundType = false
                soundKind = kind
                showRingPicker = true
            },
        )
    }
    if (showRingPicker) {
        RingtonePickerScreen(kind = soundKind, onClose = { showRingPicker = false })
    }
}

/* ---------------- Settings › Devices ---------------- */

@Composable
fun DevicesSettingsScreen(nav: NavController) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        SubScreenHeader("Devices", onBack = { nav.popBackStack() })
        SectionCard { DevicesSection() }
        Spacer(Modifier.height(32.dp))
    }
}

/* ---------------- Settings › Permissions ---------------- */

@Composable
fun PermissionsSettingsScreen(nav: NavController) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        SubScreenHeader("Permissions", onBack = { nav.popBackStack() })
        SectionCard { PermissionsSection() }
        Spacer(Modifier.height(32.dp))
    }
}

/* ---------------- Settings › App ---------------- */

@Composable
fun AppSettingsScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        SubScreenHeader("App", onBack = { nav.popBackStack() })
        SectionCard {
            // Which build am I running? This row ends the "ami ki notun APK
            // install korsi?" confusion — bug reports can quote it directly.
            SettingRow(
                Icons.Filled.Info,
                "App version",
                runCatching {
                    val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
                    "${pi.versionName} (${pi.versionCode})"
                }.getOrDefault("?"),
                clickable = false,
            ) {}
            // Owner round 16: in-app updates — checks the GitHub release and
            // the popup (or "already latest") takes it from there.
            SettingRow(Icons.Filled.SystemUpdate, "Check for updates", if (KpUpdate.checking) "Checking…" else "") {
                scope.launch {
                    withContext(Dispatchers.IO) { KpUpdate.check(ctx) }
                    if (KpUpdate.available == null) {
                        android.widget.Toast.makeText(ctx, "You are on the latest version", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
            }
            SettingRow(Icons.Filled.Favorite, "About us", "") { nav.navigate("about") }
            // (Owner round 32 item 2: the "Share Audio Via Screen Share"
            // toggle moved to Settings › Privacy.)
            // Owner round 15: crash detection on/off — capture stays until
            // the owner switches it off; off also clears the last report.
            var crashOn by remember { mutableStateOf(KpCrash.isEnabled(ctx)) }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, top = 2.dp, bottom = 2.dp, end = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.BugReport, "Crash reports", tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Text("Crash reports", fontSize = 14.5.sp, color = Ink, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                Switch(
                    checked = crashOn,
                    onCheckedChange = { on ->
                        crashOn = on
                        KpCrash.setEnabled(ctx, on)
                    },
                    // Owner round 22: the toggle rides the blue accent.
                    colors = kpSwitchColors(),
                    modifier = Modifier.scale(0.85f),
                )
            }
        }
        Spacer(Modifier.height(32.dp))
    }
}

/** Owner round 30: the account's devices — this one first, then the rest. */
@Composable
private fun DevicesSection() {
    val ctx = LocalContext.current
    var items by remember { mutableStateOf<List<JSONObject>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        runCatching {
            items = withContext(Dispatchers.IO) { Api.get("/api/auth/devices", true) }.arr("items").objects()
        }.onFailure { failed = true }
    }
    val myDevice = remember { KpPush.deviceId(ctx) }
    val list = items ?: emptyList()
    if (items == null && !failed) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(color = ActionBlueDeep, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        }
    } else if (list.isEmpty()) {
        Text(if (failed) "Offline" else "No devices", color = Muted, fontSize = 13.5.sp, modifier = Modifier.padding(16.dp))
    } else {
        list.forEach { d ->
            val current = d.optBoolean("current") || d.optString("deviceId") == myDevice
            val active = d.optBoolean("active")
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Filled.PhoneAndroid,
                    null,
                    tint = if (active) ActionBlueDeep else Muted,
                    modifier = Modifier.size(21.dp),
                )
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            d.optText("name").ifBlank { "Android" },
                            fontSize = 14.5.sp,
                            color = Ink,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                        )
                        if (current) {
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "This device",
                                fontSize = 11.sp,
                                color = ActionBlueInk,
                                modifier =
                                    Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(ActionBlue)
                                        .padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                        }
                    }
                    val ver = d.optText("appVersion")
                    Text(
                        buildString {
                            append(if (active) "Active" else "Signed out")
                            append(" · ")
                            append(deviceSeen(d.optText("lastSeenAt")))
                            if (ver.isNotBlank()) append(" · v$ver")
                        },
                        fontSize = 12.5.sp,
                        color = Muted,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

private fun deviceSeen(iso: String): String {
    val t = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return "—"
    val z = atDhaka(t)
    val now = dhakaNow()
    val h12 = z.hour % 12
    val hh = if (h12 == 0) 12 else h12
    val time = "$hh:%02d %s".format(z.minute, if (z.hour < 12) "am" else "pm")
    return when {
        z.toLocalDate() == now.toLocalDate() -> time
        z.toLocalDate() == now.toLocalDate().minusDays(1) -> "yesterday"
        else -> "${z.dayOfMonth} ${z.month.toString().take(3).lowercase()}"
    }
}

/**
 * Owner round 30: every runtime permission the app can ask for, with its
 * live state. The switch asks the system when it can; once the OS stops
 * showing the prompt (or to revoke), it opens this app's settings page.
 */
@Composable
private fun PermissionsSection() {
    val ctx = LocalContext.current
    val perms =
        remember {
            buildList {
                add(Triple("Notifications", Manifest.permission.POST_NOTIFICATIONS, Icons.Filled.NotificationsActive))
                add(Triple("Camera", Manifest.permission.CAMERA, Icons.Filled.Videocam))
                add(Triple("Microphone", Manifest.permission.RECORD_AUDIO, Icons.Filled.Mic))
                add(Triple("Contacts", Manifest.permission.READ_CONTACTS, Icons.Filled.Contacts))
                add(Triple("Phone", Manifest.permission.READ_PHONE_STATE, Icons.Filled.Call))
                add(
                    Triple(
                        "Photos & videos",
                        if (android.os.Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
                        else Manifest.permission.READ_EXTERNAL_STORAGE,
                        Icons.Filled.PermMedia,
                    ),
                )
                add(Triple("Location", Manifest.permission.ACCESS_FINE_LOCATION, Icons.Filled.LocationOn))
                if (android.os.Build.VERSION.SDK_INT >= 31) {
                    add(Triple("Bluetooth", Manifest.permission.BLUETOOTH_CONNECT, Icons.Filled.Bluetooth))
                }
            }
        }
    fun granted(p: String): Boolean {
        // POST_NOTIFICATIONS exists from API 33; below that the channel state is
        // the truth.
        if (p == Manifest.permission.POST_NOTIFICATIONS && android.os.Build.VERSION.SDK_INT < 33) {
            return androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        }
        return ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    }
    // One generation counter re-reads every state after a prompt or a
    // round trip to the system settings page.
    var gen by remember { mutableStateOf(0) }
    val states = remember(gen) { perms.associate { it.second to granted(it.second) } }
    var pending by remember { mutableStateOf<String?>(null) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
            val p = pending
            pending = null
            gen++
            // Denied with no prompt shown (permanently denied): the OS
            // settings page is the only place left to change it.
            if (!ok && p != null) {
                val act = ctx as? android.app.Activity
                if (act != null && !androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(act, p)) {
                    openAppSettings(ctx)
                }
            }
        }
    // Coming back from the settings page: refresh (the activity is the
    // lifecycle owner; no Compose-lifecycle artifact needed).
    val owner = ctx as? androidx.lifecycle.LifecycleOwner
    androidx.compose.runtime.DisposableEffect(owner) {
        val obs =
            androidx.lifecycle.LifecycleEventObserver { _, e ->
                if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) gen++
            }
        owner?.lifecycle?.addObserver(obs)
        onDispose { owner?.lifecycle?.removeObserver(obs) }
    }
    perms.forEach { (label, perm, icon) ->
        val on = states[perm] == true
        ToggleRow(icon, label, on) { want ->
            if (want && !on) {
                if (perm == Manifest.permission.POST_NOTIFICATIONS && android.os.Build.VERSION.SDK_INT < 33) {
                    openAppSettings(ctx)
                } else {
                    pending = perm
                    launcher.launch(perm)
                }
            } else {
                // Revoking is only possible from the system page.
                openAppSettings(ctx)
            }
        }
    }
    // Owner round 32 (item 9): Android 14+ turned USE_FULL_SCREEN_INTENT into
    // a special access that a sideloaded app may not hold by default. Without
    // it the incoming-call card cannot take the screen over (it stays a
    // heads-up while the phone is locked / another app is in front) — one of
    // the "call screen ashe na" cases. Same row style as the permissions above;
    // the toggle deep-links to the system page for this app (both directions).
    if (android.os.Build.VERSION.SDK_INT >= 34) {
        val fsi =
            remember(gen) {
                runCatching {
                    (ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                        .canUseFullScreenIntent()
                }.getOrDefault(true)
            }
        ToggleRow(Icons.Filled.Call, "Full-screen calls", fsi) {
            runCatching {
                ctx.startActivity(
                    android.content.Intent(
                        android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                        android.net.Uri.parse("package:${ctx.packageName}"),
                    ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }.onFailure { openAppSettings(ctx) }
        }
    }
    Spacer(Modifier.height(6.dp))
}

private fun openAppSettings(ctx: android.content.Context) {
    runCatching {
        ctx.startActivity(
            android.content.Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:${ctx.packageName}"),
            ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/**
 * Owner round 11 (2026-09-05): fullscreen incoming-ringtone picker.
 * Tap a ringtone = select + instant preview; SAVE keeps the choice; the
 * device's own audio files can be picked as a CUSTOM ringtone.
 */
/**
 * Owner round 16: the FULLSCREEN app-theme picker — same pattern as the
 * ringtone picker. Tap a theme to apply + save instantly.
 */
@Composable
fun ThemePickerScreen(onClose: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Column {
                Text("App theme", color = Ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                Text("Applies instantly, everywhere", color = Muted, fontSize = 12.sp)
            }
        }
        data class Opt(val dark: Boolean, val label: String, val note: String, val swatch: androidx.compose.ui.graphics.Color)
        listOf(
            // Owner round 17: exact theme colours — the deep dark-blue and
            // the light cream the app actually paints.
            Opt(true, "Dark Blue", "The signature deep-blue night theme", androidx.compose.ui.graphics.Color(0xFF0D1524)),
            Opt(false, "Light Cream", "Soft warm light theme", androidx.compose.ui.graphics.Color(0xFFF7F6F4)),
        ).forEach { o ->
            val selected = KpThemeMode.darkBlue == o.dark
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 5.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (selected) GoldSoft else Card)
                    .border(1.dp, if (selected) Gold else Line, RoundedCornerShape(16.dp))
                    .clickable {
                        if (!selected) {
                            KpThemeMode.set(ctx, o.dark)
                            onClose()
                            (ctx as? android.app.Activity)?.recreate()
                        } else {
                            onClose()
                        }
                    }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(o.swatch)
                        .border(2.dp, if (selected) GoldDeep else Line, CircleShape),
                )
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(o.label, color = Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(o.note, color = Muted, fontSize = 12.sp)
                }
                if (selected) {
                    Icon(Icons.Filled.Check, "Selected", tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
fun RingtonePickerScreen(kind: String = "call", onClose: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val isNotif = kind == "notif"
    val savedCustom = if (isNotif) null else SoundPrefs.customRingPath(ctx)
    var selRes by remember {
        mutableStateOf(
            if (isNotif) SoundPrefs.notifRes[SoundPrefs.notifIndex(ctx)]
            else if (savedCustom == null) SoundPrefs.ringRes[SoundPrefs.ringIndex(ctx)] else -1,
        )
    }
    var selCustom by remember { mutableStateOf(savedCustom) }
    var playingRes by remember { mutableStateOf(-2) } // -2 none, -1 custom
    var player by remember { mutableStateOf<android.media.MediaPlayer?>(null) }

    fun stopPreview() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
    }

    // Owner round 13e: leaving the screen by ANY path (system back included)
    // stops the preview — it used to keep playing after exit.
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { stopPreview() }
    }

    fun preview(res: Int, customPath: String?) {
        stopPreview()
        playingRes = res
        player = runCatching {
            val mp = android.media.MediaPlayer()
            mp.setAudioAttributes(
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .build(),
            )
            if (customPath != null) mp.setDataSource(customPath)
            else {
                val afd = ctx.resources.openRawResourceFd(res)
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            }
            mp.setOnCompletionListener {
                it.release()
                if (playingRes == res) playingRes = -2
            }
            mp.prepare()
            mp.start()
            mp
        }.getOrNull()
    }

    val customPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                runCatching {
                    val dir = java.io.File(ctx.filesDir, "ringtones").apply { mkdirs() }
                    dir.listFiles()?.forEach { it.delete() }
                    val mime = ctx.contentResolver.getType(uri)
                    val ext =
                        when {
                            mime?.contains("mpeg") == true || mime?.contains("mp3") == true -> ".mp3"
                            mime?.contains("ogg") == true -> ".ogg"
                            mime?.contains("wav") == true -> ".wav"
                            mime?.contains("flac") == true -> ".flac"
                            else -> ".mp3"
                        }
                    val f = java.io.File(dir, "custom$ext")
                    ctx.contentResolver.openInputStream(uri)?.use { input ->
                        f.outputStream().use { input.copyTo(it) }
                    }
                    selCustom = f.absolutePath
                    selRes = -1
                    preview(-1, f.absolutePath)
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
        // header
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            androidx.compose.material3.IconButton(onClick = { stopPreview(); onClose() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Column {
                Text(
                    if (isNotif) "Notification ringtone" else "Call ringtone",
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink,
                )
                Text("Tap to preview · Save to keep", fontSize = 11.5.sp, color = Muted)
            }
        }

        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 10.dp),
        ) {
            val names = if (isNotif) SoundPrefs.notifNames else SoundPrefs.ringNames.toList()
            val resList = if (isNotif) SoundPrefs.notifRes.toList() else SoundPrefs.ringRes.toList()
            names.forEachIndexed { idx, name ->
                val res = resList[idx]
                // Owner round 13: compact rows — tighter padding, smaller type.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 1.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (selRes == res) GoldSoft else Card)
                        .clickable {
                            selRes = res
                            selCustom = null
                            preview(res, null)
                        }
                        .padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        if (playingRes == res) Icons.Filled.PlayArrow else Icons.Filled.NotificationsActive,
                        null,
                        tint = ActionBlueDeep,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        name,
                        fontSize = 14.5.sp,
                        color = Ink,
                        fontWeight = if (selRes == res) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.weight(1f),
                    )
                    if (selRes == res) {
                        Icon(Icons.Filled.Done, null, tint = ActionBlueDeep, modifier = Modifier.size(18.dp))
                    }
                }
            }
            // Custom ringtone row
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (selCustom != null) GoldSoft else Card)
                    .clickable { customPicker.launch(arrayOf("audio/*")) }
                    .padding(horizontal = 14.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.LibraryMusic, null, tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        if (selCustom != null) "Custom · ${java.io.File(selCustom!!).nameWithoutExtension}" else "Custom ringtone",
                        fontSize = 14.5.sp,
                        color = Ink,
                        fontWeight = if (selCustom != null) FontWeight.SemiBold else FontWeight.Normal,
                    )
                    Text("Pick any audio from this phone", fontSize = 11.sp, color = Muted)
                }
                if (selCustom != null) {
                    Icon(Icons.Filled.Done, null, tint = ActionBlueDeep, modifier = Modifier.size(18.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        // SAVE
        Row(
            Modifier
                .fillMaxWidth()
                .padding(10.dp)
                .clip(RoundedCornerShape(10.dp))
                // Owner round 20: Save is BLUE in dark-blue mode.
                .background(ActionBlue)
                .clickable {
                    if (isNotif) {
                        if (selRes >= 0) SoundPrefs.setNotifIndex(ctx, SoundPrefs.notifRes.indexOf(selRes))
                    } else {
                        if (selCustom != null) SoundPrefs.setCustomRing(ctx, selCustom!!)
                        else if (selRes >= 0) SoundPrefs.setRingIndex(ctx, SoundPrefs.ringRes.indexOf(selRes))
                    }
                    stopPreview()
                    onClose()
                }
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            Text("Save", color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}


/** Owner round 21: Settings > Sounds first asks WHICH tone kind, then opens
 *  the shared picker (preview on tap, Save keeps, stops on exit). */
@Composable
fun SoundTypePickerScreen(onClose: () -> Unit, onPick: (String) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            androidx.compose.material3.IconButton(onClick = onClose) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Column {
                Text("Sounds", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text("Pick which tone to change", fontSize = 11.5.sp, color = Muted)
            }
        }
        @Composable
        fun TypeRow(icon: ImageVector, title: String, value: String, pick: () -> Unit) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Card)
                    .clickable { pick() }
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, null, tint = ActionBlueDeep, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(title, fontSize = 14.5.sp, color = Ink, fontWeight = FontWeight.Medium)
                    Text(value, fontSize = 12.sp, color = Muted)
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Muted, modifier = Modifier.size(20.dp))
            }
        }
        TypeRow(
            Icons.Filled.NotificationsActive,
            "Notification ringtone",
            SoundPrefs.notifLabel(ctx), // Owner round 26: no plays-for text
        ) { onPick("notif") }
        TypeRow(
            Icons.Filled.Call,
            "Call ringtone",
            SoundPrefs.currentLabel(ctx),
        ) { onPick("call") }
    }
}

/* ------------------------------------------------------------------ */
/* Owner round 22: every profile field edits on its OWN screen.        */
/* ------------------------------------------------------------------ */

@Composable
private fun EditFieldScaffold(title: String, hint: String, nav: NavController, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            androidx.compose.material3.IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Column {
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text(hint, fontSize = 11.5.sp, color = Muted)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)) {
            content()
        }
    }
}

@Composable
private fun EditSaveButton(text: String, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    if (KpThemeMode.darkBlue) {
        ActionBtn(text, Modifier.fillMaxWidth().padding(top = 18.dp), enabled && !busy, onClick)
    } else {
        GoldBtn(text, Modifier.fillMaxWidth().padding(top = 18.dp), enabled && !busy, onClick)
    }
}

/** NAME: first + last, saved as the display name. */
@Composable
fun EditNameScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val full = Store.me?.optText("displayName") ?: ""
    var first by remember { mutableStateOf(full.substringBefore(' ').trim()) }
    var last by remember { mutableStateOf(full.substringAfter(' ', "").trim()) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    EditFieldScaffold("Name", "First and last name", nav) {
        OutlinedTextField(value = first, onValueChange = { first = it.take(40); err = "" }, label = { Text("First name") }, singleLine = true, colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = ActionBlue, cursorColor = ActionBlue, focusedLabelColor = ActionBlue), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(value = last, onValueChange = { last = it.take(40); err = "" }, label = { Text("Last name") }, singleLine = true, colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = ActionBlue, cursorColor = ActionBlue, focusedLabelColor = ActionBlue), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth())
        if (err.isNotBlank()) Text(err, color = Red, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        EditSaveButton(
            "Save",
            first.isNotBlank(),
            busy,
        ) {
            scope.launch {
                busy = true
                try {
                    val updated = withContext(Dispatchers.IO) {
                        Api.patch("/api/me", JSONObject().put("displayName", (first.trim() + " " + last.trim()).trim()))
                    }
                    Store.saveMe(updated.optJSONObject("user") ?: JSONObject())
                    nav.popBackStack()
                } catch (e: Exception) {
                    err = e.message ?: "Could not save."
                } finally {
                    busy = false
                }
            }
        }
    }
}

/** USERNAME: live availability check with a tick when free. */
@Composable
fun EditUsernameScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(Store.me?.optText("username") ?: "") }
    var busy by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var available by remember { mutableStateOf<Boolean?>(null) }
    var err by remember { mutableStateOf("") }
    // Owner round 25: LIVE availability — typing checks by itself (debounced),
    // the BORDER goes green when free / red when taken, and the only extra
    // text is the red "not available" line. No buttons, no hints.
    LaunchedEffect(value) {
        val v = value.trim()
        if (v == (Store.me?.optText("username") ?: "")) {
            available = null; checking = false; return@LaunchedEffect
        }
        if (!Regex("^[a-z0-9_]{3,30}$").matches(v)) {
            available = false; checking = false; return@LaunchedEffect
        }
        checking = true
        kotlinx.coroutines.delay(500)
        try {
            val res = withContext(Dispatchers.IO) { Api.get("/api/users/username-available?u=${android.net.Uri.encode(v)}") }
            available = res.optBoolean("available")
        } catch (_: Exception) {
            available = null
        } finally {
            checking = false
        }
    }
    val borderColor = when {
        checking -> Muted
        available == true -> Color(0xFF16A34A)
        available == false -> Red
        else -> Muted
    }
    EditFieldScaffold("Username", "", nav) {
        OutlinedTextField(
            value = value,
            onValueChange = { value = it.trim().lowercase().take(30); err = "" },
            label = { Text("Username") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = borderColor,
                unfocusedBorderColor = borderColor,
                cursorColor = ActionBlue,
                focusedLabelColor = ActionBlue,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        if (available == false && value.isNotBlank() && value != (Store.me?.optText("username") ?: "")) {
            Text("this username not available", color = Red, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
        EditSaveButton("Save", available == true, busy) {
            scope.launch {
                busy = true
                try {
                    val updated = withContext(Dispatchers.IO) {
                        Api.patch("/api/me", JSONObject().put("username", value.trim().lowercase()))
                    }
                    Store.saveMe(updated.optJSONObject("user") ?: JSONObject())
                    nav.popBackStack()
                } catch (e: Exception) {
                    err = e.message ?: "Could not save."
                } finally {
                    busy = false
                }
            }
        }
    }
}

/** ABOUT: multiline, max 150 characters. */
@Composable
fun EditAboutScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(Store.me?.optText("about") ?: "") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    EditFieldScaffold("About", "Up to 150 characters", nav) {
        OutlinedTextField(
            value = value,
            onValueChange = { value = it.take(150); err = "" },
            label = { Text("About") },
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = ActionBlue, cursorColor = ActionBlue, focusedLabelColor = ActionBlue),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
        )
        Text("${value.length}/150", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(top = 4.dp))
        if (err.isNotBlank()) Text(err, color = Red, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        EditSaveButton("Save", true, busy) {
            scope.launch {
                busy = true
                try {
                    val updated = withContext(Dispatchers.IO) {
                        Api.patch("/api/me", JSONObject().put("about", value.trim()))
                    }
                    Store.saveMe(updated.optJSONObject("user") ?: JSONObject())
                    nav.popBackStack()
                } catch (e: Exception) {
                    err = e.message ?: "Could not save."
                } finally {
                    busy = false
                }
            }
        }
    }
}

/** PHONE: new number -> SIM verify (the new SIM must be in this phone). */
@Composable
fun EditPhoneScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    // Round 24: exactly like the login screen — pick the country (flag +
    // dial code chip), type only the national number.
    var country by remember { mutableStateOf(DEFAULT_COUNTRY) }
    var showCountries by remember { mutableStateOf(false) }
    var value by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
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
    EditFieldScaffold("Phone number", "The new SIM must be in this phone", nav) {
        PhoneField(
            phone = value,
            onPhone = { value = it; err = "" },
            country = country,
            onPickCountry = { showCountries = true },
            imeAction = ImeAction.Done,
            onDone = {},
        )
        if (err.isNotBlank()) Text(err, color = Red, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        Text(
            "Verification reads the SIM in this phone and matches it to the number — like login.",
            fontSize = 11.5.sp, color = Muted, modifier = Modifier.padding(top = 8.dp),
        )
        EditSaveButton("Verify and change", true, busy) {
            scope.launch {
                busy = true
                try {
                    val e164 = buildE164(country, value)
                    if (e164 == null) {
                        err =
                            if (country.iso == "BD") {
                                "Enter a valid Bangladeshi mobile number, e.g. 1792929202."
                            } else {
                                "Enter a valid phone number."
                            }
                    } else {
                        val sim = withContext(Dispatchers.IO) { PhoneVerifier.verify(ctx, e164).wire() }
                        val updated = withContext(Dispatchers.IO) {
                            Api.post("/api/auth/phone/change", JSONObject().put("phone", e164).put("sim", sim))
                        }
                        Store.saveMe(updated.optJSONObject("user") ?: JSONObject())
                        nav.popBackStack()
                    }
                } catch (e: Exception) {
                    err = e.message ?: "Could not change the number."
                } finally {
                    busy = false
                }
            }
        }
    }
}
