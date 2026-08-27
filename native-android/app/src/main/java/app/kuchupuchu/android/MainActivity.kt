package app.kuchupuchu.android

import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {
    private var shareCb: ((Int, Intent?) -> Unit)? = null

    private val ask =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    private val shareAsk =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            shareCb?.invoke(result.resultCode, result.data)
            shareCb = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        Disk.init(this)
        Api.loadToken(this)
        val need = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing =
            need.filter {
                ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
            }
        if (missing.isNotEmpty()) ask.launch(missing.toTypedArray())
        if (!Api.token.isNullOrBlank()) KpSyncService.start(this)
        handleCallIntent(intent)
        setContent { KpTheme { KpApp() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallIntent(intent)
    }

    private fun handleCallIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.getBooleanExtra("kp_accept", false)) {
            pendingAccept = true
            CallEngine.suppressIncomingFor(15_000)
            CallEngine.instance?.pendingAccept = true
            CallEngine.instance?.answer()
        }
        intent.getStringExtra("kp_chat")?.let { pendingChat = it }
    }

    override fun onResume() {
        super.onResume()
        KpState.foreground = true
        if (CallEngine.instance?.active == null) restoreChrome()
    }

    override fun onPause() {
        KpState.foreground = false
        super.onPause()
    }

    fun restoreChrome() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.parseColor("#F7F6F4")
        window.navigationBarColor = Color.WHITE
        WindowCompat.setDecorFitsSystemWindows(window, true)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    fun askShare(cb: (Int, Intent?) -> Unit) {
        shareCb = cb
        val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        shareAsk.launch(mgr.createScreenCaptureIntent())
    }

    companion object {
        @Volatile
        var current: MainActivity? = null
        @Volatile
        var pendingAccept = false
        @Volatile
        var pendingChat: String? = null
    }
}
