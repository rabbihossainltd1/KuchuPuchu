package app.kuchupuchu.android

/**
 * What a scanned KuchuPuchu QR code means, decided from its raw text alone —
 * no network call, no screen context. Kept separate from [QrScreen] so the
 * two deep-link shapes (a profile's share code, the Web login handshake) are
 * exercised by a plain JVM unit test instead of only by hand on a device.
 */
sealed class QrScanAction {
    /** `kuchupuchu://user/<code>` — resolve with `GET /api/users/by-qr/<code>`. */
    data class UserProfile(val code: String) : QrScanAction()

    /** `kuchupuchu://weblogin/<token>` — confirm with `POST /api/auth/qr/<token>/confirm`. */
    data class WebLogin(val token: String) : QrScanAction()

    /** Anything else: a stranger's QR code, a torn/partial scan, or empty content. */
    object Invalid : QrScanAction()
}

private const val USER_PREFIX = "kuchupuchu://user/"
private const val WEBLOGIN_PREFIX = "kuchupuchu://weblogin/"

fun parseQrScan(raw: String?): QrScanAction {
    val contents = raw?.trim().orEmpty()
    return when {
        contents.startsWith(USER_PREFIX) -> {
            val code = contents.removePrefix(USER_PREFIX).trim()
            if (code.isEmpty()) QrScanAction.Invalid else QrScanAction.UserProfile(code)
        }
        contents.startsWith(WEBLOGIN_PREFIX) -> {
            val token = contents.removePrefix(WEBLOGIN_PREFIX).trim()
            if (token.isEmpty()) QrScanAction.Invalid else QrScanAction.WebLogin(token)
        }
        else -> QrScanAction.Invalid
    }
}
