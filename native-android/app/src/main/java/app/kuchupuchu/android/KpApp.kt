package app.kuchupuchu.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

/**
 * Root of the v3 app. Auth gate → main tabs (Chats / Status / Calls) with
 * Settings pushed from the app bar gear.
 */
@Composable
fun KpApp() {
    val nav = rememberNavController()
    val authed by Store.authed

    // Owner round 13d: if the previous launch crashed, surface the captured
    // stack right away (Copy → paste to the developer).
    KpCrashReportDialog()
    androidx.compose.runtime.LaunchedEffect(Unit) {
        KpCrash.mark("app-open")
        nav.addOnDestinationChangedListener { _, d, _ ->
            KpCrash.mark("nav:${d.route?.takeLast(28)}")
        }
    }


    // Owner rule (2026-09-04): the ONLY launch-time permission asks are
    // notification permission and the battery-optimization exemption dialog —
    // both on the first signed-in open, once per install. Camera/mic are asked
    // contextually at the feature that needs them (MainActivity.ensurePermissions).
    if (authed) FirstRunPermissions()

    // Notification tap → open the conversation. Collect the FLOW instead of
    // reading a one-shot var: a tap while already signed in (singleTop
    // onNewIntent) emits here immediately, and on a cold start a tap that
    // lands pre-login is replayed by the StateFlow once this effect runs
    // again after `authed` flips. (The old read-once var was silently
    // dropped in exactly the common case: app open, user taps the card.)
    // Owner round 11 (2026-09-05): the in-app message sound also fires from
    // the realtime user channel — the worker SKIPS the FCM push while the
    // socket is alive, so the push-only path was silent for online users.
    // Process-level: registered once, never removed.
    val appCtx = androidx.compose.ui.platform.LocalContext.current.applicationContext
    LaunchedEffect(Unit) {
        KpSocket.onEvent { ev ->
            if (ev.optString("type") == "conv" && ev.optBoolean("msg") && Store.foreground) {
                // Own sends arrive as pokes too (round 13): never play the
                // in-app sound for a message this device just sent.
                if (!ev.optString("senderId").isBlank() &&
                    ev.optString("senderId") == Store.me?.optString("id").orEmpty()
                ) {
                    return@onEvent
                }
                val cid = ev.optString("conversationId")
                val inChat = Store.route == "chat/$cid" || Store.route.startsWith("chat/$cid?")
                if (cid.isNotBlank() && !inChat && !ScreenStore.isMuted(cid)) {
                    runCatching { KpSounds.inApp(appCtx) }
                }
            }
        }
    }

    LaunchedEffect(authed) {
        MainActivity.pendingChat.collect { pending ->
            if (authed && !pending.isNullOrBlank()) {
                // Clear only once the route actually took. A failed navigate used
                // to eat the pending id, so the card tap did nothing at all and
                // the target was gone on the next composition.
                runCatching { nav.navigate("chat/$pending") { launchSingleTop = true } }
                    .onSuccess { MainActivity.pendingChat.value = null }
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Cream) {
        if (!authed) {
            LoginScreen { Store.authed.value = true }
        } else {
            NavHost(
                navController = nav,
                startDestination = "main",
                enterTransition = { fadeIn(tween(220)) + slideInHorizontally(tween(260)) { it / 6 } },
                exitTransition = { fadeOut(tween(180)) },
                popEnterTransition = { fadeIn(tween(220)) },
                popExitTransition = { fadeOut(tween(200)) + slideOutHorizontally(tween(260)) { it / 6 } },
            ) {
                composable("main") { ChatListScreen(nav) }
                composable("newchat") { NewChatScreen(nav) }
                composable("newgroup") { CreateGroupScreen(nav) }
                composable("chat/{id}") { entry ->
                    val id = entry.arguments?.getString("id") ?: ""
                    ChatScreen(nav, id)
                }
                composable("settings") { SettingsScreen(nav) }
                composable("status") { StatusScreen(nav) }
                composable("calls") { CallsScreen(nav) }
                composable("search") { SearchScreen(nav) }
                composable("statusview/{whose}") { entry ->
                    val whose = entry.arguments?.getString("whose") ?: ""
                    StatusViewerScreen(nav, whose)
                }
                composable("statusphoto") { StatusPhotoScreen(nav) }
                composable("archive") { ArchiveScreen(nav) }
                composable("profile/{id}") { entry ->
                    ProfileScreen(nav, entry.arguments?.getString("id") ?: "")
                }
                composable("aihistory") { AIHistoryScreen(nav) }
                composable("chatmedia/{id}") { entry ->
                    ChatMediaScreen(nav, entry.arguments?.getString("id") ?: "")
                }
            }
            // Call screens float above everything while a call is live.
            CallGate()
            // Owner round 16: in-app update — popup when a newer GitHub
            // release exists, then an in-app download with live progress;
            // the install confirm sheet opens right over the app.
            KpUpdateGate()
        }
    }
}

/**
 * First-open permission flow (once per install):
 *   1. Notification permission (API 33+) — without it messages are silent.
 *   2. Battery-optimization exemption — the single OEM-agnostic switch that
 *      keeps background message/call delivery alive; asked via the system
 *      dialog right after the notification prompt resolves.
 *
 * Denied or granted, it never asks again (a prefs flag). The exemption can
 * still be re-granted later from Android Settings → Apps → Battery.
 */
@Composable
private fun FirstRunPermissions() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val notifLauncher =
        androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
        ) {
            // Whatever the answer, move on to the battery dialog.
            askBatteryExemption(ctx)
        }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        val p = ctx.getSharedPreferences("kp", 0)
        // Flag set BEFORE the prompts fire: a process death between the two
        // dialogs must not replay them on the next open.
        if (p.getBoolean("kp_first_perms_done", false)) return@LaunchedEffect
        p.edit().putBoolean("kp_first_perms_done", true).apply()
        val needNotif =
            android.os.Build.VERSION.SDK_INT >= 33 &&
                androidx.core.content.ContextCompat.checkSelfPermission(
                    ctx,
                    android.Manifest.permission.POST_NOTIFICATIONS,
                ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        if (needNotif) {
            notifLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        } else {
            askBatteryExemption(ctx)
        }
    }
}

private fun askBatteryExemption(ctx: android.content.Context) {
    runCatching {
        val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        if (!pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
            ctx.startActivity(
                android.content.Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:${ctx.packageName}"),
                ),
            )
        }
    }
}


/**
 * Owner round 16: the in-app update flow. Popup first; tapping Update stays
 * INSIDE the app — progress bar + percentage — and hands the finished APK to
 * the system installer when the bytes land.
 */
@Composable
fun KpUpdateGate() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val upd = KpUpdate.available
    when {
        upd != null && !KpUpdate.downloading -> {
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { KpUpdate.available = null },
                containerColor = Card,
                title = { Text("Update available", color = Ink) },
                text = {
                    Text(
                        "A new version (v${'$'}{upd.first}) is ready. Update now — it downloads right here, no browser.",
                        color = Muted,
                        fontSize = 13.5.sp,
                    )
                },
                confirmButton = {
                    TextButton(onClick = { KpUpdate.available = null }) { Text("Later", color = Muted) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        kotlinx.coroutines.GlobalScope.launch {
                            KpUpdate.downloadAndInstall(ctx)
                        }
                    }) { Text("Update", color = GoldDeep, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) }
                },
            )
        }
        KpUpdate.downloading -> {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xB30D1524)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 26.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Card)
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Downloading update", color = Ink, fontSize = 16.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { KpUpdate.progress },
                        color = Gold,
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("${'$'}{(KpUpdate.progress * 100).toInt()}%", color = GoldDeep, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    if (KpUpdate.downloadError.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(KpUpdate.downloadError, color = Red, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
