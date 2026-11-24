package com.lakexlocalnotes.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale

/**
 * 最小原生插件：打开 / 另存为 本地文件。
 * - open：ACTION_VIEW + FileProvider，用系统默认应用打开。
 * - saveAs：把应用私有目录里的附件“另存为”到**用户可见**位置——
 *     图片（image 开头）→ MediaStore Pictures（直接进相册，Android 10+）；
 *     其它附件 → SAF ACTION_CREATE_DOCUMENT（系统“保存到”面板，用户自选位置）。
 *   这是 Android 10+ Scoped Storage 下唯一合规的“写公共可见区域”方式（思源是甩浏览器下载，体验糙）。
 * 用法：Capacitor.Plugins.OpenFile.open({ path: "/abs/path" })
 *      Capacitor.Plugins.OpenFile.saveAs({ path: "/abs/path", name: "报告.pdf", mime: "application/pdf" })
 */
@CapacitorPlugin(name = "OpenFile")
class OpenFilePlugin : Plugin() {

    /**
     * 路径围栏：只允许 app 私有目录（filesDir / externalFilesDir）下的文件。
     * WebView 侧参数不可信——防止插件被诱导打开任意绝对路径（如 /data/data/其他包/…）。
     */
    private fun isUnderAppSandbox(file: File): Boolean {
        return try {
            val canonical = file.canonicalPath
            val roots = arrayOf(getContext().filesDir, getContext().getExternalFilesDir(null))
            var allowed = false
            for (root in roots) {
                if (root == null) continue
                val rootPath = root.canonicalPath
                if (canonical == rootPath || canonical.startsWith(rootPath + File.separator)) {
                    allowed = true
                    break
                }
            }
            allowed
        } catch (e: Exception) {
            false
        }
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrEmpty()) {
            call.reject("path required")
            return
        }
        val file = File(path)
        if (!isUnderAppSandbox(file)) {
            call.reject("path outside app sandbox")
            return
        }
        if (!isSafeShellOpenName(file.name)) {
            call.reject("file type not allowed for shell open")
            return
        }
        if (!file.exists()) {
            call.reject("file not found: $path")
            return
        }
        try {
            val mime = mimeFor(file)
            val uri = FileProvider.getUriForFile(
                getContext(),
                getContext().packageName + ".fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW)
            intent.setDataAndType(uri, mime)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            getActivity().startActivity(intent)
            call.resolve()
        } catch (e: ActivityNotFoundException) {
            call.reject("no app can open this file: " + e.message)
        } catch (e: Exception) {
            call.reject("open failed: " + e.message)
        }
    }

    @PluginMethod
    fun saveAs(call: PluginCall) {
        val path = call.getString("path")
        val localKey = call.getString("localKey")
        // 261124「保存到手机」：图片等资产按 localKey（note-assets/<id>/<file> 或 quick-notes/assets/<id>/<file>）
        // 直接解析到 App 私有资产根 —— 前端只传 key、原生按路径直读（字节不过 WebView 桥）。
        val src: File = when {
            !localKey.isNullOrEmpty() -> resolveLocalAssetFile(context.filesDir, localKey)
            !path.isNullOrEmpty() -> File(path)
            else -> {
                call.reject("path or localKey required")
                return
            }
        }
        if (!isUnderAppSandbox(src)) {
            call.reject("path outside app sandbox")
            return
        }
        if (!src.exists()) {
            call.reject("file not found: $path")
            return
        }
        val name = call.getString("name")?.takeIf { it.trim().isNotEmpty() } ?: src.name
        val mime = call.getString("mime")?.takeIf { it.isNotEmpty() } ?: mimeFor(src)
        // 261117 D 项：便携包等「必须落到用户可见目录、不再走系统选择器」的导出。
        // Android 10+ 直接写 MediaStore Downloads（文件管理器「下载」里可见，不依赖用户点选）；
        // 低版本或不支持时回退到 SAF 选择器。
        val toDownloads = call.getBoolean("toDownloads") == true

        if (toDownloads && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToDownloads(call, src, name, mime)
        } else if (mime.startsWith("image/") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 图片走相册（系统图库立即可见，最接近小红书/知乎）；低版本或非图片走 SAF。
            saveImageToGallery(call, src, name, mime)
        } else {
            saveViaSaf(call, src, name, mime)
        }
    }

    /**
     * 写到系统「下载」目录（MediaStore.Downloads，Android 10+）：用户可以立刻在文件管理器里看到，
     * 卸载 App 后文件仍留存（这是便携包备份的关键）。
     */
    private fun saveToDownloads(call: PluginCall, src: File, name: String, mime: String) {
        var uri: Uri? = null
        try {
            val values = ContentValues()
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime)
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            values.put(MediaStore.MediaColumns.IS_PENDING, 1)
            val inserted = getContext().contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw Exception("insert into MediaStore Downloads failed")
            uri = inserted
            FileInputStream(src).use { input ->
                getContext().contentResolver.openOutputStream(inserted).use { output -> copy(input, output) }
            }
            val done = ContentValues()
            done.put(MediaStore.MediaColumns.IS_PENDING, 0)
            getContext().contentResolver.update(inserted, done, null, null)
            // 261117 D 项：回报实际落盘大小（zip 是压缩包，和导出前的累计字节不是一回事）。
            call.resolve(JSObject().put("ok", true).put("name", name).put("dir", Environment.DIRECTORY_DOWNLOADS).put("bytes", src.length()))
        } catch (e: Exception) {
            if (uri != null) {
                try { getContext().contentResolver.delete(uri, null, null) } catch (ignored: Exception) { /* 清理失败不遮主错误 */ }
            }
            call.reject("保存到「下载」失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    /** 图片保存到系统相册（MediaStore Pictures）。 */
    private fun saveImageToGallery(call: PluginCall, src: File, name: String, mime: String) {
        var uri: Uri? = null
        try {
            val values = ContentValues()
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime)
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
            values.put(MediaStore.MediaColumns.IS_PENDING, 1)
            val inserted = getContext().contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            if (inserted == null) {
                call.reject("insert into MediaStore failed")
                return
            }
            uri = inserted
            FileInputStream(src).use { input ->
                getContext().contentResolver.openOutputStream(inserted).use { output -> copy(input, output) }
            }
            val done = ContentValues()
            done.put(MediaStore.MediaColumns.IS_PENDING, 0)
            getContext().contentResolver.update(inserted, done, null, null)
            call.resolve()
        } catch (e: Exception) {
            if (uri != null) {
                try {
                    getContext().contentResolver.delete(uri, null, null)
                } catch (ignored: Exception) {
                    // 清理失败不影响主错误上报
                }
            }
            call.reject("save image failed: " + e.message)
        }
    }

    /** 其它附件走 SAF：弹系统“保存到”面板，回调用户选中的 Uri 写文件。 */
    private fun saveViaSaf(call: PluginCall, src: File, name: String, mime: String) {
        try {
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            intent.addCategory(Intent.CATEGORY_OPENABLE)
            intent.type = mime
            intent.putExtra(Intent.EXTRA_TITLE, name)
            startActivityForResult(call, intent, "safSaveResult")
        } catch (e: ActivityNotFoundException) {
            call.reject("no file picker available: " + e.message)
        } catch (e: Exception) {
            call.reject("save failed: " + e.message)
        }
    }

    @ActivityCallback
    private fun safSaveResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val data = result.data
        val target = data?.data
        if (result.resultCode != Activity.RESULT_OK || target == null) {
            call.reject("canceled")
            return
        }
        val path = call.getString("path")
        val src = if (path != null) File(path) else null
        if (src == null || !isUnderAppSandbox(src) || !src.exists()) {
            call.reject("source file missing")
            return
        }
        try {
            FileInputStream(src).use { input ->
                getContext().contentResolver.openOutputStream(target).use { output -> copy(input, output) }
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("save failed: " + e.message)
        }
    }

    private fun copy(input: InputStream, output: OutputStream?) {
        if (output == null) throw Exception("cannot open output stream")
        val buf = ByteArray(8192)
        var n = input.read(buf)
        while (n > 0) {
            output.write(buf, 0, n)
            n = input.read(buf)
        }
        output.flush()
    }

    private fun mimeFor(file: File): String {
        val ext = file.name
        val dot = ext.lastIndexOf('.')
        if (dot >= 0) {
            val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.substring(dot + 1).lowercase())
            if (type != null) return type
        }
        return "application/octet-stream"
    }

    companion object {
        /**
         * 扩展名围栏（与桌面 isSafeShellOpenFilename 对齐，DS 复核 A4：native 侧也拦，防 WebView 被控绕过 TS 层）。
         * 执行类 + svg（CSP 在 file:// 无效）+ 未知扩展名 fail-closed。
         */
        @JvmStatic
        fun isSafeShellOpenName(name: String): Boolean {
            val dot = name.lastIndexOf('.')
            if (dot <= 0 || dot == name.length - 1) return false
            val ext = name.substring(dot + 1).lowercase(Locale.ROOT)
            return when (ext) {
                "exe", "com", "bat", "cmd", "ps1", "psm1",
                "vbs", "vbe", "js", "jse", "wsf", "wsh",
                "msi", "msp", "scr", "pif", "hta", "cpl",
                "jar", "apk", "app", "command", "sh", "bash",
                "zsh", "dll", "so", "dylib", "bin", "run",
                "out", "appimage", "deb", "rpm", "dmg", "pkg",
                "svg" -> false
                "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
                "txt", "md", "csv", "rtf", "epub", "key", "pages", "numbers",
                "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
                "mp3", "wav", "m4a", "aac", "flac", "ogg", "wma",
                "mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv",
                "json", "png", "jpg", "jpeg", "gif", "webp", "avif",
                "apng", "bmp", "ico", "tiff", "tif" -> true
                // 未知扩展名拒绝；常见文档/媒体/压缩包放行
                else -> false
            }
        }
    }
}