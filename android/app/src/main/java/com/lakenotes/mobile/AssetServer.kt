package com.lakenotes.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.webkit.MimeTypeMap
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * 本地资产 HTTP 服务（本地优先：canonical URL http://127.0.0.1:19876/{noteId}/{file} 在本机可达）。
 *
 * 背景：移动端编辑/查看态图片原本靠「canonical → blob 注入」显示（127.0.0.1 不可达），但 Lake 的
 * 显示机制（_displayUrl 缓存、上传完成重写 value、临时预览 blob revoke）与注入对抗，反复出现
 * 「上传后图片空白」。本服务让 canonical URL 在手机本地可达 → Lake 原生渲染，与桌面端语义一致，
 * 彻底移除 blob 注入/还原逻辑。
 *
 * 实现：ServerSocket + 固定小线程池（纯 I/O 流式，空闲零资源）。目录 = app 私有 Data/note-assets
 * （与桌面 userData/note-assets 同构，src/mobile/native/assetFs.ts 写入）。
 * 进程内共享单例：首个 start() 启动 daemon 线程随进程存活，重复 start 幂等。
 */
object AssetServer {
    private const val TAG = "LakeAssetServer"

    /** 与桌面端资源服务器一致的端口（lib/assetPort.ts ASSET_ORIGIN）。 */
    const val PORT = 19876
    private const val BACKLOG = 8
    private const val BUFFER_SIZE = 64 * 1024
    private const val POOL_SIZE = 4

    /** Capacitor 当前配置 androidScheme=http，页面固定 origin 是 http://localhost。 */
    private const val ALLOWED_ORIGIN = "http://localhost"

    /**
     * 缩略图档位（宽，px）。**必须与桌面 `src/core/assetUrl.ts` 的 `ASSET_THUMB_WIDTHS` 一致**
     * （两端同 URL 语义：同一个 `?w=128` 在桌面/安卓都取同一档）。档位离散是关键——连续值会把
     * WebView 磁盘缓存与桌面内存缓存一起打散。
     */
    private val THUMB_WIDTHS = setOf(128, 256, 512, 1024)

    /** JPEG 缩略图质量（PNG 忽略该参数）。 */
    private const val THUMB_JPEG_QUALITY = 85

    @Volatile
    private var sServerSocket: ServerSocket? = null

    @Volatile
    private var sExecutor: ExecutorService? = null

    @Volatile
    private var sToken: String? = null
    private val sAccepting = AtomicBoolean(false)

    /** 幂等启动（MainActivity.onCreate 调用；daemon 线程随进程退出自动结束）。 */
    @Synchronized
    fun start(context: Context): String? {
        if (sServerSocket != null) return sToken
        val token = randomToken()
        return try {
            val ss = ServerSocket(PORT, BACKLOG, InetAddress.getByName("127.0.0.1"))
            sServerSocket = ss
            sToken = token
            val counter = AtomicInteger(0)
            val ex = Executors.newFixedThreadPool(POOL_SIZE, ThreadFactory { r ->
                Thread(r, "lake-asset-" + counter.incrementAndGet()).apply { isDaemon = true }
            })
            sExecutor = ex
            sAccepting.set(true)
            val acceptor = Thread(Runnable { acceptLoop(ss, ex, context.applicationContext) }, "lake-asset-accept")
            acceptor.isDaemon = true
            acceptor.start()
            Log.i(TAG, "asset server listening on http://127.0.0.1:" + PORT)
            token
        } catch (e: IOException) {
            Log.e(TAG, "asset server start failed: " + e.message, e)
            sServerSocket = null
            sToken = null
            null
        }
    }

    private fun acceptLoop(ss: ServerSocket, ex: ExecutorService, appContext: Context) {
        while (sAccepting.get() && !ss.isClosed) {
            try {
                val socket = ss.accept()
                ex.execute { handle(socket, appContext) }
            } catch (e: IOException) {
                if (sAccepting.get()) Log.e(TAG, "accept error: " + e.message)
                break
            }
        }
    }

    private fun handle(socket: Socket, appContext: Context) {
        try {
            socket.use {
                val reader = BufferedReader(InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8), BUFFER_SIZE)
                val out = socket.getOutputStream()
                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                val isHead = parts[0].equals("HEAD", ignoreCase = true)
                if (parts.size < 2 || (!parts[0].equals("GET", ignoreCase = true) && !isHead)) {
                    writeError(out, 405, "method not allowed")
                    return
                }
                // 读取剩余请求头（捕获 Range——音频/视频 seek 需要 206 部分响应）
                var rangeHeader: String? = null
                var originHeader: String? = null
                while (true) {
                    val line = reader.readLine()
                    if (line.isNullOrEmpty()) break
                    if (line.regionMatches(0, "Range:", 0, 6, ignoreCase = true)) rangeHeader = line.substring(6).trim()
                    if (line.regionMatches(0, "Origin:", 0, 7, ignoreCase = true)) originHeader = line.substring(7).trim()
                }
                val target = parts[1]
                // 用 URI.getPath() 解码路径：URLDecoder 会把 '+' 解码成空格（小记文件名可能含 '+'），
                // URI.getPath() 保留 '+' 且自动剥离 query 段
                var uri: URI? = null
                var decoded = target
                try {
                    val parsed = URI(target)
                    uri = parsed
                    decoded = parsed.path ?: target
                    if (!isAuthorized(parsed, originHeader)) {
                        writeError(out, 403, "forbidden")
                        return
                    }
                } catch (e: Exception) {
                    writeError(out, 403, "forbidden")
                    return
                }
                val rel = if (decoded.startsWith("/")) decoded.substring(1) else decoded
                if (rel.isEmpty()) {
                    writeError(out, 404, "not found")
                    return
                }

                val root = File(appContext.filesDir, "note-assets")
                val file = File(root, rel)
                val rootCanonical = root.canonicalPath
                val fileCanonical = file.canonicalPath
                // 目录穿越防护：解析后的路径必须位于 note-assets 下
                if (!fileCanonical.startsWith(rootCanonical + File.separator)) {
                    writeError(out, 403, "forbidden")
                    return
                }
                if (!file.isFile) {
                    writeError(out, 404, "not found")
                    return
                }

                val length = file.length()
                var mime = mimeFor(file.name)
                if ("application/octet-stream" == mime) {
                    val sniffed = sniffMime(file)
                    if (sniffed != null) mime = sniffed
                }
                // ?w=<档位>：按需缩略图（不落盘、不上传、可重建）。失败或格式不支持 → 落到下面的原图分支。
                // 缩略图不参与 Range（没有 seek 需求），直接整段返回。
                val thumbWidth = uri?.let { thumbWidthFor(it) }
                if (thumbWidth != null && isThumbResizable(file.name)) {
                    val thumb = thumbBytes(file, thumbWidth)
                    if (thumb != null) {
                        writeBody(out, thumb, mime, isHead)
                        return
                    }
                }
                // Range 支持（音频/视频 seek、PDF 分页）：浏览器 seek 需要 206 Partial Content + Accept-Ranges，
                // 否则 seekable 只有 [0,0]，进度条无法拖动。解析 bytes=start-end / bytes=-N / bytes=start-
                var start = -1L
                var end = -1L
                if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                    val spec = rangeHeader.substring(6).trim()
                    val dash = spec.indexOf('-')
                    if (dash >= 0) {
                        val s = spec.substring(0, dash).trim()
                        val e = spec.substring(dash + 1).trim()
                        if (s.isNotEmpty()) start = s.toLongOrNull() ?: -2L
                        if (e.isNotEmpty()) end = e.toLongOrNull() ?: -2L
                    }
                }
                var isRange = start >= 0 || end >= 0
                if (isRange && start == -1L) {
                    // bytes=-N → 最后 N 字节
                    val n = end
                    if (n > 0) {
                        start = maxOf(0L, length - n)
                        end = length - 1
                    } else {
                        isRange = false
                    }
                }
                if (isRange && start == -2L) isRange = false // 非法 start
                // bytes=start-（end 未指定/-1/-2）→ 到文件末尾。此前 end 保持 -1 时
                // Content-Length = end-start+1 = 0 → 媒体元素拿到 0 字节 → SRC_NOT_SUPPORTED
                if (isRange && end < 0) end = length - 1
                if (isRange && start >= length) {
                    // 范围越界 → 416（Content-Range: bytes */length）
                    writeErrorWithRange(out, length)
                    return
                }
                if (isRange && end >= length) end = length - 1
                val head = StringBuilder(256)
                if (isRange) {
                    head.append("HTTP/1.1 206 Partial Content\r\n")
                    head.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(length).append("\r\n")
                    head.append("Content-Length: ").append(end - start + 1).append("\r\n")
                } else {
                    head.append("HTTP/1.1 200 OK\r\n")
                    head.append("Content-Length: ").append(length).append("\r\n")
                }
                head.append("Content-Type: ").append(mime).append("\r\n")
                head.append(securityHeaderLines(mime))
                // CORS：仅放行本应用 WebView 的固定 origin；无 Origin 的媒体/图片请求不校验（与桌面同语义）。
                head.append("Access-Control-Allow-Origin: ").append(ALLOWED_ORIGIN).append("\r\n")
                head.append("Access-Control-Allow-Methods: GET, HEAD\r\n")
                head.append("Accept-Ranges: bytes\r\n")
                // 文件名含唯一时间戳后缀，可长缓存（WebView 磁盘缓存，二次加载秒开）
                head.append("Cache-Control: public, max-age=31536000, immutable\r\n")
                head.append("Connection: close\r\n\r\n")
                out.write(head.toString().toByteArray(StandardCharsets.UTF_8))
                if (!isHead) {
                    if (isRange) {
                        // 部分读取（seek 场景），跳过 start 字节后流式输出 end-start+1 字节
                        FileInputStream(file).use { input ->
                            var skip = start
                            while (skip > 0) {
                                val s = input.skip(skip)
                                if (s <= 0) break
                                skip -= s
                            }
                            var remaining = end - start + 1
                            val buf = ByteArray(BUFFER_SIZE)
                            while (remaining > 0) {
                                val toRead = minOf(BUFFER_SIZE.toLong(), remaining).toInt()
                                val n = input.read(buf, 0, toRead)
                                if (n == -1) break
                                out.write(buf, 0, n)
                                remaining -= n
                            }
                        }
                    } else {
                        FileInputStream(file).use { fin ->
                            BufferedInputStream(fin, BUFFER_SIZE).use { bin ->
                                val buf = ByteArray(BUFFER_SIZE)
                                var n = bin.read(buf)
                                while (n != -1) {
                                    out.write(buf, 0, n)
                                    n = bin.read(buf)
                                }
                            }
                        }
                    }
                }
                out.flush()
            }
        } catch (e: Exception) {
            Log.e(TAG, "handle error: " + e.message, e)
        }
    }

    /** `?w=` → 档位；非法/缺省/不在白名单 → null（走原图）。与桌面 assetServer 同口径。 */
    fun thumbWidthFor(uri: URI): Int? {
        val raw = queryParameter(uri, "w") ?: return null
        val width = raw.trim().toIntOrNull() ?: return null
        return if (THUMB_WIDTHS.contains(width)) width else null
    }

    /**
     * 只对可安全重编码的位图生效。刻意排除：
     * - GIF：多帧动画 resize 后只剩首帧（宁可不缩，也不能把动图弄坏）；
     * - SVG：矢量，本就没有解码内存问题。
     * 其余（webp/avif/bmp/tiff 等）Android 侧编解码支持不一，一律不碰 ⇒ 落回原图。
     */
    fun isThumbResizable(name: String): Boolean {
        val dot = name.lastIndexOf('.')
        if (dot < 0) return false
        val ext = name.substring(dot + 1).lowercase(Locale.ROOT)
        return "png" == ext || "jpg" == ext || "jpeg" == ext
    }

    /**
     * 按需缩略图。先用 `inJustDecodeBounds` 只读尺寸、再按 `inSampleSize` 只解 1/N —— 这是关键：
     * 直接 `decodeFile` 一张 4000×3000 就是 48MB 位图进内存，正是我们要省掉的那笔开销。
     * 任何失败都返回 null，调用方落回原图：缩略图是纯优化，绝不能因为它把图弄没。
     */
    private fun thumbBytes(file: File, targetWidth: Int): ByteArray? {
        return try {
            val path = file.absolutePath
            val probe = BitmapFactory.Options()
            probe.inJustDecodeBounds = true
            BitmapFactory.decodeFile(path, probe)
            if (probe.outWidth <= 0 || probe.outHeight <= 0) return null
            // 不放大：原图不比目标宽就直接落回原图（桌面侧是 withoutEnlargement，同语义）
            if (probe.outWidth <= targetWidth) return null

            val opts = BitmapFactory.Options()
            opts.inSampleSize = sampleSizeFor(probe.outWidth, targetWidth)
            val decoded = BitmapFactory.decodeFile(path, opts) ?: return null
            var scaled = decoded
            try {
                if (decoded.width != targetWidth) {
                    val height = maxOf(1, Math.round(targetWidth * decoded.height.toFloat() / decoded.width))
                    scaled = Bitmap.createScaledBitmap(decoded, targetWidth, height, true)
                }
                val name = file.name.lowercase(Locale.ROOT)
                val format = if (name.endsWith(".png")) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
                val out = ByteArrayOutputStream()
                scaled.compress(format, THUMB_JPEG_QUALITY, out)
                out.toByteArray()
            } finally {
                if (scaled !== decoded) scaled.recycle()
                decoded.recycle()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "thumbnail failed, fallback to original: " + file.name, t)
            null
        }
    }

    /** inSampleSize 只能取 2 的幂：取「解出来仍不小于目标宽」的最大值（少解、但绝不小于目标）。 */
    fun sampleSizeFor(sourceWidth: Int, targetWidth: Int): Int {
        var sample = 1
        while (targetWidth > 0 && sourceWidth / (sample * 2) >= targetWidth) sample *= 2
        return sample
    }

    /** SVG 安全 CSP（与桌面 electron/assetServer.ts 逐字节一致，防 <img>/文档方式打开时脚本在同源执行）。 */
    const val SVG_CSP = "sandbox; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"

    /**
     * 安全响应头（260923 A3，与桌面 assetServer 对齐）：所有资源 nosniff；SVG 额外 CSP + inline。
     * 包级可见以便 JVM 单测断言（AssetServerTest）。
     */
    fun securityHeaderLines(mime: String): String {
        val sb = StringBuilder(160)
        sb.append("X-Content-Type-Options: nosniff\r\n")
        if ("image/svg+xml" == mime) {
            sb.append("Content-Security-Policy: ").append(SVG_CSP).append("\r\n")
            sb.append("Content-Disposition: inline\r\n")
        }
        return sb.toString()
    }

    /** 整段返回一个内存里的字节体（缩略图用；带 immutable 缓存头，与文件路径同缓存语义）。 */
    private fun writeBody(out: OutputStream, body: ByteArray, mime: String, isHead: Boolean) {
        val head = StringBuilder(192)
        head.append("HTTP/1.1 200 OK\r\n")
        head.append("Content-Length: ").append(body.size).append("\r\n")
        head.append("Content-Type: ").append(mime).append("\r\n")
        head.append(securityHeaderLines(mime))
        head.append("Access-Control-Allow-Origin: ").append(ALLOWED_ORIGIN).append("\r\n")
        head.append("Access-Control-Allow-Methods: GET, HEAD\r\n")
        head.append("Cache-Control: public, max-age=31536000, immutable\r\n")
        head.append("Connection: close\r\n\r\n")
        out.write(head.toString().toByteArray(StandardCharsets.UTF_8))
        if (!isHead) out.write(body)
        out.flush()
    }

    private fun writeError(out: OutputStream, code: Int, msg: String) {
        val body = msg.toByteArray(StandardCharsets.UTF_8)
        val head = StringBuilder(128)
        head.append("HTTP/1.1 ").append(code).append(" ").append(msg).append("\r\n")
        head.append("Content-Type: text/plain; charset=utf-8\r\n")
        head.append("Content-Length: ").append(body.size).append("\r\n")
        head.append("Connection: close\r\n\r\n")
        out.write(head.toString().toByteArray(StandardCharsets.UTF_8))
        out.write(body)
        out.flush()
    }

    /** 416 Range Not Satisfiable（范围越界）：带 Content-Range: bytes 星号斜杠 size。 */
    private fun writeErrorWithRange(out: OutputStream, size: Long) {
        val body = "range not satisfiable".toByteArray(StandardCharsets.UTF_8)
        val head = StringBuilder(128)
        head.append("HTTP/1.1 416 Range Not Satisfiable\r\n")
        head.append("Content-Type: text/plain; charset=utf-8\r\n")
        head.append("Content-Range: bytes */").append(size).append("\r\n")
        head.append("Content-Length: ").append(body.size).append("\r\n")
        head.append("Connection: close\r\n\r\n")
        out.write(head.toString().toByteArray(StandardCharsets.UTF_8))
        out.write(body)
        out.flush()
    }

    /**
     * 与桌面 assetServer 同语义：仅 CORS 请求（带 Origin 头）强制校验 token——
     * 外部网页没有令牌，无法跨源读取本地资源；<img>/<audio>/<video> 等 no-cors
     * 请求不带 Origin（浏览器本就不允许跨源读取其字节），放行。此前对所有请求
     * 无条件要求 token，导致 Lake 内核上传完成后重写的 canonical URL（无 token）
     * 加载 403，图片/附件卡片显示空白。
     */
    fun isAuthorized(uri: URI, origin: String?): Boolean {
        if (origin == null) return true
        if (ALLOWED_ORIGIN != origin) return false
        val token = sToken ?: return false
        val provided = queryParameter(uri, "token") ?: return false
        return MessageDigest.isEqual(
            provided.toByteArray(StandardCharsets.UTF_8),
            token.toByteArray(StandardCharsets.UTF_8)
        )
    }

    private fun queryParameter(uri: URI, name: String): String? {
        val query = uri.rawQuery ?: return null
        for (pair in query.split("&")) {
            val equals = pair.indexOf('=')
            val key = if (equals >= 0) pair.substring(0, equals) else pair
            if (name != key) continue
            val value = if (equals >= 0) pair.substring(equals + 1) else ""
            return try {
                URLDecoder.decode(value, "UTF-8")
            } catch (e: Exception) {
                null
            }
        }
        return null
    }

    private fun randomToken(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        val token = StringBuilder(bytes.size * 2)
        for (value in bytes) token.append("%02x".format(value.toInt() and 0xFF))
        return token.toString()
    }

    /** Android MimeTypeMap 对部分音频返回 x- 变体（如 wav → audio/x-wav），WebView <audio> 不识别，
     * 导致音频无 source 不加载——按标准 MIME 覆盖（与桌面 assetServer MIME_MAP 对齐）。 */
    private val MIME_OVERRIDES = mapOf(
        "wav" to "audio/wav",
        "mp3" to "audio/mpeg",
        "m4a" to "audio/mp4",
        "aac" to "audio/aac",
        "flac" to "audio/flac",
        "ogg" to "audio/ogg",
        "oga" to "audio/ogg",
        "mp4" to "video/mp4",
        "m4v" to "video/mp4",
        "mov" to "video/quicktime",
        "webm" to "video/webm",
        "mkv" to "video/x-matroska",
        "avi" to "video/x-msvideo",
        "pdf" to "application/pdf"
    )

    /**
     * 主动内容 MIME 降级（纯函数，不依赖 Android framework，便于 JVM 单测）：
     * 桌面 MIME_MAP 不含 html → 以 octet-stream 直出；Android MimeTypeMap 会给 text/html，
     * 顶层导航会以同源执行脚本 ⇒ 降级为二进制（应用无 HTML 预览功能依赖）。
     */
    fun sanitizeAssetMime(type: String): String {
        if ("text/html" == type || "application/xhtml+xml" == type) return "application/octet-stream"
        return type
    }

    fun mimeFor(name: String): String {
        val dot = name.lastIndexOf('.')
        if (dot >= 0) {
            val ext = name.substring(dot + 1).lowercase()
            val override = MIME_OVERRIDES[ext]
            if (override != null) return override
            val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            if (type != null) return sanitizeAssetMime(type)
        }
        return "application/octet-stream"
    }

    /** 图片魔数嗅探（对齐桌面 assetServer.sniffMime）：扩展名缺失/异常时按文件头判断，
     * 保证 <img> 渲染正确（WebView 按 Content-Type 决定图片解码路径）。 */
    fun sniffMime(file: File): String? {
        try {
            FileInputStream(file).use { input ->
                val head = ByteArray(16)
                val n = input.read(head)
                if (n >= 8) {
                    val b0 = head[0].toInt() and 0xFF
                    if (b0 == 0x89 && head[1].toInt() == 'P'.code && head[2].toInt() == 'N'.code && head[3].toInt() == 'G'.code) return "image/png"
                    if (b0 == 0xFF && (head[1].toInt() and 0xFF) == 0xD8 && (head[2].toInt() and 0xFF) == 0xFF) return "image/jpeg"
                    if (head[0].toInt() == 'G'.code && head[1].toInt() == 'I'.code && head[2].toInt() == 'F'.code && head[3].toInt() == '8'.code) return "image/gif"
                    if (n >= 12 && head[0].toInt() == 'R'.code && head[1].toInt() == 'I'.code && head[2].toInt() == 'F'.code && head[3].toInt() == 'F'.code
                        && head[8].toInt() == 'W'.code && head[9].toInt() == 'E'.code && head[10].toInt() == 'B'.code && head[11].toInt() == 'P'.code
                    ) return "image/webp"
                    if (head[4].toInt() == 'f'.code && head[5].toInt() == 't'.code && head[6].toInt() == 'y'.code && head[7].toInt() == 'p'.code && n >= 12) {
                        val brand = String(head, 8, 4, StandardCharsets.US_ASCII)
                        if ("avif" == brand || "avis" == brand) return "image/avif"
                    }
                }
                val ascii = String(head, 0, maxOf(0, n), StandardCharsets.US_ASCII)
                if (ascii.startsWith("<svg") || ascii.startsWith("<?xml")) return "image/svg+xml"
            }
        } catch (e: IOException) {
            Log.w(TAG, "mime sniff failed: " + e.message)
        }
        return null
    }
}
