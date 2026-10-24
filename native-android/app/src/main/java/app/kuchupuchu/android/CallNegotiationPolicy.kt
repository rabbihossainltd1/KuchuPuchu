package app.kuchupuchu.android

/** Initial track events belong to the first SDP, not a competing reoffer. */
internal fun canRenegotiateCall(initialSdpReady: Boolean, localSdp: Boolean, remoteSdp: Boolean): Boolean =
    initialSdpReady && localSdp && remoteSdp
