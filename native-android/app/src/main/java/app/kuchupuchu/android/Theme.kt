package app.kuchupuchu.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density

/* ---- KuchuPuchu v3 design tokens (locked: Chat List #7 "Gradient Rings") ---- */

val Cream = Color(0xFFF7F6F4)      // app background
val Card = Color(0xFFFFFFFF)       // white cards, 16dp radius
val Ink = Color(0xFF1C1917)        // primary text
val Muted = Color(0xFF7A6F63)      // secondary text
val Line = Color(0xFFE8E4DE)       // hairlines / card borders
val Gold = Color(0xFFF59E0B)       // primary amber
val GoldLight = Color(0xFFFDE68A)  // gradient ring start
val GoldDeep = Color(0xFFB45309)   // pressed / emphasized amber text
val GoldSoft = Color(0xFFFEF3C7)   // soft amber fills
val AmberInk = Color(0xFFFFFBEB)   // on-gold text
val Green = Color(0xFF16A34A)      // accept / online
val Red = Color(0xFFDC2626)        // end / decline
val Dark = Color(0xFF171412)       // call screens dark bg
val DarkCard = Color(0xFF242019)   // call screens sheet

/** The signature amber ring gradient around avatars / status circles. */
fun goldRing(): Brush = Brush.linearGradient(listOf(GoldLight, Gold))

fun goldFill(): Brush = Brush.linearGradient(listOf(Gold, GoldDeep))

@Composable
fun KpTheme(content: @Composable () -> Unit) {
    val d = LocalDensity.current
    CompositionLocalProvider(
        LocalDensity provides Density(density = d.density * 1.16f, fontScale = d.fontScale * 1.08f),
    ) {
        MaterialTheme(
            colorScheme = lightColorScheme(
                primary = Gold,
                onPrimary = AmberInk,
                secondary = GoldDeep,
                background = Cream,
                surface = Card,
                onBackground = Ink,
                onSurface = Ink,
                outline = Line,
            ),
            content = content,
        )
    }
}

/* ---- small formatting helpers ---- */

fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (parts.isEmpty()) return "?"
    if (parts.size == 1) return parts[0].take(1).uppercase()
    return (parts[0].take(1) + parts[1].take(1)).uppercase()
}

/** Chat-list style timestamp: 14:05 / Yesterday / Mon / 12 Aug — always in
 *  Bangladesh Standard Time (owner rule): Asia/Dhaka, UTC+6, no DST, whatever
 *  the device's timezone happens to be. */
fun listStamp(iso: String): String {
    if (iso.isBlank()) return ""
    val t = try {
        java.time.Instant.parse(iso)
    } catch (e: Exception) {
        return ""
    }
    val dhaka = java.time.ZoneId.of("Asia/Dhaka")
    val now = java.time.ZonedDateTime.now(dhaka)
    val z = t.atZone(dhaka)
    return when {
        z.toLocalDate() == now.toLocalDate() ->
            String.format("%02d:%02d", z.hour, z.minute)
        z.toLocalDate() == now.toLocalDate().minusDays(1) -> "Yesterday"
        now.toLocalDate().toEpochDay() - z.toLocalDate().toEpochDay() < 7 ->
            z.dayOfWeek.toString().take(3).let { d -> d[0].toString() + d.substring(1).lowercase() }
        else -> "${z.dayOfMonth} ${z.month.toString().take(3).let { m -> m[0] + m.substring(1).lowercase() }}"
    }
}
