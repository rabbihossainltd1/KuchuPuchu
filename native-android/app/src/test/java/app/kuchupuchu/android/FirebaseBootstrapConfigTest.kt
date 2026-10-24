package app.kuchupuchu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirebaseBootstrapConfigTest {
    private val valid = FirebaseBootstrapConfig("1:123:android:abc", "public-api-key", "project", "123")

    @Test
    fun `all public identifiers are required for cold restoration`() {
        assertTrue(valid.isComplete())
        assertFalse(valid.copy(applicationId = "").isComplete())
        assertFalse(valid.copy(apiKey = " ").isComplete())
        assertFalse(valid.copy(projectId = "").isComplete())
        assertFalse(valid.copy(senderId = "").isComplete())
    }
}
