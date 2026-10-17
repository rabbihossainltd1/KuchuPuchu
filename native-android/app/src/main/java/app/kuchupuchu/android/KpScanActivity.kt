package app.kuchupuchu.android

import android.os.Bundle
import android.view.WindowManager
import android.widget.TextView
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/**
 * Owner round 33: our own QR capture activity.
 *
 * The zxing default capture activity had two problems the owner named:
 *
 *  1. It painted NO frame around the scan area — only a translucent mask
 *     and a laser line — so the camera view had no visible border at all.
 *     This activity draws a real viewfinder (four corner brackets) in the
 *     app's accent blue, over the library's own mask.
 *  2. It followed the device's rotation, so a portrait app handed the
 *     camera a sideways preview and the phone had to be turned over to
 *     read a code. The activity is locked to portrait in the manifest, and
 *     the scan area is a fixed, centred square so the frame and the
 *     library's framing rect are the same box.
 *
 * Everything else (decode, camera lifecycle, the result contract) is the
 * library's own: the activity only replaces the layout.
 */
class KpScanActivity : CaptureActivity() {
    override fun initializeContent(): DecoratedBarcodeView {
        setContentView(R.layout.kp_scan_capture)
        findViewById<TextView>(R.id.kp_scan_close)?.setOnClickListener { finish() }
        val scanner = findViewById<DecoratedBarcodeView>(R.id.kp_scan_viewfinder)
        scanner.setStatusText("Point the camera at a KuchuPuchu code")
        return scanner
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A scan is a short, deliberate act: the screen must not dim or
        // sleep in the middle of it.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
