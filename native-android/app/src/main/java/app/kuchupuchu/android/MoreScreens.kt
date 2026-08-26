package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun StoreScreen(session: Session, onRoute: (String) -> Unit) {
    val items = remember { mutableStateListOf<JSONObject>() }
    val scope = rememberCoroutineScope()
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var notice by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                items.clear()
                items.addAll(Api.get("/api/store/products").arr("items").objects())
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Store", fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
            Text("${session.me?.walletBal() ?: 0} coins", color = Muted)
        }
        if (notice.isNotBlank()) Text(notice, color = Green, modifier = Modifier.padding(8.dp))
        LazyColumn {
            itemsIndexed(items) { _, it ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp))
                        .clickable { preview = it }.padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(it.optString("name"), fontWeight = FontWeight.Medium)
                        Text("${it.optInt("priceCoins")} coins", color = Muted, fontSize = 12.sp)
                    }
                    AccentBtn("Buy") {
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                runCatching {
                                    Api.post("/api/store/orders", JSONObject().put("productId", it.optString("id")).put("idempotencyKey", "store-${System.currentTimeMillis()}"))
                                }
                            }
                            notice = "Added to inventory."
                        }
                    }
                }
            }
        }
        preview?.let {
            Text("Preview on your profile: ${it.optString("name")}", color = Muted, modifier = Modifier.padding(8.dp))
        }
        onRoute
    }
}

@Composable
fun WalletScreen(session: Session, onRoute: (String) -> Unit) {
    val packs = remember { mutableStateListOf<JSONObject>() }
    var balance by remember { mutableStateOf(session.me?.walletBal() ?: 0) }
    var notice by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                packs.clear()
                packs.addAll(Api.get("/api/payments/packages").arr("items").objects())
                if (packs.isEmpty()) {
                    listOf(Triple("pkg_80", 80, 49), Triple("pkg_200", 200, 99), Triple("pkg_500", 500, 199), Triple("pkg_1200", 1200, 399)).forEach { (id, c, p) ->
                        packs.add(JSONObject().put("id", id).put("coins", c).put("priceBdt", p).put("name", id))
                    }
                }
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(16.dp)) {
        Text("Add funds", fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
        Text("$balance coins", fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp, bottom = 14.dp))
        if (notice.isNotBlank()) Text(notice, color = Green)
        val rows = packs.chunked(2)
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { p ->
                    Column(
                        Modifier.weight(1f).padding(vertical = 4.dp).clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp)).padding(14.dp)
                            .clickable {
                                scope.launch {
                                    withContext(Dispatchers.IO) {
                                        runCatching { Api.post("/api/wallet/topup", JSONObject().put("packageId", p.optString("id"))) }
                                    }
                                    balance += p.optInt("coins")
                                    notice = "Coins added."
                                }
                            },
                    ) {
                        Text("${p.optInt("coins")}", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                        Text("coins", color = Muted, fontSize = 13.sp)
                        Text("৳${p.optInt("priceBdt").let { if (it == 0) p.optInt("price") else it }}", color = Muted, fontSize = 13.sp)
                        Text("Add", color = Accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(12.dp))
        AccentBtn("Daily +20") {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { Api.post("/api/wallet/daily-reward") } }
                balance += 20
                notice = "Daily +20 coins."
            }
        }
        onRoute
    }
}

@Composable
fun DuoScreen(session: Session, onRoute: (String) -> Unit, engine: CallEngine) {
    var status by remember { mutableStateOf("Ready") }
    val recs = remember { mutableStateListOf<JSONObject>() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                recs.clear()
                recs.addAll(Api.get("/api/discover/recommendations").arr("items").objects())
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(16.dp)) {
        Text("Find duo", fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
        Spacer(Modifier.height(12.dp))
        AccentBtn("Match now") {
            status = "Finding…"
            scope.launch {
                val data = withContext(Dispatchers.IO) { runCatching { Api.get("/api/discover?online=true") }.getOrNull() }
                val user = data?.arr("items")?.objects()?.firstOrNull() ?: recs.firstOrNull()
                if (user != null) {
                    recs.remove(user)
                    recs.add(0, user)
                    status = "Matched with ${user.name()}"
                } else {
                    delay(800)
                    status = "No one right now. Try again."
                }
            }
        }
        Text(status, color = Muted, modifier = Modifier.padding(top = 10.dp))
        Spacer(Modifier.height(12.dp))
        recs.forEach { u ->
            PersonMini(u, onOpen = { onRoute("player/${u.userId()}") }) {
                Text("Audio", color = Accent, modifier = Modifier.clickable { engine.startCall(u.userId(), "AUDIO", u.name()) }.padding(6.dp))
                Text("Video", color = Accent, modifier = Modifier.clickable { engine.startCall(u.userId(), "VIDEO", u.name()) }.padding(6.dp))
            }
        }
        session
    }
}
