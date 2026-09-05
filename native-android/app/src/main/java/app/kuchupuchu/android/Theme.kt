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

/**
 * Owner round 13b hotfix (2026-09-05): the first dark-blue cut backed every
 * color token with a SNAPSHOT state read — thousands of subscribed reads per
 * frame read as whole-app lag on device. The palette is now STATIC: one plain
 * @Volatile flag read at load, tokens are plain getters again, and switching
 * the theme simply recreates the activity so every screen re-skins cleanly.
 */
object KpThemeMode {
    @Volatile
    var darkBlue: Boolean = true

    private const val PREF = "app_theme"

    fun load(ctx: android.content.Context) {
        darkBlue = ctx.getSharedPreferences("kp", 0).getString(PREF, "dark_blue") != "light"
    }

    fun set(ctx: android.content.Context, dark: Boolean) {
        darkBlue = dark
        ctx.getSharedPreferences("kp", 0).edit().putString(PREF, if (dark) "dark_blue" else "light").apply()
    }
}

val Cream: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFF0D1524) else Color(0xFFF7F6F4) // app background
val Card: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFF16213A) else Color(0xFFFFFFFF) // cards, 16dp radius
val Ink: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFFE9EDF6) else Color(0xFF1C1917) // primary text
val Muted: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFF8A97B2) else Color(0xFF7A6F63) // secondary text
val Line: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFF233150) else Color(0xFFE8E4DE) // hairlines / borders
val Gold = Color(0xFFF59E0B)       // primary amber
val GoldLight = Color(0xFFFDE68A)  // gradient ring start
val GoldDeep: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFFF5A623) else Color(0xFFB45309) // emphasized amber
val GoldSoft: Color
    get() = if (KpThemeMode.darkBlue) Color(0xFF2A2C3D) else Color(0xFFFEF3C7) // soft amber fills
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

/** The app-wide clock: Bangladesh Standard Time (owner rule) — Asia/Dhaka,
 *  UTC+6, no DST. Every user-visible timestamp formats in BST regardless of
 *  the device's timezone setting. */
val DHAKA: java.time.ZoneId = java.time.ZoneId.of("Asia/Dhaka")

fun atDhaka(instant: java.time.Instant): java.time.ZonedDateTime = instant.atZone(DHAKA)

fun dhakaNow(): java.time.ZonedDateTime = java.time.ZonedDateTime.now(DHAKA)

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
    val now = dhakaNow()
    val z = atDhaka(t)
    return when {
        z.toLocalDate() == now.toLocalDate() ->
            String.format("%02d:%02d", z.hour, z.minute)
        z.toLocalDate() == now.toLocalDate().minusDays(1) -> "Yesterday"
        now.toLocalDate().toEpochDay() - z.toLocalDate().toEpochDay() < 7 ->
            z.dayOfWeek.toString().take(3).let { d -> d[0].toString() + d.substring(1).lowercase() }
        else -> "${z.dayOfMonth} ${z.month.toString().take(3).let { m -> m[0] + m.substring(1).lowercase() }}"
    }
}
