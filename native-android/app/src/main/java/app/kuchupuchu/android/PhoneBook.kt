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

    fun init(ctx: Context) {
        file = java.io.File(ctx.applicationContext.filesDir, "kp-contacts.json")
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
        if (!force && System.currentTimeMillis() - syncedAt.value < 10 * 60_000L && entries.isNotEmpty()) return
        syncing.value = true
        try {
            val book = readPhoneBook(app)
            val phones = book.map { it.phone }.distinct()
            val users = HashMap<String, JSONObject>()
            // 500 numbers per request keeps the body small on slow links; the
            // server accepts up to 2000.
            phones.chunked(500).forEach { chunk ->
                runCatching {
                    val res = Api.post("/api/contacts/match", JSONObject().put("phones", JSONArray(chunk)))
                    res.arr("users").objects().forEach { u -> users[u.optString("phone")] = u }
                }
            }
            book.forEach { e -> e.user = users[e.phone] }
            val sorted =
                book.sortedWith(compareBy<Entry>({ it.user == null }, { it.name.lowercase() }))
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                entries.clear()
                entries.addAll(sorted)
                syncedAt.value = System.currentTimeMillis()
                syncing.value = false
            }
            persist(sorted)
        } catch (_: Exception) {
            android.os.Handler(android.os.Looper.getMainLooper()).post { syncing.value = false }
        }
    }

    fun clear() {
        entries.clear()
        syncedAt.value = 0L
        runCatching { file?.delete() }
    }

    private fun persist(list: List<Entry>) {
        val f = file ?: return
        runCatching {
            val arr = JSONArray()
            list.forEach { e ->
                arr.put(
                    JSONObject().put("name", e.name).put("phone", e.phone).apply { e.user?.let { put("user", it) } },
                )
            }
            f.writeText(JSONObject().put("at", System.currentTimeMillis()).put("items", arr).toString())
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
        var d = raw.filter { it.isDigit() || it == '+' }
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
