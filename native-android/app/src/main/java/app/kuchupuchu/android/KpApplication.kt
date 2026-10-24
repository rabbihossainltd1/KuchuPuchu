package app.kuchupuchu.android

import android.app.Application

/** FCM can start a process without ever creating MainActivity. No network here. */
class KpApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        runCatching { KpPush.restoreFirebase(this) }
        runCatching { KpNotify.ensureChannels(this) }
    }
}
