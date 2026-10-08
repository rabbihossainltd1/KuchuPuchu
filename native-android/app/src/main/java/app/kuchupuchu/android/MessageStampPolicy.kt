package app.kuchupuchu.android

/** The newest row stays visible; older rows reveal only when their own key is tapped. */
internal object MessageStampPolicy {
    fun isVisible(isLatestVisible: Boolean, rowKey: String, revealedKey: String): Boolean =
        isLatestVisible || (rowKey.isNotBlank() && rowKey == revealedKey)
}
