package com.lakexlocalnotes.android

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.ParcelFileDescriptor
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * PDF 逐页栅格化（261102 T2 spike，PDF 导入 → 图片页的前置能力）。
 *
 * 平台能力来自系统自带的 [PdfRenderer]（API 21+ / minSdk 24），**离线、零第三方依赖、零新打包体积**。
 * 口径：
 *  · 逐页**串行**渲染（PdfRenderer 只允许一页打开），每页渲染完立刻 recycle bitmap + close page；
 *  · 默认降采样到 maxWidth（A4 595pt → 1600px ≈ 2.7x），RGB_565 省一半内存，WebP 有损压缩落 cacheDir；
 *  · 每页发一次 progress 事件（page/pageCount/尺寸/字节），cancel 标志**每页检查**（长文档可中断）；
 *  · 输出只写 app 私有 cacheDir（可被系统回收，调用方负责把它当临时产物）。
 *
 * 输入来源二选一：
 *  · path = 相对 files/ 的路径（与 BodyStorePlugin 同一套安全校验）；
 *  · noteId + filename = 文档资产 files/note-assets/{noteId}/{filename}（与 assetFs.ts 的目录同构）。
 *
 * 注意：本插件只做「PDF → 图片页文件」，不落库、不改正文；ink 模型接线由后续任务负责。
 */
@CapacitorPlugin(name = "PdfRender")
class PdfRenderPlugin : Plugin() {
    companion object {
        /** 默认目标宽度（A4@2x ≈ 1190；1600 给文字型试卷留更高余量）。 */
        private const val DEFAULT_MAX_WIDTH = 1600
        private const val MIN_MAX_WIDTH = 320
        private const val MAX_MAX_WIDTH = 2400
        private const val DEFAULT_QUALITY = 80
        /** 输出子目录（cacheDir 下；同一批渲染共用一个 uuid 目录，便于整体清理）。 */
        private const val OUT_DIR = "pdf-render"
    }

    /** 单飞：同一时刻只允许一次渲染（PdfRenderer 实例/内存都不能并发铺开）。 */
    private val busy = AtomicBoolean(false)

    /** 取消标志：renderPdf 每页开始前检查；由 cancel() 置位。 */
    @Volatile
    private var cancelRequested = false

    private fun resolveRelative(relative: String?): File? {
        if (relative.isNullOrBlank()) return null
        if (relative.startsWith("/") || relative.startsWith("\\")) return null
        if (relative.contains('\u0000')) return null
        if (relative.split('/').any { it == ".." || it == "." || it.isEmpty() }) return null
        return try {
            val root = context.filesDir.canonicalFile
            val target = File(root, relative).canonicalFile
            if (target.path.startsWith(root.path + File.separator)) target else null
        } catch (e: Exception) {
            null
        }
    }

    private fun resolvePdfFile(call: PluginCall): File? {
        val relative = call.getString("path")
        if (!relative.isNullOrBlank()) return resolveRelative(relative)
        val noteId = call.getString("noteId")
        val filename = call.getString("filename")
        if (noteId.isNullOrBlank() || filename.isNullOrBlank()) return null
        if (noteId.contains('/') || noteId.contains('\\') || noteId == ".." || noteId == ".") return null
        if (filename.contains('/') || filename.contains('\\') || filename == ".." || filename == ".") return null
        return resolveRelative("note-assets/" + noteId + "/" + filename)
    }

    /** 输出目录：cacheDir/pdf-render/<uuid>/（每次渲染独立，失败/取消也不留半成品混淆）。 */
    private fun newOutputDir(): File {
        val base = File(context.cacheDir, OUT_DIR)
        if (!base.exists() && !base.mkdirs()) throw IllegalStateException("无法创建缓存目录")
        val dir = File(base, UUID.randomUUID().toString().replace("-", ""))
        if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("无法创建渲染目录")
        return dir
    }

    private fun compressToWebp(bitmap: Bitmap, file: File, quality: Int) {
        FileOutputStream(file).use { out ->
            val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Bitmap.CompressFormat.WEBP_LOSSY
            } else {
                @Suppress("DEPRECATION")
                Bitmap.CompressFormat.WEBP
            }
            if (!bitmap.compress(format, quality, out)) throw IllegalStateException("WebP 压缩失败")
            out.flush()
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cancelRequested = true
        val out = JSObject()
        out.put("cancelled", true)
        call.resolve(out)
    }

    /**
     * 渲染整份 PDF 的每一页。
     * options: { path? , noteId?+filename? , maxWidth?=1600, quality?=80 }
     * result:  { pageCount, pages:[{page,width,height,file,bytes}], cancelled, elapsedMs }
     * 事件:    progress { page, pageCount, width, height, bytes, file }
     */
    @PluginMethod
    fun renderPdf(call: PluginCall) {
        val source = resolvePdfFile(call)
        if (source == null) {
            call.reject("非法 PDF 路径（需要相对 files/ 的 path，或 noteId + filename）")
            return
        }
        if (!source.isFile) {
            call.reject("PDF 文件不存在: " + source.name)
            return
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("已有 PDF 正在渲染，请等待完成或先取消")
            return
        }
        cancelRequested = false
        val maxWidth = (call.getInt("maxWidth") ?: DEFAULT_MAX_WIDTH).coerceIn(MIN_MAX_WIDTH, MAX_MAX_WIDTH)
        val quality = (call.getInt("quality") ?: DEFAULT_QUALITY).coerceIn(1, 100)
        val startedAt = System.currentTimeMillis()

        Thread {
            var pfd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            try {
                val outDir = newOutputDir()
                pfd = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(pfd)
                val pageCount = renderer.pageCount
                val pages = JSArray()
                var cancelled = false

                for (index in 0 until pageCount) {
                    if (cancelRequested) { cancelled = true; break }
                    val page = renderer.openPage(index)
                    var bitmap: Bitmap? = null
                    try {
                        // PdfRenderer 的宽高单位 = 72dpi 下的像素（A4 = 595x842）。
                        val scale = if (page.width > maxWidth) maxWidth.toFloat() / page.width else 1f
                        val width = (page.width * scale).toInt().coerceAtLeast(1)
                        val height = (page.height * scale).toInt().coerceAtLeast(1)
                        bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
                        // render 只画页面内容、不清底 ⇒ 先铺白（RGB_565 画白底可省一半内存）。
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        val out = File(outDir, "page-" + (index + 1) + ".webp")
                        compressToWebp(bitmap, out, quality)
                        val item = JSObject()
                        item.put("page", index + 1)
                        item.put("width", width)
                        item.put("height", height)
                        item.put("file", out.absolutePath)
                        item.put("bytes", out.length())
                        pages.put(item)
                        notifyListeners("progress", item)
                    } finally {
                        bitmap?.recycle()
                        page.close()
                    }
                }

                val result = JSObject()
                result.put("pageCount", pageCount)
                result.put("pages", pages)
                result.put("cancelled", cancelled)
                result.put("elapsedMs", System.currentTimeMillis() - startedAt)
                call.resolve(result)
            } catch (e: Exception) {
                call.reject("PDF 渲染失败: " + (e.message ?: e.javaClass.simpleName))
            } finally {
                try { renderer?.close() } catch (e: Exception) { /* 忽略 */ }
                try { pfd?.close() } catch (e: Exception) { /* 忽略 */ }
                busy.set(false)
                cancelRequested = false
            }
        }.start()
    }
}
