package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController

/**
 * TEMPORARY stand-ins for the Status / Calls / Settings tabs.
 * These are honest "arriving in this build" states — each is replaced by
 * its locked-design screen in the remaining build rounds:
 *   Status  → Status #7 + Viewer #4  (status round)
 *   Calls   → Calls tab #2           (call round)
 *   Settings→ Settings #10 Warm Banner (settings round)
 */
@Composable
fun StatusScreen(nav: NavController) {
    TempTab("✨", "Status", "24-hour status — arriving in this build")
}

@Composable
fun CallsScreen(nav: NavController) {
    TempTab("📞", "Calls", "Voice & video call history — arriving in this build")
}

@Composable
fun SettingsScreen(nav: NavController) {
    TempTab("⚙️", "Settings", "Profile & settings — arriving in this build")
}

@Composable
fun ChatScreen(nav: NavController, convId: String) {
    TempTab("💬", "Chat", "Chat screen — arriving in this build")
}

@Composable
fun SearchScreen(nav: NavController) {
    TempTab("🔎", "Search", "Search — arriving in this build")
}

@Composable
private fun TempTab(emoji: String, title: String, note: String) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(emoji, fontSize = 44.sp)
        Spacer(Modifier.height(10.dp))
        Text(title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Spacer(Modifier.height(6.dp))
        Text(note, fontSize = 14.sp, color = Muted)
    }
}
