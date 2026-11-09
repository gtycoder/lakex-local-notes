package com.lakexlocalnotes.android

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.security.MessageDigest

/**
 * 应用内更新中心（Android 原生半段）。口径见 docs/UPDATE-CENTER.md。
 *
 * 设计红线：
 *  · **不做静默安装**：install 只拉起系统安装器（ACTION_VIEW + FileProvider），用户在系统弹窗确认；
 *  · **只走 HTTPS**：清单与安装包都只接受 https（重定向也逐跳校验，禁止降级到 http）；
 *  · 清单**只回原始 JSON**：解析/版本比较/选包全在 JS 的 src/core/update/updateManifest.ts（单一来源）；
 *  · sha256 与证书指纹校验在本插件内完成（JS 传入 core 的期望值，Kotlin 不复制第二份常量）；
 *  · 下载用系统 DownloadManager（系统通知、可跨进程/切后台），完成后落到 **App 私有 cache/updates**
 *    （FileProvider 只暴露这一个单文件），不写公共存储。
 *
 * 为什么先下载到应用专属外部目录再搬进内部 cache：DownloadManager 是系统服务（独立 uid），
 * 只能写应用专属外部目录（getExternalFilesDir），写不进 /data/data/<pkg>/cache。
 * ⇒ 下载阶段用 getExternalFilesDir(null)/updates 作为 staging，STATUS_SUCCESSFUL 时
 *   一次性搬进 cacheDir/updates 并删 staging，最终安装包仍在私有 cache（与规格一致）。
 */
@CapacitorPlugin(name = "Update")
class UpdatePlugin : Plugin() {

    companion object {
        private const val PREFS = "lakex-local-notes-update"
        private const val KEY_DOWNLOAD_ID = "downloadId"
        private const val KEY_FILENAME = "filename"
        private const val KEY_SHA256 = "sha256"
        private const val KEY_SIZE = "size"
        private const val KEY_VERSION = "version"
        private const val KEY_DOWNLOADED_PATH = "downloadedPath"

        private const val DIR_UPDATES = "updates"
        private const val MIME_APK = "application/vnd.android.package-archive"

        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 20_000
        private const val MAX_MANIFEST_BYTES = 512 * 1024
        private const val MAX_APK_BYTES = 300L * 1024 * 1024
        private const val MAX_REDIRECTS = 3

        /** APK 文件名白名单：只允许单段、无路径分隔符，必须 .apk。 */
        private val APK_NAME = Regex("^[A-Za-z0-9._-]{1,128}\\.apk$")
        private val SHA256_HEX = Regex("^[0-9a-f]{64}$")
    }

    /** 搬运/清理互斥：status() 可能被 JS 每 800ms 轮询，避免两个线程同时搬同一个文件。 */
    private val finalizing = java.util.concurrent.atomic.AtomicBoolean(false)

    private fun prefs(): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun cacheUpdatesDir(): File = File(context.cacheDir, DIR_UPDATES).apply { mkdirs() }

    /** DownloadManager 能写的唯一位置：应用专属外部目录（不是公共存储，卸载即清）。 */
    private fun stagingDir(): File? {
        val root = context.getExternalFilesDir(null) ?: return null
        return File(root, DIR_UPDATES).apply { mkdirs() }
    }

    private fun stagingFile(filename: String): File? = stagingDir()?.let { File(it, filename) }

    private fun downloadManager(): DownloadManager? = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager

    /** 只允许操作 cacheDir/updates 下的文件（WebView 参数不可信）。 */
    private fun isUnderCacheUpdates(file: File): Boolean {
        return try {
            val root = cacheUpdatesDir().canonicalPath
            val canonical = file.canonicalPath
            canonical == root || canonical.startsWith(root + File.separator)
        } catch (e: Exception) {
            false
        }
    }

    // ---- check：拉 latest.json 原始文本 ----

    @PluginMethod
    fun check(call: PluginCall) {
        val urlText = call.getString("url") ?: ""
        if (!urlText.startsWith("https://")) {
            call.reject("更新清单地址必须是 HTTPS")
            return
        }
        call.setKeepAlive(true)
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val opened = openHttps(urlText)
                conn = opened
                val status = conn.responseCode
                val out = JSObject()
                if (status !in 200..299) {
                    out.put("ok", false)
                    out.put("status", status)
                    out.put("code", "http_" + status)
                    call.resolve(out)
                    return@Thread
                }
                val body = conn.inputStream.use { readLimited(it, MAX_MANIFEST_BYTES) }
                out.put("ok", true)
                out.put("status", status)
                out.put("body", body)
                call.resolve(out)
            } catch (e: SocketTimeoutException) {
                call.resolve(failure("timeout", e.message))
            } catch (e: Exception) {
                call.resolve(failure("network", e.message ?: e.javaClass.simpleName))
            } finally {
                try { conn?.disconnect() } catch (_: Exception) { /* 已断开 */ }
            }
        }.start()
    }

    /** 逐跳跟随重定向并强制 HTTPS（HttpURLConnection 默认会跟随到 http，必须自己拦）。 */
    private fun openHttps(urlText: String): HttpURLConnection {
        var current = urlText
        for (hop in 0..MAX_REDIRECTS) {
            val conn = URL(current).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "LakexLocalNotes-Android-Update")
            val status = conn.responseCode
            if (status in 300..399) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrEmpty()) throw IOException("重定向缺少 Location")
                val next = URI(current).resolve(location).toString()
                if (!next.startsWith("https://")) throw IOException("重定向到非 HTTPS 地址")
                current = next
                continue
            }
            return conn
        }
        throw IOException("重定向次数过多")
    }

    // ---- download：系统 DownloadManager ----

    @PluginMethod
    fun download(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val filename = call.getString("filename")?.trim() ?: ""
        val sha256 = (call.getString("sha256") ?: "").lowercase()
        val size = call.getLong("size") ?: 0L
        val version = call.getString("version")?.trim() ?: ""

        if (!url.startsWith("https://")) { call.reject("安装包地址必须是 HTTPS"); return }
        if (!APK_NAME.matches(filename)) { call.reject("安装包文件名非法"); return }
        if (!SHA256_HEX.matches(sha256)) { call.reject("sha256 非法"); return }
        if (size <= 0 || size > MAX_APK_BYTES) { call.reject("安装包大小非法"); return }
        val dir = stagingDir()
        if (dir == null) { call.reject("外部存储不可用，无法下载更新"); return }
        val dm = downloadManager()
        if (dm == null) { call.reject("系统下载服务不可用"); return }

        try {
            cancelInternal()
            val target = File(dir, filename)
            if (target.exists()) target.delete()
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(filename)
                .setDescription("正在下载应用更新")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(context, null, DIR_UPDATES + "/" + filename)
                // 是否「仅 Wi-Fi」由 JS 判据决定（src/mobile/update/updatePolicy.ts）；这里不重复拦截，
                // 否则用户切到 Wi-Fi 后系统队列里的下载会莫名失败。
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
            val id = dm.enqueue(request)
            prefs().edit()
                .putLong(KEY_DOWNLOAD_ID, id)
                .putString(KEY_FILENAME, filename)
                .putString(KEY_SHA256, sha256)
                .putLong(KEY_SIZE, size)
                .putString(KEY_VERSION, version)
                .remove(KEY_DOWNLOADED_PATH)
                .apply()
            val out = JSObject()
            out.put("ok", true)
            out.put("downloadId", id.toString())
            call.resolve(out)
        } catch (e: Exception) {
            call.reject("开始下载失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    // ---- status：进度 / 完成搬运 / 失败 / 已下载未安装恢复 ----

    @PluginMethod
    fun status(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            try {
                call.resolve(queryStatus())
            } catch (e: Exception) {
                call.resolve(failure("status_failed", e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun queryStatus(): JSObject {
        val p = prefs()
        val out = JSObject()
        val downloadId = p.getLong(KEY_DOWNLOAD_ID, -1L)
        val filename = p.getString(KEY_FILENAME, "") ?: ""
        if (downloadId <= 0L) {
            val completed = p.getString(KEY_DOWNLOADED_PATH, "") ?: ""
            if (completed.isNotEmpty() && File(completed).isFile) {
                out.put("state", "downloaded")
                out.put("path", completed)
                out.put("filename", filename)
                out.put("size", File(completed).length())
                out.put("sha256", p.getString(KEY_SHA256, "") ?: "")
                out.put("version", p.getString(KEY_VERSION, "") ?: "")
                return out
            }
            if (completed.isNotEmpty()) p.edit().remove(KEY_DOWNLOADED_PATH).apply()
            // 上一次下载被中断/失败后留下的 staging 残留：没有 downloadId 就没有重试价值，清掉。
            sweepStaging(keepFilename = null)
            out.put("state", "idle")
            return out
        }
        val dm = downloadManager()
        if (dm == null) {
            clearDownloadPrefs()
            out.put("state", "failed")
            out.put("code", "no_download_manager")
            return out
        }
        dm.query(DownloadManager.Query().setFilterById(downloadId)).use { cursor ->
            if (cursor == null || !cursor.moveToFirst()) {
                clearDownloadPrefs()
                out.put("state", "idle")
                return out
            }
            val status = cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_STATUS))
            val received = columnLong(cursor, DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val total = columnLong(cursor, DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    if (!finalizing.compareAndSet(false, true)) {
                        out.put("state", "running")
                        out.put("received", received)
                        out.put("total", total)
                        out.put("filename", filename)
                        return out
                    }
                    try {
                        return finishDownloaded(p, out, filename)
                    } finally {
                        finalizing.set(false)
                    }
                }
                DownloadManager.STATUS_FAILED -> {
                    val reason = cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_REASON))
                    clearDownloadPrefs()
                    stagingFile(filename)?.delete()
                    out.put("state", "failed")
                    out.put("code", "download_failed_" + reason)
                }
                DownloadManager.STATUS_PAUSED -> {
                    out.put("state", "paused")
                    out.put("received", received)
                    out.put("total", total)
                    out.put("filename", filename)
                    out.put("version", p.getString(KEY_VERSION, "") ?: "")
                }
                else -> {
                    out.put("state", "running")
                    out.put("received", received)
                    out.put("total", total)
                    out.put("filename", filename)
                    out.put("version", p.getString(KEY_VERSION, "") ?: "")
                }
            }
        }
        return out
    }

    /** STATUS_SUCCESSFUL：把 staging 单文件搬进私有 cache；失败回滚半成品、保留 staging 以便重试。 */
    private fun finishDownloaded(p: SharedPreferences, out: JSObject, filename: String): JSObject {
        val staged = stagingFile(filename)
        val dest = File(cacheUpdatesDir(), filename)
        if (staged == null || !staged.isFile || staged.length() <= 0L) {
            clearDownloadPrefs()
            out.put("state", "failed")
            out.put("code", "downloaded_file_missing")
            return out
        }
        try {
            if (dest.exists()) dest.delete()
            staged.copyTo(dest, overwrite = true)
            if (dest.length() != staged.length()) throw IOException("搬运后大小不一致")
        } catch (e: Exception) {
            // 搬运失败：删掉半成品（回滚），**保留 staging 与 downloadId** ⇒ 下次 status() 会重试搬运。
            if (dest.exists()) dest.delete()
            out.put("state", "failed")
            out.put("code", "move_failed")
            out.put("detail", e.message ?: e.javaClass.simpleName)
            return out
        }
        staged.delete()
        p.edit()
            .remove(KEY_DOWNLOAD_ID)
            .putString(KEY_DOWNLOADED_PATH, dest.absolutePath)
            .apply()
        out.put("state", "downloaded")
        out.put("path", dest.absolutePath)
        out.put("filename", filename)
        out.put("size", dest.length())
        out.put("sha256", p.getString(KEY_SHA256, "") ?: "")
        out.put("version", p.getString(KEY_VERSION, "") ?: "")
        return out
    }

    private fun columnLong(cursor: android.database.Cursor, column: String): Long {
        val index = cursor.getColumnIndex(column)
        return if (index < 0 || cursor.isNull(index)) -1L else cursor.getLong(index)
    }

    // ---- cancel ----

    @PluginMethod
    fun cancel(call: PluginCall) {
        try {
            cancelInternal()
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("取消下载失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun cancelInternal() {
        val p = prefs()
        val downloadId = p.getLong(KEY_DOWNLOAD_ID, -1L)
        if (downloadId > 0L) {
            try { downloadManager()?.remove(downloadId) } catch (_: Exception) { /* 已不存在 */ }
        }
        val filename = p.getString(KEY_FILENAME, "") ?: ""
        // staging 与 cache 两侧都清（同目录里可能还有历史残留文件）。
        sweepStaging(keepFilename = null)
        if (filename.isNotEmpty()) File(cacheUpdatesDir(), filename).delete()
        p.edit()
            .remove(KEY_DOWNLOAD_ID)
            .remove(KEY_FILENAME)
            .remove(KEY_SHA256)
            .remove(KEY_SIZE)
            .remove(KEY_VERSION)
            .remove(KEY_DOWNLOADED_PATH)
            .apply()
    }

    // ---- cleanup：清 staging 与 cache 的更新残留（「清理缓存」入口用；卸载时系统会一并删两处目录） ----

    @PluginMethod
    fun cleanup(call: PluginCall) {
        try {
            cancelInternal()
            sweepStaging(keepFilename = null)
            cacheUpdatesDir().listFiles()?.forEach { it.deleteRecursively() }
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("清理更新缓存失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun sweepStaging(keepFilename: String?) {
        val files = stagingDir()?.listFiles() ?: return
        for (file in files) {
            if (keepFilename != null && file.name == keepFilename) continue
            try { file.deleteRecursively() } catch (_: Exception) { /* 删不掉留给下次 */ }
        }
    }

    // ---- verify：sha256 + APK 签名证书指纹 ----

    @PluginMethod
    fun verify(call: PluginCall) {
        val path = call.getString("path") ?: ""
        val expectedSha = (call.getString("sha256") ?: "").lowercase()
        val expectedCert = normalizeHex(call.getString("certSha256") ?: "")
        if (path.isEmpty()) { call.reject("path 必填"); return }
        if (!SHA256_HEX.matches(expectedSha)) { call.reject("期望 sha256 非法"); return }
        if (!SHA256_HEX.matches(expectedCert)) { call.reject("期望证书指纹非法"); return }
        val file = File(path)
        if (!isUnderCacheUpdates(file)) { call.reject("安装包路径不在更新缓存目录"); return }
        if (!file.isFile) { call.reject("安装包不存在"); return }

        call.setKeepAlive(true)
        Thread {
            try {
                val actualSha = sha256OfFile(file)
                val out = JSObject()
                if (actualSha != expectedSha) {
                    out.put("ok", false)
                    out.put("code", "sha256_mismatch")
                    out.put("sha256", actualSha)
                    call.resolve(out)
                    return@Thread
                }
                val pm = context.packageManager
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES
                } else {
                    @Suppress("DEPRECATION")
                    val legacyFlags = android.content.pm.PackageManager.GET_SIGNATURES
                    legacyFlags
                }
                val info = pm.getPackageArchiveInfo(path, flags)
                if (info == null) {
                    out.put("ok", false)
                    out.put("code", "bad_apk")
                    call.resolve(out)
                    return@Thread
                }
                val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    info.signingInfo?.apkContentsSigners ?: emptyArray()
                } else {
                    @Suppress("DEPRECATION")
                    val legacySignatures = info.signatures
                    legacySignatures ?: emptyArray()
                }
                val signer = signatures.firstOrNull()
                if (signer == null) {
                    out.put("ok", false)
                    out.put("code", "no_signature")
                    call.resolve(out)
                    return@Thread
                }
                val actualCert = sha256Hex(signer.toByteArray())
                if (actualCert != expectedCert) {
                    out.put("ok", false)
                    out.put("code", "cert_mismatch")
                    out.put("signerSha256", actualCert)
                    call.resolve(out)
                    return@Thread
                }
                out.put("ok", true)
                out.put("sha256", actualSha)
                out.put("signerSha256", actualCert)
                val archiveVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    info.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    val legacyVersionCode = info.versionCode
                    legacyVersionCode.toLong()
                }
                out.put("versionCode", archiveVersionCode)
                out.put("versionName", info.versionName ?: "")
                call.resolve(out)
            } catch (e: Exception) {
                call.resolve(failure("verify_failed", e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    // ---- install：只拉起系统安装器 ----

    @PluginMethod
    fun install(call: PluginCall) {
        val path = call.getString("path") ?: ""
        val file = File(path)
        if (!isUnderCacheUpdates(file) || !file.isFile) {
            call.reject("安装包不存在或路径非法")
            return
        }
        // Android 8+：需要用户在系统设置里允许「安装未知应用」；没允许时先把用户送到那一页，
        // 由用户手动打开开关（不请求额外权限、不绕过系统弹窗）。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val out = JSObject()
            out.put("ok", false)
            out.put("code", "install_permission")
            out.put("openedSettings", openUnknownSourcesSettings())
            call.resolve(out)
            return
        }
        try {
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, MIME_APK)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val host = getActivity()
            if (host != null) host.startActivity(intent) else context.startActivity(intent)
            call.resolve(JSObject().put("ok", true))
        } catch (e: ActivityNotFoundException) {
            call.reject("没有可用的系统安装器")
        } catch (e: Exception) {
            call.reject("拉起安装器失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun openUnknownSourcesSettings(): Boolean {
        return try {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.packageName),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val host = getActivity()
            if (host != null) host.startActivity(intent) else context.startActivity(intent)
            true
        } catch (e: Exception) {
            false
        }
    }

    // ---- isWifi：自动下载的「仅 Wi-Fi」判据半边（Wi-Fi / 计量网络） ----

    @PluginMethod
    fun isWifi(call: PluginCall) {
        val out = JSObject()
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val caps = if (cm != null) {
                val network = cm.activeNetwork
                if (network != null) cm.getNetworkCapabilities(network) else null
            } else null
            out.put("wifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            out.put("metered", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false)
            out.put("online", caps != null)
            call.resolve(out)
        } catch (e: Exception) {
            call.reject("读取网络状态失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    // ---- 内部工具 ----

    private fun failure(code: String, detail: String?): JSObject {
        val out = JSObject()
        out.put("ok", false)
        out.put("code", code)
        if (!detail.isNullOrEmpty()) out.put("detail", detail.take(300))
        return out
    }

    private fun clearDownloadPrefs() {
        prefs().edit()
            .remove(KEY_DOWNLOAD_ID)
            .remove(KEY_FILENAME)
            .remove(KEY_SHA256)
            .remove(KEY_SIZE)
            .remove(KEY_VERSION)
            .apply()
    }

    private fun readLimited(input: InputStream, maxBytes: Int): String {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > maxBytes) throw IOException("响应体过大")
            out.write(buffer, 0, read)
        }
        return out.toString("UTF-8")
    }

    private fun normalizeHex(value: String): String = value.trim().lowercase().replace(":", "")

    private fun sha256OfFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return toHex(digest.digest())
    }

    private fun sha256Hex(bytes: ByteArray): String =
        toHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun toHex(bytes: ByteArray): String {
        val builder = StringBuilder(bytes.size * 2)
        for (byte in bytes) builder.append(String.format("%02x", byte.toInt() and 0xFF))
        return builder.toString()
    }
}
