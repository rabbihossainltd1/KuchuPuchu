package app.kuchupuchu.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Brush
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
@Composable
fun SettingsScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    // Paint instantly from the cached profile — no "…" flash on every open.
    val me = remember { mutableStateOf(Store.me ?: JSONObject()) }
    var editField by remember { mutableStateOf<String?>(null) }
    var editValue by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf(false) }
    // Phone-auth: change-number dialog state.
    var showChangePhone by remember { mutableStateOf(false) }
    var showRingPicker by remember { mutableStateOf(false) }
    var changePhone by remember { mutableStateOf("") }
    var changePhoneError by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        runCatching {
            me.value = withContext(Dispatchers.IO) { Api.get("/api/me", true).optJSONObject("user") ?: JSONObject() }
            Store.saveMe(me.value)
        }
    }

    val avatarPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                scope.launch {
                    busy = true
                    error = ""
                    // The worker stores avatars inline with a 200KB budget —
                    // compress below it and show real errors instead of
                    // failing silently.
                    val dataUrl =
                        withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx, maxSide = 512, maxChars = 190_000) }
                    if (dataUrl == null) {
                        error = "Could not read that photo. Pick another one."
                    } else {
                        try {
                            val updated =
                                withContext(Dispatchers.IO) {
                                    Api.patch("/api/me", JSONObject().put("avatarUrl", dataUrl))
                                }
                            me.value = updated.optJSONObject("user") ?: me.value
                            Store.saveMe(me.value)
                        } catch (e: Exception) {
                            error = e.message ?: "Could not set the photo."
                        }
                    }
                    busy = false
                }
            }
        }

    fun save(field: String, value: String) {
        scope.launch {
            busy = true
            error = ""
            try {
                val updated =
                    withContext(Dispatchers.IO) { Api.patch("/api/me", JSONObject().put(field, value.trim())) }
                me.value = updated.optJSONObject("user") ?: me.value
                Store.saveMe(me.value)
                editField = null
            } catch (e: Exception) {
                error = e.message ?: "Could not save."
            } finally {
                busy = false
            }
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
        /* ---------- top bar ---------- */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text("Settings", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }

        /* ---------- warm amber banner ---------- */
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Brush.linearGradient(listOf(GoldLight, Gold)))
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box {
                    KpAvatar(
                        me.value.optText("displayName"),
                        me.value.optIso("avatarUrl"),
                        76.dp,
                        ring = false,
                    )
                    Box(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .clickable {
                                avatarPicker.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                )
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (busy) {
                            CircularProgressIndicator(
                                color = GoldDeep,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(15.dp),
                            )
                        } else {
                            Icon(
                                Icons.Filled.Edit,
                                contentDescription = "Change photo",
                                tint = GoldDeep,
                                modifier = Modifier.size(15.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(
                        me.value.optText("displayName").ifBlank { "…" },
                        color = Color.White,
                        fontSize = 21.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(2.dp))
                    val un = me.value.optText("username")
                    Text(
                        if (un.isNotBlank()) "@$un" else "Add a username ↓",
                        color = Color(0xE6FFFFFF),
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        me.value.optText("about").ifBlank { "Hey! I'm using KuchuPuchu" },
                        color = Color(0xCCFFFFFF),
                        fontSize = 12.5.sp,
                        maxLines = 2,
                    )
                }
            }
        }

        /* ---------- white list card ---------- */
        Column(
            Modifier
                .fillMaxWidth()
                .padding(14.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color.White),
        ) {
            SettingRow(Icons.Filled.Badge, "Name", me.value.optText("displayName").ifBlank { "—" }) {
                editField = "displayName"; editValue = me.value.optText("displayName")
            }
            SettingRow(Icons.Filled.AlternateEmail, "Username", me.value.optText("username").ifBlank { "not set" }) {
                editField = "username"; editValue = me.value.optText("username")
            }
            SettingRow(Icons.Filled.Info, "About", me.value.optText("about").ifBlank { "Hey! I'm using KuchuPuchu" }) {
                editField = "about"; editValue = me.value.optText("about")
            }
            // Phone auth: the login identity now. Change needs the new SIM
            // literally present on this device (MATCH) — the worker rejects
            // anything weaker for a number change (PHONE_AUTH_PLAN.md §5).
            SettingRow(
                Icons.Filled.Call,
                "Phone number",
                me.value.optText("phone").ifBlank { "not set" },
            ) {
                changePhone = ""
                changePhoneError = ""
                showChangePhone = true
            }
            // Owner round 10 (2026-09-04): his incoming-ringtone pack — the
            // user picks which one rings for calls. Default is the app's
            // ORIGINAL tone again (owner round 13); his "calling ringing"
            // file stays as the caller-side ringback only.
            SettingRow(
                Icons.Filled.Palette,
                "App theme",
                if (KpThemeMode.darkBlue) "Dark blue" else "Light",
            ) {
                // Owner round 13 (2026-09-05): dark blue is the DEFAULT; the
                // previous light look stays one tap away. Applies instantly.
                val setDark = !KpThemeMode.darkBlue
                KpThemeMode.set(ctx, setDark)
            }
            SettingRow(
                Icons.Filled.NotificationsActive,
                "Incoming ringtone",
                SoundPrefs.currentLabel(ctx),
            ) { showRingPicker = true }
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
        }

        if (error.isNotBlank()) {
            Text(error, color = Red, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp))
        }

        /* ---------- about + logout ---------- */
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color.White),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    val ver =
                        remember {
                            runCatching {
                                val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
                                "${pi.versionName} (${pi.versionCode})"
                            }.getOrDefault("?")
                        }
                    Text("KuchuPuchu $ver", fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                    Text("kuchupuchu-api.kuchupuchu.workers.dev", fontSize = 12.sp, color = Muted)
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFFFEE2E2))
                .clickable { confirmLogout = true }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Log out", tint = Red, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            Text("Log out", color = Red, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(32.dp))
    }



    // Owner round 11: FULLSCREEN ringtone picker — tap previews, Save keeps.
    if (showRingPicker) {
        RingtonePickerScreen(onClose = { showRingPicker = false })
    }

    /* ---------- edit dialog ---------- */
    if (editField != null) {
        AlertDialog(
            onDismissRequest = { editField = null },
            title = {
                Text(
                    when (editField) {
                        "displayName" -> "Your name"
                        "username" -> "Username"
                        else -> "About"
                    },
                )
            },
            text = {
                Column {
                    OutlinedTextField(
                        editValue,
                        { editValue = it.take(if (editField == "about") 200 else 60) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                    )
                    if (editField == "username") {
                        Spacer(Modifier.height(6.dp))
                        Text("People can find you by this username — use lowercase letters, numbers and underscores only.", fontSize = 12.sp, color = Muted)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { save(editField!!, editValue) },
                    enabled = !busy && editValue.isNotBlank(),
                ) { Text("Save", color = GoldDeep, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { editField = null }) { Text("Cancel", color = Muted) }
            },
        )
    }

    /* ---------- phone auth: change number ---------- */
    if (showChangePhone) {
        AlertDialog(
            onDismissRequest = { showChangePhone = false },
            title = { Text("Change phone number") },
            text = {
                Column {
                    Text(
                        "The new number must be present on this device's SIM — it only changes if it can be verified automatically.",
                        fontSize = 12.sp,
                        color = Muted,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        changePhone,
                        { changePhone = it; changePhoneError = "" },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                    )
                    if (changePhoneError.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(changePhoneError, color = Red, fontSize = 12.sp)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            busy = true
                            changePhoneError = ""
                            try {
                                val e164 = PhoneVerifier.normalize(changePhone)
                                if (e164 == null) {
                                    changePhoneError = "Enter a valid number, e.g. 01712345678."
                                } else {
                                    val sim =
                                        withContext(Dispatchers.IO) {
                                            PhoneVerifier.verify(ctx, e164).wire()
                                        }
                                    val updated =
                                        withContext(Dispatchers.IO) {
                                            Api.post(
                                                "/api/auth/phone/change",
                                                JSONObject().put("phone", e164).put("sim", sim),
                                            )
                                        }
                                    me.value = updated.optJSONObject("user") ?: me.value
                                    Store.saveMe(me.value)
                                    showChangePhone = false
                                }
                            } catch (e: Exception) {
                                changePhoneError = e.message ?: "Could not change the number."
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy && changePhone.isNotBlank(),
                ) { Text("Change", color = GoldDeep, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { showChangePhone = false }) { Text("Cancel", color = Muted) }
            },
        )
    }

    /* ---------- logout confirm ---------- */
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Log out?") },
            text = { Text("You can sign in again anytime with your phone number.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        // deviceId travels with the logout so the worker removes
                        // this install's push row in the same request: while the
                        // bearer is still valid, and without touching the user's
                        // other devices.
                        runCatching {
                            withContext(Dispatchers.IO) {
                                Api.post(
                                    "/api/auth/logout",
                                    org.json.JSONObject().put("deviceId", KpPush.deviceId(ctx)),
                                )
                            }
                        }
                        KpPush.unregister()
                        KpNotify.cancelAll(ctx)
                        Store.signOut(ctx)
                    }
                }) { Text("Log out", color = Red, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmLogout = false }) { Text("Cancel", color = Muted) }
            },
        )
    }
}

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
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = label, tint = GoldDeep, modifier = Modifier.size(21.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 13.sp, color = Muted)
            Text(value, fontSize = 14.5.sp, color = Ink, fontWeight = FontWeight.Medium)
        }
        if (clickable) {
            Icon(Icons.Filled.Edit, contentDescription = "Edit", tint = Color(0xFFD6D3D1), modifier = Modifier.size(16.dp))
        }
    }
}


/**
 * Owner round 11 (2026-09-05): fullscreen incoming-ringtone picker.
 * Tap a ringtone = select + instant preview; SAVE keeps the choice; the
 * device's own audio files can be picked as a CUSTOM ringtone.
 */
@Composable
fun RingtonePickerScreen(onClose: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val savedCustom = SoundPrefs.customRingPath(ctx)
    var selRes by remember { mutableStateOf(if (savedCustom == null) SoundPrefs.ringRes[SoundPrefs.ringIndex(ctx)] else -1) }
    var selCustom by remember { mutableStateOf(savedCustom) }
    var playingRes by remember { mutableStateOf(-2) } // -2 none, -1 custom
    var player by remember { mutableStateOf<android.media.MediaPlayer?>(null) }

    fun stopPreview() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
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
                Text("Incoming ringtone", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink)
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
            SoundPrefs.ringNames.forEachIndexed { idx, name ->
                val res = SoundPrefs.ringRes[idx]
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
                        tint = GoldDeep,
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
                        Icon(Icons.Filled.Done, null, tint = GoldDeep, modifier = Modifier.size(18.dp))
                    }
                }
            }
            // Custom ringtone row
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (selCustom != null) GoldSoft else Color.White)
                    .clickable { customPicker.launch(arrayOf("audio/*")) }
                    .padding(horizontal = 14.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.LibraryMusic, null, tint = GoldDeep, modifier = Modifier.size(20.dp))
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
                    Icon(Icons.Filled.Done, null, tint = GoldDeep, modifier = Modifier.size(18.dp))
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
                .background(Gold)
                .clickable {
                    if (selCustom != null) SoundPrefs.setCustomRing(ctx, selCustom!!)
                    else if (selRes >= 0) SoundPrefs.setRingIndex(ctx, SoundPrefs.ringRes.indexOf(selRes))
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
