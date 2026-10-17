package app.kuchupuchu.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/** Native KuchuPuchu surface for linked VintoxBd classes — never a web view. */
@Composable
fun ClassroomListScreen(nav: NavController) {
    val ctx = LocalContext.current
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(refresh) {
        loading = true
        error = ""
        try {
            val answer = CoreApi.getAsync(ctx, "/api/classroom/v1/classes")
            rows = answer.optJSONArray("classes").objects()
        } catch (e: Exception) {
            error = classroomError(e, "Classes could not be loaded.")
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxSize().background(Cream).navigationBarsPadding()) {
        SubScreenHeader("Class", onBack = { nav.popBackStack() })
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ActionBlueDeep)
            }
            error.isNotBlank() -> ClassroomNotice(error) { refresh++ }
            rows.isEmpty() -> ClassroomNotice(
                "No enrolled classes are available. Link the VintoxBd account that owns your enrolment.",
            ) { refresh++ }
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item { Spacer(Modifier.height(4.dp)) }
                items(rows, key = { it.optString("id") }) { item ->
                    val id = item.optString("id")
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .background(Card, RoundedCornerShape(18.dp))
                            .clickable(enabled = id.isNotBlank()) { nav.navigate("classroom/$id") }
                            .padding(16.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.School, null, tint = ActionBlueDeep, modifier = Modifier.size(21.dp))
                            Spacer(Modifier.size(9.dp))
                            Text(
                                item.optString("title").ifBlank { "Live class" },
                                color = Ink,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(Icons.AutoMirrored.Filled.ArrowForward, "Open class", tint = Muted, modifier = Modifier.size(19.dp))
                        }
                        Text(
                            listOf(item.optString("course"), item.optString("batch"))
                                .filter { it.isNotBlank() }.joinToString(" · "),
                            color = Muted,
                            fontSize = 12.5.sp,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                        Text(
                            classroomWhen(item),
                            color = if (item.optBoolean("inSession")) ActionBlueDeep else Muted,
                            fontSize = 12.5.sp,
                            fontWeight = if (item.optBoolean("inSession")) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
fun ClassroomDetailScreen(nav: NavController, classId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var downloadingMaterial by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<JSONObject?>(null) }

    LaunchedEffect(classId) {
        if (!classId.matches(Regex("^[0-9]{1,20}$"))) {
            error = "That class address is invalid."
            loading = false
            return@LaunchedEffect
        }
        try {
            item = CoreApi.getAsync(ctx, "/api/classroom/v1/classes/$classId").optJSONObject("class")
                ?: error("Missing class")
        } catch (e: Exception) {
            error = classroomError(e, "The class could not be loaded.")
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxSize().background(Cream).navigationBarsPadding()) {
        SubScreenHeader("Class details", onBack = { nav.popBackStack() })
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ActionBlueDeep)
            }
            error.isNotBlank() && item == null -> ClassroomNotice(error) { nav.popBackStack() }
            item != null -> {
                val current = item!!
                LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                    item {
                        Text(current.optString("title"), color = Ink, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        Text(current.optString("topic"), color = Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 5.dp))
                        Text(classroomWhen(current), color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
                        if (error.isNotBlank()) Text(error, color = Red, fontSize = 12.5.sp, modifier = Modifier.padding(top = 10.dp))
                        Spacer(Modifier.height(18.dp))
                    }
                    classroomMaterialSection(
                        current.optJSONArray("materials"),
                        downloadingMaterial,
                    ) { material ->
                        val materialId = material.optString("id")
                        if (materialId.isBlank() || !material.optBoolean("available")) return@classroomMaterialSection
                        downloadingMaterial = materialId
                        error = ""
                        scope.launch {
                            try {
                                val saved = CoreApi.downloadToDownloads(
                                    ctx,
                                    "/api/classroom/v1/classes/$classId/materials/$materialId",
                                    material.optString("title").ifBlank { "class-material" },
                                )
                                android.widget.Toast.makeText(ctx, "Saved to $saved", android.widget.Toast.LENGTH_LONG).show()
                            } catch (e: Exception) {
                                error = classroomError(e, "That material could not be downloaded.")
                            } finally {
                                downloadingMaterial = ""
                            }
                        }
                    }
                    classroomDetailSection("Polls", current.optJSONArray("polls"), "question")
                    classroomDetailSection("Quizzes", current.optJSONArray("quizzes"), "title")
                    if (current.optBoolean("recordingAvailable")) {
                        item {
                            OutlinedButton(
                                enabled = downloadingMaterial.isBlank(),
                                onClick = {
                                    downloadingMaterial = "recording"
                                    error = ""
                                    scope.launch {
                                        try {
                                            val saved = CoreApi.downloadToDownloads(
                                                ctx,
                                                "/api/classroom/v1/classes/$classId/recording",
                                                current.optString("title").ifBlank { "class" } + "-recording.mp4",
                                            )
                                            android.widget.Toast.makeText(ctx, "Saved to $saved", android.widget.Toast.LENGTH_LONG).show()
                                        } catch (e: Exception) {
                                            error = classroomError(e, "The class recording could not be downloaded.")
                                        } finally {
                                            downloadingMaterial = ""
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                            ) {
                                if (downloadingMaterial == "recording") {
                                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.size(8.dp))
                                }
                                Text("Save class recording")
                            }
                        }
                    }
                    item {
                        Spacer(Modifier.height(20.dp))
                        Button(
                            enabled = current.optBoolean("joinable") && !busy,
                            onClick = {
                                busy = true
                                error = ""
                                scope.launch {
                                    try {
                                        val token = CoreApi.postAsync(ctx, "/api/classroom/v1/classes/$classId/room-token")
                                        ClassroomRoomHandoff.put(classId, current.optString("title"), token)
                                        nav.navigate("classroom/$classId/room")
                                    } catch (e: Exception) {
                                        error = classroomError(e, "The room could not be opened.")
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = ActionBlueDeep),
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                        ) {
                            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Card, strokeWidth = 2.dp)
                            else Text(if (current.optBoolean("joinable")) "Join live class" else "Class is not live", fontWeight = FontWeight.SemiBold)
                        }
                        Text(
                            "The room opens inside KuchuPuchu. No external meeting page is used.",
                            color = Muted,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 10.dp, bottom = 28.dp),
                        )
                    }
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.classroomMaterialSection(
    values: JSONArray?,
    downloadingId: String,
    onDownload: (JSONObject) -> Unit,
) {
    val rows = values.objects()
    if (rows.isEmpty()) return
    item { Text("Materials", color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp)) }
    items(rows, key = { "material:${it.optString("id")}" }) { row ->
        val available = row.optBoolean("available")
        OutlinedButton(
            onClick = { onDownload(row) },
            enabled = available && downloadingId.isBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (downloadingId == row.optString("id")) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
            }
            Text(
                if (available) row.optString("title").ifBlank { "Class material" }
                else "${row.optString("title").ifBlank { "Class material" }} · unavailable",
            )
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.classroomDetailSection(
    title: String,
    values: JSONArray?,
    label: String,
) {
    val rows = values.objects()
    if (rows.isEmpty()) return
    item { Text(title, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp)) }
    items(rows, key = { "$title:${it.optString("id")}" }) { row ->
        Text(
            row.optString(label).ifBlank { title.dropLast(1) },
            color = Ink,
            fontSize = 13.sp,
            modifier = Modifier.fillMaxWidth().background(Card, RoundedCornerShape(12.dp)).padding(12.dp),
        )
        Spacer(Modifier.height(6.dp))
    }
}

private object ClassroomRoomHandoff {
    var classId: String = ""
    var title: String = ""
    var credentials: JSONObject? = null

    fun put(id: String, value: String, room: JSONObject) {
        classId = id
        title = value
        credentials = JSONObject(room.toString())
    }

    fun take(id: String): Pair<String, JSONObject>? {
        if (id != classId) return null
        val room = credentials ?: return null
        credentials = null
        return title to room
    }
}

/** Native six-person peer-to-peer room. Laravel remains the admission authority. */
@Composable
fun ClassroomRoomScreen(nav: NavController, classId: String) {
    val app = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    val handoff = remember(classId) { ClassroomRoomHandoff.take(classId) }
    var room by remember { mutableStateOf<VintoxMediaRoom?>(null) }
    var state by remember { mutableStateOf("Connecting…") }
    var participants by remember { mutableIntStateOf(0) }
    var videos by remember { mutableStateOf<List<VideoTrack>>(emptyList()) }
    var error by remember { mutableStateOf("") }
    var toolsOpen by remember { mutableStateOf(false) }
    var tools by remember { mutableStateOf<JSONObject?>(null) }
    var toolError by remember { mutableStateOf("") }
    var toolRefresh by remember { mutableIntStateOf(0) }
    var manuallyLeft by remember { mutableStateOf(false) }
    var refreshAttempts by remember { mutableIntStateOf(0) }
    var retryNonce by remember { mutableIntStateOf(0) }
    var needsRelink by remember { mutableStateOf(false) }

    LaunchedEffect(handoff, retryNonce) {
        error = ""
        needsRelink = false
        state = "Connecting…"
        videos = emptyList()
        refreshAttempts = 0
        val initial = if (retryNonce == 0) {
            handoff?.second
        } else {
            try {
                CoreApi.postAsync(app, "/api/classroom/v1/classes/$classId/room-token")
            } catch (e: Exception) {
                needsRelink = classroomNeedsRelink(e)
                error = classroomError(e, "The room credential could not be refreshed.")
                null
            }
        }
        if (initial == null) {
            if (error.isBlank()) error = "The room credential expired. Open the class and join again."
            return@LaunchedEffect
        }
        val connected = VintoxMediaRoom(
            app,
            onState = { state = it },
            onVideo = { track -> videos = (videos + track).distinct() },
            onClosed = {
                if (ClassroomRecoveryPolicy.shouldAutoRefresh(manuallyLeft, refreshAttempts)) {
                    refreshAttempts++
                    retryNonce++
                } else if (!manuallyLeft) {
                    error = "The classroom connection ended. Return to the class and join again."
                }
            },
            onParticipants = { count -> participants = count },
        )
        room = connected

        suspend fun connect(credentials: JSONObject) {
            connected.connect(credentials)
            participants = 1
            state = "Live"
        }

        try {
            connect(initial)
            launch {
                while (isActive && !manuallyLeft) {
                    try {
                        CoreApi.postAsync(
                            app,
                            "/api/classroom/v1/classes/$classId/attendance",
                            JSONObject().put("event", "heartbeat"),
                        )
                    } catch (_: Exception) {
                        // Entitlement is rechecked by room-token refresh; a transient
                        // heartbeat failure must not tear down healthy classroom media.
                    }
                    delay(30_000)
                }
            }
        } catch (e: Exception) {
            needsRelink = classroomNeedsRelink(e)
            error = classroomError(e, "The classroom connection failed. Check the network and try again.")
        }
    }

    LaunchedEffect(room, toolRefresh) {
        if (room == null) return@LaunchedEffect
        while (isActive && !manuallyLeft) {
            try {
                tools = CoreApi.getAsync(app, "/api/classroom/v1/classes/$classId/state")
                toolError = ""
            } catch (e: Exception) {
                toolError = classroomError(e, "Class tools could not be refreshed.")
            }
            delay(5_000)
        }
    }

    fun leave() {
        manuallyLeft = true
        ClassroomAttendanceReporter.leave(app, classId)
        room?.disconnect()
        nav.popBackStack()
    }

    DisposableEffect(room) { onDispose { room?.disconnect() } }
    BackHandler { leave() }

    Column(Modifier.fillMaxSize().background(Ink).navigationBarsPadding()) {
        SubScreenHeader(handoff?.first?.ifBlank { "Live class" } ?: "Live class", onBack = { leave() })
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            when {
                toolsOpen -> ClassroomToolsPanel(
                    state = tools,
                    error = toolError,
                    onAction = { suffix, payload ->
                        scope.launch {
                            try {
                                CoreApi.postAsync(
                                    app,
                                    "/api/classroom/v1/classes/$classId/$suffix",
                                    payload,
                                )
                                toolError = ""
                                toolRefresh++
                            } catch (e: Exception) {
                                toolError = classroomError(e, "That classroom action could not be completed.")
                            }
                        }
                    },
                )
                error.isNotBlank() -> Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Text(error, color = Card, fontSize = 14.sp)
                    Text("Access is always rechecked with VintoxBd; a cached class cannot keep the room open.", color = Card.copy(alpha = 0.68f), fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
                    Spacer(Modifier.height(12.dp))
                    if (needsRelink) {
                        Button(onClick = { nav.navigate("settings/vintoxbd") }) {
                            Text("Open VintoxBd account")
                        }
                    } else {
                        OutlinedButton(onClick = { retryNonce++ }) {
                            Text("Try connection again")
                        }
                    }
                }
                videos.isNotEmpty() && room != null -> ClassroomVideo(room!!, videos.first())
                else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.School, null, tint = Card, modifier = Modifier.size(54.dp))
                    Spacer(Modifier.height(14.dp))
                    Text(state, color = Card, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text("$participants participant${if (participants == 1) "" else "s"}", color = Card.copy(alpha = 0.72f), fontSize = 13.sp)
                    Text("Waiting for the instructor's video. Audio plays automatically.", color = Card.copy(alpha = 0.72f), fontSize = 12.sp, modifier = Modifier.padding(20.dp))
                }
            }
        }
        OutlinedButton(
            onClick = { toolsOpen = !toolsOpen },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        ) {
            Text(if (toolsOpen) "Back to class video" else "Class tools")
        }
        Text(
            "$state · $participants participant${if (participants == 1) "" else "s"}",
            color = Card.copy(alpha = 0.74f),
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Button(
            onClick = { leave() },
            colors = ButtonDefaults.buttonColors(containerColor = Red),
            modifier = Modifier.fillMaxWidth().padding(16.dp).height(50.dp),
            shape = RoundedCornerShape(14.dp),
        ) { Text("Leave class", fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun ClassroomToolsPanel(
    state: JSONObject?,
    error: String,
    onAction: (String, JSONObject) -> Unit,
) {
    var question by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var answers by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    val polls = state?.optJSONArray("polls").objects()
    val quizzes = state?.optJSONArray("quizzes").objects()
    val roster = state?.optJSONArray("roster").objects()
    val questions = state?.optJSONArray("questions").objects()
    val hands = state?.optJSONObject("hands")?.optJSONArray("participants").objects()
    val chat = state?.optJSONArray("chat").objects()

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Text("Class tools", color = Card, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            if (error.isNotBlank()) Text(error, color = Red, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            Text(
                "Hands raised: ${state?.optJSONObject("hands")?.optInt("raised") ?: 0}",
                color = Card.copy(alpha = 0.72f),
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 5.dp),
            )
            OutlinedButton(onClick = { onAction("raise-hand", JSONObject()) }) { Text("Raise hand") }
        }
        if (roster.isNotEmpty()) {
            item { Text("In class", color = Card, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
            items(roster) { participant ->
                ClassroomIdentityRow(participant, participant.optString("name"))
            }
        }
        if (hands.isNotEmpty()) {
            item { Text("Raised hands", color = Card, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
            items(hands) { participant ->
                ClassroomIdentityRow(
                    participant,
                    "${participant.optString("name")} · ${participant.optString("status")}",
                )
            }
        }
        if (questions.isNotEmpty()) {
            item { Text("Questions", color = Card, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
            items(questions, key = { "question:${it.optString("id")}" }) { row ->
                Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(12.dp)).padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RealmBadge(originRealmOf(row.optString("originRealm")), 13.dp)
                        Spacer(Modifier.size(7.dp))
                        Text(row.optString("name"), color = Ink, fontWeight = FontWeight.SemiBold)
                    }
                    Text(row.optString("question"), color = Ink, fontSize = 13.sp, modifier = Modifier.padding(top = 5.dp))
                    row.optString("answer").takeIf { it.isNotBlank() }?.let {
                        Text("Answer: $it", color = Muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 5.dp))
                    }
                }
            }
        }
        item {
            TextField(
                value = question,
                onValueChange = { question = it.take(1000) },
                label = { Text("Ask a question") },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = question.isNotBlank(),
                onClick = {
                    onAction("questions", JSONObject().put("question", question.trim()))
                    question = ""
                },
            ) { Text("Ask") }
        }
        items(polls, key = { "poll:${it.optString("id")}" }) { poll ->
            Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(12.dp)).padding(12.dp)) {
                Text(poll.optString("question"), color = Ink, fontWeight = FontWeight.SemiBold)
                poll.optJSONArray("options").strings().forEachIndexed { index, option ->
                    OutlinedButton(
                        enabled = poll.optBoolean("open"),
                        onClick = { onAction("polls/${poll.optString("id")}/vote", JSONObject().put("option", index)) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(option) }
                }
            }
        }
        items(quizzes, key = { "quiz:${it.optString("id")}" }) { quiz ->
            Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(12.dp)).padding(12.dp)) {
                Text(quiz.optString("title"), color = Ink, fontWeight = FontWeight.SemiBold)
                quiz.optJSONArray("questions").objects().forEach { row ->
                    val quizId = quiz.optString("id")
                    val questionId = row.optString("id")
                    val answerKey = "$quizId:$questionId"
                    Text(row.optString("question"), color = Ink, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                    row.optJSONArray("options").strings().forEachIndexed { index, option ->
                        OutlinedButton(
                            onClick = { answers = answers + (answerKey to index) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (answers[answerKey] == index) "✓ $option" else option) }
                    }
                }
                val rows = quiz.optJSONArray("questions").objects()
                Button(
                    enabled = quiz.optBoolean("open") && rows.isNotEmpty() && rows.all { answers.containsKey("${quiz.optString("id")}:${it.optString("id")}") },
                    onClick = {
                        val payload = JSONObject()
                        rows.forEach { row ->
                            payload.put(row.optString("id"), answers["${quiz.optString("id")}:${row.optString("id")}"])
                        }
                        onAction("quizzes/${quiz.optString("id")}/submit", JSONObject().put("answers", payload))
                    },
                ) { Text("Submit quiz") }
            }
        }
        item {
            Text("Class chat", color = Card, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            chat.takeLast(20).forEach { row ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 5.dp),
                ) {
                    RealmBadge(originRealmOf(row.optString("originRealm")), 12.dp)
                    Spacer(Modifier.size(6.dp))
                    Text(
                        "${row.optString("name")}: ${row.optString("body")}",
                        color = Card.copy(alpha = 0.82f),
                        fontSize = 12.5.sp,
                    )
                }
            }
            TextField(
                value = message,
                onValueChange = { message = it.take(1000) },
                label = { Text("Message") },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Button(
                enabled = message.isNotBlank(),
                onClick = {
                    onAction("chat", JSONObject().put("body", message.trim()))
                    message = ""
                },
            ) { Text("Send") }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun ClassroomIdentityRow(participant: JSONObject, label: String) {
    Row(
        Modifier.fillMaxWidth().background(Card, RoundedCornerShape(12.dp)).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RealmBadge(originRealmOf(participant.optString("originRealm")), 14.dp)
        Spacer(Modifier.size(8.dp))
        Text(label, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ClassroomVideo(room: VintoxMediaRoom, track: VideoTrack) {
    val context = LocalContext.current
    val renderer = remember(room, track) {
        SurfaceViewRenderer(context).also {
            it.init(VintoxMediaRoom.egl.eglBaseContext, null)
            track.addSink(it)
        }
    }
    DisposableEffect(renderer, track) {
        onDispose {
            track.removeSink(renderer)
            renderer.release()
        }
    }
    AndroidView(
        factory = { renderer },
        modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Ink),
    )
}

private object ClassroomAttendanceReporter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun leave(context: android.content.Context, classId: String) {
        scope.launch {
            try {
                CoreApi.postAsync(
                    context,
                    "/api/classroom/v1/classes/$classId/attendance",
                    JSONObject().put("event", "leave"),
                )
            } catch (_: Exception) {
                // Best effort only: the last successful heartbeat remains authoritative.
            }
        }
    }
}

@Composable
private fun ClassroomNotice(message: String, action: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(message, color = Ink, fontSize = 14.sp)
        Spacer(Modifier.height(12.dp))
        IconButton(onClick = action) { Icon(Icons.Filled.Refresh, "Try again", tint = ActionBlueDeep) }
    }
}

private fun classroomError(error: Exception, fallback: String): String =
    (error as? CoreApi.CoreError)?.message?.takeIf { it.isNotBlank() } ?: fallback

private fun classroomNeedsRelink(error: Exception): Boolean {
    val core = error as? CoreApi.CoreError ?: return false
    return ClassroomRecoveryPolicy.needsRelink(core.status, core.code)
}

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else List(length()) { index -> optJSONObject(index) }.filterNotNull()

private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else List(length()) { index -> optString(index) }

private fun classroomWhen(item: JSONObject): String {
    if (item.optBoolean("inSession")) return "Live now"
    val start = item.optString("startsAt")
    return if (start.isBlank()) item.optString("status") else start.replace('T', ' ').take(16)
}
