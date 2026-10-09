package app.kuchupuchu.android

/** Stable ids and pure reorder rules for the four account-synced home tabs. */
internal object HomeNavOrderPolicy {
    val defaultOrder = listOf("chats", "status", "calls", "profile")

    /** Reject corrupt/partial preferences rather than hiding or duplicating a tab. */
    fun normalize(order: List<String>?): List<String> =
        if (order != null && order.size == defaultOrder.size && order.toSet() == defaultOrder.toSet()) {
            order.toList()
        } else {
            defaultOrder
        }

    /** Move one stable tab id to a slot, preserving every other tab exactly once. */
    fun move(order: List<String>, itemId: String, destination: Int): List<String> {
        val current = normalize(order)
        val from = current.indexOf(itemId)
        if (from < 0) return current
        val to = destination.coerceIn(0, current.lastIndex)
        if (from == to) return current
        return current.toMutableList().apply {
            removeAt(from)
            add(to, itemId)
        }
    }
}
