package app.kuchupuchu.android

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Owner round 35: the QR screen's two tabs get their OWN glyphs — the
 * owner's own SVGs, redrawn here as ImageVectors so nothing has to be
 * shipped as a PNG: a code block with a person for "My code", and a
 * viewfinder frame for "Scan".
 *
 * Both are 24x24 outlines with a 1.5 stroke and round caps and joins,
 * painted in black and tinted by the caller — the same line-icon language
 * the app's other own glyphs (and the attach button) use.
 */
private val kpQrIconInk = SolidColor(Color.Black)
private const val kpQrIconStrokeWidth = 1.5f

/**
 * "My code": three code cells (a 7x7 rounded square each) with a dot
 * inside, and a head with shoulders beside the third one.
 */
val QrMyCodeIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "QrMyCodeIcon",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        path(
            stroke = kpQrIconInk,
            strokeLineWidth = kpQrIconStrokeWidth,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        ) {
            // One code cell: a 7x7 square with 1.5 rounded corners, drawn
            // clockwise from its top edge.
            fun cell(x: Float, y: Float) {
                moveTo(x + 1.5f, y)
                lineTo(x + 5.5f, y)
                arcTo(1.5f, 1.5f, 0f, false, true, x + 7f, y + 1.5f)
                lineTo(x + 7f, y + 5.5f)
                arcTo(1.5f, 1.5f, 0f, false, true, x + 5.5f, y + 7f)
                lineTo(x + 1.5f, y + 7f)
                arcTo(1.5f, 1.5f, 0f, false, true, x, y + 5.5f)
                lineTo(x, y + 1.5f)
                arcTo(1.5f, 1.5f, 0f, false, true, x + 1.5f, y)
                close()
            }
            cell(3f, 3f)
            cell(14f, 3f)
            cell(3f, 14f)
            // The dot inside each cell (a zero-length round-capped stroke).
            moveTo(6.5f, 6.5f)
            lineTo(6.51f, 6.5f)
            moveTo(17.5f, 6.5f)
            lineTo(17.51f, 6.5f)
            moveTo(6.5f, 17.5f)
            lineTo(6.51f, 17.5f)
            // The head: a full circle around (17.5, 15.8) with r = 1.7, drawn
            // as two half arcs in the same direction.
            moveTo(15.8f, 15.8f)
            arcTo(1.7f, 1.7f, 0f, false, true, 19.2f, 15.8f)
            arcTo(1.7f, 1.7f, 0f, false, true, 15.8f, 15.8f)
            // The shoulders.
            moveTo(14.5f, 21f)
            curveTo(14.5f, 19.2f, 15.8f, 18f, 17.5f, 18f)
            curveTo(19.2f, 18f, 20.5f, 19.2f, 20.5f, 21f)
        }
    }.build()
}

/**
 * "Scan": four viewfinder corners with a scanner line across the middle.
 */
val QrScanIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "QrScanIcon",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        path(
            stroke = kpQrIconInk,
            strokeLineWidth = kpQrIconStrokeWidth,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        ) {
            // Top-left corner.
            moveTo(4f, 8f)
            lineTo(4f, 6f)
            arcTo(2f, 2f, 0f, false, true, 6f, 4f)
            lineTo(8f, 4f)
            // Top-right corner.
            moveTo(16f, 4f)
            lineTo(18f, 4f)
            arcTo(2f, 2f, 0f, false, true, 20f, 6f)
            lineTo(20f, 8f)
            // Bottom-right corner.
            moveTo(20f, 16f)
            lineTo(20f, 18f)
            arcTo(2f, 2f, 0f, false, true, 18f, 20f)
            lineTo(16f, 20f)
            // Bottom-left corner.
            moveTo(8f, 20f)
            lineTo(6f, 20f)
            arcTo(2f, 2f, 0f, false, true, 4f, 18f)
            lineTo(4f, 16f)
            // The scanner line.
            moveTo(7f, 12f)
            lineTo(17f, 12f)
        }
    }.build()
}
