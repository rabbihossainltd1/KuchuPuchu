package app.kuchupuchu.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.concurrent.ConcurrentHashMap

/**
 * Shared image helpers. Avatars are data-URLs the worker stores inline, so
 * decoding them once into a memory map is cheap and offline-friendly.
 */
object Bitmaps {
    private val mem = ConcurrentHashMap<String, Bitmap>()

    fun load(url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        mem[url]?.let { return it }
        val bmp = decode(url) ?: return null
        if (mem.size > 60) mem.clear()
        mem[url] = bmp
        return bmp
    }

    private fun decode(url: String): Bitmap? = runCatching {
        if (url.startsWith("data:")) {
            val b64 = url.substringAfter(",", "")
            if (b64.isBlank()) null else BitmapFactory.decodeByteArray(Base64.decode(b64, Base64.DEFAULT), 0, b64.length)
        } else if (url.startsWith("http")) {
            val bytes = Api.download(url)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } else null
    }.getOrNull()
}

@Composable
fun rememberBitmap(url: String?): ImageBitmap? {
    val state = remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) {
        if (url.isNullOrBlank()) return@LaunchedEffect
        val bmp = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Bitmaps.load(url) }
        state.value = bmp?.asImageBitmap()
    }
    return state.value
}

/**
 * The signature avatar: amber gradient ring (locked Chat List #7 look)
 * with initials or photo inside.
 */
@Composable
fun KpAvatar(
    name: String,
    url: String?,
    size: Dp,
    ring: Boolean = true,
    ringWidth: Dp = 2.5.dp,
) {
    val bmp = rememberBitmap(url)
    val inner = size - if (ring) ringWidth * 2 else 0.dp
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        if (ring) {
            Box(
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(goldRing()),
            )
        }
        Box(
            Modifier
                .size(inner)
                .clip(CircleShape)
                .background(Cream),
            contentAlignment = Alignment.Center,
        ) {
            if (bmp != null) {
                Image(
                    bmp,
                    contentDescription = name,
                    modifier = Modifier.size(inner),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Text(
                    initials(name),
                    fontSize = (inner.value * 0.38f).sp,
                    fontWeight = FontWeight.SemiBold,
                    color = GoldDeep,
                )
            }
        }
    }
}

/** Solid gold pill button — the app's primary action. */
@Composable
fun GoldBtn(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
            containerColor = Gold,
            contentColor = AmberInk,
        ),
    ) {
        Text(text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** Quiet circular icon button used in top bars. */
@Composable
fun IconBtn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    tint: androidx.compose.ui.graphics.Color = Ink,
    size: Dp = 26.dp,
    onClick: () -> Unit,
) {
    androidx.compose.material3.IconButton(onClick = onClick) {
        androidx.compose.material3.Icon(
            icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(size),
        )
    }
}
