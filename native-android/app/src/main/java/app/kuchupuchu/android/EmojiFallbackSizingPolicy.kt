package app.kuchupuchu.android

/** Layout policy for the cold system-emoji text rendered while Noto Lottie loads. */
internal object EmojiFallbackSizingPolicy {
    const val LINE_HEIGHT_MULTIPLIER = 1.2f

    /** Keep the fallback's physical font size tied to the fixed dp box, not user font scale. */
    fun fontSizeSp(boxSizeDp: Float, fontScale: Float): Float = boxSizeDp / fontScale

    /** Leave vertical font-metric slack so color-emoji ink does not clip at the bottom. */
    fun lineHeightSp(fontSizeSp: Float): Float = fontSizeSp * LINE_HEIGHT_MULTIPLIER
}
