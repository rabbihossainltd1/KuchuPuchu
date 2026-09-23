package app.kuchupuchu.android

/** r66: one pending outside action; cancel never mutates the selected batch. */
internal class AttachmentExitGate {
    private var pending: (() -> Unit)? = null

    fun request(hasSelection: Boolean, action: () -> Unit): Boolean {
        if (pending != null) return false
        if (!hasSelection) {
            action()
            return true
        }
        pending = action
        return false
    }

    fun cancel() {
        pending = null
    }

    fun confirm(discard: () -> Unit) {
        val action = pending ?: return
        pending = null
        discard()
        action()
    }
}
