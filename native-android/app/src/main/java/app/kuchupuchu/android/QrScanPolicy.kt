package app.kuchupuchu.android

/**
 * What a scanned KuchuPuchu QR code means, decided from its raw text alone —
 * no network call, no screen context. Kept separate from [QrScreen] so the
 * deep-link shapes (a profile's share code, the Web login handshake) are
 * exercised by a plain JVM unit test instead of only by hand on a device.
 */
sealed class QrScanAction {
    /** `kuchupuchu://user/<code>` — resolve with `GET /api/users/by-qr/<code>`. */
    data class UserProfile(val code: String) : QrScanAction()

    /**
     * Owner round 120 (2026-10-21): the QR payload is the public share link
     * (https://kuchupuchu.web.app/@handle). Scanning one INSIDE the scanner
     * (a friend's print-out, a screenshot) resolves the handle through
     * `GET /api/users/username/<handle>` and shows the same profile preview.
     */
    data class UserHandle(val handle: String) : QrScanAction()

    /**
     * Owner 2026-10-26 (item 6): a VintoxBd profile link —
     * https://vintoxbd.online/@handle, the same address the VX QR encodes.
     * Scanning it resolves the VX account and shows its profile preview in
     * this app first; the chat opens from there.
     */
    data class VxUserHandle(val handle: String) : QrScanAction()

    /** `kuchupuchu://weblogin/<token>` — confirm with `POST /api/auth/qr/<token>/confirm`. */
    data class WebLogin(val token: String) : QrScanAction()

    /**
     * Owner 2026-10-29: the VintoxBd "Link KP" page now INITIATES the link
     * itself and shows https://vintoxbd.online/link/<id>?sig=<signature> as a
     * QR code. Scanning it here (the KP side is the decider for a VX-initiated
     * ceremony) offers the one-tap confirm, then
     * `POST /api/links/approvals/<id>/approve` completes the binding.
     */
    data class VxLinkApproval(val id: String, val signature: String) : QrScanAction()

    /** Anything else: a stranger's QR code, a torn/partial scan, or empty content. */
    object Invalid : QrScanAction()
}

private const val USER_PREFIX = "kuchupuchu://user/"
private const val WEBLOGIN_PREFIX = "kuchupuchu://weblogin/"
private val SHARE_HOSTS = setOf("kuchupuchu.web.app", "kuchupuchu.firebaseapp.com")
private const val VX_SHARE_HOST = "vintoxbd.online"
private val HANDLE_RE = Regex("^[a-z0-9_]{3,30}$")

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
        contents.startsWith("https://") || contents.startsWith("http://") -> parseShareLink(contents)
        else -> QrScanAction.Invalid
    }
}

/** https://kuchupuchu.web.app/@handle (one path segment, optional slash). Parsed
 * by hand, not android.net.Uri, so this stays a plain-JVM-testable function. */
private fun parseShareLink(contents: String): QrScanAction {
    val afterScheme = contents.substringAfter("://", missingDelimiterValue = "")
    if (afterScheme.isEmpty()) return QrScanAction.Invalid
    val host = afterScheme.substringBefore('/').substringBefore(':').lowercase()
    if (host !in SHARE_HOSTS && host != VX_SHARE_HOST) return QrScanAction.Invalid
    // Path only — a query string or fragment is not part of the handle.
    val path = afterScheme.substringAfter('/', "").substringBefore('?').substringBefore('#')
    val segments = path.split('/').filter { it.isNotEmpty() }
    // Owner 2026-10-29: the VX Link-KP QR — /link/<approvalId>?sig=<signature>.
    // A /link/ path in any other shape is a torn scan, never a handle.
    if (host == VX_SHARE_HOST && segments.firstOrNull() == "link" && segments.size != 2) {
        return QrScanAction.Invalid
    }
    if (host == VX_SHARE_HOST && segments.size == 2 && segments[0] == "link") {
        val approvalId = segments[1]
        val query = contents.substringAfter('?', "").substringBefore('#')
        val signature = query.split('&').firstNotNullOfOrNull { part ->
            val kv = part.split('=', limit = 2)
            if (kv.size == 2 && (kv[0] == "sig" || kv[0] == "signature")) {
                runCatching { java.net.URLDecoder.decode(kv[1], "UTF-8") }.getOrNull()
            } else {
                null
            }
        } ?: ""
        return if (approvalId.matches(Regex("^[A-Za-z0-9_-]{1,128}$")) && signature.length >= 16) {
            QrScanAction.VxLinkApproval(approvalId, signature)
        } else {
            QrScanAction.Invalid
        }
    }
    if (segments.size != 1) return QrScanAction.Invalid
    val handle = segments[0].removePrefix("@").lowercase().trim()
    if (!handle.matches(HANDLE_RE)) return QrScanAction.Invalid
    return if (host == VX_SHARE_HOST) QrScanAction.VxUserHandle(handle) else QrScanAction.UserHandle(handle)
}
