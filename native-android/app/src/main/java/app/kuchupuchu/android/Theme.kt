package app.kuchupuchu.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Ink = Color(0xFF1C1917)
val Muted = Color(0xFF6B6560)
val Line = Color(0xFFE7E5E4)
val Bg = Color(0xFFF7F6F4)
val Surface = Color(0xFFFFFFFF)
val Accent = Color(0xFF9A3412)
val Rose = Color(0xFFE11D48)
val Green = Color(0xFF3F6212)
val Stone = Color(0xFF44403C)
val Cream = Color(0xFFFDE68A)

@Composable
fun KpTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Ink,
            onPrimary = Color.White,
            background = Bg,
            surface = Surface,
            onBackground = Ink,
            onSurface = Ink,
        ),
        content = content,
    )
}
