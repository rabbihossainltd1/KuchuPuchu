package app.kuchupuchu.android

import androidx.compose.foundation.background
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
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                items.clear()
                items.addAll(Api.get("/api/store/products").arr("items").objects())
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/home") }
            Text("Store", fontWeight = FontWeight.SemiBold)
        }
        LazyColumn(Modifier.padding(12.dp)) {
            itemsIndexed(items) { _, it ->
                Row(
                    Modifier.fillMaxWidth().clickable { preview = it }.padding(10.dp).background(Surface, RoundedCornerShape(12.dp)).padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(it.optString("name"), fontWeight = FontWeight.Medium)
                        Text("${it.optInt("priceCoins")} coins", color = Muted, fontSize = 12.sp)
                    }
                    Text(
                        "Buy",
                        color = Accent,
                        modifier =
                            Modifier.clickable {
                                scope.launch(Dispatchers.IO) {
                                    runCatching {
                                        Api.post(
                                            "/api/store/orders",
                                            JSONObject().put("productId", it.optString("id")).put("idempotencyKey", "store-${System.currentTimeMillis()}"),
                                        )
                                    }
                                }
                            }.padding(8.dp),
                    )
                }
            }
        }
        preview?.let {
            Text("Preview on your profile: ${it.optString("name")}", modifier = Modifier.padding(16.dp), color = Muted)
        }
    }
}

@Composable
fun WalletScreen(session: Session, onRoute: (String) -> Unit) {
    val packs = remember { mutableStateListOf<JSONObject>() }
    var balance by remember { mutableStateOf(session.me?.walletBal() ?: 0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                val data = Api.get("/api/payments/packages")
                packs.clear()
                packs.addAll(data.arr("items").objects())
                if (packs.isEmpty()) {
                    listOf(Triple("pkg_80", 80, 49), Triple("pkg_200", 200, 99), Triple("pkg_500", 500, 199), Triple("pkg_1200", 1200, 399)).forEach { (id, c, p) ->
                        packs.add(JSONObject().put("id", id).put("coins", c).put("priceBdt", p).put("name", id))
                    }
                }
                balance = session.me?.walletBal() ?: balance
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/home") }
            Text("Add Funds", fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(12.dp))
        Text("Balance  $balance", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(8.dp))
        packs.forEach { p ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp).background(Surface, RoundedCornerShape(12.dp)).padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("${p.optInt("coins")} coins", fontWeight = FontWeight.Medium)
                Text(
                    "৳${p.optInt("priceBdt").let { if (it == 0) p.optInt("price") else it }}",
                    color = Accent,
                    modifier =
                        Modifier.clickable {
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    runCatching { Api.post("/api/wallet/topup", JSONObject().put("packageId", p.optString("id"))) }
                                }
                                balance += p.optInt("coins")
                            }
                        },
                )
            }
        }
    }
}

@Composable
fun DuoScreen(session: Session, onRoute: (String) -> Unit, engine: CallEngine) {
    var status by remember { mutableStateOf("Ready") }
    var match by remember { mutableStateOf<JSONObject?>(null) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Bg).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/home") }
            Text("Find Duo", fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(40.dp))
        Text(status, fontSize = 18.sp)
        Spacer(Modifier.height(20.dp))
        Text(
            "Match now",
            color = androidx.compose.ui.graphics.Color.White,
            modifier =
                Modifier.background(Ink, RoundedCornerShape(12.dp)).clickable {
                    status = "Finding…"
                    scope.launch {
                        val data =
                            withContext(Dispatchers.IO) {
                                runCatching { Api.post("/api/duo/match") }.getOrNull()
                            }
                        val user = data?.optJSONObject("user")
                        if (user != null) {
                            match = user
                            status = "Matched with ${user.name()}"
                        } else {
                            delay(1200)
                            status = "No one right now. Try again."
                        }
                    }
                }.padding(horizontal = 24.dp, vertical = 12.dp),
        )
        match?.let { u ->
            Spacer(Modifier.height(24.dp))
            PersonRow(u, onOpen = { onRoute("player/${u.userId()}") })
            Row {
                Text("Audio", color = Accent, modifier = Modifier.clickable { engine.startCall(u.userId(), "AUDIO", u.name()) }.padding(8.dp))
                Text("Video", color = Accent, modifier = Modifier.clickable { engine.startCall(u.userId(), "VIDEO", u.name()) }.padding(8.dp))
            }
        }
    }
}
