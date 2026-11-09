package com.lakexlocalnotes.android

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

/**
 * 便携包导入（docs/PORTABLE-TRANSFER.md）原生半段：选 zip / 解压 / 只读读桌面库 / 复制文件 / 回滚。
 *
 * 职责边界：
 *  · 本插件**不写**手机业务库（S3 基线、notes/folders 映射全在 JS，见 src/mobile/portable/importPortable.ts）；
 *  · 本插件只做文件系统与「只读打开桌面 SQLite 分页返回行」；
 *  · 解压严格防 zip-slip（拒绝绝对路径 / ".." / 反斜杠 / 符号链接式条目），总大小 ≤4GiB；
 *  · 导入前把当前数据隔离到 files/portable-import/rollback-<ts>/：DB 复制、正文/资产目录 **rename 移动**；
 *    写 pending.json；提交删除隔离；失败/下次启动发现 pending 自动回滚。
 */
@CapacitorPlugin(name = "PortableImport")
class PortablePackagePlugin : Plugin() {

    companion object {
        private const val PORTABLE_FORMAT = "lakex-local-notes-portable"
        private const val PORTABLE_FORMAT_VERSION = 1
        private const val PORTABLE_LIMIT_BYTES = 4L * 1024 * 1024 * 1024
        private const val MAX_ENTRIES = 100_000
        private const val MAX_MANIFEST_BYTES = 2 * 1024 * 1024
        private const val PAGE_SIZE_MAX = 1000

        private const val IMPORT_ROOT = "portable-import"
        private const val PENDING_FILE = "pending.json"
        private const val MOBILE_DB_FILE = "lakex-local-notes-mobileSQLite.db"

        /** 需要随导入一起改写的正文/资产目录（手机端 = filesDir 下同名相对路径）。 */
        private val PAYLOAD_DIRS = listOf(
            "notes", "usheets", "bitables", "boards", "inks",
            "note-assets", "quick-notes/items", "quick-notes/assets",
        )

        /** 只允许读取的桌面表（避免把任意 SQL 带进插件）。 */
        private val READONLY_TABLES = mapOf(
            "main" to setOf("notes", "tree_nodes"),
            "quick" to setOf("quick_notes", "quick_note_deleted", "tags", "tag_links", "tag_link_versions"),
        )
    }

    private val pickInFlight = AtomicBoolean(false)

    private fun importRoot(): File = File(context.filesDir, IMPORT_ROOT).apply { mkdirs() }

    private fun pendingFile(): File = File(importRoot(), PENDING_FILE)

    /** 目录围栏：pending/rollback 里读到的路径必须先证明在 portable-import/ 下，才允许递归删除。 */
    private fun isInsideImportRoot(file: File): Boolean {
        return try {
            val root = importRoot().canonicalPath
            val canonical = file.canonicalFile.path
            canonical == root || canonical.startsWith(root + File.separator)
        } catch (e: Exception) {
            false
        }
    }

    // ---- 1) 选包 + 解压 + 清单校验 ----

    @PluginMethod
    fun pickAndStage(call: PluginCall) {
        if (!pickInFlight.compareAndSet(false, true)) {
            call.reject("已有便携包解析在进行，请稍后")
            return
        }
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(call, intent, "stagingResult")
        } catch (e: Exception) {
            pickInFlight.set(false)
            call.reject("无法打开系统文件选择器: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @ActivityCallback
    private fun stagingResult(call: PluginCall?, result: ActivityResult) {
        pickInFlight.set(false)
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("ok", false).put("cancelled", true))
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("没有选中文件")
            return
        }
        call.setKeepAlive(true)
        Thread {
            try {
                call.resolve(extractArchive(uri))
            } catch (e: Exception) {
                call.reject("便携包无效: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun extractArchive(uri: Uri): JSObject {
        val stage = File(importRoot(), "stage-" + System.currentTimeMillis()).apply { mkdirs() }
        val stageRoot = stage.canonicalPath
        var totalBytes = 0L
        var entryCount = 0
        try {
            val stream = context.contentResolver.openInputStream(uri) ?: throw IOException("无法读取所选文件")
            BufferedInputStream(stream).use { buffered ->
                ZipInputStream(buffered).use { zin ->
                    while (true) {
                        val entry = zin.nextEntry ?: break
                        entryCount += 1
                        if (entryCount > MAX_ENTRIES) throw IOException("zip 条目过多（上限 " + MAX_ENTRIES + "）")
                        val rawName = entry.name ?: throw IOException("zip 条目缺少名称")
                        if (rawName.contains('\\') || rawName.startsWith("/")) throw IOException("zip 条目含非法路径")
                        var name = rawName.replace('\\', '/').trim('/')
                        while (name.startsWith("./")) name = name.substring(2)
                        if (name.isEmpty()) continue
                        val parts = name.split('/')
                        if (parts.any { it == ".." || it == "." || it.isEmpty() }) throw IOException("zip 条目含上级目录")
                        val target = File(stage, name).canonicalFile
                        if (target.path != stageRoot && !target.path.startsWith(stageRoot + File.separator)) {
                            throw IOException("zip 条目越界")
                        }
                        if (entry.isDirectory) {
                            target.mkdirs()
                            continue
                        }
                        target.parentFile?.mkdirs()
                        FileOutputStream(target).use { out ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = zin.read(buffer)
                                if (read < 0) break
                                totalBytes += read
                                if (totalBytes > PORTABLE_LIMIT_BYTES) throw IOException("便携包超过 4GiB 上限")
                                out.write(buffer, 0, read)
                            }
                        }
                    }
                }
            }
            val manifestText = validateStagedPackage(stage, totalBytes)
            return JSObject()
                .put("ok", true)
                .put("stagingPath", stage.absolutePath)
                .put("manifestJson", manifestText)
                .put("bytes", totalBytes)
                .put("entries", entryCount)
        } catch (e: Exception) {
            stage.deleteRecursively()
            throw e
        }
    }

    /** 最小校验（与 src/core/portable/portableFormat.ts 同口径）；完整解析/校验由 JS 再做一次。 */
    private fun validateStagedPackage(stage: File, totalBytes: Long): String {
        val manifestFile = File(stage, "portable.json")
        if (!manifestFile.isFile) throw IOException("缺少 portable.json")
        if (manifestFile.length() > MAX_MANIFEST_BYTES) throw IOException("portable.json 过大")
        val text = manifestFile.readText(Charsets.UTF_8)
        val obj = JSONObject(text)
        if (obj.optString("format") != PORTABLE_FORMAT) throw IOException("不是 LakexLocalNotes 便携包")
        if (obj.optInt("formatVersion", 0) != PORTABLE_FORMAT_VERSION) throw IOException("便携包格式版本不支持")
        if (obj.optBoolean("hasHistory", true)) throw IOException("便携包不应包含历史快照")
        if (obj.optLong("limitBytes", 0L) != PORTABLE_LIMIT_BYTES) throw IOException("便携包上限声明不匹配")
        val source = obj.optJSONObject("source")
        if (source == null || source.optString("platform") != "desktop") throw IOException("便携包来源非法")
        // baseline 允许为 null（纯离线包）：此时包内只有内容哈希，不写同步账本。
        val baseline = obj.optJSONObject("baseline")
        if (baseline != null && (baseline.optString("epoch").isEmpty() || baseline.optString("lakeCommit").isEmpty() ||
                baseline.optString("quickNotesCommit").isEmpty())
        ) throw IOException("便携包基线不完整")
        if (!File(stage, "desktop/metadata.sqlite3").isFile) throw IOException("缺少 desktop/metadata.sqlite3")
        if (!File(stage, "desktop/quick-notes/metadata.sqlite3").isFile) throw IOException("缺少 desktop/quick-notes/metadata.sqlite3")
        if (!File(stage, "desktop/sync-v3/baseline.json").isFile) throw IOException("缺少 desktop/sync-v3/baseline.json")
        if (totalBytes <= 0L) throw IOException("便携包为空")
        return text
    }

    /** 取消/放弃本次选择：删掉未被 beginImport 使用的 staging。 */
    @PluginMethod
    fun discardStaging(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        try {
            deleteStagingDir(stagingPath)
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("清理 staging 失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun deleteStagingDir(stagingPath: String) {
        if (stagingPath.isEmpty()) return
        val root = importRoot().canonicalPath
        val dir = File(stagingPath).canonicalFile
        if (!dir.path.startsWith(root + File.separator)) throw IOException("staging 路径越界")
        dir.deleteRecursively()
    }

    // ---- 2) 只读读桌面库（分页） ----

    @PluginMethod
    fun readRows(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        val dbKey = call.getString("db") ?: ""
        val table = call.getString("table") ?: ""
        val offset = (call.getInt("offset") ?: 0).coerceAtLeast(0)
        val limit = (call.getInt("limit") ?: 500).coerceIn(1, PAGE_SIZE_MAX)
        val allowed = READONLY_TABLES[dbKey]
        if (allowed == null) { call.reject("未知的数据库: " + dbKey); return }
        if (table !in allowed) { call.reject("不允许读取的表: " + table); return }
        call.setKeepAlive(true)
        Thread {
            var db: SQLiteDatabase? = null
            try {
                val file = stagingDbFile(stagingPath, dbKey)
                db = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
                val rows = JSONArray()
                db.rawQuery("SELECT * FROM " + table + " LIMIT " + limit + " OFFSET " + offset, null).use { cursor ->
                    while (cursor.moveToNext()) rows.put(rowToJson(cursor))
                }
                val out = JSObject()
                out.put("ok", true)
                out.put("rows", rows)
                out.put("done", rows.length() < limit)
                call.resolve(out)
            } catch (e: Exception) {
                call.reject("读取桌面数据库失败: " + (e.message ?: e.javaClass.simpleName))
            } finally {
                try { db?.close() } catch (_: Exception) { /* 已关闭 */ }
            }
        }.start()
    }

    private fun stagingDbFile(stagingPath: String, dbKey: String): File {
        val stage = File(stagingPath).canonicalFile
        val root = importRoot().canonicalPath
        if (!stage.path.startsWith(root + File.separator)) throw IOException("staging 路径越界")
        val rel = if (dbKey == "main") "desktop/metadata.sqlite3" else "desktop/quick-notes/metadata.sqlite3"
        val file = File(stage, rel)
        if (!file.isFile) throw IOException("包内数据库缺失: " + rel)
        return file
    }

    private fun rowToJson(cursor: Cursor): JSONObject {
        val obj = JSONObject()
        for (index in 0 until cursor.columnCount) {
            val name = cursor.getColumnName(index)
            when (cursor.getType(index)) {
                Cursor.FIELD_TYPE_NULL -> obj.put(name, JSONObject.NULL)
                Cursor.FIELD_TYPE_INTEGER -> obj.put(name, cursor.getLong(index))
                Cursor.FIELD_TYPE_FLOAT -> obj.put(name, cursor.getDouble(index))
                Cursor.FIELD_TYPE_BLOB -> obj.put(name, Base64.encodeToString(cursor.getBlob(index), Base64.NO_WRAP))
                else -> obj.put(name, cursor.getString(index))
            }
        }
        return obj
    }

    @PluginMethod
    fun readBaseline(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        try {
            val stage = File(stagingPath).canonicalFile
            val root = importRoot().canonicalPath
            if (!stage.path.startsWith(root + File.separator)) throw IOException("staging 路径越界")
            val file = File(stage, "desktop/sync-v3/baseline.json")
            if (!file.isFile) throw IOException("便携包缺少同步基线文件")
            if (file.length() > 64L * 1024 * 1024) throw IOException("同步基线文件过大")
            call.resolve(JSObject().put("ok", true).put("json", file.readText(Charsets.UTF_8)))
        } catch (e: Exception) {
            call.reject("读取同步基线失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    // ---- 3) 复制正文/资产/小记文件到 App 私有 Data ----

    @PluginMethod
    fun copyPayload(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        call.setKeepAlive(true)
        Thread {
            try {
                val stage = File(stagingPath).canonicalFile
                val filesRoot = context.filesDir.canonicalFile
                val root = importRoot().canonicalPath
                if (!stage.path.startsWith(root + File.separator)) throw IOException("staging 路径越界")
                var files = 0L
                var bytes = 0L
                for (relative in PAYLOAD_DIRS) {
                    val source = File(stage, "desktop/" + relative)
                    if (!source.isDirectory) continue
                    val target = File(filesRoot, relative).canonicalFile
                    if (!target.path.startsWith(filesRoot.path + File.separator)) throw IOException("目标路径越界")
                    val counted = copyDirectory(source, target)
                    files += counted.first
                    bytes += counted.second
                }
                val out = JSObject()
                out.put("ok", true)
                out.put("files", files)
                out.put("bytes", bytes)
                call.resolve(out)
            } catch (e: Exception) {
                call.reject("复制正文/资源失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun copyDirectory(source: File, target: File): Pair<Long, Long> {
        var files = 0L
        var bytes = 0L
        val children = source.listFiles() ?: return files to bytes
        target.mkdirs()
        for (child in children) {
            if (child.isDirectory) {
                val sub = copyDirectory(child, File(target, child.name))
                files += sub.first
                bytes += sub.second
            } else {
                child.copyTo(File(target, child.name), overwrite = true)
                files += 1
                bytes += child.length()
            }
        }
        return files to bytes
    }

    // ---- 4) 回滚隔离 / 提交 / 恢复 ----

    @PluginMethod
    fun beginImport(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        call.setKeepAlive(true)
        Thread {
            try {
                call.resolve(beginImportInternal(stagingPath))
            } catch (e: Exception) {
                call.reject("准备导入失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun beginImportInternal(stagingPath: String): JSObject {
        val stage = File(stagingPath).canonicalFile
        val root = importRoot().canonicalPath
        if (!stage.path.startsWith(root + File.separator)) throw IOException("staging 路径越界")
        if (pendingFile().isFile) throw IOException("上一次导入未完成（pending 未清理），请先重启 App 让系统回滚")

        val rollbackDir = File(importRoot(), "rollback-" + System.currentTimeMillis())
        val dbBackupDir = File(rollbackDir, "db").apply { mkdirs() }
        val filesBackupDir = File(rollbackDir, "files").apply { mkdirs() }

        val dbDir = context.getDatabasePath(MOBILE_DB_FILE).parentFile
            ?: throw IOException("无法定位应用数据库目录")
        val dbFiles = mainDbFiles(dbDir)
        val savedDbNames = mutableListOf<String>()
        val movedDirs = mutableListOf<String>()
        try {
            for (file in dbFiles) {
                file.copyTo(File(dbBackupDir, file.name), overwrite = true)
                savedDbNames.add(file.name)
            }
            // 备份完成后删除 live DB（WAL/SHM 一并删）：JS 随后重新开库会得到空库。
            for (file in dbFiles) {
                if (!file.delete() && file.exists()) throw IOException("无法隔离当前数据库: " + file.name)
            }

            for (relative in PAYLOAD_DIRS) {
                val live = File(context.filesDir, relative)
                if (!live.exists()) continue
                val backup = File(filesBackupDir, relative)
                backup.parentFile?.mkdirs()
                if (live.renameTo(backup)) {
                    movedDirs.add(relative)
                } else {
                    // 同分区 rename 理论上不会失败；失败则回滚已移动目录后中止。
                    for (done in movedDirs) {
                        File(filesBackupDir, done).renameTo(File(context.filesDir, done))
                    }
                    throw IOException("隔离正文目录失败: " + relative)
                }
            }
            writePending(stagingPath, rollbackDir, dbDir, savedDbNames, movedDirs)
            return JSObject()
                .put("ok", true)
                .put("rollbackDir", rollbackDir.absolutePath)
                .put("dbFiles", savedDbNames.size)
                .put("movedDirs", movedDirs.size)
        } catch (e: Exception) {
            // 半途失败：尽力恢复**已移动的**目录与 DB（不能按全部 PAYLOAD_DIRS 删，否则会误删未动过的数据）。
            try { restoreFrom(rollbackDir, dbDir, savedDbNames, movedDirs) } catch (_: Exception) { /* 保留 rollback 供下次启动 pending 恢复 */ }
            throw e
        }
    }

    /** 主库文件（含 WAL/SHM/journal）：手机端只有一份业务库，小记表同库。 */
    private fun mainDbFiles(dbDir: File): List<File> {
        val names = listOf(MOBILE_DB_FILE, MOBILE_DB_FILE + "-wal", MOBILE_DB_FILE + "-shm", MOBILE_DB_FILE + "-journal")
        return names.map { File(dbDir, it) }.filter { it.isFile }
    }

    private fun writePending(stagingPath: String, rollbackDir: File, dbDir: File, dbFiles: List<String>, movedDirs: List<String>) {
        val obj = JSONObject()
        obj.put("version", 1)
        obj.put("startedAt", System.currentTimeMillis())
        obj.put("stagingPath", stagingPath)
        obj.put("rollbackDir", rollbackDir.absolutePath)
        obj.put("dbDir", dbDir.absolutePath)
        obj.put("dbFiles", JSONArray(dbFiles))
        obj.put("movedDirs", JSONArray(movedDirs))
        val temp = File(importRoot(), PENDING_FILE + ".tmp")
        temp.writeText(obj.toString(), Charsets.UTF_8)
        if (!temp.renameTo(pendingFile())) throw IOException("写 pending 标记失败")
    }

    @PluginMethod
    fun commitImport(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            try {
                val pending = readPending()
                if (pending != null) {
                    val rollbackDir = File(pending.optString("rollbackDir"))
                    if (isInsideImportRoot(rollbackDir)) rollbackDir.deleteRecursively()
                    deleteStagingDir(pending.optString("stagingPath"))
                }
                pendingFile().delete()
                File(importRoot(), PENDING_FILE + ".tmp").delete()
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("提交导入失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    @PluginMethod
    fun rollbackImport(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            try {
                call.resolve(doRollback())
            } catch (e: Exception) {
                call.reject("回滚失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    @PluginMethod
    fun recoverPending(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            try {
                val pending = readPending()
                if (pending == null) {
                    call.resolve(JSObject().put("ok", true).put("restored", false).put("pending", false))
                    return@Thread
                }
                val out = doRollback()
                out.put("pending", true)
                call.resolve(out)
            } catch (e: Exception) {
                call.reject("恢复上次导入失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun doRollback(): JSObject {
        val pending = readPending()
        if (pending == null) {
            pendingFile().delete()
            return JSObject().put("ok", true).put("restored", false)
        }
        val rollbackDir = File(pending.optString("rollbackDir"))
        val dbDir = File(pending.optString("dbDir"))
        val dbFiles = jsonArrayToStrings(pending.optJSONArray("dbFiles"))
        val movedDirs = jsonArrayToStrings(pending.optJSONArray("movedDirs"))
        restoreFrom(rollbackDir, dbDir, dbFiles, movedDirs)
        deleteStagingDir(pending.optString("stagingPath"))
        pendingFile().delete()
        return JSObject().put("ok", true).put("restored", true).put("files", movedDirs.size)
    }

    /** 恢复现场：删 live 残留 → 把 DB 备份拷回原位 → 把正文/资产目录移回。 */
    private fun restoreFrom(rollbackDir: File, dbDir: File, dbFiles: List<String>, movedDirs: List<String>) {
        if (!isInsideImportRoot(rollbackDir)) throw IOException("rollback 目录越界")
        dbDir.mkdirs()
        for (name in listOf(MOBILE_DB_FILE, MOBILE_DB_FILE + "-wal", MOBILE_DB_FILE + "-shm", MOBILE_DB_FILE + "-journal")) {
            val live = File(dbDir, name)
            if (live.exists()) live.delete()
        }
        val dbBackupDir = File(rollbackDir, "db")
        for (name in dbFiles) {
            val backup = File(dbBackupDir, name)
            if (!backup.isFile) continue
            backup.copyTo(File(dbDir, name), overwrite = true)
        }
        val filesBackupDir = File(rollbackDir, "files")
        for (relative in movedDirs) {
            val live = File(context.filesDir, relative)
            if (live.exists()) live.deleteRecursively()
            val backup = File(filesBackupDir, relative)
            if (!backup.exists()) continue
            live.parentFile?.mkdirs()
            if (!backup.renameTo(live)) {
                copyDirectory(backup, live)
                backup.deleteRecursively()
            }
        }
        rollbackDir.deleteRecursively()
    }

    @PluginMethod
    fun pendingInfo(call: PluginCall) {
        try {
            val pending = readPending()
            val out = JSObject()
            out.put("pending", pending != null)
            if (pending != null) {
                out.put("startedAt", pending.optLong("startedAt", 0L))
                out.put("stagingPath", pending.optString("stagingPath"))
            }
            call.resolve(out)
        } catch (e: Exception) {
            call.reject("读取导入标记失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun readPending(): JSONObject? {
        val file = pendingFile()
        if (!file.isFile) return null
        return try {
            JSONObject(file.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    private fun jsonArrayToStrings(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        val out = mutableListOf<String>()
        for (index in 0 until array.length()) {
            val value = array.optString(index, "")
            if (value.isNotEmpty()) out.add(value)
        }
        return out
    }

}
