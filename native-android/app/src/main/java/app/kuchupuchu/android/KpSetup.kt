package app.kuchupuchu.android

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * OEM "keep running" setup.
 *
 * Device evidence that made this necessary: a fresh install on the tester's
 * phone showed MIUI/HyperOS "Allow background activity" OFF and "Allow auto
 * launch" OFF (see the Power consumption controls screenshot). With either one
 * off the launcher freezes the whole process the moment the app leaves the
 * foreground — and every message and every ring reaches this app as a DATA-only
 * push (deliberate: a data push is what lets our own Reply / Accept / Decline
 * card be drawn and retracted). A frozen process never runs
 * FirebaseMessagingService, so nothing shows until the app is opened again.
 * That is the "background notification ashe na" report; the worker is not
 * involved — the push is sent and FCM accepts it.
 *
 * Neither switch can be enabled by the app: Android exposes only the battery
 * exemption dialog (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which is what
 * "Allow background activity" is wired to) and MIUI's autostart page has no
 * public API at all. So the job here is to detect the crippled state honestly
 * and deep-link the user to the exact page.
 *
 * The first attempt (MainActivity.askBackgroundPermissions) was wrong in a way
 * that produced exactly this bug report: it set a `bg_asked` flag BEFORE
 * checking whether anything was granted, and gated the MIUI autostart page on
 * isIgnoringBatteryOptimizations() being true. On HyperOS the Google dialog can
 * be answered and the app can still end up restricted, so the app asked once,
 * never asked again, and never showed the autostart page at all. Now the nudge
 * re-arms while the device really is restricting us, and stops by itself the
 * moment the state is healthy.
 */
object KpSetup {

    /** True when the user (or the ROM) put us in the "Restricted" background bucket. */
    fun backgroundRestricted(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= 28 &&
            runCatching {
                (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isBackgroundRestricted
            }.getOrDefault(false)

    /** False while Doze/App-standby may delay our pushes. */
    fun ignoresBattery(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 23 ||
            runCatching {
                (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .isIgnoringBatteryOptimizations(ctx.packageName)
            }.getOrDefault(true)

    fun needsSetup(ctx: Context): Boolean = backgroundRestricted(ctx) || !ignoresBattery(ctx)

    fun isMiui(): Boolean {
        val maker = Build.MANUFACTURER.lowercase()
        if (maker == "xiaomi" || maker == "redmi" || maker == "poco" || maker == "blackshark") return true
        return runCatching { Build.DISPLAY.lowercase().contains("miui") }.getOrDefault(false)
    }

    /** One-line state for the Settings row / dialog. */
    fun statusText(ctx: Context): String {
        val bg = if (backgroundRestricted(ctx)) "background: restricted" else "background: allowed"
        val battery = if (ignoresBattery(ctx)) "battery: unrestricted" else "battery: optimised"
        return if (needsSetup(ctx)) "$bg, $battery — messages may be delayed" else "$bg, $battery"
    }

    /** The system dialog that flips "Allow background activity" to on. */
    fun openBatteryExemption(ctx: Context): Boolean =
        launch(
            ctx,
            Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${ctx.packageName}"),
            ),
        )

    /** The per-app page in the screenshot: Power consumption controls / Battery. */
    fun openAppDetails(ctx: Context): Boolean =
        launch(
            ctx,
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")),
        )

    /** MIUI's autostart list; the only place "Allow auto launch" lives. */
    fun openAutostart(ctx: Context): Boolean {
        val candidates =
            listOf(
                // Global autostart manager (HyperOS/MIUI 12+).
                Intent("miui.intent.action.OP_AUTO_START"),
                Intent().setClassName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity",
                ),
                // Older MIUI: the per-app permission editor holds both switches.
                Intent("miui.intent.action.APP_PERM_EDITOR")
                    .setClassName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.permissions.PermissionsEditorActivity",
                    )
                    .putExtra("extra_pkgname", ctx.packageName),
                Intent("miui.intent.action.APP_PERM_EDITOR")
                    .putExtra("extra_pkgname", ctx.packageName),
            )
        return candidates.any { launch(ctx, it) }
    }

    /** Best available single tap: autostart page on MIUI, else the exemption dialog. */
    fun openFixIt(ctx: Context) {
        if (isMiui() && openAutostart(ctx)) return
        if (openBatteryExemption(ctx)) return
        openAppDetails(ctx)
    }

    private fun launch(ctx: Context, intent: Intent): Boolean =
        runCatching {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            true
        }.getOrDefault(false)
}
