package com.lakenotes.mobile

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

    /** PUT：把本地 note-assets/localKey 流式上传到 S3 key。 */
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

    /** GET：把 S3 key 流式下载到 note-assets/localKey，返回 size/sha256（供校验）。 */
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
                if (!temp.renameTo(dest)) {
                    temp.copyTo(dest, overwrite = true)
                    temp.delete()
                }
            } catch (e: Exception) {
                temp.delete()
                throw e
            } finally {
                conn.disconnect()
            }
            val sha = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
            call.resolve(JSObject().put("status", status).put("size", total).put("sha256", sha))
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

    private fun localAssetFile(localKey: String): File = File(File(getContext().filesDir, "note-assets"), localKey)

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
