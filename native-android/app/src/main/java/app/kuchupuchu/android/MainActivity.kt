package app.kuchupuchu.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsControllerCompat
import coil.Coil
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache

class MainActivity : ComponentActivity() {

    private var shareCb: ((Int, Intent?) -> Unit)? = null

    /** Two screen-share requests in flight used to overwrite each other's
     *  callback, so the FIRST caller's closure ran with the SECOND request's
     *  result — a granted projection handed to the wrong call, and a declined one
     *  reported as a failure to the other. Each request now owns a generation. */
    private var shareGen = 0L

    /**
     * Contextual permission gate (owner rule 2026-09-04): permissions are asked
     * at the moment the user enters the feature that needs them — camera when a
     * camera feature opens, mic when a call/voice note starts — never in one
     * bulk dialog at launch. The only first-open asks (notification + battery
     * exemption) live in KpApp's FirstRunPermissions gate.
     *
     * The callback runs whether or not everything was granted — callers own
     * the degraded behaviour (a video call without camera is a voice call; a
     * denied mic surfaces the engine's own error message).
     */
    @Volatile
    private var askCb: (() -> Unit)? = null

    private val ask =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val cb = askCb
            askCb = null
            cb?.invoke()
        }

    /** Ask for `perms` (only the still-missing ones), then run [onProceed]. */
    fun ensurePermissions(perms: List<String>, onProceed: () -> Unit) {
        val missing =
            perms.filter {
                ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
            }
        if (missing.isEmpty()) {
            onProceed()
            return
        }
        askCb = onProceed
        ask.launch(missing.toTypedArray())
    }

    private val shareAsk =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            shareCb?.invoke(result.resultCode, result.data)
            shareCb = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Owner round 13d: catch the silent chat-open crash on device — the
        // handler must be in place before anything else runs.
        KpCrash.install(this)
        super.onCreate(savedInstanceState)
        // Edge-to-edge on every API level, so the Compose-side insets are the
        // single source of truth. (targetSdk 35 forces this on Android 15+
        // anyway — setDecorFitsSystemWindows(true) and statusBarColor are
        // ignored there, which used to push the whole UI under the bars.)
        enableEdgeToEdge()
        current = this
        Api.loadToken(this)
        Coil.setImageLoader(
            ImageLoader.Builder(applicationContext)
                .okHttpClient { Api.http }
                // Keep typical chat-photo working sets resident. The default
                // cache evicted earlier bubbles after one fullscreen image.
                .memoryCache {
                    MemoryCache.Builder(applicationContext)
                        .maxSizeBytes(64 * 1024 * 1024)
                        .build()
                }
                // Disk cache: previously every photo re-downloaded after a
                // process restart (or memory-cache eviction), which made
                // scrolling back through a media-heavy chat re-fetch the whole
                // thread and stutter. The worker serves /api/files with
                // cache-control max-age=7d, so disk hits are authoritative.
                .diskCache {
                    DiskCache.Builder()
                        // filesDir, not cacheDir: cacheDir is exactly the directory
                        // the system (and ColorOS-style storage managers) purges, so
                        // "cached" photos re-downloaded after a background kill —
                        // the chat-photo half of the owner's report. We cap it below
                        // and evict ourselves instead of leaving it to the OS.
                        .directory(filesDir.resolve("kp-image-cache"))
                        .maxSizeBytes(256L * 1024 * 1024)
                        .build()
                }
                // Content-addressed urls (/api/files/<key>, <id>@v<n> refs) never
                // change under the same key, so revalidating buys nothing and costs
                // a round trip on every cold start. Cache-Control is still honoured
                // by OkHttp for the JSON calls; here the key IS the version.
                .respectCacheHeaders(false)
                .crossfade(true)
                .build(),
        )
        // One-shot cleanup: the image cache lived in cacheDir until it was moved
        // to filesDir, and an orphaned few hundred MB there is nobody's idea of a
        // cache. Off the main thread, lowest priority — startup must not pay for
        // a delete.
        Thread {
            runCatching {
                val stale = cacheDir.resolve("kp-image-cache")
                if (stale.exists()) stale.deleteRecursively()
            }
        }.apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
        Store.init(this)
        // The retry clock must run for the whole process, not just while a chat
        // is open: queued sends are the one thing the user cannot see working.
        Outbox.start(this)
        Store.authed.value = !Api.token.isNullOrBlank() && Store.me != null
        // Owner round 15: cold-open lag — notification channels, the Telecom
        // account binder call and the call engine all sat BETWEEN onCreate
        // and the first frame. None of them is needed to draw; they run on a
        // background starter thread now (each is idempotent).
        Thread {
            runCatching { KpNotify.ensureChannels(this) }
            if (CallEngine.instance == null) {
                val engine = CallEngine(application)
                engine.start(this)
            }
        }.apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }

        // Push mode is live on the v3 worker: init Firebase + register the
        // device token. No always-on service, no permanent notification.
        // boot() owns the retries and loads the session itself — gating on
        // Api.token here used to skip push entirely whenever this ran before
        // the stored session was restored, i.e. most cold starts.
        KpPush.boot(this)
        // Realtime user channel, held for the life of the PROCESS (not tied to
        // any one screen, which is what used to drop it the moment the user left
        // the chat list). This is what makes the worker's push-shape decision
        // trustworthy: while the process is alive (foreground OR background but
        // not frozen) the socket heartbeats, so liveSockets > 0 and the worker
        // sends a DATA-ONLY message whose rich Reply / Like / Mark-as-read card
        // the app can draw. If ColorOS freezes/kills the process the heartbeat
        // stops, the socket is classified dead within STALE_MS, and the worker
        // falls back to the guaranteed system payload — a bare tray card beats
        // silence. No foreground service, no visible notification.
        KpSocket.joinUser()
        // Pre-warm the SoundPool so the first send/receive tick never hits the
        // async-load race (play() on a not-yet-loaded sample is silently
        // dropped - the first message after a cold start used to be mute).
        Thread { runCatching { KpSounds.ensure(this) } }.start()



        handleIntent(intent)
        // Owner round 13b: the palette must be settled BEFORE the first frame —
        // a post-composition load left one frame of mixed tokens.
        KpThemeMode.load(this)
        setContent {
            KpTheme {
                KpApp()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        // Tapping the ongoing notification restores a previously minimized
        // Compose call overlay without recreating the call/session.
        CallEngine.instance?.restoreCallUi()
        if (intent.getBooleanExtra("kp_accept", false)) {
            CallEngine.instance?.let {
                CallEngine.suppressIncomingFor(15_000)
                it.pendingAccept = true
                it.answer()
            }
        }
        intent.getStringExtra("kp_chat")?.let { pendingChat.value = it }
        // Missed-call "Call back" action: start the call right away — with the
        // same contextual mic/camera gate every other call entry point uses.
        intent.getStringExtra("kp_callback")?.let { otherId ->
            if (otherId.isNotBlank()) {
                val kind = intent.getStringExtra("kp_callback_kind") ?: "AUDIO"
                val name = intent.getStringExtra("kp_callback_name") ?: "KuchuPuchu"
                ensurePermissions(
                    if (kind == "VIDEO") {
                        listOf(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.CAMERA)
                    } else {
                        listOf(android.Manifest.permission.RECORD_AUDIO)
                    },
                ) {
                    CallEngine.instance?.startCall(otherId, kind, name)
                }
            }
        }
        // Incoming-call notification tapped: the always-running engine's
        // next poll (~1s) surfaces the ringing screen with Accept/Decline —
        // nothing else to do here.
    }

    override fun onResume() {
        // A cold start that could not reach the worker (no network yet)
        // left push un-init'd for the whole run; re-arm whenever the app is
        // back in front. No-op once Firebase + registration have succeeded.
        KpPush.boot(this)
        super.onResume()
        Store.foreground = true
        // §37: an app that is being used should not expire. Off the main thread (this
        // is a network call), once per foreground, and the server only writes when the
        // expiry is actually near — so this costs a request, not a D1 row.
        Thread { runCatching { Api.refreshSession() } }.start()
        // Returning to the app triggers an instant re-sync of the open screens
        // (they observe ScreenStore.poke) — no waiting for the next poll.
        ScreenStore.pokeInbox()
        if (CallEngine.instance?.active == null) restoreChrome()
    }

    override fun onPause() {
        Store.foreground = false
        super.onPause()
    }

    fun restoreChrome() {
        // Bars are transparent (edge-to-edge); only the icon appearance needs
        // flipping back after the dark call screens.
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    /** Screen-share permission flow (video call screens). */
    fun askShare(cb: (Int, Intent?) -> Unit) {
        val gen = ++shareGen
        shareCb = { code, data -> if (gen == shareGen) cb(code, data) }
        val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        shareAsk.launch(mgr.createScreenCaptureIntent())
    }

    companion object {
        @Volatile
        var current: MainActivity? = null

        /** Conversation to open from a notification tap.
         *
         *  A StateFlow, not a @Volatile var: a tap while the user is ALREADY
         *  signed in (singleTop onNewIntent) used to write the var and then
         *  wait forever — the only consumer was a LaunchedEffect(authed) that
         *  re-runs only when `authed` flips. KpApp now collects this flow, so
         *  every tap is observed; StateFlow replay also picks up taps that
         *  landed before login on a cold start.
         */
        val pendingChat = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    }
}

/**
 * Contextual permission gate for the camera/mic feature entry points (owner
 * rule 2026-09-04: never ask everything up front — ask when the user enters
 * the feature). Grants are remembered by the OS, so the common case is a
 * zero-dialog straight-through. Runs [then] even on denial — each caller
 * already owns its degraded behaviour (video call without camera = voice,
 * VoiceNote/engine surface their own error toast).
 *
 * Best-effort by design: with no live Activity host (process waking for a
 * push-triggered call) the action proceeds exactly as it did before this
 * gate existed.
 */
fun gateMicCamera(video: Boolean, then: () -> Unit) {
    val activity = MainActivity.current ?: run { then(); return }
    val perms =
        if (video) {
            listOf(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.CAMERA)
        } else {
            listOf(android.Manifest.permission.RECORD_AUDIO)
        }
    activity.ensurePermissions(perms, then)
}

/** Camera-only variant (camera toggle on a live call, attach-sheet camera). */
fun gateCamera(then: () -> Unit) {
    val activity = MainActivity.current ?: run { then(); return }
    activity.ensurePermissions(listOf(android.Manifest.permission.CAMERA), then)
}
