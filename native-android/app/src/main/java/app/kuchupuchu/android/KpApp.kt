package app.kuchupuchu.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
            // Owner round 31 (item 18): a peer changed name / username / about
            // / picture. Drop every cached view of that user, then poke: the
            // chat list refetches (new name + avatarRef), the open chat header
            // and the profile page re-read the user, avatars re-resolve.
            if (ev.optString("type") == "profile") {
                val uid = ev.optString("userId")
                if (uid.isNotBlank()) {
                    Cache.bust("/api/users/$uid")
                    Cache.bustAll("/api/users/$uid/")
                    Cache.bustAll("/api/conversations")
                    if (ev.optBoolean("self")) Cache.bust("/api/me")
                }
                ScreenStore.pokeProfile()
                ScreenStore.pokeInbox()
                return@onEvent
            }
            // Owner fix 3/5: global chat-list realtime — every conv poke
            // merges the single updated conversation instantly, on ANY screen
            // (the previous listener lived only inside ChatListScreen's
            // composition, so a message arriving on another tab left the list
            // stale until it was revisited). Runs in appScope so it outlives
            // any one screen and works while foreground or background.
            if (ev.optString("type") == "conv") {
                val cid = ev.optString("conversationId")
                if (cid.isNotBlank()) {
                    ScreenStore.appScope.launch {
                        runCatching {
                            val one =
                                with(kotlinx.coroutines.Dispatchers.IO) {
                                    Api.get("/api/conversations/$cid", true)
                                }.optJSONObject("conversation") ?: return@launch
                            if (Store.route == "chat/$cid") one.put("unread", 0)
                            ScreenStore.upsertConv(one)
                        }
                    }
                }
                ScreenStore.pokeInbox()
                if (!ev.optBoolean("msg")) return@onEvent
            }
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
                // Owner round 31 (item 26): hidden chats never sound either.
                if (cid.isNotBlank() && !inChat && !ScreenStore.isSilenced(cid)) {
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
            // Owner round 31 (item 33): with a call connected and the call UI
            // minimised, a "Return to call" strip (timer, one tap) sits ABOVE
            // every screen. While it is up it owns the status-bar inset, so the
            // screens' own statusBarsPadding() collapses to zero instead of
            // stacking under it.
            val callEngine = CallEngine.instance
            val bannerUp = callEngine != null && callEngine.active != null && callEngine.minimized
            Column(Modifier.fillMaxSize()) {
              ReturnToCallBanner()
              Box(
                  Modifier
                      .fillMaxSize()
                      .then(if (bannerUp) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier),
              ) {
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
                // Owner round 32 (item 12): `with` = comma-separated user ids
                // pre-picked as members ("Create group with …" from the list).
                composable(
                    "newgroup?with={with}",
                    arguments = listOf(navArgument("with") { defaultValue = "" }),
                ) { entry ->
                    CreateGroupScreen(nav, entry.arguments?.getString("with") ?: "")
                }
                composable("chat/{id}") { entry ->
                    val id = entry.arguments?.getString("id") ?: ""
                    ChatScreen(nav, id)
                }
                composable("settings") { SettingsScreen(nav) }
                // Owner round 31: Settings is a hub — each section is its own screen.
                composable("settings/privacy") { PrivacySettingsScreen(nav) }
                composable("settings/appearance") { AppearanceSettingsScreen(nav) }
                composable("settings/devices") { DevicesSettingsScreen(nav) }
                composable("settings/permissions") { PermissionsSettingsScreen(nav) }
                composable("settings/app") { AppSettingsScreen(nav) }
                // Owner round 32 (item 7): Privacy › Blocklist (unblock lives here).
                composable("settings/blocklist") { BlocklistScreen(nav) }
                // Owner round 31: the group profile (members / admin actions).
                composable("group/{id}") { GroupInfoScreen(nav, it.arguments?.getString("id") ?: "") }
                // Owner round 32 (item 5): group profile ⋮ → Settings ("Private group").
                composable("group/{id}/settings") { GroupSettingsScreen(nav, it.arguments?.getString("id") ?: "") }
                // Owner round 28: home ⋮ menu destinations.
                composable("about") { AboutScreen(nav) }
                composable("contacts") { AllContactsScreen(nav) }
                composable(
                    "newcontact?name={name}&phone={phone}",
                    arguments = listOf(navArgument("name") { defaultValue = "" }, navArgument("phone") { defaultValue = "" }),
                ) { entry ->
                    NewContactScreen(
                        nav,
                        initialName = entry.arguments?.getString("name") ?: "",
                        initialPhone = entry.arguments?.getString("phone") ?: "",
                    )
                }
                // Owner round 22: per-field profile edit screens.
                composable("editfield/name") { EditNameScreen(nav) }
                composable("editfield/username") { EditUsernameScreen(nav) }
                composable("editfield/about") { EditAboutScreen(nav) }
                composable("editfield/phone") { EditPhoneScreen(nav) }
                composable("status") { StatusScreen(nav) }
                composable("calls") { CallsScreen(nav) }
                composable("search") { SearchScreen(nav) }
                // Owner round 33 (item 11b): the viewer rises from the bottom
                // and, on close (last status done / swipe down / X / back),
                // slides back down instead of fading like an ordinary screen.
                composable(
                    "statusview/{whose}",
                    enterTransition = { slideInVertically(tween(240)) { it } },
                    popEnterTransition = { fadeIn(tween(220)) },
                    exitTransition = { fadeOut(tween(180)) },
                    popExitTransition = { slideOutVertically(tween(240)) { it } },
                ) { entry ->
                    val whose = entry.arguments?.getString("whose") ?: ""
                    StatusViewerScreen(nav, whose)
                }
                // Owner round 31 (items 30/31): the app's own gallery picks the
                // item, the share screen receives it as a route argument.
                composable("statuspick") { StatusPickScreen(nav) }
                // Owner round 32 (item 19): the light media editor behind the
                // attach panel's Edit (pen for a photo, trim for a video).
                composable("mediaedit/{conv}/{once}/{arg}") { entry ->
                    val picked = statusPickDecode(entry.arguments?.getString("arg") ?: "")
                    val conv = entry.arguments?.getString("conv") ?: ""
                    if (picked == null || conv.isBlank()) {
                        LaunchedEffect(Unit) { nav.popBackStack() }
                    } else {
                        MediaEditScreen(
                            nav,
                            picked.first,
                            picked.second,
                            conv,
                            viewOnce = entry.arguments?.getString("once") == "1",
                        )
                    }
                }
                // Owner round 22: the in-app video player is its own screen.
                composable("videoplayer/{b64}") { entry ->
                    VideoPlayerScreen(nav, entry.arguments?.getString("b64") ?: "")
                }
                // Owner round 32 (item 33): documents open in the app's own viewer.
                composable("docviewer/{b64}") { entry ->
                    DocViewerScreen(nav, entry.arguments?.getString("b64") ?: "")
                }
                composable("archive") { ArchiveScreen(nav) }
                composable("profile/{id}") { entry ->
                    ProfileScreen(nav, entry.arguments?.getString("id") ?: "")
                }
                composable("aihistory") { AIHistoryScreen(nav) }
                composable("chatmedia/{id}") { entry ->
                    ChatMediaScreen(nav, entry.arguments?.getString("id") ?: "")
                }
            }
              }
            }
            // Owner round 32 (item 36): something shared from another app —
            // the same multi-select picker as Forward, titled "Send to". The
            // sends run on ShareSend's own scope; one target opens that chat.
            val share by MainActivity.pendingShare.collectAsState()
            share?.takeIf { authed }?.let { payload ->
                ForwardDialog(
                    onClose = {
                        MainActivity.pendingShare.value = null
                        ShareSend.discard(payload)
                    },
                    onSend = { targets ->
                        MainActivity.pendingShare.value = null
                        ShareSend.send(appCtx, targets, payload) { ok ->
                            android.widget.Toast.makeText(appCtx, if (ok) "Sent" else "Could not send", android.widget.Toast.LENGTH_SHORT).show()
                        }
                        if (targets.size == 1) {
                            runCatching { nav.navigate("chat/${targets[0]}") { launchSingleTop = true } }
                        }
                    },
                    title = "Send to",
                )
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
 * Owner fix 5/5: replaced the dismissible bottom sheet (KpSheet) with a centered, non-cancelable popup Dialog that appears on ANY screen (it lives at the root of KpApp), cannot be swiped away, and drives download→install without the app exiting. Installing uses Intent path on <34 so the app is not killed before the system confirm sheet.
 */
@Composable
fun KpUpdateGate() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val upd = KpUpdate.available
    val ready = KpUpdate.ready
    val downloading = KpUpdate.downloading
    val installing = KpUpdate.installing
    val justUpdated = KpUpdate.justUpdated
    if (upd == null && ready == null && !downloading && !installing && !justUpdated) return
    // Non-skippable popup — Dialog with no outside/back dismiss so an update cannot be swiped away. The old KpSheet was dismissible and a bottom sheet.
    androidx.compose.ui.window.Dialog(
        onDismissRequest = {},
        properties = androidx.compose.ui.window.DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        // Centered card — theme-aware, works on any route because this gate is at the root of KpApp.
        androidx.compose.foundation.layout.Box(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp),
            contentAlignment = androidx.compose.ui.Alignment.Center,
        ) {
            androidx.compose.material3.Card(
                shape = RoundedCornerShape(20.dp),
                colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = Card),
                elevation = androidx.compose.material3.CardDefaults.cardElevation(defaultElevation = 8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
                    // v166 (owner: "in app update downloading er somoy ei
                    // animation ta hobe ar update available animation ta tumi ei
                    // animation er sathe sync kore create kore daw … colour
                    // system ta app er sathe match korbe"): the plain title +
                    // LinearProgressIndicator pair is replaced by the owner's
                    // own maintenance-crew scene (KpUpdateScene) — the SAME crew
                    // is on screen whether the update is merely available or
                    // downloading, and its palette is the app's Blue / Gold.
                    Text(
                        when {
                            justUpdated -> "Update installed"
                            installing -> "Installing update"
                            ready != null -> "Update ready"
                            downloading -> "Downloading update"
                            else -> "Update available"
                        },
                        fontSize = 18.sp,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        color = Ink,
                    )
                    Spacer(Modifier.height(10.dp))
                    when {
                        justUpdated -> {
                            KpUpdateScene(KpUpdatePhase.DONE, 1f, Modifier.fillMaxWidth())
                            Spacer(Modifier.height(14.dp))
                            Text("Restart to run the new build.", color = Muted, fontSize = 13.5.sp)
                            Spacer(Modifier.height(14.dp))
                            GoldBtn("Restart", Modifier.fillMaxWidth()) { KpUpdate.restart(ctx) }
                        }
                        installing -> {
                            KpUpdateScene(KpUpdatePhase.DONE, 1f, Modifier.fillMaxWidth())
                            Spacer(Modifier.height(14.dp))
                            Text(
                                "Confirm the install in the system window.",
                                color = Muted,
                                fontSize = 13.sp,
                            )
                        }
                        ready != null -> {
                            KpUpdateScene(KpUpdatePhase.DONE, 1f, Modifier.fillMaxWidth())
                            Spacer(Modifier.height(14.dp))
                            Text("v${upd?.first ?: ""} downloaded and ready to install.", color = Muted, fontSize = 13.5.sp)
                            Spacer(Modifier.height(14.dp))
                            GoldBtn("Install", Modifier.fillMaxWidth()) { scope.launch { KpUpdate.installReady(ctx) } }
                        }
                        downloading -> {
                            // The bar IS the scene here: real progress drives the
                            // fill and the walking figure (KpUpdate.progress).
                            KpUpdateScene(KpUpdatePhase.DOWNLOADING, KpUpdate.progress, Modifier.fillMaxWidth())
                        }
                        else -> {
                            KpUpdateScene(KpUpdatePhase.AVAILABLE, 0f, Modifier.fillMaxWidth())
                            Spacer(Modifier.height(12.dp))
                            Text("A new version v${upd?.first} is available. Update to continue.", color = Muted, fontSize = 13.5.sp)
                            Spacer(Modifier.height(14.dp))
                            GoldBtn("Update", Modifier.fillMaxWidth()) { scope.launch { KpUpdate.downloadAndInstall(ctx) } }
                        }
                    }
                    if (KpUpdate.downloadError.isNotBlank()) {
                        Spacer(Modifier.height(10.dp))
                        Text(KpUpdate.downloadError, color = Red, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
