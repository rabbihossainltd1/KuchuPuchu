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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.text.style.TextAlign
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
            // Owner round 33: this switch used to be a FULL-WIDTH pill with
            // two huge buttons. It ate a third of the screen and pushed the
            // code itself off the bottom. It is now a compact segmented
            // control that hugs its content in the top-left corner.
            Row(
                Modifier
                    .padding(start = 16.dp, top = 2.dp, bottom = 6.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Card)
                    .border(1.dp, Line, RoundedCornerShape(12.dp))
                    .padding(3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                QrTabButton("My code", tab == 0) { tab = 0 }
                QrTabButton("Scan", tab == 1) { tab = 1 }
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
            .width(84.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) ActionBlueDeep else Color.Transparent)
            .clickable { haptics.tap(); onClick() }
            .padding(vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) ActionBlueInk else Ink,
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
    // Owner round 33: an account can hold NO share code at all — accounts
    // created before QR profiles existed were never backfilled, and the D1
    // backfill that used to fill them in was itself blocked by the daily
    // write quota. The old screen then spun for ever, so the owner never
    // even saw a code to scan. Mint one the moment we know the account has
    // none, and say so plainly when that fails.
    var loadError by remember(user) { mutableStateOf<String?>(null) }
    var minting by remember { mutableStateOf(false) }
    var retry by remember { mutableStateOf(0) }

    LaunchedEffect(user, qrCode, retry) {
        if (qrCode.isNotBlank() || minting) return@LaunchedEffect
        if (user == null) return@LaunchedEffect // the profile is still loading
        if (!isMe) {
            loadError = "This person has no QR code yet."
            return@LaunchedEffect
        }
        minting = true
        loadError = null
        var failure: String? = null
        val fresh =
            runCatching {
                withContext(Dispatchers.IO) { Api.post("/api/users/me/qr-code/reset") }.optString("qrCode")
            }.onFailure { failure = it.message }.getOrNull().orEmpty()
        minting = false
        if (fresh.isNotBlank()) {
            qrCode = fresh
            // This pane only renders for my own profile, so Store.me is this
            // same account — keep its cache in step.
            Store.me?.let { mine ->
                Store.saveMe(JSONObject(mine.toString()).put("qrCode", fresh))
            }
        } else {
            loadError =
                failure?.takeIf { it.isNotBlank() }
                    ?: "Your code could not be created right now. Try again in a minute."
        }
    }

    Column(
        // Owner round 33: the pane used to be a fixed-height column, so the
        // reset row and its note ran off the bottom of the screen on a
        // normal phone. It scrolls now — nothing is ever cut off.
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))
        KpAvatar(
            name = user?.optText("displayName").orEmpty(),
            url = user?.optText("avatarUrl"),
            size = 76.dp,
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
        Spacer(Modifier.height(16.dp))
        if (loadError != null) {
            // No code, and none could be minted: say it plainly and offer a
            // retry instead of spinning for ever.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Card)
                    .border(1.dp, Line, RoundedCornerShape(18.dp))
                    .padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    loadError!!,
                    fontSize = 13.sp,
                    color = Muted,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier
                        .clip(RoundedCornerShape(18.dp))
                        .background(ActionBlueDeep)
                        .clickable(enabled = !minting) { retry++ }
                        .padding(horizontal = 18.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Refresh, null, tint = ActionBlueInk, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (minting) "Please wait…" else "Try again",
                        color = ActionBlueInk,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        } else {
            Box(
                Modifier
                    .size(216.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White)
                    // Owner round 33: the frame used to be a 20%-alpha
                    // hairline, so on a white card it was invisible and the
                    // code looked unframed. A solid accent border reads as a
                    // real panel — and the white margin around the code is
                    // its quiet zone, without which scanners struggle.
                    .border(2.dp, ActionBlueDeep, RoundedCornerShape(18.dp)),
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
                        Image(bmp.asImageBitmap(), contentDescription = "QR code", modifier = Modifier.size(184.dp))
                    } else {
                        Text("Could not draw the code.", fontSize = 13.sp, color = Muted)
                    }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            if (isMe) "People who scan this add you instantly." else "Scan this to add ${user?.optText("displayName")?.ifBlank { "them" } ?: "them"}.",
            fontSize = 13.sp,
            color = Muted,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        if (isMe) {
            Spacer(Modifier.height(10.dp))
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
            // Owner round 33: the standalone "the old code stops working…"
            // note was filler under the button — it repeated the button's
            // own label and pushed the rest of the screen down. It is gone.
        }
        Spacer(Modifier.height(28.dp))
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
                        // Owner round 33: the camera used to follow the
                        // device's rotation, so a portrait app handed the
                        // scanner a sideways preview and the phone had to be
                        // turned over to read a code. Locked to the app's
                        // orientation (portrait) it never does.
                        .setOrientationLocked(true)
                        // Our own capture activity: the zxing default paints
                        // no frame around the scan area, so the viewfinder
                        // had no border at all.
                        .setCaptureActivity(KpScanActivity::class.java)
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

    Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
        // Owner round 33: the scan pane was a bare icon on the page — no
        // frame, so there was nothing that looked like a viewfinder. The
        // panel now carries the same accent border the code panel does.
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .border(2.dp, ActionBlueDeep, RoundedCornerShape(20.dp))
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
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
                            Text(
                                "Scan again",
                                color = ActionBlueInk,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
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
