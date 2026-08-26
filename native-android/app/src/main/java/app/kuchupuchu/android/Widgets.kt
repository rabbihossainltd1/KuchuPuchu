package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
fun Avatar(user: JSONObject?, size: Dp = 40.dp, onClick: (() -> Unit)? = null) {
    val name = user?.optString("displayName").orEmpty().ifBlank { "?" }
    val initial = name.take(1).uppercase()
    val photo = user?.optString("photoUrl").orEmpty()
    Box(
        Modifier.size(size)
            .clip(CircleShape)
            .background(Color(0xFFE7E5E4))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, fontWeight = FontWeight.SemiBold, fontSize = (size.value / 2.4f).sp, color = Stone)
    }
    photo // reserved for Coil later
}

@Composable
fun PlusIcon(onClick: () -> Unit) = IconBtn(Icons.Outlined.Add, onClick)

@Composable
fun PencilIcon(onClick: () -> Unit) = IconBtn(Icons.Outlined.Edit, onClick)

@Composable
fun MenuIcon(onClick: () -> Unit) = IconBtn(Icons.Outlined.Menu, onClick)

@Composable
fun CloseIcon(onClick: () -> Unit) = IconBtn(Icons.Outlined.Close, onClick)

@Composable
fun OnlineDot(online: Boolean, size: Dp = 10.dp) {
    Box(
        Modifier.size(size).clip(CircleShape).background(if (online) Color(0xFF22C55E) else Color(0xFFA8A29E))
            .border(1.5.dp, Color.White, CircleShape),
    )
}

fun JSONObject.name(): String = optString("displayName").ifBlank { "Player" }

fun JSONObject.userId(): String = optString("userId").ifBlank { optString("id") }

fun JSONObject.uid(): String = optString("username").ifBlank { userId().take(8) }

fun JSONObject.profile(): JSONObject = optJSONObject("profile") ?: this

fun JSONObject.walletBal(): Int = optJSONObject("wallet")?.optInt("balance") ?: optInt("balance")
