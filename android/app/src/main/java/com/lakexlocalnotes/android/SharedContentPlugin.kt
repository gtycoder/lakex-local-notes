package com.lakexlocalnotes.android

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import com.getcapacitor.JSArray
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

internal class SharedContentTooLargeException(maxBytes: Long, label: String = "文件") :
    Exception("分享的${label}超过 ${maxBytes / 1024 / 1024} MiB，未导入")

/** 边读边计数，超过上限立刻停止；调用方负责删除临时文件。label 只用于可见报错文案。 */
internal fun copyStreamToFile(input: InputStream, output: OutputStream, maxBytes: Long, label: String = "文件"): Long {
    val buf = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val n = input.read(buf)
        if (n < 0) break
        total += n
        if (total > maxBytes) throw SharedContentTooLargeException(maxBytes, label)
        output.write(buf, 0, n)
    }
    return total
}

private data class InboxCopy(
    val filename: String? = null,
    val mimeType: String? = null,
    /** 261102 T2-C：显式分类 image | pdf | markdown | file（JS 不再靠 imageFilename 猜；旧字段仍在，保回滚兼容）。 */
    val kind: String? = null,
    /** 261106：原始显示名（分享方给的 DISPLAY_NAME）——导入 Markdown 时用它做文档标题（inbox 文件名是 UUID）。 */
    val displayName: String? = null,
    val error: String? = null,
)

/**
 * 系统「分享 → LakexLocalNotes」入口（ACTION_SEND）。
 *
 * 原生只做接住：文本原样交给 JS；图片/文件复制到 `filesDir/shared-inbox/<name>`
 * （JS 用 `capacitor/filesystem` 的 Directory.Data 读取），随后 JS 打开「小记」框预填。
 * 冷启动读 launch intent；已在运行时走 [handleOnNewIntent]。
 */
@CapacitorPlugin(name = "SharedContent")
class SharedContentPlugin : Plugin() {
    private var pending: JSObject? = null

    /** 已处理的分享 URI + 复制结果：load 与 onNewIntent 可能对同一次分享各触发一次，用它去重。 */
    private var lastUri: String? = null
    private var lastCopies: List<InboxCopy>? = null

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
            lastCopies = null
        }
    }

    /** 单文件分享（SEND）：EXTRA_STREAM 一个 Uri。 */
    private fun singleStream(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        }

    /** 多文件分享（SEND_MULTIPLE）：EXTRA_STREAM 是 ArrayList<Uri>。 */
    private fun multipleStreams(intent: Intent): List<Uri> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
        } else {
            @Suppress("DEPRECATION")
            (intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)) ?: emptyList()
        }

    private fun readIntent(intent: Intent?) {
        if (intent == null) return
        // 261106：ACTION_SEND（单文件/纯文本）与 ACTION_SEND_MULTIPLE（多文件，如批量分享 .md）。
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(singleStream(intent))
            Intent.ACTION_SEND_MULTIPLE -> multipleStreams(intent)
            else -> return
        }
        val out = JSObject()
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (!text.isNullOrEmpty()) out.put("text", text)
        if (uris.isNotEmpty()) {
            val mime = intent.type
            val key = uris.joinToString("|") { it.toString() }
            val copies: List<InboxCopy> = if (key == lastUri && lastCopies != null) {
                lastCopies!! // 同一次分享被两条路径触发：复用结果，不再复制
            } else {
                uris.map { copyToInbox(it, mime) }.also {
                    lastUri = key
                    lastCopies = it
                }
            }
            // 兼容旧 JS/回滚：首个文件的 filename/kind/mimeType/displayName/imageFilename 仍照旧输出。
            val copy0 = copies.firstOrNull()
            if (copy0?.filename != null) {
                out.put("filename", copy0.filename)
                out.put("kind", copy0.kind ?: KIND_FILE)
                out.put("imageFilename", copy0.filename)
                out.put("mimeType", copy0.mimeType ?: mime ?: "application/octet-stream")
                if (copy0.displayName != null) out.put("displayName", copy0.displayName)
            }
            // 多文件（SEND_MULTIPLE）：files = [{filename, kind, mimeType}]；逐个文件的失败也在这里带上 error。
            val files = JSArray()
            for (copied in copies) {
                val entry = JSObject()
                if (copied.filename != null) {
                    entry.put("filename", copied.filename)
                    entry.put("kind", copied.kind ?: KIND_FILE)
                    entry.put("mimeType", copied.mimeType ?: mime ?: "application/octet-stream")
                    if (copied.displayName != null) entry.put("displayName", copied.displayName)
                }
                if (copied.error != null) entry.put("error", copied.error)
                files.put(entry)
            }
            if (files.length() > 0) out.put("files", files)
            // 首个文件的错误仍写 imageError（旧字段兼容）。
            if (copy0?.error != null) out.put("imageError", copy0.error)
        }
        if (out.length() > 0) pending = out
    }

    private fun copyToInbox(uri: Uri, mime: String?): InboxCopy {
        val dir = File(getContext().filesDir, INBOX)
        // MIME 可能是 application/octet-stream（分享方对 PDF 很常见）⇒ 用 DISPLAY_NAME 后缀兜底定扩展名/分类。
        val displayName = queryDisplayName(uri)
        val extension = extensionFor(mime, displayName)
        val kind = classifyShared(mime, extension)
        // 261102 T2-C：PDF 单独 32MiB 档；261106：Markdown 与共享管线上限对齐（20MiB）；图片/其它仍 25MiB。
        val maxBytes = when (kind) {
            KIND_PDF -> MAX_PDF_INBOX_BYTES
            KIND_MARKDOWN -> MAX_MARKDOWN_INBOX_BYTES
            else -> MAX_INBOX_BYTES
        }
        val label = when (kind) {
            KIND_PDF -> "PDF"
            KIND_MARKDOWN -> "Markdown 文件"
            else -> "文件"
        }
        val out = File(dir, UUID.randomUUID().toString().replace("-", "") + extension)
        val partial = File(dir, out.name + ".part")
        return try {
            if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("cannot create shared inbox")
            getContext().contentResolver.openInputStream(uri).use { input ->
                if (input == null) throw IllegalStateException("cannot open shared content")
                FileOutputStream(partial).use { os -> copyStreamToFile(input, os, maxBytes, label) }
            }
            if (!partial.renameTo(out)) throw IllegalStateException("cannot finalize shared content")
            InboxCopy(filename = out.name, mimeType = mime ?: "application/octet-stream", kind = kind, displayName = displayName)
        } catch (e: Exception) {
            Log.w("SharedContentPlugin", "copyToInbox failed", e)
            partial.delete()
            out.delete()
            InboxCopy(error = if (e is SharedContentTooLargeException) e.message else "读取分享文件失败，未导入")
        }
    }

    /** 分享文件的显示名：octet-stream 时靠后缀判 PDF。查询失败不抛错，回退 uri 末段。 */
    private fun queryDisplayName(uri: Uri): String? {
        return try {
            getContext().contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null
            } ?: uri.lastPathSegment
        } catch (e: Exception) {
            uri.lastPathSegment
        }
    }

    /** MIME → 扩展名；MIME 不可信（octet-stream/缺失/text/plain）时看 DISPLAY_NAME 的后缀兜底。 */
    private fun extensionFor(mime: String?, displayName: String?): String {
        val lower = displayName?.lowercase()
        when {
            mime == null -> {}
            mime.startsWith("image/png") -> return ".png"
            mime.startsWith("image/jpeg") -> return ".jpg"
            mime.startsWith("image/gif") -> return ".gif"
            mime.startsWith("image/webp") -> return ".webp"
            mime.startsWith("image/avif") -> return ".avif"
            mime.startsWith("application/pdf") -> return ".pdf"
            mime.startsWith("text/markdown") || mime.startsWith("text/x-markdown") -> return if (lower?.endsWith(".markdown") == true) ".markdown" else ".md"
        }
        if (lower?.endsWith(".pdf") == true) return ".pdf"
        // 261106：分享方常把 .md 标成 text/plain 或 application/octet-stream ⇒ 用 DISPLAY_NAME 后缀兜底。
        if (lower?.endsWith(".markdown") == true) return ".markdown"
        if (lower?.endsWith(".md") == true) return ".md"
        return ".bin"
    }

    /** 显式分类（261102 T2-C / 261106 扩展）：image | pdf | markdown | file。 */
    private fun classifyShared(mime: String?, extension: String): String = when {
        extension == ".pdf" || mime?.startsWith("application/pdf") == true -> KIND_PDF
        extension in MARKDOWN_EXTENSIONS || mime?.startsWith("text/markdown") == true || mime?.startsWith("text/x-markdown") == true -> KIND_MARKDOWN
        extension in IMAGE_EXTENSIONS || mime?.startsWith("image/") == true -> KIND_IMAGE
        else -> KIND_FILE
    }

    /** JS 启动/回前台时取一次性分享内容（取完即清）。 */
    @PluginMethod
    fun consume(call: PluginCall) {
        val result = pending
        pending = null
        lastUri = null
        lastCopies = null
        call.resolve(result ?: JSObject())
    }

    private companion object {
        const val INBOX = "shared-inbox"
        /** 与共享图片协议上限 MAX_IMAGE_BYTES 对齐（Kotlin 无法直接引用 TS 常量）。 */
        const val MAX_INBOX_BYTES = 25L * 1024 * 1024
        /** 261102 T2-C：PDF 单独一档（与桌面 AI_PDF_MAX_BYTES 32MiB 对齐）；图片/其它仍 25MiB。 */
        const val MAX_PDF_INBOX_BYTES = 32L * 1024 * 1024
        /** 分享内容显式分类，输出到 JS 的 `kind` 字段（JS 不再靠 imageFilename 猜）。 */
        const val KIND_IMAGE = "image"
        const val KIND_PDF = "pdf"
        /** 261106：Markdown 分享（.md → 共享管线导入为文档）。 */
        const val KIND_MARKDOWN = "markdown"
        const val KIND_FILE = "file"
        /** Markdown 归档上限与 src/features/import/markdownImportPipeline 的 MAX_MARKDOWN_IMPORT_BYTES 对齐。 */
        const val MAX_MARKDOWN_INBOX_BYTES = 20L * 1024 * 1024
        val IMAGE_EXTENSIONS = setOf(".png", ".jpg", ".gif", ".webp", ".avif")
        val MARKDOWN_EXTENSIONS = setOf(".md", ".markdown")
    }
}
