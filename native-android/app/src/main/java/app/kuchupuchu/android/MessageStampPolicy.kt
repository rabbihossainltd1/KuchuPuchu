package app.kuchupuchu.android

/** The newest row is visible by default; a tap toggles one row's status override. */
internal object MessageStampPolicy {
    fun isVisible(
        isLatestVisible: Boolean,
        rowKey: String,
        overrideKey: String,
        overrideVisible: Boolean = true,
    ): Boolean =
        rowKey.isNotBlank() && if (rowKey == overrideKey) overrideVisible else isLatestVisible

    fun toggleOverrideVisible(
        currentKey: String,
        currentVisible: Boolean,
        tappedKey: String,
        tappedIsLatest: Boolean,
    ): Boolean =
        if (tappedKey.isBlank()) currentVisible
        else if (currentKey == tappedKey) !currentVisible
        else !tappedIsLatest
}
