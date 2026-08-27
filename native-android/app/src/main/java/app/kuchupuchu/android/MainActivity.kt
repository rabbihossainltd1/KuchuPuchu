package app.kuchupuchu.android

import android.Manifest
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {

    private val ask =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        Api.loadToken(this)
        Store.init(this)
        KpNotify.ensureChannels(this)

        val need = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing =
            need.filter {
                ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
            }
        if (missing.isNotEmpty()) ask.launch(missing.toTypedArray())

        // Push mode is live on the v3 worker: init Firebase + register the
        // device token. No always-on service, no permanent notification.
        if (!Api.token.isNullOrBlank()) {
            Thread {
                runCatching {
                    if (KpPush.tryInit(this)) KpPush.registerToken(this)
                }
            }.start()
        }

        handleIntent(intent)
        setContent { KpTheme { KpApp() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: android.content.Intent?) {
        if (intent == null) return
        intent.getStringExtra("kp_chat")?.let { pendingChat = it }
    }

    override fun onResume() {
        super.onResume()
        Store.foreground = true
        restoreChrome()
    }

    override fun onPause() {
        Store.foreground = false
        super.onPause()
    }

    fun restoreChrome() {
        window.statusBarColor = Color.parseColor("#F7F6F4")
        window.navigationBarColor = Color.parseColor("#FFFFFF")
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

    companion object {
        @Volatile
        var current: MainActivity? = null

        /** Conversation to open from a notification tap. */
        @Volatile
        var pendingChat: String? = null
    }
}
