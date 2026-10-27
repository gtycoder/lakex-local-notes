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
    private fun atomicWrite(target: File, sync: Boolean = true, writeBody: (FileOutputStream) -> Unit) {
        val parent = target.parentFile ?: throw IOException("正文父目录无效")
        if (!parent.exists() && !parent.mkdirs()) throw IOException("正文目录创建失败")
        val tmp = File(parent, target.name + ".tmp-" + UUID.randomUUID())
        try {
            FileOutputStream(tmp).use { out ->
                writeBody(out)
                out.flush()
                // sync=false（批量导入）：原子 rename 仍在，只是不逐文件 fsync —— 进程被杀不会丢
                // （页缓存在），断电可能丢最近写入；正文在云端有同内容副本，下轮按 hash 自愈。
                if (sync) out.fd.sync()
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
        // 同步批量导入默认 durable=false（见 atomicWrite 注释）；单写/用户保存仍逐文件 fsync。
        val durable = call.getBoolean("durable", true) ?: true
        var written = 0
        var bytes = 0L
        try {
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val file = resolve(item.optString("path", "")) ?: throw IOException("非法正文路径: " + item.optString("path", ""))
                val data = item.optString("data", "")
                atomicWrite(file, durable) { out -> out.write(data.toByteArray(Charsets.UTF_8)) }
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

    /**
     * 批量移动正文（261027）：同步下载先把正文写到 files/staging/<id>.body（kind 尚不知），
     * 落库时再原子 rename 到最终路径（notes/<id>.lake 等），避免在 JS 里攒 2k 篇正文导致 OOM。
     * items: [{ from, to }]（均相对 files/）。
     */
    @PluginMethod
    fun moveMany(call: PluginCall) {
        val items = call.getArray("items") ?: run { call.reject("items 必填"); return }
        var moved = 0
        try {
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val from = resolve(item.optString("from", "")) ?: throw IOException("非法源路径")
                val to = resolve(item.optString("to", "")) ?: throw IOException("非法目标路径")
                if (!from.isFile) throw IOException("源正文不存在: " + item.optString("from", ""))
                to.parentFile?.let { parent -> if (!parent.exists() && !parent.mkdirs()) throw IOException("正文目录创建失败") }
                if (!from.renameTo(to)) {
                    if (to.exists() && !to.delete()) throw IOException("目标正文删除失败")
                    if (!from.renameTo(to)) throw IOException("正文 rename 失败: " + item.optString("to", ""))
                }
                moved += 1
            }
            call.resolve(JSObject().put("moved", moved))
        } catch (e: Exception) {
            call.reject("正文批量移动失败（已完成 " + moved + " 篇）: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    /** 清理 staging 目录（崩溃残留；每次同步 init 时调用，幂等）。 */
    @PluginMethod
    fun clearStaging(call: PluginCall) {
        try {
            val dir = File(root, "staging")
            var removed = 0
            if (dir.isDirectory) for (f in dir.listFiles() ?: emptyArray()) if (f.isFile) { if (f.delete()) removed += 1 }
            call.resolve(JSObject().put("removed", removed))
        } catch (e: Exception) {
            call.reject("清理 staging 失败: " + (e.message ?: e.javaClass.simpleName))
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
     * 批量 stat 正文（261026 续传提速）：续传时先比对 hash，一致且文件存在就完全不用读内容。
     * paths: [relative] → items: [{ path, exists, size }]
     */
    @PluginMethod
    fun statMany(call: PluginCall) {
        val paths = call.getArray("paths") ?: run { call.reject("paths 必填"); return }
        val items = JSArray()
        try {
            for (i in 0 until paths.length()) {
                val relative = paths.optString(i, "")
                val item = JSObject()
                val file = resolve(relative)
                item.put("path", relative)
                item.put("exists", file != null && file.isFile)
                item.put("size", if (file != null && file.isFile) file.length() else 0L)
                items.put(item)
            }
            call.resolve(JSObject().put("items", items))
        } catch (e: Exception) {
            call.reject("正文批量 stat 失败: " + (e.message ?: e.javaClass.simpleName))
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
