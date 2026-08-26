package app.kuchupuchu.android

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
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Person
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AppShell(session: Session, route: String, onRoute: (String) -> Unit, engine: CallEngine) {
    val ctx = LocalContext.current
    var drawer by remember { mutableStateOf(false) }
    val tab = route.substringAfter("tabs/").substringBefore("/")
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
                when {
                    route.startsWith("tabs/home") -> HomeScreen(session, onRoute) { drawer = true }
                    route.startsWith("tabs/inbox") -> InboxScreen(session, onRoute)
                    route.startsWith("tabs/alerts") -> AlertsScreen(session, onRoute)
                    route.startsWith("tabs/me") -> ProfileScreen(session, onRoute, mine = true) { drawer = true }
                    route.startsWith("chat/") -> ChatScreen(route.removePrefix("chat/"), session, onRoute, engine)
                    route == "friends" -> FriendsScreen(session, onRoute)
                    route == "requests" -> RequestsScreen(session, onRoute)
                    route == "settings" -> SettingsScreen(session, onRoute)
                    route == "duo" -> DuoScreen(session, onRoute, engine)
                    route == "store" -> StoreScreen(session, onRoute)
                    route == "wallet" -> WalletScreen(session, onRoute)
                    route.startsWith("player/") -> PlayerScreen(route.removePrefix("player/"), session, onRoute, engine)
                    route == "compose" -> ComposePostScreen(session) { onRoute("tabs/home") }
                    else -> HomeScreen(session, onRoute) { drawer = true }
                }
            }
            if (route.startsWith("tabs/")) {
                Row(
                    Modifier.fillMaxWidth().background(Surface).padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    Tab("Home", Icons.Outlined.Home, tab == "home") { onRoute("tabs/home") }
                    Tab("Messages", Icons.Outlined.ChatBubbleOutline, tab == "inbox", session.unread) { onRoute("tabs/inbox") }
                    Tab("Alerts", Icons.Outlined.NotificationsNone, tab == "alerts", session.noteCount) { onRoute("tabs/alerts") }
                    Tab("Profile", Icons.Outlined.Person, tab == "me") { onRoute("tabs/me") }
                }
            }
        }
        if (drawer) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(0.35f)).clickable { drawer = false })
            Column(
                Modifier.fillMaxHeight().width(280.dp).align(Alignment.CenterEnd).background(Surface).padding(18.dp),
            ) {
                Image(painterResource(R.drawable.logo_wordmark), null, Modifier.height(28.dp))
                Spacer(Modifier.height(18.dp))
                DrawerItem("Friends") { drawer = false; onRoute("friends") }
                DrawerItem("Requests") { drawer = false; onRoute("requests") }
                DrawerItem("Settings") { drawer = false; onRoute("settings") }
                DrawerItem("Find Duo") { drawer = false; onRoute("duo") }
                DrawerItem("Store") { drawer = false; onRoute("store") }
                DrawerItem("Add Funds") { drawer = false; onRoute("wallet") }
                DrawerItem("My Profile") { drawer = false; onRoute("tabs/me") }
                HorizontalDivider(Modifier.padding(vertical = 12.dp), color = Line)
                DrawerItem("Log out") {
                    drawer = false
                    logout(ctx, session, onRoute)
                }
            }
        }
    }
}

@Composable
private fun Tab(label: String, icon: ImageVector, on: Boolean, badge: Int = 0, click: () -> Unit) {
    Column(Modifier.clickable(onClick = click).padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box {
            Icon(icon, label, tint = if (on) Accent else Muted)
            if (badge > 0) {
                Box(
                    Modifier.align(Alignment.TopEnd).background(Rose).padding(horizontal = 4.dp),
                ) {
                    Text("${if (badge > 9) "9+" else badge}", color = Color.White, fontSize = 9.sp)
                }
            }
        }
        Text(label, fontSize = 10.sp, color = if (on) Accent else Muted)
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
