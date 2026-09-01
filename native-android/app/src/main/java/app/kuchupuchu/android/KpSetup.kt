package app.kuchupuchu.android

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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

    private const val PREFS = "kp"
    private const val KEY_NAG_TS = "bg_nag_ts"
    private const val KEY_MUTED = "bg_nag_muted"
    private const val NAG_INTERVAL_MS = 3L * 24 * 3600_000L

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

    /**
     * Should the cold-start nudge fire? Only while actually crippled; after a
     * tap it waits three days instead of latching off forever, and a "don't ask
     * again" answer is honoured for good.
     */
    fun shouldNag(ctx: Context): Boolean {
        if (!needsSetup(ctx)) {
            // Healthy now — drop the counter so a later ROM reset re-arms it.
            prefs(ctx).edit().remove(KEY_NAG_TS).apply()
            return false
        }
        val p = prefs(ctx)
        if (p.getBoolean(KEY_MUTED, false)) return false
        val last = p.getLong(KEY_NAG_TS, 0L)
        return last == 0L || System.currentTimeMillis() - last > NAG_INTERVAL_MS
    }

    fun markNagged(ctx: Context) = prefs(ctx).edit().putLong(KEY_NAG_TS, System.currentTimeMillis()).apply()

    fun muteForever(ctx: Context) = prefs(ctx).edit().putBoolean(KEY_MUTED, true).apply()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

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

/**
 * The cold-start nudge. Explains the consequence (not the theory) and offers
 * the two real switches; every button opens a system page, so it can be
 * verified on a device instead of trusting the app.
 */
@Composable
fun KpSetupDialog(onDismiss: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Filled.Info, contentDescription = null, tint = GoldDeep) },
        title = { Text("Messages may not arrive", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink) },
        text = {
            Column {
                Text(
                    "Your phone is putting KuchuPuchu to sleep, so chats and calls only " +
                        "show up after you open the app. Two switches fix it:",
                    fontSize = 14.sp,
                    color = Ink,
                )
                Spacer(Modifier.height(10.dp))
                BulletRow("1", "Allow auto launch")
                BulletRow("2", "Allow background activity  /  No restrictions")
                Spacer(Modifier.height(10.dp))
                Text(
                    "KuchuPuchu: ${KpSetup.statusText(ctx)}",
                    fontSize = 12.sp,
                    color = Muted,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    KpSetup.openFixIt(ctx)
                    KpSetup.markNagged(ctx)
                    onDismiss()
                },
            ) { Text("Open settings", color = GoldDeep, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { KpSetup.muteForever(ctx); onDismiss() }) {
                    Text("Don't ask", color = Muted, fontSize = 13.sp)
                }
                TextButton(onClick = onDismiss) { Text("Later", color = Muted, fontSize = 13.sp) }
            }
        },
    )
}

@Composable
private fun BulletRow(index: String, label: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            index,
            fontSize = 12.sp,
            color = Color.White,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .width(20.dp)
                .height(20.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(GoldDeep)
                .padding(top = 2.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(label, fontSize = 14.sp, color = Ink, modifier = Modifier.weight(1f))
    }
}
