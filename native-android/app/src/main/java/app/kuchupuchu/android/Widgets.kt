package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import org.json.JSONObject

@Composable
fun IconBtn(icon: ImageVector, tint: Color = Ink, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(22.dp))
    }
}

@Composable
fun PlusIcon(onClick: () -> Unit) {
    IconBtn(Icons.Outlined.Add) { onClick() }
}

@Composable
fun PencilIcon(onClick: () -> Unit) {
    IconBtn(Icons.Outlined.Edit) { onClick() }
}

@Composable
fun MenuIcon(onClick: () -> Unit) {
    IconBtn(Icons.Outlined.Menu) { onClick() }
}

@Composable
fun CloseIcon(onClick: () -> Unit) {
    IconBtn(Icons.Outlined.Close) { onClick() }
}

@Composable
fun Avatar(
    user: JSONObject?,
    size: Dp = 44.dp,
    online: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val name = user?.name().orEmpty().ifBlank { "?" }
    val initial =
        name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1) }.uppercase()
            .ifBlank { name.take(1).uppercase() }
    val photo = user?.optString("avatarUrl").orEmpty().ifBlank { user?.optString("photoUrl").orEmpty() }
    Box(
        Modifier.size(size)
            .clip(CircleShape)
            .background(AccentSoft)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (photo.isNotBlank()) {
            AsyncImage(photo, null, modifier = Modifier.size(size), contentScale = ContentScale.Crop)
        } else {
            Text(initial, fontWeight = FontWeight.Bold, fontSize = (size.value / 2.6f).sp, color = Accent)
        }
        if (online) {
            Box(
                Modifier.align(Alignment.BottomEnd).size(size * 0.28f).clip(CircleShape)
                    .background(Color(0xFF3F6212)).border(2.dp, Color.White, CircleShape),
            )
        }
    }
}

@Composable
fun AccentBtn(label: String, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(10.dp)).background(Accent).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = AccentInk, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun GhostBtn(label: String, onClick: () -> Unit) {
    Box(
        Modifier.clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Muted)
    }
}

@Composable
fun SoftCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().background(Surface).padding(14.dp),
    ) { content() }
}

@Composable
fun PersonMini(u: JSONObject, onOpen: () -> Unit, trailing: @Composable (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(u, 44.dp, online = u.optBoolean("online"))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(u.name(), fontWeight = FontWeight.SemiBold, color = Ink)
            Text("@${u.uid()}", color = Muted, fontSize = 13.sp)
        }
        if (trailing != null) trailing()
    }
}

fun JSONObject.name(): String = optString("displayName").ifBlank { "Player" }

fun JSONObject.userId(): String = optString("userId").ifBlank { optString("id") }

fun JSONObject.uid(): String = optString("username").ifBlank { userId().take(8) }

fun JSONObject.profile(): JSONObject = optJSONObject("profile") ?: this

fun JSONObject.walletBal(): Int = optJSONObject("wallet")?.optInt("balance") ?: optInt("balance")

fun JSONObject.online(): Boolean = optBoolean("online")
