package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Owner round 31 (item 31): the status media picker is the app's OWN gallery
 * — the same device pool, folder chips and 4-column cells as the chat attach
 * panel — not the system picker. One tap on a photo or a video opens the
 * share screen (StatusPhotoScreen) with that item; nothing is posted here.
 */
@Composable
fun StatusPickScreen(nav: NavController) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    var canRead by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var pool by remember { mutableStateOf(listOf<MediaItem>()) }
    var folder by remember { mutableStateOf<String?>(null) }

    fun hasRead(): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }

    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            canRead = hasRead()
            if (!canRead) loaded = true
        }

    LaunchedEffect(Unit) {
        canRead = hasRead()
        if (!canRead) {
            permission.launch(
                if (Build.VERSION.SDK_INT >= 33) {
                    arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
                } else {
                    arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                },
            )
        }
    }

    LaunchedEffect(canRead) {
        if (!canRead) return@LaunchedEffect
        pool = withContext(Dispatchers.IO) { runCatching { loadMediaPool(ctx) }.getOrDefault(emptyList()) }
        loaded = true
    }

    val buckets =
        remember(pool) {
            pool.groupBy { it.bucket }
                .map { (name, items) -> Triple(name, items.size, items.maxOf { it.added }) }
                .sortedByDescending { it.third }
        }
    val shown = if (folder == null) pool else pool.filter { it.bucket == folder }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.Filled.Close, "Close", tint = Ink)
            }
            Text(folder ?: "Recent", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        }

        if (buckets.size > 1) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val all = listOf("All" to pool.size)
                (all + buckets.map { it.first to it.second }).forEach { (name, count) ->
                    val selected = (folder == null && name == "All") || folder == name
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (selected) ChipSelected else ChipIdle)
                            .clickable {
                                haptics.tap()
                                folder = if (name == "All") null else name
                            }
                            .padding(horizontal = 12.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            name,
                            color = if (selected) ActionBlueDeep else Muted,
                            fontSize = 12.5.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        )
                        Text("  $count", color = Muted, fontSize = 11.sp)
                    }
                }
            }
        }

        when {
            !loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ActionBlue)
            }
            !canRead -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                GoldBtn("Allow gallery") { openAppSettingsPage(ctx) }
            }
            shown.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No media", color = Muted, fontSize = 14.sp)
            }
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 2.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(shown, key = { it.uri.toString() }) { item ->
                    MediaCell(
                        item,
                        ctx,
                        selected = false,
                        selectIndex = 0,
                        onToggle = {
                            haptics.tap()
                            // One tap = straight to the share screen with this item.
                            nav.navigate("statusphoto/" + statusPickArg(item)) {
                                popUpTo("statuspick") { inclusive = true }
                            }
                        },
                    )
                }
            }
        }
    }
}

/** Uri + kind → one URL-safe route argument for `statusphoto/{arg}`. */
internal fun statusPickArg(item: MediaItem): String =
    android.util.Base64.encodeToString(
        ((if (item.isVideo) "v:" else "i:") + item.uri.toString()).toByteArray(),
        android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
    )

/** Back from the route argument: (uri, isVideo), or null when there is none. */
internal fun statusPickDecode(arg: String): Pair<android.net.Uri, Boolean>? =
    runCatching {
        val raw = String(
            android.util.Base64.decode(arg, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP),
            Charsets.UTF_8,
        )
        if (raw.length < 3) return null
        android.net.Uri.parse(raw.substring(2)) to raw.startsWith("v:")
    }.getOrNull()

private fun openAppSettingsPage(ctx: android.content.Context) {
    runCatching {
        ctx.startActivity(
            android.content.Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:" + ctx.packageName),
            ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
