package app.kuchupuchu.android

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.animateLottieCompositionAsState
import com.airbnb.lottie.compose.rememberLottieComposition
import kotlinx.coroutines.delay

/**
 * Cold-start splash: plays the branded Lottie from res/raw once over the
 * dark app background, then fades into the app. A tap skips it — nobody
 * should be held hostage by a splash.
 */
@Composable
fun SplashGate(content: @Composable () -> Unit) {
    var show by remember { mutableStateOf(true) }
    var minHoldDone by remember { mutableStateOf(false) }
    val composition by rememberLottieComposition(LottieCompositionSpec.RawRes(R.raw.kuchupuchu_splash))
    val progress by animateLottieCompositionAsState(
        composition,
        iterations = 1,
        restartOnPlay = false,
    )

    // The animation is 6s at 30fps — the splash ends when it finishes.
    // A short minimum hold avoids a flash on fast devices; a tap skips.
    LaunchedEffect(composition) {
        if (composition != null) {
            delay(600)
            minHoldDone = true
        }
    }
    LaunchedEffect(progress) {
        if (progress >= 1f) show = false
    }

    Box(Modifier.fillMaxSize()) {
        content()
        AnimatedVisibility(
            visible = show && composition != null,
            exit = fadeOut(animationSpec = tween(320)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xFF12100D))
                    .clickable {
                        if (minHoldDone) show = false
                    },
                contentAlignment = Alignment.Center,
            ) {
                LottieAnimation(
                    composition = composition,
                    progress = { progress },
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
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
