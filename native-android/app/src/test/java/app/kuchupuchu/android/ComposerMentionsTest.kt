package app.kuchupuchu.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposerMentionsTest {
    @Test
    fun activeAtTokenFiltersAndInsertsUsername() {
        val candidates = listOf(
            ComposerMention("1", "Rahi Ahmed", "rahi"),
            ComposerMention("2", "Mina Akter", "mina"),
            ComposerMention("3", "Rabiul", "rabiul"),
        )
        assertEquals(listOf("rahi", "rabiul"), ComposerMentions.suggestions("ra", candidates).map { it.username })
        assertEquals("hello @rahi ", ComposerMentions.insert("hello @ra", candidates.first()))
        assertNull(ComposerMentions.active("email@rahi"))
    }

    @Test
    fun candidatesComeFromThisChatAndNeverIncludeSelf() {
        val conversation = JSONObject()
            .put("isGroup", true)
            .put(
                "members",
                JSONArray()
                    .put(JSONObject().put("user", JSONObject().put("id", "me").put("username", "owner").put("displayName", "Owner")))
                    .put(JSONObject().put("user", JSONObject().put("id", "peer").put("username", "rahi").put("displayName", "Rahi Ahmed")))
                    .put(JSONObject().put("user", JSONObject().put("id", "bad").put("username", "bad name").put("displayName", "Invalid"))),
            )
        val candidates = ComposerMentions.forConversation(conversation, "me")
        assertEquals(1, candidates.size)
        assertEquals("peer", candidates.single().id)
        assertTrue(ComposerMentions.suggestions("RAH", candidates).isNotEmpty())
    }
}
