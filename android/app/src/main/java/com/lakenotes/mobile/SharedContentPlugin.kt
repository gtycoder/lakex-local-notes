package com.lakenotes.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * 系统「分享 → LocalLakeNotes」入口（ACTION_SEND）。
 *
 * 原生只做接住：文本原样交给 JS；图片/文件复制到 `filesDir/shared-inbox/<name>`
 * （JS 用 `capacitor/filesystem` 的 Directory.Data 读取），随后 JS 打开「小记」框预填。
 * 冷启动读 launch intent；已在运行时走 [handleOnNewIntent]。
 */
@CapacitorPlugin(name = "SharedContent")
class SharedContentPlugin : Plugin() {
    private var pending: JSObject? = null

    /** 已处理的分享 URI + 复制出的文件名：load 与 onNewIntent 可能对同一次分享各触发一次，用它去重。 */
    private var lastUri: String? = null
    private var lastImageFilename: String? = null

    override fun load() {
        readIntent(getActivity().intent)
    }

    override fun handleOnNewIntent(intent: Intent?) {
        readIntent(intent)
        val current = pending
        if (current != null) {
            // 热启动：通知后清掉 pending，避免 JS 再 consume 到同一条（重复开框）
            notifyListeners("shared", current, true)
            pending = null
            lastUri = null
            lastImageFilename = null
        }
    }

    private fun readIntent(intent: Intent?) {
        if (intent == null || Intent.ACTION_SEND != intent.action) return
        val out = JSObject()
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (!text.isNullOrEmpty()) out.put("text", text)
        val uri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        }
        if (uri != null) {
            val mime = intent.type
            val name: String? = if (uri.toString() == lastUri && lastImageFilename != null) {
                lastImageFilename // 同一次分享被两条路径触发：复用已复制的文件，不再复制
            } else {
                copyToInbox(uri, mime).also {
                    if (it != null) {
                        lastUri = uri.toString()
                        lastImageFilename = it
                    }
                }
            }
            if (name != null) {
                out.put("imageFilename", name)
                out.put("mimeType", mime ?: "application/octet-stream")
            }
        }
        if (out.length() > 0) pending = out
    }

    private fun copyToInbox(uri: Uri, mime: String?): String? {
        return try {
            val dir = File(getContext().filesDir, INBOX)
            if (!dir.exists() && !dir.mkdirs()) return null
            val out = File(dir, UUID.randomUUID().toString().replace("-", "") + extensionFor(mime))
            getContext().contentResolver.openInputStream(uri).use { input ->
                if (input == null) return null
                FileOutputStream(out).use { os ->
                    val buf = ByteArray(64 * 1024)
                    var n = input.read(buf)
                    while (n > 0) {
                        os.write(buf, 0, n)
                        n = input.read(buf)
                    }
                }
            }
            out.name
        } catch (e: Exception) {
            Log.w("SharedContentPlugin", "copyToInbox failed", e)
            null
        }
    }

    private fun extensionFor(mime: String?): String = when {
        mime == null -> ".bin"
        mime.startsWith("image/png") -> ".png"
        mime.startsWith("image/jpeg") -> ".jpg"
        mime.startsWith("image/gif") -> ".gif"
        mime.startsWith("image/webp") -> ".webp"
        mime.startsWith("image/avif") -> ".avif"
        else -> ".bin"
    }

    /** JS 启动/回前台时取一次性分享内容（取完即清）。 */
    @PluginMethod
    fun consume(call: PluginCall) {
        val result = pending
        pending = null
        lastUri = null
        lastImageFilename = null
        call.resolve(result ?: JSObject())
    }

    private companion object {
        const val INBOX = "shared-inbox"
    }
}
