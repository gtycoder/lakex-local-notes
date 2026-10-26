package com.locallakexnotes.mobile

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * 正文文件存储（261019，移动端存储架构对齐桌面）。
 *
 * 目录 = App 私有 files/（Capacitor Directory.Data），相对路径由 core 的
 * src/core/noteBodyPaths.ts 统一给出（notes/{id}.lake、bitables/{id}.bitable.json、
 * quick-notes/items/{id}.qnote、history/{id}/<snapshot>.body.gz …）。
 *
 * 为什么自写插件而不是 @capacitor/filesystem：
 *   · 正文每次保存都要写盘，多一次 JS↔native 桥往返会直接加在保存延迟上；
 *   · 正文必须原子写（临时文件 + fsync + rename），Filesystem 没有原子替换；
 *   · 历史快照要 gzip —— 在原生做，不依赖 WebView 的 CompressionStream 能力。
 *
 * 安全边界：只接受相对 files/ 的路径；绝对路径 / ".." / 反斜杠一律拒绝；
 * 解析后 canonicalPath 必须仍在 files/ 下（目录穿越防护）。
 */
@CapacitorPlugin(name = "BodyStore")
class BodyStorePlugin : Plugin() {
    private val root: File get() = context.filesDir

    /** 相对路径 → files/ 下的 File；非法或越界返回 null（调用方 reject）。 */
    private fun resolve(relative: String?): File? {
        if (relative.isNullOrBlank()) return null
        if (relative.startsWith("/") || relative.startsWith("\\")) return null
        if (relative.contains('\u0000')) return null
        if (relative.split('/').any { it == ".." || it == "." || it.isEmpty() }) return null
        return try {
            val rootCanonical = root.canonicalFile
            val target = File(rootCanonical, relative).canonicalFile
            if (target.path != rootCanonical.path && target.path.startsWith(rootCanonical.path + File.separator)) target else null
        } catch (e: Exception) {
            null
        }
    }

    private fun resolveOrReject(call: PluginCall, key: String = "path"): File? {
        val file = resolve(call.getString(key))
        if (file == null) {
            call.reject("非法正文路径")
            return null
        }
        return file
    }

    /** 原子写：同目录临时文件 → fsync → rename。失败清理临时文件。 */
    private fun atomicWrite(target: File, writeBody: (FileOutputStream) -> Unit) {
        val parent = target.parentFile ?: throw IOException("正文父目录无效")
        if (!parent.exists() && !parent.mkdirs()) throw IOException("正文目录创建失败")
        val tmp = File(parent, target.name + ".tmp-" + UUID.randomUUID())
        try {
            FileOutputStream(tmp).use { out ->
                writeBody(out)
                out.flush()
                out.fd.sync()
            }
            if (!tmp.renameTo(target)) {
                // 某些文件系统 rename 目标存在会失败：先删再 rename（同目录下仍是原子的）。
                if (target.exists() && !target.delete()) throw IOException("旧正文删除失败")
                if (!tmp.renameTo(target)) throw IOException("正文 rename 失败")
            }
        } finally {
            if (tmp.exists()) tmp.delete()
        }
    }

    private fun readTextFile(file: File): String? {
        if (!file.isFile) return null
        return file.readText(Charsets.UTF_8)
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val file = resolveOrReject(call) ?: return
        val data = call.getString("data") ?: run { call.reject("data 必填"); return }
        try {
            atomicWrite(file) { out -> out.write(data.toByteArray(Charsets.UTF_8)) }
            val res = JSObject()
            res.put("size", file.length())
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("正文写入失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    /**
     * 批量原子写（261026 首拉提速）：一次桥调用写多篇正文（每篇仍是 tmp+fsync+rename）。
     * 首拉 2k 篇时把「2k 次 JS↔native 往返」压成「每 100 篇 1 次」。
     * items: [{ path, data }] → { written, bytes }
     */
    @PluginMethod
    fun writeMany(call: PluginCall) {
        val items = call.getArray("items") ?: run { call.reject("items 必填"); return }
        var written = 0
        var bytes = 0L
        try {
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val file = resolve(item.optString("path", "")) ?: throw IOException("非法正文路径: " + item.optString("path", ""))
                val data = item.optString("data", "")
                atomicWrite(file) { out -> out.write(data.toByteArray(Charsets.UTF_8)) }
                written += 1
                bytes += file.length()
            }
            val res = JSObject()
            res.put("written", written)
            res.put("bytes", bytes)
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("正文批量写入失败（已完成 " + written + " 篇）: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun read(call: PluginCall) {
        val file = resolveOrReject(call) ?: return
        try {
            val data = readTextFile(file)
            val res = JSObject()
            if (data == null) {
                res.put("exists", false)
            } else {
                res.put("exists", true)
                res.put("data", data)
            }
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("正文读取失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    /**
     * 批量读正文（261026 续传提速）：一次桥读一批（如 100 篇），替代续传时逐篇 readBody 的 2k 次往返。
     * paths: [relative] → items: [{ path, exists, data? }]
     */
    @PluginMethod
    fun readMany(call: PluginCall) {
        val paths = call.getArray("paths") ?: run { call.reject("paths 必填"); return }
        val items = JSArray()
        try {
            for (i in 0 until paths.length()) {
                val relative = paths.optString(i, "")
                val item = JSObject()
                val file = resolve(relative)
                if (file == null) {
                    item.put("path", relative)
                    item.put("exists", false)
                    items.put(item)
                    continue
                }
                val data = readTextFile(file)
                item.put("path", relative)
                item.put("exists", data != null)
                if (data != null) item.put("data", data)
                items.put(item)
            }
            call.resolve(JSObject().put("items", items))
        } catch (e: Exception) {
            call.reject("正文批量读取失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val file = resolveOrReject(call) ?: return
        try {
            if (file.exists()) file.delete()
            // 顺带清理空目录（不越过 files/ 根）。
            var dir = file.parentFile
            val rootCanonical = root.canonicalFile
            while (dir != null && dir.canonicalPath != rootCanonical.path) {
                val children = dir.list()
                if (children == null || children.isNotEmpty()) break
                if (!dir.delete()) break
                dir = dir.parentFile
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("正文删除失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun stat(call: PluginCall) {
        val file = resolveOrReject(call) ?: return
        val res = JSObject()
        res.put("exists", file.isFile)
        res.put("size", if (file.isFile) file.length() else 0L)
        call.resolve(res)
    }

    @PluginMethod
    fun writeSnapshot(call: PluginCall) {
        val file = resolveOrReject(call) ?: return
        val data = call.getString("data") ?: run { call.reject("data 必填"); return }
        try {
            atomicWrite(file) { out ->
                // 只 finish、不能 close：close 会连带关掉外层 FileOutputStream，atomicWrite 随后还要 fd.sync()。
                val gz = GZIPOutputStream(out)
                gz.write(data.toByteArray(Charsets.UTF_8))
                gz.finish()
            }
            val res = JSObject()
            res.put("size", file.length())
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("历史快照写入失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun readSnapshot(call: PluginCall) {
        val file = resolveOrReject(call) ?: return
        try {
            if (!file.isFile) {
                val res = JSObject()
                res.put("exists", false)
                call.resolve(res)
                return
            }
            val text = GZIPInputStream(file.inputStream()).use { gz ->
                val buffer = ByteArrayOutputStream()
                gz.copyTo(buffer)
                buffer.toString(Charsets.UTF_8.name())
            }
            val res = JSObject()
            res.put("exists", true)
            res.put("data", text)
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("历史快照读取失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }
}
