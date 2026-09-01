package app.kuchupuchu.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-registers the push token after OS events that orphan it.
 *
 * Why: the tester's "updated the APK, never opened the app, nothing arrived
 * (message showed delivered, call stuck on calling)" case is Android's
 * force-stop-on-update behaviour — a package replace puts FLAG_STOPPED on the
 * app, and while that flag is set FCM will not wake the process, so the push is
 * queued and only appears the moment the app is launched. This receiver is the
 * one thing that still runs in that window (MY_PACKAGE_REPLACED is exempt from
 * the stopped-package filter), so the registration is refreshed instead of
 * waiting for the user. Same story for a reboot with autostart disabled.
 *
 * It deliberately starts no service: starting a foreground service from a
 * boot/replace broadcast is not an Android 12+ exemption, and the app ships no
 * background service at all (the keep-alive FGS was removed — see the manifest
 * note over KpPushService).
 */
class KpWakeupReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // The token string usually survives an update, and registerToken()
            // skips a repeat when its cached value matches — but the device row
            // is what matters, so force one POST after a replace.
            runCatching {
                app.getSharedPreferences("kp_push", Context.MODE_PRIVATE).edit().remove("registered").apply()
            }
        }
        runCatching { KpPush.boot(app) }
    }
}
