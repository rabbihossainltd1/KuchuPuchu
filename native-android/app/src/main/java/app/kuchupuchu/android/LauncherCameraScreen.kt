package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.navigation.NavController
import java.io.File

/** Camera entry opened by the launcher shortcut; a captured image enters the Status editor. */
@Composable
fun LauncherCameraScreen(nav: NavController) {
    val context = LocalContext.current
    var outputUri by rememberSaveable { mutableStateOf<Uri?>(null) }
    var outputPath by rememberSaveable { mutableStateOf<String?>(null) }
    var cameraLaunchRequested by rememberSaveable { mutableStateOf(false) }

    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { captured ->
            val file = outputPath?.let(::File)
            if (captured && outputUri != null) {
                val item = MediaItem(outputUri!!, isVideo = false, durationMs = 0, bucket = "Camera", added = System.currentTimeMillis())
                val routeArg = statusPickArg(item)
                nav.navigate("mediaedit/status/0/$routeArg") {
                    popUpTo("launcher-camera") { inclusive = true }
                }
            } else {
                file?.delete()
                nav.popBackStack()
            }
        }

    LaunchedEffect(Unit) {
        if (cameraLaunchRequested) return@LaunchedEffect
        cameraLaunchRequested = true
        val file = File(context.cacheDir, "launcher_camera_${System.currentTimeMillis()}.jpg")
        val uri =
            runCatching {
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            }.getOrElse {
                Toast.makeText(context, "Camera could not be opened", Toast.LENGTH_SHORT).show()
                nav.popBackStack()
                return@LaunchedEffect
            }
        outputPath = file.absolutePath
        outputUri = uri
        val activity = MainActivity.current
        if (activity == null) {
            file.delete()
            Toast.makeText(context, "Camera could not be opened", Toast.LENGTH_SHORT).show()
            nav.popBackStack()
            return@LaunchedEffect
        }
        activity.ensurePermissions(listOf(Manifest.permission.CAMERA)) {
            val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                file.delete()
                Toast.makeText(context, "Camera permission is needed to take a photo", Toast.LENGTH_SHORT).show()
                nav.popBackStack()
            } else {
                runCatching { camera.launch(uri) }
                    .onFailure {
                        file.delete()
                        Toast.makeText(context, "No camera app is available", Toast.LENGTH_SHORT).show()
                        nav.popBackStack()
                    }
            }
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(color = Color.White)
            Text("Opening camera…", color = Color.White, fontSize = 14.sp)
        }
    }
}
