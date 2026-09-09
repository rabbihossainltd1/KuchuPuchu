package app.kuchupuchu.android

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.Inflater

/**
 * Owner round 32 (item 33): a small baseline-TIFF reader for the in-app
 * document viewer — Android has no TIFF decoder of its own, so a `.tif`
 * sent in chat used to be a dead tap.
 *
 * Reads the first image of a classic (non-Big) TIFF, either byte order:
 * bilevel (WhiteIsZero / BlackIsZero), grayscale 8 / 16 bit, palette,
 * RGB / RGBA (chunky or planar), 8 or 16 bits per sample, in strips or
 * tiles, uncompressed / PackBits / LZW / Deflate (with the horizontal
 * predictor). JPEG-in-TIFF, CCITT fax and CMYK are not handled — the
 * viewer then falls back to its plain "open elsewhere" row. The output is
 * an ARGB_8888 int array, subsampled when the picture is larger than
 * [maxSide] on either axis so a scanned A3 page never blows the heap.
 */
object TiffDecoder {
    class Image(val width: Int, val height: Int, val argb: IntArray)

    private class Ifd(val tags: Map<Int, LongArray>)

    fun looksTiff(f: File): Boolean =
        runCatching {
            RandomAccessFile(f, "r").use { raf ->
                if (raf.length() < 8) return false
                val b0 = raf.read()
                val b1 = raf.read()
                val m0 = raf.read()
                val m1 = raf.read()
                (b0 == 0x49 && b1 == 0x49 && m0 == 42 && m1 == 0) || (b0 == 0x4D && b1 == 0x4D && m0 == 0 && m1 == 42)
            }
        }.getOrDefault(false)

    fun decode(f: File, maxSide: Int = 2048): Image? =
        runCatching {
            val bytes = f.readBytes()
            decode(ByteBuffer.wrap(bytes), maxSide)
        }.getOrNull()

    private fun decode(buf: ByteBuffer, maxSide: Int): Image? {
        if (buf.limit() < 8) return null
        val b0 = buf.get(0).toInt() and 0xFF
        val b1 = buf.get(1).toInt() and 0xFF
        buf.order(
            when {
                b0 == 0x49 && b1 == 0x49 -> ByteOrder.LITTLE_ENDIAN
                b0 == 0x4D && b1 == 0x4D -> ByteOrder.BIG_ENDIAN
                else -> return null
            },
        )
        if ((buf.getShort(2).toInt() and 0xFFFF) != 42) return null
        val ifdOff = buf.getInt(4).toLong() and 0xFFFFFFFFL
        val ifd = readIfd(buf, ifdOff) ?: return null
        val t = ifd.tags
        val width = t[256]?.get(0)?.toInt() ?: return null
        val height = t[257]?.get(0)?.toInt() ?: return null
        if (width <= 0 || height <= 0 || width.toLong() * height > 80_000_000L) return null
        val bitsArr = t[258] ?: longArrayOf(1)
        val bits = bitsArr[0].toInt()
        val compression = t[259]?.get(0)?.toInt() ?: 1
        val photometric = t[262]?.get(0)?.toInt() ?: 1
        val samples = t[277]?.get(0)?.toInt() ?: 1
        val planar = t[284]?.get(0)?.toInt() ?: 1
        val predictor = t[317]?.get(0)?.toInt() ?: 1
        val extra = t[338]
        val palette = t[320]
        if (photometric !in 0..3) return null // 5 CMYK, 6 YCbCr (JPEG) not handled
        if (compression !in intArrayOf(1, 5, 8, 32773, 32946)) return null
        if (bits != 1 && bits != 8 && bits != 16) return null
        if (bits == 1 && (photometric > 1 || samples != 1)) return null
        if (samples < 1 || samples > 4) return null
        if (photometric == 3 && (palette == null || bits != 8 || samples != 1)) return null
        val alphaIndex = if (samples == 4 || (samples == 2 && photometric <= 1)) samples - 1 else -1
        val premultiplied = extra != null && extra.isNotEmpty() && extra[0] == 1L

        val tiled = t.containsKey(322) && t.containsKey(324)
        val offsets = (if (tiled) t[324] else t[273]) ?: return null
        val counts = (if (tiled) t[325] else t[279]) ?: LongArray(offsets.size) { -1L }
        val tileW = if (tiled) t[322]!![0].toInt() else width
        val tileH = if (tiled) t[323]!![0].toInt() else (t[278]?.get(0)?.toInt() ?: height).coerceIn(1, height)
        if (tileW <= 0 || tileH <= 0) return null
        val tilesAcross = (width + tileW - 1) / tileW
        val tilesDown = (height + tileH - 1) / tileH
        val planes = if (planar == 2) samples else 1
        val perPlane = tilesAcross * tilesDown
        if (offsets.size < perPlane * planes) return null

        val step = maxOf(1, (maxOf(width, height) + maxSide - 1) / maxSide)
        val outW = (width + step - 1) / step
        val outH = (height + step - 1) / step
        val argb = IntArray(outW * outH)
        val samplesPerPixelInPlane = if (planar == 2) 1 else samples
        val bytesPerSample = if (bits == 16) 2 else 1
        val rowBytes =
            if (bits == 1) (tileW + 7) / 8 else tileW * samplesPerPixelInPlane * bytesPerSample
        val tileBytes = rowBytes * tileH
        val bigEndian = buf.order() == ByteOrder.BIG_ENDIAN
        val lut = if (photometric == 3) palette!! else null
        val lutSize = 256
        // 16-bit samples: the top 8 bits are all a screen can show.
        fun readSample(data: ByteArray, at: Int): Int =
            if (bits == 16) data[if (bigEndian) at else at + 1].toInt() and 0xFF
            else data[at].toInt() and 0xFF

        for (ty in 0 until tilesDown) {
            for (tx in 0 until tilesAcross) {
                val tileIndex = ty * tilesAcross + tx
                val tiles =
                    Array(planes) { p ->
                        val i = p * perPlane + tileIndex
                        val raw = slice(buf, offsets[i], counts[i], tileBytes) ?: return null
                        val data = decompress(raw, compression, tileBytes) ?: return null
                        if (predictor == 2 && bits >= 8) undoPredictor(data, rowBytes, tileH, samplesPerPixelInPlane, bytesPerSample, bigEndian)
                        data
                    }
                val x0 = tx * tileW
                val y0 = ty * tileH
                var yy = 0
                while (yy < tileH) {
                    val y = y0 + yy
                    if (y >= height) break
                    if (y % step == 0) {
                        val oy = y / step
                        var xx = 0
                        while (xx < tileW) {
                            val x = x0 + xx
                            if (x >= width) break
                            if (x % step == 0) {
                                val ox = x / step
                                val color: Int =
                                    when {
                                        bits == 1 -> {
                                            val b = tiles[0][yy * rowBytes + (xx shr 3)].toInt() and 0xFF
                                            val bit = (b shr (7 - (xx and 7))) and 1
                                            val white = if (photometric == 0) bit == 0 else bit == 1
                                            if (white) -0x1 else -0x1000000
                                        }
                                        lut != null -> {
                                            val idx = tiles[0][yy * rowBytes + xx].toInt() and 0xFF
                                            val r = (lut.getOrElse(idx) { 0L }.toInt() shr 8) and 0xFF
                                            val g = (lut.getOrElse(lutSize + idx) { 0L }.toInt() shr 8) and 0xFF
                                            val b = (lut.getOrElse(2 * lutSize + idx) { 0L }.toInt() shr 8) and 0xFF
                                            (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                                        }
                                        else -> {
                                            val comps = IntArray(samples)
                                            for (s in 0 until samples) {
                                                val data = if (planar == 2) tiles[s] else tiles[0]
                                                val at =
                                                    if (planar == 2) yy * rowBytes + xx * bytesPerSample
                                                    else yy * rowBytes + (xx * samples + s) * bytesPerSample
                                                comps[s] = readSample(data, at)
                                            }
                                            var a = 255
                                            if (alphaIndex >= 0) a = comps[alphaIndex]
                                            var r: Int
                                            var g: Int
                                            var b: Int
                                            if (photometric == 2) {
                                                r = comps[0]
                                                g = comps[1]
                                                b = comps[2]
                                            } else {
                                                var v = comps[0]
                                                if (photometric == 0) v = 255 - v
                                                r = v
                                                g = v
                                                b = v
                                            }
                                            if (a in 1..254 && premultiplied) {
                                                r = (r * 255 / a).coerceAtMost(255)
                                                g = (g * 255 / a).coerceAtMost(255)
                                                b = (b * 255 / a).coerceAtMost(255)
                                            }
                                            if (a < 255) {
                                                // flatten on white: documents are read on paper
                                                r = (r * a + 255 * (255 - a)) / 255
                                                g = (g * a + 255 * (255 - a)) / 255
                                                b = (b * a + 255 * (255 - a)) / 255
                                            }
                                            (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                                        }
                                    }
                                argb[oy * outW + ox] = color
                            }
                            xx++
                        }
                    }
                    yy++
                }
            }
        }
        return Image(outW, outH, argb)
    }

    private fun readIfd(buf: ByteBuffer, off: Long): Ifd? {
        if (off < 8 || off + 2 > buf.limit()) return null
        val n = buf.getShort(off.toInt()).toInt() and 0xFFFF
        if (n == 0 || n > 512) return null
        val tags = HashMap<Int, LongArray>()
        var p = off.toInt() + 2
        repeat(n) {
            if (p + 12 > buf.limit()) return null
            val tag = buf.getShort(p).toInt() and 0xFFFF
            val type = buf.getShort(p + 2).toInt() and 0xFFFF
            val count = buf.getInt(p + 4).toLong() and 0xFFFFFFFFL
            val size = typeSize(type)
            if (size > 0 && count in 1..1_000_000L) {
                val total = size * count
                val valueAt = if (total <= 4) p + 8 else (buf.getInt(p + 8).toLong() and 0xFFFFFFFFL).toInt()
                if (valueAt >= 0 && valueAt + total <= buf.limit()) {
                    val vals = LongArray(count.toInt())
                    for (i in 0 until count.toInt()) {
                        val at = valueAt + i * size
                        vals[i] =
                            when (type) {
                                1, 2, 6, 7 -> (buf.get(at).toLong() and 0xFF)
                                3, 8 -> (buf.getShort(at).toLong() and 0xFFFF)
                                4, 9 -> (buf.getInt(at).toLong() and 0xFFFFFFFFL)
                                else -> 0L
                            }
                    }
                    tags[tag] = vals
                }
            }
            p += 12
        }
        return Ifd(tags)
    }

    private fun typeSize(type: Int): Int =
        when (type) {
            1, 2, 6, 7 -> 1
            3, 8 -> 2
            4, 9, 11 -> 4
            5, 10, 12 -> 8
            else -> 0
        }

    private fun slice(buf: ByteBuffer, off: Long, count: Long, fallback: Int): ByteArray? {
        val n = if (count > 0) count else fallback.toLong()
        if (off < 0 || n <= 0 || off + n > buf.limit()) return null
        val out = ByteArray(n.toInt())
        for (i in 0 until n.toInt()) out[i] = buf.get((off + i).toInt())
        return out
    }

    private fun decompress(raw: ByteArray, compression: Int, expect: Int): ByteArray? =
        when (compression) {
            1 -> if (raw.size >= expect) raw else raw.copyOf(expect)
            32773 -> packBits(raw, expect)
            5 -> lzw(raw, expect)
            8, 32946 -> inflate(raw, expect)
            else -> null
        }

    private fun packBits(src: ByteArray, expect: Int): ByteArray {
        val out = ByteArray(expect)
        var i = 0
        var o = 0
        while (i < src.size && o < expect) {
            val n = src[i++].toInt()
            when {
                n >= 0 -> {
                    val len = minOf(n + 1, src.size - i, expect - o)
                    System.arraycopy(src, i, out, o, len)
                    i += len
                    o += len
                }
                n != -128 -> {
                    if (i >= src.size) break
                    val v = src[i++]
                    val len = minOf(1 - n, expect - o)
                    java.util.Arrays.fill(out, o, o + len, v)
                    o += len
                }
            }
        }
        return out
    }

    private fun inflate(src: ByteArray, expect: Int): ByteArray? =
        runCatching {
            val inf = Inflater()
            inf.setInput(src)
            val out = ByteArray(expect)
            var o = 0
            while (o < expect && !inf.finished()) {
                val n = inf.inflate(out, o, expect - o)
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break
                o += n
            }
            inf.end()
            out
        }.getOrNull()

    /** TIFF LZW (MSB-first codes, early change), the variant every writer emits. */
    private fun lzw(src: ByteArray, expect: Int): ByteArray? {
        val out = ByteArrayOutputStream(expect)
        val prefix = IntArray(4096)
        val suffix = ByteArray(4096)
        val lengths = IntArray(4096)
        for (i in 0 until 256) {
            suffix[i] = i.toByte()
            lengths[i] = 1
            prefix[i] = -1
        }
        var next = 258
        var codeLen = 9
        var bitPos = 0L
        val totalBits = src.size.toLong() * 8
        var old = -1
        val stack = ByteArray(4096)
        fun readCode(): Int {
            if (bitPos + codeLen > totalBits) return 257
            var v = 0
            for (k in 0 until codeLen) {
                val bp = bitPos + k
                val bit = (src[(bp shr 3).toInt()].toInt() shr (7 - (bp and 7).toInt())) and 1
                v = (v shl 1) or bit
            }
            bitPos += codeLen
            return v
        }
        fun emit(code: Int): Byte {
            var c = code
            var n = lengths[c]
            var first: Byte = 0
            var i = n - 1
            while (c >= 0 && i >= 0) {
                stack[i] = suffix[c]
                first = suffix[c]
                c = prefix[c]
                i--
            }
            out.write(stack, 0, n)
            return first
        }
        while (out.size() < expect) {
            val code = readCode()
            if (code == 257) break
            if (code == 256) {
                next = 258
                codeLen = 9
                val c = readCode()
                if (c == 257) break
                if (c > 255) return null
                emit(c)
                old = c
                continue
            }
            if (old < 0) return null
            val first: Byte
            if (code < next) {
                first = emit(code)
                if (next < 4096) {
                    prefix[next] = old
                    suffix[next] = first
                    lengths[next] = lengths[old] + 1
                    next++
                }
            } else if (code == next) {
                // KwKwK case: old string + its first byte
                var c = old
                while (prefix[c] >= 0) c = prefix[c]
                first = suffix[c]
                if (next < 4096) {
                    prefix[next] = old
                    suffix[next] = first
                    lengths[next] = lengths[old] + 1
                    next++
                }
                emit(code)
            } else {
                return null
            }
            old = code
            if (next + 1 >= (1 shl codeLen) && codeLen < 12) codeLen++
        }
        val res = out.toByteArray()
        return if (res.size >= expect) res else res.copyOf(expect)
    }

    private fun undoPredictor(data: ByteArray, rowBytes: Int, rows: Int, spp: Int, bps: Int, bigEndian: Boolean) {
        val stride = spp * bps
        for (r in 0 until rows) {
            val base = r * rowBytes
            if (base + rowBytes > data.size) break
            if (bps == 1) {
                for (i in stride until rowBytes) data[base + i] = (data[base + i] + data[base + i - stride]).toByte()
            } else {
                // 16-bit predictor: whole samples in the file's byte order
                val hiOff = if (bigEndian) 0 else 1
                val loOff = 1 - hiOff
                var i = stride
                while (i + 1 < rowBytes) {
                    val prev =
                        ((data[base + i - stride + hiOff].toInt() and 0xFF) shl 8) or
                            (data[base + i - stride + loOff].toInt() and 0xFF)
                    val cur =
                        ((data[base + i + hiOff].toInt() and 0xFF) shl 8) or
                            (data[base + i + loOff].toInt() and 0xFF)
                    val sum = (prev + cur) and 0xFFFF
                    data[base + i + hiOff] = (sum shr 8).toByte()
                    data[base + i + loOff] = sum.toByte()
                    i += 2
                }
            }
        }
    }
}
