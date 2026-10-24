package app.kuchupuchu.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.NotificationManagerCompat

/** Reports real permission state; never claims to bypass an OEM background policy. */
@Composable
fun BackgroundDeliveryDialog(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val notifications = NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    val battery = (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager)
        .isIgnoringBatteryOptimizations(ctx.packageName)
    fun appSettings() {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
    }
    KpSheet(onDismiss = onDismiss, title = "Background delivery") {
            Text(
                "Notifications: ${if (notifications) "allowed" else "blocked"}\n" +
                    "Battery exemption: ${if (battery) "allowed" else "restricted"}\n" +
                    "Cached push configuration: ${if (KpPush.hasCachedConfig(ctx)) "available" else "not ready"}\n\n" +
                    "On Realme, also allow Auto launch and background activity in app settings. " +
                    "Your phone controls these settings. Force stop prevents delivery until you reopen the app.",
            )

            TextButton(onClick = { appSettings(); onDismiss() }) { Text("App settings") }

            TextButton(onClick = {
                runCatching {
                    ctx.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")))
                }.onFailure { appSettings() }
                onDismiss()
            }) { Text("Battery settings") }
    }
}
