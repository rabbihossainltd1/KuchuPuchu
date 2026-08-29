package app.kuchupuchu.android

import android.media.MediaPlayer
import android.net.Uri
import android.widget.VideoView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Cold-start splash: plays the branded MP4 (res/raw/kp_splash) once,
 * fullscreen, then fades into the app. A tap skips it — nobody should be
 * held hostage by a splash. Video is muted.
 */
@Composable
fun SplashGate(content: @Composable () -> Unit) {
    var show by remember { mutableStateOf(true) }

    Box(Modifier.fillMaxSize()) {
        content()
        AnimatedVisibility(
            visible = show,
            exit = fadeOut(animationSpec = tween(320)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xFF12100D))
                    .clickable { show = false },
                contentAlignment = Alignment.Center,
            ) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        VideoView(ctx).apply {
                            setVideoURI(
                                Uri.parse("android.resource://${ctx.packageName}/${R.raw.kp_splash}"),
                            )
                            setOnPreparedListener { mp ->
                                mp.isLooping = false
                                mp.setVolume(0f, 0f)
                                mp.setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT)
                                start()
                            }
                            setOnCompletionListener { show = false }
                        }
                    },
                )
                Text(
                    "Tap to skip",
                    color = Color.White.copy(alpha = 0.35f),
                    fontSize = 12.sp,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .navigationBarsPadding()
                        .padding(bottom = 26.dp),
                )
            }
        }
    }
}
