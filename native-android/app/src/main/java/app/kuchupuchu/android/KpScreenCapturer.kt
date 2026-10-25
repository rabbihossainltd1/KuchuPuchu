package app.kuchupuchu.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.view.WindowManager
import android.util.DisplayMetrics
import android.os.Handler
import android.os.Looper
import android.view.Surface
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink

class KpScreenCapturer(
    private val app: Context,
    private val resultData: Intent,
    private val onStopped: () -> Unit,
) : VideoCapturer, VideoSink {
    private var helper: SurfaceTextureHelper? = null
    private var observer: CapturerObserver? = null
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var width = 720
    private var height = 1280
    private val main = Handler(Looper.getMainLooper())
    private val displayManager = app.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(id: Int) {}
        override fun onDisplayRemoved(id: Int) {}
        override fun onDisplayChanged(id: Int) {
            if (Build.VERSION.SDK_INT < 34 && projection != null) {
                val size = screenSize()
                resizeTo(size.first, size.second)
            }
        }
    }
    private fun screenSize(): Pair<Int, Int> {
        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            metrics.widthPixels to metrics.heightPixels
        }
    }
    private fun resizeTo(sourceWidth: Int, sourceHeight: Int) {
        if (sourceWidth <= 0 || sourceHeight <= 0) return
        val scale = minOf(1.0, 1280.0 / maxOf(sourceWidth, sourceHeight))
        val w = maxOf(2, (sourceWidth * scale).toInt() / 2 * 2)
        val h = maxOf(2, (sourceHeight * scale).toInt() / 2 * 2)
        if (w == width && h == height) return
        width = w
        height = h
        helper?.setTextureSize(w, h)
        display?.resize(w, h, app.resources.displayMetrics.densityDpi)
    }
    private val callback =
        object : MediaProjection.Callback() {
            override fun onCapturedContentResize(width: Int, height: Int) {
                main.post { if (projection != null) resizeTo(width, height) }
            }
            override fun onStop() {
                main.post { onStopped() }
            }
        }

    override fun initialize(helper: SurfaceTextureHelper?, context: Context?, observer: CapturerObserver?) {
        this.helper = helper
        this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        val actual = screenSize()
        resizeTo(actual.first, actual.second)
        val helper = helper ?: return
        val mgr = app.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // Owner round 33 (item 21): a projection that will not open is a failure
        // the user gets told about (toggleShare names it) - not a share that
        // quietly sends black.
        val mp = mgr.getMediaProjection(Activity.RESULT_OK, resultData) ?: throw IllegalStateException("No media projection")
        mp.registerCallback(callback, main)
        projection = mp
        // Owner round 31 item 20: with "Share audio via screen share" on, the
        // phone's playback rides along (mixed into the mic track).
        SystemAudioTap.start(app, mp)
        observer?.onCapturerStarted(true)
        helper.setTextureSize(this.width, this.height)
        helper.startListening(this)
        display =
            mp.createVirtualDisplay(
                "kp-share",
                this.width,
                this.height,
                app.resources.displayMetrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                Surface(helper.surfaceTexture),
                null,
                null,
            )
        displayManager.registerDisplayListener(displayListener, main)
    }

    override fun stopCapture() {
        displayManager.unregisterDisplayListener(displayListener)
        SystemAudioTap.stop()
        helper?.stopListening()
        runCatching { display?.release() }
        display = null
        runCatching { projection?.unregisterCallback(callback) }
        runCatching { projection?.stop() }
        projection = null
        observer?.onCapturerStopped()
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        resizeTo(width, height)
    }

    override fun dispose() {
        runCatching { stopCapture() }
    }

    override fun isScreencast() = true

    override fun onFrame(frame: VideoFrame) {
        observer?.onFrameCaptured(frame)
    }
}
