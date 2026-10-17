package app.kuchupuchu.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import kotlin.math.min

/**
 * Owner round 33: the scanner's viewfinder frame.
 *
 * The zxing default draws a translucent mask outside the scan area and a
 * laser line inside it — no border. The owner named the missing border
 * explicitly, so the four corner brackets are drawn here, in the app's
 * accent blue, on top of the library's mask.
 *
 * The view is a fixed square that matches the framing rect the library is
 * given in the layout (250dp), so the brackets and the decoded area are
 * the same box.
 */
class KpScanFrameView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {
    private val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3f * resources.displayMetrics.density
            strokeCap = Paint.Cap.ROUND
            color = Color.parseColor("#5AA9FF")
        }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val len = min(w, h) * 0.24f
        // top-left
        canvas.drawLine(0f, len, 0f, 0f, paint)
        canvas.drawLine(0f, 0f, len, 0f, paint)
        // top-right
        canvas.drawLine(w, len, w, 0f, paint)
        canvas.drawLine(w - len, 0f, w, 0f, paint)
        // bottom-left
        canvas.drawLine(0f, h - len, 0f, h, paint)
        canvas.drawLine(0f, h, len, h, paint)
        // bottom-right
        canvas.drawLine(w, h - len, w, h, paint)
        canvas.drawLine(w - len, h, w, h, paint)
    }
}
