package app.kuchupuchu.android

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

/**
 * Phone auth §14 — the IN-APP half of new-device login approval.
 *
 * The push notification is only a doorbell: it can be dismissed, swallowed by
 * an OEM, or (as reported) tapped with nothing wired to the tap. So the app
 * itself keeps a source of truth:
 *
 *  - KpPushService offers an arriving login_request here immediately when the
 *    app is in the foreground (no notification noise while looking at the app).
 *  - KpApp polls GET /api/auth/login/pending every few seconds while signed
 *    in, which also covers a tapped/dismissed/missed notification — tapping
 *    the card opens the app and this dialog appears within one poll.
 *
 * Accept/Decline hit the same authenticated endpoints the notification
 * buttons use; the worker stays the only decision maker (§19).
 */
object LoginApprovals {

    /** The PENDING login request to show, or null. */
    val pending = MutableStateFlow<JSONObject?>(null)

    /** A login_request push arrived while the user is in the app. */
    fun offer(requestId: String, newDeviceId: String?, deviceName: String?) {
        pending.value =
            JSONObject()
                .put("id", requestId)
                .put("newDeviceId", newDeviceId ?: "")
                .put("deviceName", deviceName ?: "")
    }

    /** One round trip to the worker; replaces/clears the dialog to match. */
    fun refresh() {
        if (!Store.authed.value) return
        runCatching {
            val r = Api.get("/api/auth/login/pending", force = true)
            pending.value = r.optJSONObject("request")
        }
    }

    /** Answer the request off the UI thread, then close the dialog. */
    fun respond(ctx: Context, requestId: String, approve: Boolean) {
        Api.loadToken(ctx)
        Thread {
            runCatching {
                Api.post(
                    if (approve) "/api/auth/login/approve" else "/api/auth/login/decline",
                    JSONObject().put("id", requestId),
                )
            }
            KpNotify.cancelLoginCard(ctx)
            pending.value = null
        }.start()
    }
}

/** Shown above everything while signed in and a login request is pending. */
@Composable
fun LoginApprovalGate() {
    val req by LoginApprovals.pending.collectAsState()
    val current = req ?: return
    val ctx = LocalContext.current
    var busy by remember { mutableStateOf(false) }
    val deviceName = current.optString("deviceName").takeIf { it.isNotBlank() } ?: "Another device"
    AlertDialog(
        onDismissRequest = {
            // Back/click-outside just hides the dialog; the notification and
            // the next poll cycle both bring it back until it is answered.
            if (!busy) LoginApprovals.pending.value = null
        },
        title = { Text("New login attempt") },
        text = {
            Column {
                Text(
                    "$deviceName wants to sign in to KuchuPuchu with your phone number.",
                    fontSize = 14.sp,
                )
                Spacer(Modifier.height(6.dp))
                Text("If this wasn't you, tap Decline.", fontSize = 12.sp, color = Muted)
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    busy = true
                    LoginApprovals.respond(ctx, current.optString("id"), true)
                },
                enabled = !busy,
            ) { Text("Accept", color = GoldDeep, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    busy = true
                    LoginApprovals.respond(ctx, current.optString("id"), false)
                },
                enabled = !busy,
            ) { Text("Decline", color = Red, fontWeight = FontWeight.SemiBold) }
        },
    )
}
