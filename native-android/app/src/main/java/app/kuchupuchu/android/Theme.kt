package app.kuchupuchu.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Ink = Color(0xFF1C1917)
val Muted = Color(0xFF6B6560)
val Line = Color(0xFFE8E4DE)
val Bg = Color(0xFFF7F6F4)
val FeedBg = Color(0xFFF0EEEA)
val Surface = Color(0xFFFFFFFF)
val Accent = Color(0xFFB45309)
val AccentInk = Color(0xFFFFFBEB)
val AccentSoft = Color(0xFFFEF3C7)
val AccentDeep = Color(0xFF92400E)
val Green = Color(0xFF3F6212)
val Rose = Color(0xFF9F1239)
val DangerSoft = Color(0xFFFFE4E6)
val Stone = Color(0xFF44403C)
val CallInk = Color(0xFF1C1917)

@Composable
fun KpTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Accent,
            onPrimary = AccentInk,
            background = Bg,
            surface = Surface,
            onBackground = Ink,
            onSurface = Ink,
        ),
        content = content,
    )
}

fun timeAgo(iso: String): String {
    if (iso.isBlank()) return ""
    val t =
        try {
            java.time.Instant.parse(iso.replace(" ", "T").let { if (it.endsWith("Z") || it.contains("+")) it else it + "Z" }).toEpochMilli()
        } catch (_: Exception) {
            iso.toLongOrNull() ?: return iso.take(16)
        }
    val sec = ((System.currentTimeMillis() - t).coerceAtLeast(0)) / 1000
    if (sec < 45) return "just now"
    val min = sec / 60
    if (min < 60) return "${min}m"
    val hr = min / 60
    if (hr < 24) return "${hr}h"
    val day = hr / 24
    if (day < 7) return "${day}d"
    return iso.take(10)
}

fun lastSeen(iso: String, online: Boolean): String {
    if (online) return "Active now"
    if (iso.isBlank()) return "Offline"
    val label = timeAgo(iso)
    return if (label == "just now") "Last seen just now" else "Last seen $label ago"
}

fun parseIso(iso: String): Long? {
    val clean = iso.trim().replace(" ", "T").removeSuffix("Z").substringBefore("+").substringBefore(".")
    val patterns = arrayOf("yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd")
    for (p in patterns) {
        try {
            val sdf = java.text.SimpleDateFormat(p, java.util.Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            val d = sdf.parse(clean)
            if (d != null) return d.time
        } catch (_: Exception) {
        }
    }
    return iso.toLongOrNull()
}

val STICKERS =
    listOf(
        "fire" to "Fire",
        "heart" to "Heart",
        "like" to "Like",
        "gg" to "GG",
        "cry" to "Cry",
        "rage" to "Rage",
        "star" to "Star",
        "party" to "Party",
        "love" to "Love",
        "clutch" to "Clutch",
    )
