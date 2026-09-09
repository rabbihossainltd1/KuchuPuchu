package app.kuchupuchu.android

import java.io.File
import java.io.RandomAccessFile

/**
 * Owner round 32 (item 33): what is INSIDE an archive, for the in-app
 * document viewer — a ZIP is read with the platform's ZipFile; a RAR (both
 * the RAR 1.5–4 and the RAR 5 header layouts) is walked by hand, headers
 * only. Nothing is extracted or decompressed: the viewer shows the table of
 * contents (name, size, folder or file) and offers Save. Encrypted
 * archives report `locked` (RAR with encrypted headers lists nothing at
 * all — the names themselves are ciphertext).
 */
object ArchiveList {
    class Entry(val path: String, val size: Long, val dir: Boolean)

    class Listing(val entries: List<Entry>, val locked: Boolean, val truncated: Boolean, val kind: String)

    private const val MAX_ENTRIES = 2000

    fun looksZip(f: File): Boolean = magic(f, 4).let { it.size == 4 && it[0] == 'P'.code.toByte() && it[1] == 'K'.code.toByte() && it[2].toInt() == 3 && it[3].toInt() == 4 }

    fun looksRar(f: File): Boolean = magic(f, 7).let { it.size == 7 && it[0] == 'R'.code.toByte() && it[1] == 'a'.code.toByte() && it[2] == 'r'.code.toByte() && it[3] == '!'.code.toByte() && it[4].toInt() == 0x1A && it[5].toInt() == 0x07 }

    private fun magic(f: File, n: Int): ByteArray =
        runCatching {
            RandomAccessFile(f, "r").use { raf ->
                val b = ByteArray(n)
                val got = raf.read(b)
                if (got == n) b else ByteArray(0)
            }
        }.getOrDefault(ByteArray(0))

    fun list(f: File): Listing? =
        when {
            looksZip(f) -> zip(f)
            looksRar(f) -> rar(f)
            else -> null
        }

    /**
     * ZIP by its central directory (the platform ZipFile throws on an
     * archive with an encrypted entry, which is exactly the one a viewer
     * still has to list). Names are UTF-8 when the entry says so (flag bit
     * 11), otherwise best-effort; ZIP64 sizes come from the extra field.
     */
    private fun zip(f: File): Listing? =
        runCatching {
            RandomAccessFile(f, "r").use { raf ->
                val len = raf.length()
                val tail = minOf(len, 65_557L)
                val buf = ByteArray(tail.toInt())
                raf.seek(len - tail)
                raf.readFully(buf)
                var eocd = -1
                var i = buf.size - 22
                while (i >= 0) {
                    if (buf[i].toInt() == 0x50 && buf[i + 1].toInt() == 0x4b && buf[i + 2].toInt() == 0x05 && buf[i + 3].toInt() == 0x06) {
                        eocd = i
                        break
                    }
                    i--
                }
                if (eocd < 0) return null
                var cdSize = le32(buf, eocd + 12)
                var cdOff = le32(buf, eocd + 16)
                if (cdOff == 0xFFFFFFFFL || cdSize == 0xFFFFFFFFL) {
                    // ZIP64: the locator sits right before the EOCD record.
                    val loc = eocd - 20
                    if (loc >= 0 && buf[loc].toInt() == 0x50 && buf[loc + 1].toInt() == 0x4b && buf[loc + 2].toInt() == 0x06 && buf[loc + 3].toInt() == 0x07) {
                        val recOff = le64(buf, loc + 8)
                        if (recOff < 0 || recOff + 56 > len) return null
                        val rec = ByteArray(56)
                        raf.seek(recOff)
                        raf.readFully(rec)
                        cdSize = le64(rec, 40)
                        cdOff = le64(rec, 48)
                    }
                }
                if (cdOff < 0 || cdSize <= 0 || cdOff + cdSize > len) return null
                val cd = ByteArray(minOf(cdSize, 8L * 1024 * 1024).toInt())
                raf.seek(cdOff)
                raf.readFully(cd)
                val out = ArrayList<Entry>()
                var locked = false
                var truncated = false
                var p = 0
                while (p + 46 <= cd.size) {
                    if (!(cd[p].toInt() == 0x50 && cd[p + 1].toInt() == 0x4b && cd[p + 2].toInt() == 0x01 && cd[p + 3].toInt() == 0x02)) break
                    if (out.size >= MAX_ENTRIES) {
                        truncated = true
                        break
                    }
                    val flags = le16(cd, p + 8)
                    var size = le32(cd, p + 24)
                    val nameLen = le16(cd, p + 28)
                    val extraLen = le16(cd, p + 30)
                    val commentLen = le16(cd, p + 32)
                    if (p + 46 + nameLen + extraLen > cd.size) break
                    if (flags and 1 != 0) locked = true
                    val name = String(cd, p + 46, nameLen, if (flags and 0x0800 != 0) Charsets.UTF_8 else Charsets.ISO_8859_1)
                    if (size == 0xFFFFFFFFL) {
                        // ZIP64 extra: id 0x0001, uncompressed size first
                        var q = p + 46 + nameLen
                        val endExtra = q + extraLen
                        while (q + 4 <= endExtra) {
                            val id = le16(cd, q)
                            val sz = le16(cd, q + 2)
                            if (id == 1 && sz >= 8 && q + 4 + 8 <= endExtra) {
                                size = le64(cd, q + 4)
                                break
                            }
                            q += 4 + sz
                        }
                    }
                    val dir = name.endsWith("/")
                    val clean = name.trimEnd('/')
                    if (clean.isNotBlank()) out += Entry(clean, if (dir) 0L else size, dir)
                    p += 46 + nameLen + extraLen + commentLen
                }
                Listing(out, locked, truncated, "zip")
            }
        }.getOrNull()

    private fun le16(b: ByteArray, at: Int): Int = (b[at].toInt() and 0xFF) or ((b[at + 1].toInt() and 0xFF) shl 8)

    private fun le32(b: ByteArray, at: Int): Long =
        (b[at].toLong() and 0xFF) or ((b[at + 1].toLong() and 0xFF) shl 8) or
            ((b[at + 2].toLong() and 0xFF) shl 16) or ((b[at + 3].toLong() and 0xFF) shl 24)

    private fun le64(b: ByteArray, at: Int): Long = le32(b, at) or (le32(b, at + 4) shl 32)

    /* ------------------------------ RAR ------------------------------ */

    private fun rar(f: File): Listing? =
        runCatching {
            RandomAccessFile(f, "r").use { raf ->
                val sig = ByteArray(8)
                raf.readFully(sig, 0, 7)
                if (sig[6].toInt() == 0x00) return rar3(raf, 7L)
                raf.seek(7)
                if (sig[6].toInt() == 0x01 && raf.read() == 0x00) return rar5(raf, 8L)
                null
            }
        }.getOrNull()

    /** RAR 1.5–4.x: 7-byte block headers `crc16 type flags size`. */
    private fun rar3(raf: RandomAccessFile, start: Long): Listing {
        val out = ArrayList<Entry>()
        var locked = false
        var truncated = false
        var pos = start
        val len = raf.length()
        val head = ByteArray(7)
        while (pos + 7 <= len && out.size < MAX_ENTRIES) {
            raf.seek(pos)
            raf.readFully(head)
            val type = head[2].toInt() and 0xFF
            val flags = le16(head, 3)
            val size = le16(head, 5)
            if (size < 7) break
            val hdr = ByteArray(size)
            raf.seek(pos)
            if (pos + size > len) break
            raf.readFully(hdr)
            var addSize = 0L
            if (flags and 0x8000 != 0 && size >= 11) addSize = le32(hdr, 7)
            when (type) {
                0x73 -> if (flags and 0x0080 != 0) locked = true // MAIN, password flag
                0x74 -> { // FILE
                    if (flags and 0x0004 != 0) locked = true // per-file password
                    if (size >= 32) {
                        var packed = le32(hdr, 7)
                        var unpacked = le32(hdr, 11)
                        val nameSize = le16(hdr, 26)
                        var p = 32
                        if (flags and 0x0100 != 0 && size >= 40) { // LARGE
                            packed = packed or (le32(hdr, 32) shl 32)
                            unpacked = unpacked or (le32(hdr, 36) shl 32)
                            p = 40
                        }
                        addSize = packed
                        if (p + nameSize <= size) {
                            val raw = hdr.copyOfRange(p, p + nameSize)
                            val name =
                                if (flags and 0x0200 != 0) rar3UnicodeName(raw)
                                else String(raw.takeWhile { it.toInt() != 0 }.toByteArray(), Charsets.UTF_8)
                            val dir = (flags and 0x00E0) == 0x00E0
                            val clean = name.replace('\\', '/').trimEnd('/')
                            if (clean.isNotBlank()) out += Entry(clean, if (dir) 0L else unpacked, dir)
                        }
                    }
                }
                0x7B -> return Listing(out, locked, truncated, "rar") // ENDARC
            }
            val next = pos + size + addSize
            if (next <= pos) break
            pos = next
        }
        if (out.size >= MAX_ENTRIES) truncated = true
        return Listing(out, locked, truncated, "rar")
    }

    /** RAR3 "unicode" names: 8-bit name, NUL, then a compressed UTF-16 patch. */
    private fun rar3UnicodeName(raw: ByteArray): String {
        val nul = raw.indexOf(0)
        if (nul < 0) return String(raw, Charsets.UTF_8)
        val std = raw.copyOfRange(0, nul)
        val enc = raw.copyOfRange(nul + 1, raw.size)
        if (enc.isEmpty()) return String(std, Charsets.UTF_8)
        val buf = java.io.ByteArrayOutputStream()
        var encPos = 0
        var pos = 0
        fun encByte(): Int = if (encPos < enc.size) enc[encPos++].toInt() and 0xFF else 0
        fun stdByte(): Int = if (pos < std.size) std[pos].toInt() and 0xFF else '?'.code
        fun put(lo: Int, hi: Int) {
            buf.write(lo)
            buf.write(hi)
            pos++
        }
        val hi = encByte()
        var flagBits = 0
        var flags = 0
        while (encPos < enc.size && buf.size() < 4096) {
            if (flagBits == 0) {
                flags = encByte()
                flagBits = 8
            }
            flagBits -= 2
            when ((flags shr flagBits) and 3) {
                0 -> put(encByte(), 0)
                1 -> put(encByte(), hi)
                2 -> {
                    val lo = encByte()
                    put(lo, encByte())
                }
                else -> {
                    val n = encByte()
                    if (n and 0x80 != 0) {
                        val c = encByte()
                        repeat((n and 0x7F) + 2) { put((stdByte() + c) and 0xFF, hi) }
                    } else {
                        repeat(n + 2) { put(stdByte(), 0) }
                    }
                }
            }
        }
        return String(buf.toByteArray(), Charsets.UTF_16LE).trimEnd('\u0000')
    }

    /** RAR 5: `crc32 vint(size) vint(type) vint(flags) [extra] [data]`. */
    private fun rar5(raf: RandomAccessFile, start: Long): Listing {
        val out = ArrayList<Entry>()
        var locked = false
        var truncated = false
        var pos = start
        val len = raf.length()
        val peek = ByteArray(16)
        while (pos + 6 <= len && out.size < MAX_ENTRIES) {
            raf.seek(pos)
            val got = raf.read(peek)
            if (got < 6) break
            var p = 4
            val (hdrLen, p1) = vint(peek, p, got) ?: break
            p = p1
            val headerSize = p + hdrLen
            if (hdrLen <= 0 || headerSize > 2L * 1024 * 1024 || pos + headerSize > len) break
            val hdr = ByteArray(headerSize.toInt())
            raf.seek(pos)
            raf.readFully(hdr)
            val (type, p2) = vint(hdr, p, hdr.size) ?: break
            val (flags, p3) = vint(hdr, p2, hdr.size) ?: break
            p = p3
            var extraSize = 0L
            var dataSize = 0L
            if (flags and 0x01 != 0L) {
                val (e, pe) = vint(hdr, p, hdr.size) ?: break
                extraSize = e
                p = pe
            }
            if (flags and 0x02 != 0L) {
                val (d, pd) = vint(hdr, p, hdr.size) ?: break
                dataSize = d
                p = pd
            }
            when (type) {
                4L -> { // ENCRYPTION: headers themselves are encrypted
                    return Listing(out, true, truncated, "rar")
                }
                2L -> { // FILE
                    val (fileFlags, a) = vint(hdr, p, hdr.size) ?: break
                    val (unpacked, b) = vint(hdr, a, hdr.size) ?: break
                    val (_, c) = vint(hdr, b, hdr.size) ?: break // attributes
                    var q = c
                    if (fileFlags and 0x02 != 0L) q += 4 // mtime
                    if (fileFlags and 0x04 != 0L) q += 4 // crc32
                    val (_, d) = vint(hdr, q, hdr.size) ?: break // compression info
                    val (_, e) = vint(hdr, d, hdr.size) ?: break // host os
                    val (nameLen, f0) = vint(hdr, e, hdr.size) ?: break
                    if (f0 + nameLen > hdr.size) break
                    val name = String(hdr, f0, nameLen.toInt(), Charsets.UTF_8).substringBefore('\u0000')
                    if (extraSize > 0 && rar5ExtraHasEncryption(hdr, (f0 + nameLen).toInt(), hdr.size)) locked = true
                    val dir = fileFlags and 0x01 != 0L
                    val clean = name.replace('\\', '/').trimEnd('/')
                    if (clean.isNotBlank()) out += Entry(clean, if (dir) 0L else unpacked, dir)
                }
                5L -> return Listing(out, locked, truncated, "rar") // ENDARC
            }
            val next = pos + headerSize + dataSize
            if (next <= pos) break
            pos = next
        }
        if (out.size >= MAX_ENTRIES) truncated = true
        return Listing(out, locked, truncated, "rar")
    }

    private fun rar5ExtraHasEncryption(hdr: ByteArray, from: Int, end: Int): Boolean {
        var p = from
        var guard = 0
        while (p < end - 1 && guard++ < 32) {
            val (size, a) = vint(hdr, p, end) ?: return false
            val (type, _) = vint(hdr, a, end) ?: return false
            if (type == 1L) return true
            p = (a + size).toInt()
            if (size <= 0) return false
        }
        return false
    }

    /** RAR5 variable-length int: 7 bits per byte, low first, high bit = more. */
    private fun vint(b: ByteArray, at: Int, end: Int): Pair<Long, Int>? {
        var res = 0L
        var shift = 0
        var p = at
        while (p < end && shift <= 63) {
            val v = b[p].toInt() and 0xFF
            res = res or ((v and 0x7F).toLong() shl shift)
            p++
            shift += 7
            if (v and 0x80 == 0) return res to p
        }
        return null
    }
}
