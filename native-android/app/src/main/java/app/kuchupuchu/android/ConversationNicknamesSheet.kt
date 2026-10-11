package app.kuchupuchu.android

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private data class ChatNicknameMember(
    val id: String,
    val displayName: String,
    val nickname: String,
)

/** Conversation-scoped nickname editor, opened from a profile screen's ⋮ menu. */
@Composable
internal fun ConversationNicknamesSheet(
    conversationId: String,
    conversation: JSONObject?,
    meId: String,
    onDismiss: () -> Unit,
    onSaved: (JSONObject) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val members = remember(conversationId, conversation?.toString(), meId) {
        val result = mutableListOf<ChatNicknameMember>()
        if (conversation?.optBoolean("isGroup") == true) {
            val rows = conversation.optJSONArray("members")
            if (rows != null) for (index in 0 until rows.length()) {
                val user = rows.optJSONObject(index)?.optJSONObject("user") ?: continue
                val id = user.optString("id")
                if (id.isBlank() || id == meId) continue
                result += ChatNicknameMember(
                    id = id,
                    displayName = user.optText("displayName").ifBlank { user.optText("username") },
                    nickname = user.optText("nickname"),
                )
            }
        } else {
            val user = conversation?.optJSONObject("other")
            val id = user?.optString("id").orEmpty()
            if (user != null && id.isNotBlank() && id != meId) {
                result += ChatNicknameMember(
                    id = id,
                    displayName = user.optText("displayName").ifBlank { user.optText("username") },
                    nickname = user.optText("nickname"),
                )
            }
        }
        result
    }
    var target by remember(conversationId) { mutableStateOf<ChatNicknameMember?>(null) }
    var draft by remember(conversationId) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    fun saveNickname(rawValue: String) {
        val current = target ?: return
        if (busy) return
        val value = rawValue.trim().take(40)
        scope.launch {
            busy = true
            error = ""
            try {
                val path = "/api/conversations/${Uri.encode(conversationId)}/nicknames/${Uri.encode(current.id)}"
                val response = withContext(Dispatchers.IO) {
                    if (value.isBlank()) Api.delete(path)
                    else Api.put(path, JSONObject().put("nickname", value))
                }
                response.optJSONObject("conversation")?.let(onSaved)
                ScreenStore.pokeInbox()
                target = null
                draft = ""
            } catch (failure: Exception) {
                error = failure.message?.takeIf { it.isNotBlank() } ?: "Could not save the nickname."
            } finally {
                busy = false
            }
        }
    }

    KpSheet(onDismiss = { if (!busy) onDismiss() }, title = if (target == null) "Nicknames" else "Nickname") {
        if (target == null) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp)) {
                Text(
                    "Aliases are shared only with people in this chat; profile names stay unchanged.",
                    color = Muted,
                    fontSize = 12.5.sp,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                if (members.isEmpty()) {
                    Text("No other chat members are available.", color = Muted, fontSize = 13.sp)
                }
            }
            members.forEach { member ->
                KpSheetRow(
                    Icons.Filled.Edit,
                    if (member.nickname.isNotBlank() && member.displayName != member.nickname) {
                        "${member.displayName} · ${member.nickname}"
                    } else {
                        member.displayName
                    },
                ) {
                    target = member
                    draft = member.nickname
                    error = ""
                }
            }
        } else {
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp).imePadding()) {
                Text("For ${target?.displayName ?: "this member"} in this chat.", color = Muted, fontSize = 12.5.sp)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(40) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
                    singleLine = true,
                    enabled = !busy,
                    shape = RoundedCornerShape(14.dp),
                    label = { Text("Nickname") },
                    placeholder = { Text(target?.displayName.orEmpty()) },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = ActionBlue,
                        unfocusedBorderColor = Line,
                        cursorColor = ActionBlue,
                        focusedTextColor = Ink,
                        unfocusedTextColor = Ink,
                    ),
                )
                if (error.isNotBlank()) {
                    Text(error, color = Red, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                }
                Spacer(Modifier.height(10.dp))
                GoldBtn(
                    "Save",
                    Modifier.fillMaxWidth(),
                    enabled = !busy && draft.trim().isNotBlank(),
                ) { saveNickname(draft) }
                if (target?.nickname?.isNotBlank() == true) {
                    KpSheetRow(null, "Clear nickname", tint = Red) { saveNickname("") }
                }
                KpSheetRow(null, "Cancel") { if (!busy) target = null }
            }
        }
    }
}
