package app.kuchupuchu.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

/**
 * Root of the v3 app. Auth gate → main tabs (Chats / Status / Calls) with
 * Settings pushed from the app bar gear.
 */
@Composable
fun KpApp() {
    val nav = rememberNavController()
    var authed by remember { mutableStateOf(!Api.token.isNullOrBlank() && Store.me != null) }

    // Notification tap → open the conversation once authed.
    LaunchedEffect(authed) {
        val pending = MainActivity.pendingChat
        if (authed && !pending.isNullOrBlank()) {
            MainActivity.pendingChat = null
            nav.navigate("chat/$pending")
        }
    }

    Surface(Modifier.fillMaxSize(), color = Cream) {
        if (!authed) {
            LoginScreen { authed = true }
        } else {
            NavHost(navController = nav, startDestination = "main") {
                composable("main") { ChatListScreen(nav) }
                composable("newchat") { NewChatScreen(nav) }
                composable("chat/{id}") { entry ->
                    val id = entry.arguments?.getString("id") ?: ""
                    ChatScreen(nav, id)
                }
                composable("settings") { SettingsScreen(nav) }
                composable("status") { StatusScreen(nav) }
                composable("calls") { CallsScreen(nav) }
                composable("search") { SearchScreen(nav) }
            }
        }
    }
}
