package app.kuchupuchu.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Owner round 28: the phone book, matched against KuchuPuchu.
 *
 * `sync()` reads the device contacts (READ_CONTACTS must already be granted —
 * the screens ask), normalises every number to E.164 (the phone's own SIM
 * country decides what a local number means; Bangladesh by default), sends the
 * distinct numbers to `/api/contacts/match` and keeps the answer in memory +
 * on disk. The server stores nothing: it answers which numbers are accounts and
 * forgets the list.
 *
 * Two products read the result: the All-contacts screen (KP users → Chat,
 * everyone else → Invite) and global search (KP users from the phone book
 * surface under "People" even when the query is their phone-book name, which
 * the server cannot know).
 */
object PhoneBook {
    /** One phone-book entry (already E.164) — `user` is set when it is a KP account. */
    class Entry(val name: String, val phone: String, var user: JSONObject? = null)

    val entries = mutableStateListOf<Entry>()
    val syncing = mutableStateOf(false)
    val syncedAt = mutableStateOf(0L)
    private var file: java.io.File? = null

    /**
     * Owner round 33 (item 14): the phone book changed — or the last match
     * request failed — since the last sync, so the next [sync] ignores the
     * 10-minute throttle. Set by [markDirty] ("Add contact" hands the person
     * to the phone's Contacts app: the book changes AFTER we come back), by
     * the contacts ContentObserver below, and by a sync that could not reach
     * the server. Before this, a friend saved to the phone book kept showing
     * "Add contact" until the next cold start.
     */
    @Volatile
    private var dirty = false

    fun markDirty() {
        dirty = true
    }

    fun init(ctx: Context) {
        file = java.io.File(ctx.applicationContext.filesDir, "kp-contacts.json")
        // Best-effort: a change in the phone's contacts (any app) flags the
        // match stale; the resume sync picks it up.
        runCatching {
            ctx.applicationContext.contentResolver.registerContentObserver(
                ContactsContract.Contacts.CONTENT_URI,
                true,
                object : android.database.ContentObserver(null) {
                    override fun onChange(selfChange: Boolean) {
                        dirty = true
                    }
                },
            )
        }
        val f = file ?: return
        Thread {
            runCatching {
                if (!f.exists()) return@Thread
                val o = JSONObject(f.readText())
                val arr = o.optJSONArray("items") ?: JSONArray()
                val list = ArrayList<Entry>()
                for (i in 0 until arr.length()) {
                    val e = arr.getJSONObject(i)
                    list.add(Entry(e.optString("name"), e.optString("phone"), e.optJSONObject("user")))
                }
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    if (entries.isEmpty()) {
                        entries.addAll(list)
                        syncedAt.value = o.optLong("at", 0L)
                    }
                }
            }
        }.start()
    }

    fun granted(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    /** KP users found in the phone book (for search + the top of All contacts). */
    fun kpUsers(): List<Entry> = entries.filter { it.user != null }

    /** Phone-book name for a KP user id, when the person is in the contacts. */
    fun nameFor(userId: String): String? =
        entries.firstOrNull { it.user?.optString("id") == userId }?.name

    /**
     * Owner round 33 (item 14): the NUMBER itself is in the phone book — the
     * second way to know a person, for when the server match is stale or
     * their account carries a number the match could not hit.
     */
    fun hasNumber(phone: String?): Boolean {
        val p = phone?.trim().orEmpty()
        if (p.isBlank()) return false
        val e164 = toE164(p, DEFAULT_COUNTRY) ?: p
        return entries.any { it.phone == e164 || it.phone == p }
    }

    /**
     * Phone-book KP users whose contact name, display name or username contains
     * `q` — the search screen merges these into the server's "People" section.
     */
    fun search(q: String): List<Entry> {
        val needle = q.trim().lowercase().removePrefix("@")
        if (needle.length < 2) return emptyList()
        return kpUsers().filter { e ->
            e.name.lowercase().contains(needle) ||
                e.user?.optString("displayName").orEmpty().lowercase().contains(needle) ||
                e.user?.optString("username").orEmpty().lowercase().contains(needle) ||
                e.phone.contains(needle)
        }
    }

    /**
     * Read + match. Safe to call often: it no-ops while a sync is running and,
     * unless `force`, when the last one is under 10 minutes old. Runs the
     * blocking work on the calling thread — call it from Dispatchers.IO.
     */
    fun sync(ctx: Context, force: Boolean = false) {
        val app = ctx.applicationContext
        if (!granted(app)) return
        if (syncing.value) return
        val fresh = System.currentTimeMillis() - syncedAt.value < 10 * 60_000L
        if (!force && !dirty && fresh && entries.isNotEmpty()) return
        syncing.value = true
        dirty = false
        try {
            val book = readPhoneBook(app)
            val phones = book.map { it.phone }.distinct()
            val users = HashMap<String, JSONObject>()
            // Owner round 33 (item 14): a chunk whose match request failed (an
            // offline launch) keeps the users the LAST sync found for those
            // numbers and leaves the sync dirty, so the next one retries. The
            // whole book used to come back with nobody matched and the
            // 10-minute throttle then pinned "Add contact" on every friend.
            val previous = entries.associateBy({ it.phone }, { it.user })
            var failed = false
            // 500 numbers per request keeps the body small on slow links; the
            // server accepts up to 2000.
            phones.chunked(500).forEach { chunk ->
                runCatching {
                    val res = Api.post("/api/contacts/match", JSONObject().put("phones", JSONArray(chunk)))
                    res.arr("users").objects().forEach { u -> users[u.optString("phone")] = u }
                }.onFailure {
                    failed = true
                    chunk.forEach { p -> previous[p]?.let { users[p] = it } }
                }
            }
            book.forEach { e -> e.user = users[e.phone] }
            val sorted =
                book.sortedWith(compareBy<Entry>({ it.user == null }, { it.name.lowercase() }))
            val stamp = if (failed) syncedAt.value else System.currentTimeMillis()
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                entries.clear()
                entries.addAll(sorted)
                syncedAt.value = stamp
                syncing.value = false
            }
            if (failed) dirty = true
            persist(sorted, stamp)
        } catch (_: Exception) {
            dirty = true
            android.os.Handler(android.os.Looper.getMainLooper()).post { syncing.value = false }
        }
    }

    fun clear() {
        entries.clear()
        syncedAt.value = 0L
        runCatching { file?.delete() }
    }

    private fun persist(list: List<Entry>, at: Long) {
        val f = file ?: return
        runCatching {
            val arr = JSONArray()
            list.forEach { e ->
                arr.put(
                    JSONObject().put("name", e.name).put("phone", e.phone).apply { e.user?.let { put("user", it) } },
                )
            }
            f.writeText(JSONObject().put("at", at).put("items", arr).toString())
        }
    }

    /** Every (name, E.164 number) pair in the phone book, one entry per number. */
    private fun readPhoneBook(ctx: Context): List<Entry> {
        val home = homeCountry(ctx)
        val out = LinkedHashMap<String, Entry>()
        val cursor =
            ctx.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER,
                    ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER,
                ),
                null,
                null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC",
            ) ?: return emptyList()
        cursor.use { c ->
            val iName = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val iNum = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            val iNorm = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER)
            while (c.moveToNext()) {
                val name = (if (iName >= 0) c.getString(iName) else null).orEmpty().trim()
                val norm = if (iNorm >= 0) c.getString(iNorm) else null
                val raw = if (iNum >= 0) c.getString(iNum) else null
                val e164 = toE164(norm ?: "", home) ?: toE164(raw ?: "", home) ?: continue
                if (out.containsKey(e164)) continue
                out[e164] = Entry(name.ifBlank { e164 }, e164)
            }
        }
        return out.values.toList()
    }

    /** The SIM's country (falls back to the network, then Bangladesh). */
    private fun homeCountry(ctx: Context): KpCountry {
        val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? android.telephony.TelephonyManager
        val iso =
            tm?.simCountryIso?.takeIf { it.length == 2 }
                ?: tm?.networkCountryIso?.takeIf { it.length == 2 }
                ?: java.util.Locale.getDefault().country
        return COUNTRIES.firstOrNull { it.iso.equals(iso, ignoreCase = true) } ?: DEFAULT_COUNTRY
    }

    /**
     * "+880 17xx", "0088017xx", "017xx", "88017xx" → "+88017xxxxxxxx". Returns
     * null for anything that cannot be a full international number (short
     * codes, star codes, service numbers).
     */
    fun toE164(raw: String, home: KpCountry): String? {
        // Owner round 33 (item 14): Bengali / Arabic-Indic digits (a number
        // saved from a Bangla keyboard) become ASCII — they used to fail the
        // ASCII regex below and the contact silently dropped out of the match.
        var d =
            raw.mapNotNull { c ->
                when {
                    c == '+' -> c
                    c.isDigit() -> Character.digit(c, 10).takeIf { it >= 0 }?.let { '0' + it }
                    else -> null
                }
            }.joinToString("")
        if (d.isEmpty()) return null
        if (d.startsWith("00")) d = "+" + d.drop(2)
        val full =
            when {
                d.startsWith("+") -> d.drop(1).filter { it.isDigit() }
                d.startsWith(home.dial) && d.length >= home.dial.length + 8 -> d
                else -> home.dial + d.dropWhile { it == '0' }
            }
        if (!Regex("^[1-9]\\d{7,14}$").matches(full)) return null
        return "+$full"
    }
}
