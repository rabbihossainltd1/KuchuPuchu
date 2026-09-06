package app.kuchupuchu.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owner round 28: "About Us" from the home ⋮ menu. Real content only — the
 * installed build, the founder card the official chat already shows (same
 * links), the open-source repo and a live "check for updates" row.
 */
@Composable
fun AboutScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    fun open(url: String) {
        runCatching {
            ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        }
    }

    fun messageOwner() {
        // The founder's KuchuPuchu account: open (or create) the 1:1 chat.
        scope.launch {
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/users/username/rabbihossainltd", true) }
                val id = data.optJSONObject("user")?.optString("id").orEmpty()
                if (id.isBlank()) return@launch
                val cached = ScreenStore.convIdForUser[id]
                val convId =
                    cached ?: withContext(Dispatchers.IO) {
                        Api.post("/api/conversations", org.json.JSONObject().put("userId", id))
                    }.optJSONObject("conversation")?.optString("id").orEmpty()
                if (convId.isNotBlank()) {
                    ScreenStore.convIdForUser[id] = convId
                    nav.navigate("chat/$convId")
                }
            }
        }
    }

    val versionName =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull().orEmpty()
    val versionCode = KpUpdate.installedVersionCode(ctx)

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            Text("About Us", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }

        // Owner round 31: "About Us ta khub chapa" — a hero block with real
        // air, the founder card with a centred portrait, and the links spaced
        // out (18dp rows, 22dp gaps between the blocks).
        Spacer(Modifier.height(10.dp))

        /* ---------- app hero ---------- */
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(
                    Brush.verticalGradient(
                        listOf(
                            if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.22f) else GoldSoft,
                            Card,
                        ),
                    ),
                )
                .padding(horizontal = 24.dp, vertical = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.icon_gold),
                contentDescription = "KuchuPuchu",
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(96.dp).clip(RoundedCornerShape(26.dp)),
            )
            Spacer(Modifier.height(18.dp))
            Text("KuchuPuchu", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.height(6.dp))
            Text(
                "Version $versionName · build $versionCode",
                fontSize = 13.sp,
                color = ActionBlueDeep,
                fontWeight = FontWeight.Medium,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(ActionBlue.copy(alpha = 0.14f))
                        .padding(horizontal = 12.dp, vertical = 5.dp),
            )
            Spacer(Modifier.height(18.dp))
            Text(
                "A fast, private messenger made in Bangladesh — chats, voice & video calls, " +
                    "status updates and an AI assistant, with your phone number as your identity.",
                fontSize = 14.sp,
                color = Ink,
                textAlign = TextAlign.Center,
                lineHeight = 22.sp,
            )
        }

        Spacer(Modifier.height(22.dp))

        /* ---------- founder card ---------- */
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Card)
                .padding(horizontal = 20.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.owner_avatar),
                contentDescription = "Rabbi Hossain",
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(84.dp).clip(CircleShape),
            )
            Spacer(Modifier.height(14.dp))
            Text("MD Rabbi Hossain", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.height(4.dp))
            Text(
                "Founder & Developer",
                fontSize = 13.sp,
                color = if (KpThemeMode.darkBlue) ActionBlueDeep else GoldDeep,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text("Kaliganj, Jhenaidah, Khulna, Bangladesh", fontSize = 12.5.sp, color = Muted)
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                AboutBrandIcon(R.drawable.ic_brand_facebook, "Facebook") { open("https://facebook.com/Rabbihossainltd") }
                AboutBrandIcon(R.drawable.ic_brand_instagram, "Instagram") { open("https://instagram.com/Rabbihossainltd1") }
                AboutBrandIcon(R.drawable.ic_brand_telegram, "Telegram") { open("https://t.me/Rabbihossainltd0") }
                AboutBrandIcon(R.drawable.ic_brand_tiktok, "TikTok") { open("https://tiktok.com/@Rabbihossainltd") }
            }
        }

        Spacer(Modifier.height(22.dp))

        /* ---------- links ---------- */
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Card)
                .padding(vertical = 6.dp),
        ) {
            AboutRow(Icons.Filled.Chat, "Message the founder", "@rabbihossainltd") {
                haptics.tap()
                messageOwner()
            }
            AboutRow(Icons.Filled.Language, "Website", "rabbihossainltd.online") { open("https://rabbihossainltd.online") }
            AboutRow(Icons.Filled.Email, "Contact", "info@rabbihossainltd.online") { open("mailto:info@rabbihossainltd.online") }
            AboutRow(Icons.Filled.Code, "Source & releases", "GitHub") {
                open("https://github.com/rabbihossainltd1/KuchuPuchu/releases")
            }
            AboutRow(
                Icons.Filled.SystemUpdate,
                "Check for updates",
                if (KpUpdate.checking) "Checking…" else "GitHub release",
            ) {
                scope.launch {
                    withContext(Dispatchers.IO) { KpUpdate.check(ctx) }
                    if (KpUpdate.available == null) {
                        android.widget.Toast.makeText(ctx, "You are on the latest version", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        Spacer(Modifier.height(28.dp))
        Text(
            "© ${java.time.Year.now().value} KuchuPuchu · Made with care in Bangladesh",
            fontSize = 12.sp,
            color = Muted,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun AboutBrandIcon(res: Int, label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.16f) else GoldSoft)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(res), label, tint = Color.Unspecified, modifier = Modifier.size(21.dp))
    }
}

@Composable
private fun AboutRow(icon: ImageVector, label: String, value: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(ActionBlue.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, tint = ActionBlueDeep, modifier = Modifier.size(20.dp)) }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1)
            Spacer(Modifier.height(2.dp))
            Text(value, fontSize = 12.5.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Muted, modifier = Modifier.size(20.dp))
    }
}
