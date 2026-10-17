package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

fun originRealmOf(value: String?): String? = when (value?.lowercase()) {
    "kp" -> "kp"
    "vx" -> "vx"
    else -> null
}

fun realmOf(value: JSONObject?): String? = originRealmOf(
    value?.optString("originRealm")?.ifBlank { value.optString("origin_realm") },
)

/** System-issued account-origin badge; callers cannot choose its value. */
@Composable
fun RealmBadge(realm: String?, height: Dp = 14.dp) {
    val label = when (realm) {
        "kp" -> "KP"
        "vx" -> "VX"
        else -> return
    }
    Text(
        text = label,
        color = ActionBlueInk,
        fontSize = (height.value * 0.60f).sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .background(ActionBlue.copy(alpha = 0.16f), RoundedCornerShape(50))
            .padding(horizontal = (height.value * 0.35f).dp, vertical = (height.value * 0.10f).dp),
    )
}
