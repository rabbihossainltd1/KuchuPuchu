package app.kuchupuchu.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
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
    private val callback =
        object : MediaProjection.Callback() {
            override fun onStop() {
                main.post { onStopped() }
            }
        }

    override fun initialize(helper: SurfaceTextureHelper?, context: Context?, observer: CapturerObserver?) {
        this.helper = helper
        this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        this.width = width
        this.height = height
        val helper = helper ?: return
        val mgr = app.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mp = mgr.getMediaProjection(Activity.RESULT_OK, resultData) ?: return
        mp.registerCallback(callback, main)
        projection = mp
        observer?.onCapturerStarted(true)
        helper.setTextureSize(width, height)
        helper.startListening(this)
        display =
            mp.createVirtualDisplay(
                "kp-share",
                width,
                height,
                400,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                Surface(helper.surfaceTexture),
                null,
                null,
            )
    }

    override fun stopCapture() {
        helper?.stopListening()
        runCatching { display?.release() }
        display = null
        runCatching { projection?.unregisterCallback(callback) }
        runCatching { projection?.stop() }
        projection = null
        observer?.onCapturerStopped()
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        this.width = width
        this.height = height
        display?.resize(width, height, 400)
        helper?.setTextureSize(width, height)
    }

    override fun dispose() {
        runCatching { stopCapture() }
    }

    override fun isScreencast() = true

    override fun onFrame(frame: VideoFrame) {
        observer?.onFrameCaptured(frame)
    }
}
