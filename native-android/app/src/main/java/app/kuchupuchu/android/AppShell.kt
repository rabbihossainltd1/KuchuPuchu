package app.kuchupuchu.android

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AppShell(
    session: Session,
    route: String,
    onRoute: (String) -> Unit,
    onBack: () -> Boolean,
    engine: CallEngine,
) {
    val ctx = LocalContext.current
    val activity = ctx as? Activity
    var drawer by remember { mutableStateOf(false) }
    var searchOpen by remember { mutableStateOf(false) }
    val playerBar = remember { PlayerBar() }
    val tab = route.substringAfter("tabs/").substringBefore("/")
    val inThread = route.startsWith("chat/")
    val onPlayer = route.startsWith("player/")
    val onHome = route.startsWith("tabs/home")
    val onProfile = route.startsWith("tabs/me")
    val showChrome = !inThread

    BackHandler {
        when {
            drawer -> drawer = false
            searchOpen -> searchOpen = false
            else -> if (!onBack()) activity?.moveTaskToBack(true)
        }
    }

    Box(Modifier.fillMaxSize().background(Bg)) {
        Column(Modifier.fillMaxSize()) {
            if (showChrome) {
                Row(
                    Modifier.fillMaxWidth().background(Surface).padding(start = 4.dp, end = 2.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    MenuIcon { drawer = true }
                    if (onHome) {
                        Image(
                            painterResource(R.drawable.logo_wordmark),
                            "KuchuPuchu",
                            modifier = Modifier.height(26.dp).padding(start = 2.dp),
                            contentScale = ContentScale.Fit,
                        )
                        Spacer(Modifier.weight(1f))
                        PlusIcon { onRoute("compose") }
                        IconBtn(Icons.Outlined.Search) { searchOpen = !searchOpen }
                        Box {
                            IconBtn(Icons.Outlined.ChatBubbleOutline) { onRoute("tabs/inbox") }
                            if (session.unread > 0) Badge(session.unread, Modifier.align(Alignment.TopEnd))
                        }
                    } else {
                        Text(
                            pageTitle(route),
                            Modifier.weight(1f),
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Ink,
                        )
                        if (onPlayer) {
                            // Other player's profile: the ⋮ menu lives in the
                            // far corner (where coins usually sit).
                            if (playerBar.showCalls) {
                                IconBtn(Icons.Outlined.Call) { playerBar.onAudio?.invoke() }
                                IconBtn(Icons.Outlined.Videocam) { playerBar.onVideo?.invoke() }
                            }
                            IconBtn(Icons.Outlined.MoreVert) { playerBar.onMenu?.invoke() }
                        } else if (onProfile) {
                            PencilIcon { onRoute("edit-profile") }
                        } else {
                            Text(
                                "${session.me?.walletBal() ?: 0}",
                                color = Ink,
                                modifier = Modifier.clickable { onRoute("wallet") }.padding(8.dp),
                            )
                        }
                    }
                }
            }
            Box(Modifier.weight(1f)) {
                KeepAlive(route.startsWith("tabs/home")) {
                    HomeScreen(session, onRoute, searchOpen) { searchOpen = false }
                }
                KeepAlive(route.startsWith("tabs/inbox")) {
                    InboxScreen(session, onRoute)
                }
                KeepAlive(route.startsWith("tabs/alerts")) {
                    AlertsScreen(session, onRoute)
                }
                KeepAlive(route.startsWith("tabs/me")) {
                    ProfileScreen(session, onRoute, mine = true)
                }
                when {
                    route.startsWith("chat/") ->
                        ChatScreen(route.removePrefix("chat/"), session, onRoute, { onBack(); Unit }, engine)
                    route == "friends" -> FriendsScreen(session, onRoute)
                    route == "requests" -> RequestsScreen(session, onRoute)
                    route == "settings" -> SettingsScreen(session, onRoute)
                    route == "duo" -> DuoScreen(session, onRoute, engine)
                    route == "store" -> StoreScreen(session, onRoute)
                    route == "wallet" -> WalletScreen(session, onRoute)
                    route.startsWith("player/") ->
                        PlayerScreen(route.removePrefix("player/"), session, onRoute, { onBack(); Unit }, engine, playerBar)
                    route == "compose" -> ComposePostScreen(session) { session.feedEpoch++; onBack(); Unit }
                    route == "edit-profile" -> EditProfileScreen(session) { onBack(); Unit }
                }
            }
            if (showChrome && route.startsWith("tabs/")) {
                Column(Modifier.fillMaxWidth().background(Surface)) {
                    HorizontalDivider(color = Line)
                    Row(
                        Modifier.fillMaxWidth().padding(top = 7.dp, bottom = 9.dp, start = 6.dp, end = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        NavTab(Icons.Outlined.Home, "Home", tab == "home") { onRoute("tabs/home") }
                        NavTab(Icons.Outlined.ChatBubbleOutline, "Chats", tab == "inbox", session.unread) { onRoute("tabs/inbox") }
                        NavTab(Icons.Outlined.NotificationsNone, "Alerts", tab == "alerts", session.noteCount) { onRoute("tabs/alerts") }
                        NavTab(Icons.Outlined.Person, "Profile", tab == "me") { onRoute("tabs/me") }
                    }
                }
            }
        }
        if (drawer) {
            Box(Modifier.fillMaxSize().background(Color(0x591C1917)).clickable { drawer = false })
            Column(
                Modifier.fillMaxHeight().width(300.dp).align(Alignment.CenterStart).background(Surface).padding(16.dp, 18.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(painterResource(R.drawable.icon_gold), null, Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(session.me?.name().orEmpty(), fontWeight = FontWeight.SemiBold)
                        Text("@${session.me?.uid().orEmpty()}", color = Muted, fontSize = 13.sp)
                    }
                    CloseIcon { drawer = false }
                }
                Spacer(Modifier.height(16.dp))
                DrawerItem("My profile") { drawer = false; onRoute("tabs/me") }
                DrawerItem("Friends") { drawer = false; onRoute("friends") }
                DrawerItem("Requests") { drawer = false; onRoute("requests") }
                DrawerItem("Find duo") { drawer = false; onRoute("duo") }
                DrawerItem("Store") { drawer = false; onRoute("store") }
                DrawerItem("Add funds") { drawer = false; onRoute("wallet") }
                DrawerItem("Settings") { drawer = false; onRoute("settings") }
                HorizontalDivider(Modifier.padding(vertical = 12.dp), color = Line)
                Text(
                    "Sign out",
                    color = Muted,
                    modifier = Modifier.fillMaxWidth().clickable {
                        drawer = false
                        logout(ctx, session, onRoute)
                    }.padding(vertical = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun KeepAlive(visible: Boolean, content: @Composable () -> Unit) {
    Box(
        Modifier
            .then(if (visible) Modifier.fillMaxSize() else Modifier.size(0.dp))
            .clipToBounds(),
        propagateMinConstraints = visible,
    ) { content() }
}

private fun pageTitle(route: String) =
    when {
        route.startsWith("tabs/inbox") -> "Messages"
        route.startsWith("tabs/alerts") -> "Notifications"
        route.startsWith("tabs/me") -> "Profile"
        route == "friends" -> "Friends"
        route == "requests" -> "Requests"
        route == "duo" -> "Find duo"
        route == "settings" -> "Settings"
        route == "store" -> "Store"
        route == "wallet" -> "Add funds"
        else -> "KuchuPuchu"
    }

@Composable
private fun androidx.compose.foundation.layout.RowScope.NavTab(icon: ImageVector, label: String, on: Boolean, badge: Int = 0, click: () -> Unit) {
    Column(
        Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = click).padding(top = 6.dp, bottom = 3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                Modifier.width(64.dp).height(38.dp).clip(RoundedCornerShape(19.dp))
                    .background(if (on) AccentSoft else Color.Transparent),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = if (on) AccentDeep else Muted, modifier = Modifier.size(28.dp))
            }
            if (badge > 0) Badge(badge, Modifier.align(Alignment.TopEnd))
        }
        Spacer(Modifier.height(3.dp))
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
            color = if (on) AccentDeep else Muted,
        )
    }
}

@Composable
fun Badge(n: Int, modifier: Modifier = Modifier) {
    Box(
        modifier.background(Rose, RoundedCornerShape(99.dp)).padding(horizontal = 4.dp).height(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (n > 9) "9+" else "$n", color = Color.White, fontSize = 10.sp)
    }
}

@Composable
private fun DrawerItem(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp),
        fontSize = 16.sp,
        fontWeight = FontWeight.Medium,
        color = Ink,
    )
}
