package app.kuchupuchu.android

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * r76-26 (owner: "logout kore app delete kore abar install korle ba onno
 * phone a login korle purono message gulate lock emoji dekhai ... readable
 * thakte hobe"; method: WhatsApp-style passphrase, the owner's pick):
 *
 *  - Settings › Privacy › "Message key backup" locks the CURRENT message
 *    identity under a passphrase and stores the sealed blob on the server
 *    (the server holds ciphertext it cannot open — the old plaintext
 *    auto-upload is retired);
 *  - a fresh install that finds a locked backup shows [E2eeRestoreGate]:
 *    the passphrase unlocks the history (old rows unseal on the spot), and
 *    until then the app runs on a fresh keypair so sending never waits.
 */

/* ---------------- Settings › Privacy › sheet ---------------- */

@Composable
fun KeyBackupSheet(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    // null = still asking the server.
    var remote by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var passDialog by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { remote = E2eeMsg.remoteBackup() }

    KpSheet(onDismiss = onClose, title = "Message key backup") {
        Text(
            when {
                remote == null -> "Checking…"
                remote!!.startsWith("KP2.") -> "On — locked with your passphrase"
                remote!!.isNotBlank() -> "On — upgrading needs a passphrase"
                else -> "Off"
            },
            color = Muted,
            fontSize = 12.5.sp,
            modifier = Modifier.padding(horizontal = 14.dp).padding(bottom = 4.dp),
        )
        KpSheetRow(Icons.Filled.Key, if (remote.isNullOrBlank()) "Set backup passphrase" else "Change passphrase") {
            passDialog = true
        }
        if (!remote.isNullOrBlank()) {
            KpSheetRow(Icons.Filled.Delete, "Delete backup", tint = Red) { confirmDelete = true }
        }
        Text(
            "Your passphrase seals the key that opens your message history. On a new phone (or after a reinstall) it unlocks every old message. If you forget it, locked messages cannot be recovered.",
            color = Muted,
            fontSize = 11.5.sp,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }

    if (passDialog) {
        PassphraseDialog(
            title = if (remote.isNullOrBlank()) "Set backup passphrase" else "Change passphrase",
            confirmLabel = "Save",
            busy = busy,
            onClose = { passDialog = false },
            onDone = { pass ->
                busy = true
                scope.launch {
                    val ok = E2eeMsg.uploadLockedBackup(ctx, pass)
                    busy = false
                    if (ok) {
                        android.widget.Toast.makeText(ctx, "Backup saved", android.widget.Toast.LENGTH_SHORT).show()
                        remote = E2eeMsg.remoteBackup()
                        passDialog = false
                    } else {
                        android.widget.Toast.makeText(ctx, "Could not reach the server", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
            },
        )
    }

    if (confirmDelete) {
        KpConfirmSheet(
            title = "Delete the backup?",
            confirmLabel = "Delete",
            danger = true,
            onDismiss = { confirmDelete = false },
            onConfirm = {
                confirmDelete = false
                scope.launch {
                    val ok = E2eeMsg.deleteBackup()
                    android.widget.Toast.makeText(
                        ctx,
                        if (ok) "Backup deleted" else "Could not reach the server",
                        android.widget.Toast.LENGTH_SHORT,
                    ).show()
                    if (ok) remote = ""
                }
            },
        )
    }
}

/* ---------------- the shared passphrase field ---------------- */

@Composable
internal fun PassphraseDialog(
    title: String,
    confirmLabel: String,
    busy: Boolean,
    error: String? = null,
    onClose: () -> Unit,
    onDone: (String) -> Unit,
) {
    var pass by remember { mutableStateOf("") }
    // The sheet kit, like every other ask in the app (no AlertDialog — r31-7).
    KpSheet(onDismiss = onClose, title = title) {
        OutlinedTextField(
            value = pass,
            onValueChange = { pass = it },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            label = { Text("Passphrase") },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp),
        )
        if (pass.isNotBlank() && pass.length < 6) {
            Text("At least 6 characters", color = Red, fontSize = 11.5.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
        }
        error?.let {
            Text(it, color = Red, fontSize = 11.5.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
        }
        Spacer(Modifier.height(6.dp))
        if (busy) {
            CircularProgressIndicator(
                color = ActionBlueDeep,
                strokeWidth = 2.dp,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp).size(22.dp),
            )
        } else {
            KpSheetRow(icon = null, label = confirmLabel, tint = ActionBlueDeep) {
                if (pass.length >= 6) onDone(pass)
            }
        }
        KpSheetRow(icon = null, label = "Cancel") { onClose() }
    }
}

/* ---------------- the new-phone restore prompt ---------------- */

/**
 * Mounted by the chat list. While the server holds a locked backup this
 * install cannot open, the gate asks for the passphrase — once per launch
 * ("Later" silences it until the next open), and a wrong answer stays on
 * the dialog with its reason instead of failing silently.
 */
@Composable
fun E2eeRestoreGate() {
    val ctx = LocalContext.current
    var pend by remember { mutableStateOf(E2eeMsg.pendingRestore) }
    var dismissed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // ensurePublished (app entry) may still be in flight when the list draws.
    LaunchedEffect(Unit) {
        while (pend == null) {
            delay(3_000)
            pend = E2eeMsg.pendingRestore
        }
    }
    if (pend != null && !dismissed) {
        PassphraseDialog(
            title = "Unlock your old messages",
            confirmLabel = "Unlock",
            busy = busy,
            error = error,
            onClose = { dismissed = true },
            onDone = { pass ->
                busy = true
                error = null
                val ok = withContext(Dispatchers.IO) { E2eeMsg.tryRestore(ctx, pass) }
                busy = false
                if (ok) {
                    pend = null
                    android.widget.Toast.makeText(ctx, "Old messages unlocked", android.widget.Toast.LENGTH_SHORT).show()
                } else {
                    error = "Wrong passphrase — try again"
                }
            },
        )
    }
}
