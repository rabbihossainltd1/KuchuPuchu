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
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
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
    val authed by Store.authed

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
            LoginScreen { Store.authed.value = true }
        } else {
            NavHost(
                navController = nav,
                startDestination = "main",
                enterTransition = { fadeIn(tween(220)) + slideInHorizontally(tween(260)) { it / 6 } },
                exitTransition = { fadeOut(tween(180)) },
                popEnterTransition = { fadeIn(tween(220)) },
                popExitTransition = { fadeOut(tween(200)) + slideOutHorizontally(tween(260)) { it / 6 } },
            ) {
                composable("main") { ChatListScreen(nav) }
                composable("newchat") { NewChatScreen(nav) }
                composable("newgroup") { CreateGroupScreen(nav) }
                composable("chat/{id}") { entry ->
                    val id = entry.arguments?.getString("id") ?: ""
                    ChatScreen(nav, id)
                }
                composable("settings") { SettingsScreen(nav) }
                composable("status") { StatusScreen(nav) }
                composable("calls") { CallsScreen(nav) }
                composable("search") { SearchScreen(nav) }
                composable("statusview/{whose}") { entry ->
                    val whose = entry.arguments?.getString("whose") ?: ""
                    StatusViewerScreen(nav, whose)
                }
                composable("statusphoto") { StatusPhotoScreen(nav) }
                composable("profile/{id}") { entry ->
                    ProfileScreen(nav, entry.arguments?.getString("id") ?: "")
                }
                composable("chatmedia/{id}") { entry ->
                    ChatMediaScreen(nav, entry.arguments?.getString("id") ?: "")
                }
            }
            // Call screens float above everything while a call is live.
            CallGate()
        }
    }
}
