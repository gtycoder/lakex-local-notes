package com.locallakexnotes.mobile

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
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

internal class SharedContentTooLargeException(maxBytes: Long) :
    Exception("分享的图片超过 ${maxBytes / 1024 / 1024} MiB，未导入")

/** 边读边计数，超过上限立刻停止；调用方负责删除临时文件。 */
internal fun copyStreamToFile(input: InputStream, output: OutputStream, maxBytes: Long): Long {
    val buf = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val n = input.read(buf)
        if (n < 0) break
        total += n
        if (total > maxBytes) throw SharedContentTooLargeException(maxBytes)
        output.write(buf, 0, n)
    }
    return total
}

private data class InboxCopy(val filename: String? = null, val error: String? = null)

/**
 * 系统「分享 → LocalLakexNotes」入口（ACTION_SEND）。
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
    private var lastImageError: String? = null

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
            lastImageError = null
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
            val copied: InboxCopy = if (uri.toString() == lastUri && (lastImageFilename != null || lastImageError != null)) {
                InboxCopy(lastImageFilename, lastImageError) // 同一次分享被两条路径触发：复用结果，不再复制
            } else {
                copyToInbox(uri, mime).also {
                    lastUri = uri.toString()
                    lastImageFilename = it.filename
                    lastImageError = it.error
                }
            }
            if (copied.filename != null) {
                out.put("imageFilename", copied.filename)
                out.put("mimeType", mime ?: "application/octet-stream")
            }
            if (copied.error != null) out.put("imageError", copied.error)
        }
        if (out.length() > 0) pending = out
    }

    private fun copyToInbox(uri: Uri, mime: String?): InboxCopy {
        val dir = File(getContext().filesDir, INBOX)
        val out = File(dir, UUID.randomUUID().toString().replace("-", "") + extensionFor(mime))
        val partial = File(dir, out.name + ".part")
        return try {
            if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("cannot create shared inbox")
            getContext().contentResolver.openInputStream(uri).use { input ->
                if (input == null) throw IllegalStateException("cannot open shared content")
                FileOutputStream(partial).use { os -> copyStreamToFile(input, os, MAX_INBOX_BYTES) }
            }
            if (!partial.renameTo(out)) throw IllegalStateException("cannot finalize shared content")
            InboxCopy(filename = out.name)
        } catch (e: Exception) {
            Log.w("SharedContentPlugin", "copyToInbox failed", e)
            partial.delete()
            out.delete()
            InboxCopy(error = if (e is SharedContentTooLargeException) e.message else "读取分享文件失败，未导入")
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
        lastImageError = null
        call.resolve(result ?: JSObject())
    }

    private companion object {
        const val INBOX = "shared-inbox"
        /** 与共享图片协议上限 MAX_IMAGE_BYTES 对齐（Kotlin 无法直接引用 TS 常量）。 */
        const val MAX_INBOX_BYTES = 25L * 1024 * 1024
    }
}
