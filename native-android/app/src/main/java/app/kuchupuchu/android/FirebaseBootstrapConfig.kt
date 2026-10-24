package app.kuchupuchu.android

/** Public Firebase identifiers only; never a session, token or service-account key. */
data class FirebaseBootstrapConfig(
    val applicationId: String,
    val apiKey: String,
    val projectId: String,
    val senderId: String,
) {
    fun isComplete(): Boolean =
        applicationId.isNotBlank() && apiKey.isNotBlank() && projectId.isNotBlank() && senderId.isNotBlank()
}
