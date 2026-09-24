package app.kuchupuchu.android

import android.content.Context
import org.json.JSONObject

/**
 * r67-2 (owner: "massage notification a age jemon shob dekha jeto reply deoa
 * jeto ekhono same hobe massage phone a asha matroi decrypt hoye jabe. same as
 * old version").
 *
 * Before E2EE the worker's push carried the message text, so the tray card read
 * the message and Reply worked from the shade. With 1:1 bodies sealed the push
 * can only carry the envelope — the server cannot open it — so the card said
 * the lock ("🔒") and looked empty. The PHONE has the keys, so the fix belongs
 * here: the moment the push lands, open the envelope and draw the card from the
 * plaintext. Two sources, cheapest first:
 *
 *  1. `kp_env` — the sealed body the worker attaches when it fits in the FCM
 *     data budget (a data message is capped at 4 KB, so long messages skip it).
 *     Opened directly, no request.
 *  2. the newest message row: one bounded GET of the conversation's messages,
 *     find the pushed `mid`, open its body. Same page the open chat fetches, so
 *     nothing new is exposed and the row is already the one the app would show.
 *
 * If the envelope cannot be opened (our key was lost on a reinstall, the peer
 * rotated devices) the card falls back to the worker's generic label — never
 * ciphertext, exactly like [ChatPreviewText].
 */
internal object PushSeal {
    /** What the push payload says about this message. */
    data class Plan(val sealed: Boolean, val envelope: String?, val once: Boolean = false)

    /**
     * r72-20 (owner: "notification ei text show hoye jacche"): the worker labels
     * a view-once push instead of describing it — "Message · View once", "Photo ·
     * View once", "Voice · View once". That label is the whole card for such a
     * row, so this is the one thing the phone must not improve on.
     */
    fun isOnceLabel(s: String?): Boolean = s?.trim()?.endsWith("View once") == true

    /** The worker's placeholder for a sealed body (mirrors the server's preview). */
    const val LOCK = "\uD83D\uDD12"

    /**
     * What the tray card says. The opened plaintext wins; otherwise a sealed
     * body must never be printed as ciphertext or as the bare lock — the card
     * reads a neutral label, and the reply action below it still works.
     */
    fun cardText(plan: Plan, opened: String?, body: String?): String {
        val raw = body.orEmpty().trim()
        // r72-20: a view-once label WINS over the plaintext this phone could
        // open — the card (and the list row it feeds) must not print the words
        // the row itself is hiding.
        if (plan.once || isOnceLabel(raw)) return raw.ifBlank { "New message" }
        if (!opened.isNullOrBlank()) return opened
        if (raw.isEmpty()) return "New message"
        if (plan.sealed && (raw == LOCK || E2eeMsg.isEnvelope(raw))) return "New message"
        return raw
    }

    /**
     * Decide from the payload alone (pure — JVM-testable, no Android).
     *
     * `kp_e2ee` is the worker's explicit marker; a body that already IS an
     * envelope counts too, so an older worker (which only sent the preview)
     * still lands on the sealed path instead of printing ciphertext.
     */
    fun plan(kpE2ee: String?, kpEnv: String?, body: String?): Plan {
        val env = kpEnv?.trim()?.takeIf { E2eeMsg.isEnvelope(it) }
        val bodyEnv = body?.trim()?.takeIf { E2eeMsg.isEnvelope(it) }
        val sealed = kpE2ee == "1" || env != null || bodyEnv != null
        // r72-20: a view-once push spends nothing here — there is nothing the
        // card may print, so [open] / [openBounded] answer null for it.
        return Plan(sealed, env ?: bodyEnv, isOnceLabel(body))
    }

    /** The plaintext for the card, or null when this payload is not sealed / cannot be opened. */
    fun open(ctx: Context, convoId: String, mid: String?, plan: Plan): String? {
        if (!plan.sealed || plan.once) return null
        return runCatching { openInner(ctx, convoId, mid, plan) }.getOrNull()
    }

    /**
     * [open] with a hard time budget, for the FCM handler. An envelope that
     * rode the push needs no network and returns immediately; the fetch
     * fallback runs on its own thread and is abandoned after [budgetMs] —
     * the push service expects the handler to finish in seconds and would
     * otherwise kill the process with the card still unposted, i.e. NO
     * notification at all, which is strictly worse than one bare label.
     * A late result is discarded; the next list refresh carries the text.
     */
    fun openBounded(ctx: Context, convoId: String, mid: String?, plan: Plan, budgetMs: Long): String? {
        if (!plan.sealed || plan.once) return null
        if (plan.envelope != null) return open(ctx, convoId, mid, plan)
        val holder = java.util.concurrent.atomic.AtomicReference<String?>(null)
        val t =
            Thread {
                holder.set(runCatching { openInner(ctx, convoId, mid, plan) }.getOrNull())
            }
        t.isDaemon = true
        t.name = "kp-pushseal"
        t.start()
        runCatching { t.join(budgetMs) }
        return holder.get()
    }

    private fun openInner(ctx: Context, convoId: String, mid: String?, plan: Plan): String? {
        // The key is resolved ONCE and up front: with no key there is nothing to
        // open, so the fetch below must not even start — a push handler that
        // retried the lookup after the request would cost two round trips on a
        // phone that is offline anyway.
        val peer = peerKey(ctx, convoId)
        if (peer.isBlank()) return null
        // 1. the envelope rode the push (short messages).
        if (plan.envelope != null) {
            E2eeMsg.open(ctx, plan.envelope, peer)?.let { return it }
        }
        // 2. open the row the push is about. One request, the same page the
        //    chat fetches; the row's own envelope wins over a stale payload copy.
        val row = fetchRow(ctx, convoId, mid) ?: return null
        val wire = row.optText("kpEnvelope").ifBlank { row.optText("body") }
        if (!E2eeMsg.isEnvelope(wire)) return null
        return E2eeMsg.open(ctx, wire, peer)
    }

    /**
     * The peer's published message key, from the cheapest source that has one:
     * the conversation the app already cached for this chat (the same detail
     * [E2eeMsg.prepareOutgoing] uses), then the on-disk offline snapshot, and
     * only then the network — the FCM handler has seconds, so the local cache
     * has to answer whenever it can.
     */
    private fun peerKey(ctx: Context, convoId: String): String {
        fun fromConv(c: JSONObject?): String =
            c?.optJSONObject("other")?.optText("e2eePublicKey").orEmpty()
        val detailPath = "/api/conversations/$convoId"
        fromConv(Cache.peek(detailPath)?.optJSONObject("conversation"))?.let { if (it.isNotBlank()) return it }
        fromConv(ScreenStore.convDetailOf(convoId))?.let { if (it.isNotBlank()) return it }
        return runCatching {
            val data = Api.request(detailPath, "GET", null)
            Cache.put(detailPath, data)
            fromConv(data.optJSONObject("conversation"))
        }.getOrDefault("")
    }

    /** The pushed row from the newest page of its own conversation. */
    private fun fetchRow(ctx: Context, convoId: String, mid: String?): JSONObject? {
        if (mid.isNullOrBlank()) return null
        val data = runCatching { Api.get("/api/conversations/$convoId/messages") }.getOrNull() ?: return null
        val items = data.optJSONArray("items") ?: return null
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i) ?: continue
            if (row.optString("id") == mid) return row
        }
        return null
    }
}
