package app.kuchupuchu.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.json.JSONObject

fun originRealmOf(value: String?): String? = when (value?.lowercase()) {
    "kp" -> "kp"
    "vx" -> "vx"
    else -> null
}

fun realmOf(value: JSONObject?): String? = originRealmOf(
    value?.optString("originRealm")?.ifBlank { value.optString("origin_realm") },
)

/** Original owner-supplied artwork rasterized without changing its design. */
@Composable
fun RealmBadge(realm: String?, height: Dp = 16.dp) {
    val resource = when (realm) {
        "kp" -> R.drawable.realm_badge_kp
        "vx" -> R.drawable.realm_badge_vx
        else -> return
    }
    Image(
        painter = painterResource(resource),
        contentDescription = "${realm.uppercase()} account origin",
        modifier = Modifier.size(height),
    )
}
