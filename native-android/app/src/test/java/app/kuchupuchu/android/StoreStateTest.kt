package app.kuchupuchu.android

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real-device report, step 2: "I changed my profile picture, but the status screen kept
 * the old one — or caught up much later."
 *
 * The status screen does not cache the picture itself: it reads [Store.me], and a photo
 * change writes it through `saveMe`. That hand-off is invisible to Compose unless `me`
 * is snapshot state — with the plain `@Volatile var` it used to be, every reader kept
 * the previous value until some unrelated recomposition swept past it ("onek onek late").
 *
 * So the thing to pin is not the value (a `var` round-trips just as well) but *what the
 * property is*. A delegated property compiles to a synthetic `<name>$delegate` field; a
 * `@Volatile var` has no such field, and a `var me: JSONObject? = null` regression would
 * pass every other test in this module while putting the bug straight back.
 */
class StoreStateTest {
    private fun delegateField() = Store::class.java.getDeclaredField("me\$delegate")

    @Test
    fun `me is a delegated property, not a plain field`() {
        // Throws NoSuchFieldException if anyone writes `var me: JSONObject? = null`
        // again — which is exactly the regression this test exists for.
        val field = delegateField()
        assertTrue(
            "Store.me must delegate to Compose state, found ${field.type.name}",
            field.type.name.startsWith("androidx.compose.runtime."),
        )
    }

    @Test
    fun `the delegate is a MutableState, so a write invalidates readers`() {
        val field = delegateField()
        field.isAccessible = true
        val state = field.get(Store)
        assertTrue(
            "Store.me must be a MutableState (readers must be invalidated on write)",
            state is androidx.compose.runtime.MutableState<*>,
        )
    }
}
