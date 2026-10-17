package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.NavController
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Phase R9 (Android half): every profile — mine and everyone else's — carries
 * a "QR" button that shows THAT profile's own code
 * (`kuchupuchu://user/<qrCode>`), never a scanner for someone else's. Only my
 * own profile also offers "Scan", because scanning is something I do, not
 * something I show. Scanning another person's code previews their profile
 * first — Message/Add, never an instant open (owner decision). Scanning the
 * Web's `kuchupuchu://weblogin/<token>` code signs that browser in the moment
 * this phone confirms it: opening the scanner and pointing it at the one code
 * on the screen already is the consent, so there is no second approval tap.
 */
@Composable
fun QrScreen(nav: NavController, userId: String) {
    val isMe = userId.isNotBlank() && userId == Store.myId()
    var tab by remember { mutableStateOf(0) } // 0 = my code, 1 = scan
    var user by remember { mutableStateOf(if (isMe) Store.me else null) }
    LaunchedEffect(userId) {
        runCatching {
            val path = if (isMe) "/api/me" else "/api/users/$userId"
            val data = withContext(Dispatchers.IO) { Api.get(path) }
            data.optJSONObject("user")?.let { user = it }
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
            Text(
                if (isMe) "QR code" else "Their QR code",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
                modifier = Modifier.weight(1f),
            )
        }

        if (isMe) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card),
            ) {
                QrTabButton("My code", tab == 0, Modifier.weight(1f)) { tab = 0 }
                QrTabButton("Scan", tab == 1, Modifier.weight(1f)) { tab = 1 }
            }
        }

        if (!isMe || tab == 0) {
            MyQrPane(user = user, isMe = isMe)
        } else {
            QrScannerPane(nav = nav)
        }
    }
}

@Composable
private fun QrTabButton(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val haptics = rememberHaptics()
    Box(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ActionBlueDeep else Color.Transparent)
            .clickable { haptics.tap(); onClick() }
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) Color.White else Ink,
        )
    }
}

/** The "My code" / friend's-code pane: avatar, name, the QR bitmap, reset (self only). */
@Composable
private fun MyQrPane(user: JSONObject?, isMe: Boolean) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var qrCode by remember(user) { mutableStateOf(user?.optText("qrCode").orEmpty()) }
    var resetting by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(16.dp))
        KpAvatar(
            name = user?.optText("displayName").orEmpty(),
            url = user?.optText("avatarUrl"),
            size = 84.dp,
            avatarRef = user?.optText("avatarRef"),
        )
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                user?.optText("displayName")?.ifBlank { "KuchuPuchu" } ?: "KuchuPuchu",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
            )
            Spacer(Modifier.width(6.dp))
            UserBadges(user)
        }
        val username = user?.optText("username").orEmpty()
        if (username.isNotBlank()) {
            Text("@$username", fontSize = 13.sp, color = Muted)
        }
        Spacer(Modifier.height(20.dp))
        Box(
            Modifier
                .size(240.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.White)
                .border(1.dp, CircleButtonEdge, RoundedCornerShape(20.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (qrCode.isBlank()) {
                CircularProgressIndicator(color = ActionBlueDeep)
            } else {
                val bmp =
                    remember(qrCode) {
                        runCatching {
                            BarcodeEncoder().encodeBitmap(
                                "kuchupuchu://user/$qrCode",
                                BarcodeFormat.QR_CODE,
                                720,
                                720,
                            )
                        }.getOrNull()
                    }
                if (bmp != null) {
                    Image(bmp.asImageBitmap(), contentDescription = "QR code", modifier = Modifier.size(210.dp))
                } else {
                    Text("Could not draw the code.", fontSize = 13.sp, color = Muted)
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        Text(
            if (isMe) "People who scan this add you instantly." else "Scan this to add ${user?.optText("displayName")?.ifBlank { "them" } ?: "them"}.",
            fontSize = 13.sp,
            color = Muted,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        if (isMe) {
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .clickable(enabled = !resetting) {
                        resetting = true
                        scope.launch {
                            runCatching {
                                val data = withContext(Dispatchers.IO) { Api.post("/api/users/me/qr-code/reset") }
                                val fresh = data.optString("qrCode")
                                if (fresh.isNotBlank()) {
                                    qrCode = fresh
                                    // This row only renders when isMe (below), so Store.me
                                    // is this same account — keep its cache in step.
                                    Store.me?.let { mine ->
                                        Store.saveMe(JSONObject(mine.toString()).put("qrCode", fresh))
                                    }
                                }
                            }.onFailure {
                                Toast.makeText(ctx, "Could not reset the code.", Toast.LENGTH_SHORT).show()
                            }
                            resetting = false
                        }
                    }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Refresh, null, tint = ActionBlueDeep, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    if (resetting) "Resetting…" else "Reset code",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = ActionBlueDeep,
                )
            }
            Text(
                "The old code stops working the moment you reset it.",
                fontSize = 11.5.sp,
                color = Muted,
                modifier = Modifier.padding(start = 20.dp, top = 2.dp, end = 20.dp),
            )
        }
    }
}

/** The scanner pane (self profile only): camera permission, then the preview-first add flow. */
@Composable
private fun QrScannerPane(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var permissionDenied by remember { mutableStateOf(false) }

    val scanner =
        rememberLauncherForActivityResult(ScanContract()) { result ->
            error = ""
            when (val action = parseQrScan(result.contents)) {
                is QrScanAction.UserProfile -> {
                    loading = true
                    scope.launch {
                        runCatching {
                            val data =
                                withContext(Dispatchers.IO) {
                                    Api.get("/api/users/by-qr/${action.code}", force = true)
                                }
                            data.optJSONObject("user")
                        }.onSuccess { u ->
                            loading = false
                            if (u == null) error = "This QR code doesn't match a KuchuPuchu account."
                            else if (u.optString("id") == Store.myId()) error = "That's your own code."
                            else preview = u
                        }.onFailure {
                            loading = false
                            error = it.message ?: "Could not look up that code."
                        }
                    }
                }
                is QrScanAction.WebLogin -> {
                    loading = true
                    scope.launch {
                        runCatching {
                            withContext(Dispatchers.IO) { Api.post("/api/auth/qr/${action.token}/confirm") }
                        }.onSuccess {
                            loading = false
                            Toast.makeText(ctx, "Signed that browser in.", Toast.LENGTH_SHORT).show()
                            nav.popBackStack()
                        }.onFailure {
                            loading = false
                            error = it.message ?: "That login code has expired. Ask for a fresh one."
                        }
                    }
                }
                QrScanAction.Invalid -> if (result.contents != null) error = "That isn't a KuchuPuchu QR code."
            }
        }

    fun launchScan() {
        val activity = MainActivity.current
        if (activity == null) {
            error = "Could not open the camera."
            return
        }
        activity.ensurePermissions(listOf(Manifest.permission.CAMERA)) {
            val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                permissionDenied = true
                return@ensurePermissions
            }
            permissionDenied = false
            runCatching {
                scanner.launch(
                    ScanOptions()
                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setBeepEnabled(false)
                        .setOrientationLocked(false)
                        .setPrompt("Point the camera at a KuchuPuchu QR code"),
                )
            }.onFailure { error = "No camera app is available." }
        }
    }

    LaunchedEffect(Unit) { launchScan() }

    if (preview != null) {
        QrScanPreviewSheet(
            user = preview!!,
            onDismiss = { preview = null; launchScan() },
            onMessage = { target ->
                val known = PhoneBook.entries.any { it.user?.optString("id") == target.optString("id") }
                scope.launch {
                    runCatching {
                        val data =
                            withContext(Dispatchers.IO) {
                                Api.post(
                                    "/api/conversations",
                                    JSONObject().put("userId", target.optString("id")).put("request", !known),
                                )
                            }
                        data.optJSONObject("conversation")?.optString("id")
                    }.onSuccess { cid ->
                        if (!cid.isNullOrBlank()) {
                            nav.navigate("chat/$cid") { popUpTo("main") }
                        }
                    }.onFailure {
                        Toast.makeText(ctx, "Could not open that chat.", Toast.LENGTH_SHORT).show()
                    }
                }
            },
        )
        return
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            loading -> CircularProgressIndicator(color = ActionBlueDeep)
            permissionDenied ->
                EmptyState(
                    icon = Icons.Filled.QrCodeScanner,
                    title = "Camera permission needed",
                    note = "KuchuPuchu needs the camera to scan a QR code.",
                    modifier = Modifier.clickable { launchScan() },
                )
            error.isNotBlank() ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    EmptyState(icon = Icons.Filled.QrCodeScanner, title = "Couldn't scan that", note = error)
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(20.dp))
                            .background(ActionBlueDeep)
                            .clickable { error = ""; launchScan() }
                            .padding(horizontal = 18.dp, vertical = 10.dp),
                    ) {
                        Text("Scan again", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            else ->
                EmptyState(
                    icon = Icons.Filled.QrCodeScanner,
                    title = "Scan a code",
                    note = "Point your camera at a KuchuPuchu profile or login code.",
                    modifier = Modifier.clickable { launchScan() },
                )
        }
    }
}

/**
 * Preview-first (owner decision): scanning someone's profile code never
 * opens or creates the chat on its own — this card names them first and
 * waits for an explicit Message tap.
 */
@Composable
private fun QrScanPreviewSheet(user: JSONObject, onDismiss: () -> Unit, onMessage: (JSONObject) -> Unit) {
    KpSheet(onDismiss = onDismiss, title = "Add from QR code") {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            KpAvatar(
                name = user.optText("displayName"),
                url = user.optText("avatarUrl"),
                size = 72.dp,
                avatarRef = user.optText("avatarRef"),
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(user.optText("displayName").ifBlank { "KuchuPuchu user" }, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Ink)
                Spacer(Modifier.width(6.dp))
                UserBadges(user)
            }
            val username = user.optText("username")
            if (username.isNotBlank()) Text("@$username", fontSize = 13.sp, color = Muted)
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(ActionBlueDeep)
                    .clickable { onMessage(user) }
                    .padding(vertical = 13.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.PersonAdd, null, tint = Color.White, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Message", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
