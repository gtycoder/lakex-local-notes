package com.locallakexnotes.mobile

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * `localKey` 是**相对 filesDir 的完整资产路径**（261027 起）：
 *   lake 资产 = `note-assets/<id>/<file>`；小记图片 = `quick-notes/assets/<id>/<file>`。
 * 只允许落在两个资产根的 canonical 子树内；拒绝绝对路径、.. 与软链逃逸。
 * （旧版只认 note-assets 根 + 不含前缀的 `<id>/<file>`，小记图片因此没有原生上传/下载通道。）
 */
internal fun resolveLocalAssetFile(filesRoot: File, localKey: String): File {
    require(localKey.isNotBlank() && !File(localKey).isAbsolute) { "invalid localKey: $localKey" }
    require(localKey.startsWith("note-assets/") || localKey.startsWith("quick-notes/assets/")) { "invalid localKey: $localKey" }
    val root = filesRoot.canonicalFile
    val target = File(root, localKey).canonicalFile
    require(target.path.startsWith(root.path + File.separator)) { "invalid localKey: $localKey" }
    val lakeRoot = File(root, "note-assets").canonicalFile.path + File.separator
    val quickRoot = File(root, "quick-notes/assets").canonicalFile.path + File.separator
    require(target.path.startsWith(lakeRoot) || target.path.startsWith(quickRoot)) { "invalid localKey: $localKey" }
    return target
}

/**
 * 原生资产同步插件：S3 流式 GET/PUT + 本地文件读写，字节不过 WebView 桥。
 *
 * 设计：JS 只传「对象 key + 本地资产 key」，签名（SigV4）与网络/磁盘 IO 全在原生完成。
 * 复用既有端口契约：S3Store.putObjectStream / SyncDbPort.openLocalAssetStream 已是可选钩子，
 * core 不必改动；移动端实现这两个钩子即走原生流式，缺失时 JS 端口回退到原有字节/base64 路径。
 */
@CapacitorPlugin(name = "AssetSync")
class AssetSyncPlugin : Plugin() {
    private data class Config(
        val endpoint: String,
        val region: String,
        val bucket: String,
        val accessKeyId: String,
        val secretAccessKey: String,
        val forcePathStyle: Boolean,
    )

    @Volatile
    private var config: Config? = null

    /**
     * Capacitor Android 把所有插件调用都 post 到同一条 HandlerThread（"CapacitorPlugins"），
     * 所以插件方法里做阻塞 IO 会把 20 个并发请求串行化：实测首拉资产只有约 6 文件/s。
     * 这里把 GET/PUT 的实际 IO 丢给独立线程池（方法本身立即返回、稍后 resolve/reject），
     * 让 JS 侧 20 并发真正并行。CapacitorHttp 也是同样的做法。
     */
    private val ioPool = Executors.newFixedThreadPool(16) { runnable ->
        Thread(runnable, "LakeAssetSync-io").apply { isDaemon = true }
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val endpoint = call.getString("endpoint")
        val region = call.getString("region")
        val bucket = call.getString("bucket")
        val accessKeyId = call.getString("accessKeyId")
        val secretAccessKey = call.getString("secretAccessKey")
        if (endpoint.isNullOrEmpty() || region.isNullOrEmpty() || bucket.isNullOrEmpty()
            || accessKeyId.isNullOrEmpty() || secretAccessKey.isNullOrEmpty()
        ) {
            call.reject("incomplete S3 config")
            return
        }
        config = Config(endpoint, region, bucket, accessKeyId, secretAccessKey, call.getBoolean("forcePathStyle", false) ?: false)
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", true))
    }

    /** PUT：把本地 note-assets/localKey 流式上传到 S3 key（IO 在 ioPool，避免插件单线程串行）。 */
    @PluginMethod
    fun putFile(call: PluginCall) {
        val key = call.getString("key")
        val localKey = call.getString("localKey")
        val cfg = config
        if (key.isNullOrEmpty() || localKey.isNullOrEmpty()) {
            call.reject("key/localKey required")
            return
        }
        if (cfg == null) {
            call.reject("not configured")
            return
        }
        ioPool.execute { performPut(call, cfg, key, localKey) }
    }

    private fun performPut(call: PluginCall, cfg: Config, key: String, localKey: String) {
        try {
            val file = localAssetFile(localKey)
            if (!file.isFile) {
                call.reject("local asset missing: " + localKey)
                return
            }
            val size = file.length()
            val payloadHash = sha256File(file)
            val request = buildRequest(cfg, key)
            val now = utcNow()
            val headers = linkedMapOf(
                "host" to request.signHost,
                "x-amz-content-sha256" to payloadHash,
                "x-amz-date" to now.first,
            )
            val auth = AwsV4Signer.authorization(
                "PUT", request.path, "", headers, payloadHash, now.first, now.second,
                cfg.region, cfg.accessKeyId, cfg.secretAccessKey,
            )
            val conn = openConnection(request.url)
            conn.requestMethod = "PUT"
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(size)
            conn.setRequestProperty("x-amz-content-sha256", payloadHash)
            conn.setRequestProperty("x-amz-date", now.first)
            conn.setRequestProperty("Authorization", auth)
            FileInputStream(file).use { input -> conn.outputStream.use { out -> input.copyTo(out) } }
            val status = conn.responseCode
            conn.disconnect()
            if (status in 200..299) {
                call.resolve(JSObject().put("status", status).put("bytes", size))
            } else {
                call.reject("PUT failed: HTTP " + status)
            }
        } catch (e: Exception) {
            Log.e(TAG, "putFile failed: " + e.message, e)
            call.reject("PUT failed: " + e.message)
        }
    }

    /** GET：把 S3 key 流式下载到 note-assets/localKey，返回 size/sha256（IO 在 ioPool，避免插件单线程串行）。 */
    @PluginMethod
    fun getFile(call: PluginCall) {
        val key = call.getString("key")
        val localKey = call.getString("localKey")
        val cfg = config
        if (key.isNullOrEmpty() || localKey.isNullOrEmpty()) {
            call.reject("key/localKey required")
            return
        }
        if (cfg == null) {
            call.reject("not configured")
            return
        }
        val maxBytes = (call.getInt("maxBytes") ?: Int.MAX_VALUE).toLong()
        val expectedSize = call.getLong("expectedSize")
        val expectedSha256 = call.getString("expectedSha256")
        ioPool.execute { performGet(call, cfg, key, localKey, maxBytes, expectedSize, expectedSha256) }
    }

    private fun performGet(
        call: PluginCall,
        cfg: Config,
        key: String,
        localKey: String,
        maxBytes: Long,
        expectedSize: Long?,
        expectedSha256: String?,
    ) {
        try {
            val dest = localAssetFile(localKey)
            val request = buildRequest(cfg, key)
            val now = utcNow()
            val emptyHash = EMPTY_PAYLOAD_SHA256
            val headers = linkedMapOf(
                "host" to request.signHost,
                "x-amz-content-sha256" to emptyHash,
                "x-amz-date" to now.first,
            )
            val auth = AwsV4Signer.authorization(
                "GET", request.path, "", headers, emptyHash, now.first, now.second,
                cfg.region, cfg.accessKeyId, cfg.secretAccessKey,
            )
            val conn = openConnection(request.url)
            conn.requestMethod = "GET"
            conn.setRequestProperty("x-amz-content-sha256", emptyHash)
            conn.setRequestProperty("x-amz-date", now.first)
            conn.setRequestProperty("Authorization", auth)
            val status = conn.responseCode
            if (status == 404) {
                conn.disconnect()
                call.resolve(JSObject().put("status", 404))
                return
            }
            if (status !in 200..299) {
                conn.disconnect()
                call.reject("GET failed: HTTP " + status)
                return
            }
            dest.parentFile?.mkdirs()
            val temp = File(dest.parentFile, ".tmp-" + dest.name)
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            try {
                conn.inputStream.use { input ->
                    FileOutputStream(temp).use { output ->
                        val buf = ByteArray(64 * 1024)
                        var n = input.read(buf)
                        while (n > 0) {
                            total += n
                            if (total > maxBytes) throw Exception("object exceeds maxBytes (" + maxBytes + ")")
                            output.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            n = input.read(buf)
                        }
                    }
                }
            } catch (e: Exception) {
                temp.delete()
                throw e
            } finally {
                conn.disconnect()
            }
            val sha = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
            // 期望校验（可选）：不符则丢弃临时文件、返回 corrupt，绝不把坏字节落到正式路径。
            val sizeMismatch = expectedSize != null && expectedSize != total
            val hashMismatch = expectedSha256 != null && !expectedSha256.equals(sha, ignoreCase = true)
            if (sizeMismatch || hashMismatch) {
                temp.delete()
                call.resolve(JSObject().put("status", "corrupt").put("size", total).put("sha256", sha))
                return
            }
            if (!temp.renameTo(dest)) {
                temp.copyTo(dest, overwrite = true)
                temp.delete()
            }
            call.resolve(JSObject().put("status", "ok").put("size", total).put("sha256", sha))
        } catch (e: Exception) {
            Log.e(TAG, "getFile failed: " + e.message, e)
            call.reject("GET failed: " + e.message)
        }
    }

    /** 列出某笔记本地资产目录（原生算 size+sha256），供 listLocalAssets 免 base64 读盘。 */
    @PluginMethod
    fun listAssets(call: PluginCall) {
        val noteId = call.getString("noteId")
        if (noteId.isNullOrEmpty()) {
            call.reject("noteId required")
            return
        }
        try {
            val dir = File(File(getContext().filesDir, "note-assets"), noteId)
            val arr = JSArray()
            if (dir.isDirectory) {
                for (f in dir.listFiles() ?: emptyArray()) {
                    if (!f.isFile) continue
                    val obj = JSObject()
                    obj.put("filename", f.name)
                    obj.put("size", f.length())
                    obj.put("hash", sha256File(f))
                    arr.put(obj)
                }
            }
            call.resolve(JSObject().put("assets", arr))
        } catch (e: Exception) {
            Log.e(TAG, "listAssets failed: " + e.message, e)
            call.reject("listAssets failed: " + e.message)
        }
    }

    /**
     * 一次性列出全部本地资产名（261026 首拉提速）：note-assets/<noteId>/<file> 与
     * quick-notes/assets/<noteId>/<file>。只返回文件名（不 hash），供同步做「本地差集」：
     * 首拉 2k 篇时把 2k 次 readdir 桥调用压成 1 次。
     */
    @PluginMethod
    fun listAllAssets(call: PluginCall) {
        ioPool.execute {
            try {
                val notes = JSObject()
                val noteRoot = File(getContext().filesDir, "note-assets")
                for (dir in noteRoot.listFiles() ?: emptyArray()) {
                    if (!dir.isDirectory) continue
                    val arr = JSArray()
                    for (f in dir.listFiles() ?: emptyArray()) if (f.isFile && !f.name.startsWith(".tmp-")) arr.put(f.name)
                    notes.put(dir.name, arr)
                }
                val quick = JSObject()
                val quickRoot = File(getContext().filesDir, "quick-notes/assets")
                for (dir in quickRoot.listFiles() ?: emptyArray()) {
                    if (!dir.isDirectory) continue
                    val arr = JSArray()
                    for (f in dir.listFiles() ?: emptyArray()) if (f.isFile && !f.name.startsWith(".tmp-")) arr.put(f.name)
                    quick.put(dir.name, arr)
                }
                call.resolve(JSObject().put("notes", notes).put("quickNotes", quick))
            } catch (e: Exception) {
                Log.e(TAG, "listAllAssets failed: " + e.message, e)
                call.reject("listAllAssets failed: " + e.message)
            }
        }
    }

    /**
     * 本地资产目录「文件名→大小」（261027）：只 stat、不读内容、不算 hash。
     * 保存文档时孤儿登记只需要 size；旧实现为拿 size 把整份附件读回 JS（25MB 附件 × N 就是几十 MB 桥流量）。
     */
    @PluginMethod
    fun statLocal(call: PluginCall) {
        val dir = resolveAssetFsPath(call.getString("path"))
        if (dir == null) {
            call.reject("非法资产路径")
            return
        }
        ioPool.execute {
            try {
                val arr = JSArray()
                if (dir.isDirectory) {
                    for (f in dir.listFiles() ?: emptyArray()) {
                        if (!f.isFile) continue
                        if (f.name.startsWith(".tmp-")) continue
                        arr.put(JSObject().put("name", f.name).put("size", f.length()))
                    }
                }
                call.resolve(JSObject().put("files", arr))
            } catch (e: Exception) {
                Log.e(TAG, "statLocal failed: " + e.message, e)
                call.reject("statLocal failed: " + e.message)
            }
        }
    }

    /**
     * 本地资产文件读写/删除/列目录（261026）：把移动端资产文件操作从 @capacitor/filesystem 全原生化。
     * path 只接受 note-assets/... 或 quick-notes/assets/...（与 resolveLocalAssetFile 同口径）；data 为 base64。
     */
    private fun resolveAssetFsPath(relative: String?): File? {
        if (relative.isNullOrBlank()) return null
        if (relative.startsWith("/") || relative.contains('\u0000')) return null
        if (relative.split('/').any { it == ".." || it == "." || it.isEmpty() }) return null
        if (!relative.startsWith("note-assets/") && !relative.startsWith("quick-notes/assets/")) return null
        return try {
            val root = getContext().filesDir.canonicalFile
            val target = File(root, relative).canonicalFile
            if (target.path.startsWith(root.path + File.separator)) target else null
        } catch (e: Exception) { null }
    }

    private fun atomicWriteBytes(target: File, bytes: ByteArray) {
        val parent = target.parentFile ?: throw Exception("资产父目录无效")
        if (!parent.exists() && !parent.mkdirs()) throw Exception("资产目录创建失败")
        val tmp = File(parent, target.name + ".tmp-" + java.util.UUID.randomUUID())
        try {
            java.io.FileOutputStream(tmp).use { out ->
                out.write(bytes)
                out.flush()
                out.fd.sync()
            }
            if (!tmp.renameTo(target)) {
                if (target.exists() && !target.delete()) throw Exception("旧资产删除失败")
                if (!tmp.renameTo(target)) throw Exception("资产 rename 失败")
            }
        } finally { if (tmp.exists()) tmp.delete() }
    }

    @PluginMethod
    fun writeLocal(call: PluginCall) {
        val target = resolveAssetFsPath(call.getString("path")) ?: run { call.reject("非法资产路径"); return }
        val data = call.getString("data") ?: run { call.reject("data 必填"); return }
        ioPool.execute {
            try {
                val bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT)
                atomicWriteBytes(target, bytes)
                call.resolve(JSObject().put("size", target.length()))
            } catch (e: Exception) {
                Log.e(TAG, "writeLocal failed: " + e.message, e)
                call.reject("writeLocal failed: " + e.message)
            }
        }
    }

    @PluginMethod
    fun readLocal(call: PluginCall) {
        val target = resolveAssetFsPath(call.getString("path")) ?: run { call.reject("非法资产路径"); return }
        ioPool.execute {
            try {
                if (!target.isFile) {
                    call.resolve(JSObject().put("exists", false))
                    return@execute
                }
                val bytes = target.readBytes()
                call.resolve(JSObject().put("exists", true).put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
            } catch (e: Exception) {
                call.reject("readLocal failed: " + e.message)
            }
        }
    }

    @PluginMethod
    fun removeLocal(call: PluginCall) {
        val target = resolveAssetFsPath(call.getString("path")) ?: run { call.reject("非法资产路径"); return }
        ioPool.execute {
            try {
                if (target.isFile) target.delete()
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("removeLocal failed: " + e.message)
            }
        }
    }

    @PluginMethod
    fun listLocal(call: PluginCall) {
        val target = resolveAssetFsPath(call.getString("path")?.trimEnd('/')) ?: run {
            call.reject("非法资产目录")
            return
        }
        ioPool.execute {
            try {
                val arr = JSArray()
                if (target.isDirectory) for (f in target.listFiles() ?: emptyArray()) if (f.isFile && !f.name.startsWith(".tmp-")) arr.put(f.name)
                call.resolve(JSObject().put("files", arr))
            } catch (e: Exception) {
                call.reject("listLocal failed: " + e.message)
            }
        }
    }

    /** 某条小记的本地图片清单（filename/size/sha256；quick-notes/assets/<id>）。 */
    @PluginMethod
    fun listQuickAssets(call: PluginCall) {
        val noteId = call.getString("noteId")
        if (noteId.isNullOrEmpty()) { call.reject("noteId required"); return }
        ioPool.execute {
            try {
                val dir = File(File(getContext().filesDir, "quick-notes/assets"), noteId)
                val arr = JSArray()
                if (dir.isDirectory) {
                    for (f in dir.listFiles() ?: emptyArray()) {
                        if (!f.isFile) continue
                        val obj = JSObject()
                        obj.put("filename", f.name)
                        obj.put("size", f.length())
                        obj.put("hash", sha256File(f))
                        arr.put(obj)
                    }
                }
                call.resolve(JSObject().put("assets", arr))
            } catch (e: Exception) {
                Log.e(TAG, "listQuickAssets failed: " + e.message, e)
                call.reject("listQuickAssets failed: " + e.message)
            }
        }
    }

    /**
     * 列出某笔记资源目录里的图片（只返回 filename/size，**不计算 sha256**）。
     * 供 AI 图片选择器用：listAssets 会给每个文件算 sha256，附件多时会明显卡。
     */
    @PluginMethod
    fun listImageAssets(call: PluginCall) {
        val noteId = call.getString("noteId")
        if (noteId.isNullOrEmpty()) {
            call.reject("noteId required")
            return
        }
        try {
            val dir = File(File(getContext().filesDir, "note-assets"), noteId)
            val arr = JSArray()
            val imageExtensions = setOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif")
            if (dir.isDirectory) {
                for (f in dir.listFiles() ?: emptyArray()) {
                    if (!f.isFile) continue
                    val extension = f.name.substringAfterLast('.', "").lowercase()
                    if (extension !in imageExtensions) continue
                    val obj = JSObject()
                    obj.put("filename", f.name)
                    obj.put("size", f.length())
                    arr.put(obj)
                }
            }
            call.resolve(JSObject().put("assets", arr))
        } catch (e: Exception) {
            Log.e(TAG, "listImageAssets failed: " + e.message, e)
            call.reject("listImageAssets failed: " + e.message)
        }
    }

    private data class SignedRequest(val url: String, val path: String, val signHost: String)

    private fun buildRequest(cfg: Config, key: String): SignedRequest {
        val ep = URI(cfg.endpoint)
        val scheme = ep.scheme ?: "https"
        val host = ep.host ?: throw Exception("invalid endpoint")
        val port = ep.port
        val encodedKey = key.split("/").joinToString("/") { AwsV4Signer.encodeRfc3986(it) }
        val path: String
        val requestHost: String
        if (cfg.forcePathStyle) {
            path = "/" + AwsV4Signer.encodeRfc3986(cfg.bucket) + "/" + encodedKey
            requestHost = host
        } else {
            path = "/" + encodedKey
            requestHost = cfg.bucket + "." + host
        }
        val signHost = if (port > 0) requestHost + ":" + port else requestHost
        val url = scheme + "://" + signHost + path
        return SignedRequest(url, path, signHost)
    }

    private fun openConnection(url: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 120_000
        conn.readTimeout = 120_000
        return conn
    }

    private fun localAssetFile(localKey: String): File = resolveLocalAssetFile(getContext().filesDir, localKey)

    private fun sha256File(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buf = ByteArray(64 * 1024)
            var n = input.read(buf)
            while (n > 0) {
                digest.update(buf, 0, n)
                n = input.read(buf)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    private fun utcNow(): Pair<String, String> {
        val now = Date()
        val amz = SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(now)
        val date = SimpleDateFormat("yyyyMMdd", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(now)
        return amz to date
    }

    private companion object {
        const val TAG = "LakeAssetSync"
        const val EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
}
