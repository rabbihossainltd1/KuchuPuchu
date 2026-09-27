package app.kuchupuchu.android

/** r66: pure, JVM-tested rules shared by every personal-message send path. */
internal object E2eeSendPolicy {
    fun protectsKind(kind: String): Boolean =
        kind.ifBlank { "TEXT" } in setOf("TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE")

    /** Never downgrade a personal message when either key is not ready. */
    fun protectBody(
        plain: String,
        personal: Boolean,
        ready: Boolean,
        seal: (String) -> String?,
    ): String {
        if (plain.isBlank() || !personal) return plain
        check(ready) { "Waiting for secure chat." }
        if (plain.startsWith("KP1.")) return plain
        val sealed = seal(plain)
        check(sealed != null && sealed.startsWith("KP1.")) { "Waiting for secure chat." }
        return sealed
    }
}

/**
 * A successful publication belongs to ONE authenticated session. Failed or
 * overlapping attempts never latch success, and an account switch cannot
 * inherit the old account's acknowledgement. No Android/Compose state here.
 */
internal class E2eePublicationGate {
    private var publishedSession = ""

    /** r76-26: adopting a restored identity invalidates the last publication — the next app-entry tick republishes the restored public key. */
    @Synchronized
    fun reset() {
        publishedSession = ""
    }

    @Synchronized
    fun ensure(session: String, current: () -> Boolean, publish: () -> Boolean): Boolean {
        if (session.isBlank() || !current()) return false
        if (publishedSession == session) return true
        val ok = runCatching { publish() }.getOrDefault(false)
        if (!ok || !current()) return false
        publishedSession = session
        return true
    }
}
