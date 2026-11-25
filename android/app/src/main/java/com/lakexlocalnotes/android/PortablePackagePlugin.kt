package com.lakexlocalnotes.android

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.provider.OpenableColumns
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
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
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
 *
 * 本体按三个分区组织（各分区首行有 ---- 标记）：staging（选包/解压/清单校验）→
 * import（只读读桌面库 + 复制正文/资产 + 回滚隔离/提交/恢复）→ snapshot（手机整机快照导出/检视/恢复，
 * 复用 import 的回滚/pending 机制）；纯规则（条目名/上限/后缀闸）在 PortablePackageRules.kt。
 *    写 pending.json；提交删除隔离；失败/下次启动发现 pending 自动回滚。
 */
@CapacitorPlugin(name = "PortableImport")
class PortablePackagePlugin : Plugin() {

    companion object {
        private const val PORTABLE_FORMAT = "lakex-local-notes-portable"
        /** v2（261122 大统一）：一份清单两种布局（desktop-workspace / mobile-snapshot）互导；不写 v1 兼容。 */
        private const val PORTABLE_FORMAT_VERSION = 2
        // 后缀闸 / 上限 / 条目名裁决 = PortablePackageRules（M-16② 纯规则 + JVM 单测；本体只做 IO/Activity）。
        private const val PAGE_SIZE_MAX = 1000

        private const val IMPORT_ROOT = "portable-import"
        private const val PENDING_FILE = "pending.json"
        private const val MOBILE_DB_FILE = "lakex-local-notes-mobileSQLite.db"

        /** 需要随导入一起改写的正文/资产/草稿/素材目录（手机端 = filesDir 下同名相对路径；v2 全量口径）。 */
        private val PAYLOAD_DIRS = listOf(
            "notes", "usheets", "bitables", "boards", "inks",
            "note-assets", "quick-notes/items", "quick-notes/assets", "quick-notes/staging",
            "draft-journal", "materials",
        )

        /** 261117 D 项：移动端导出快照（卸载/换机前的 100% 可靠备份）的包标识。 */
        private const val SNAPSHOT_LAYOUT = "mobile-snapshot"
        private const val SNAPSHOT_PREFIX = "lakex-portable-mobile-"
        private const val EXPORT_ROOT = "portable-export"
        /** 快照要备份的目录：payload（正文/资产/草稿/素材）**加上** sync-v3 基线。
         *  261122 裁决：历史快照是仅本机数据，**不进导入导出**（导出端还会清 note_history 索引行）。 */
        private val SNAPSHOT_DIRS = PAYLOAD_DIRS + listOf("sync-v3")
        /** 快照恢复时也要隔离/回滚的额外目录（导入路径不碰它们）。 */
        private val SNAPSHOT_EXTRA_DIRS = listOf("history", "draft-journal", "sync-v3")

        /** 只允许读取的桌面表（避免把任意 SQL 带进插件）。 */
        private val READONLY_TABLES = mapOf(
            "main" to setOf("notes", "tree_nodes"),
            "quick" to setOf("quick_notes", "quick_note_deleted", "tags", "tag_links", "tag_link_versions"),
        )
    }

    private val pickInFlight = AtomicBoolean(false)

    private fun importRoot(): File = File(context.filesDir, IMPORT_ROOT).apply { mkdirs() }

    private fun pendingFile(): File = File(importRoot(), PENDING_FILE)

    /**
     * 目录围栏（M-16① 收口：本文件 5 处 canonicalPath + startsWith(root+separator) 路径包含检查同源）：
     * canonical 后必须**严格落在 root 之下**，防 "../" 越界；异常一律判 false（不放行）。
     * pending/rollback/staging 里读到的路径必须先过这一关，才允许读取或递归删除。
     */
    private fun isInside(root: File, file: File): Boolean {
        return try {
            file.canonicalFile.path.startsWith(root.canonicalPath + File.separator)
        } catch (e: Exception) {
            false
        }
    }

    // ---- staging 1) 选包 + 解压 + 清单校验 ----

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
        // 用户 261110 定稿：不为历史数据做兼容 ⇒ 只接受 .zip.lln，旧 .zip 直接拒绝。
        val displayName = try {
            getContext().contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (_: Exception) { null }
        if (displayName == null || !PortablePackageRules.hasPortableExtension(displayName)) {
            call.reject("只支持最新的 .zip.lln 便携包（不再兼容旧 .zip）")
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

    /**
     * 261123（设备级自动化解锁，对齐 inspectSnapshot({path}) 先例）：按**文件路径**直接 staging，
     * 绕过系统文件选择器。生产 UI 仍走 pickAndStage（选包路径不可由页面伪造）；本入口仅供设备级
     * 自动化/脚本把已就位的 .zip.lln 送进与 UI 完全相同的 extractArchive → validateStagedPackage 链路。
     */
    @PluginMethod
    fun stageFromPath(call: PluginCall) {
        if (!pickInFlight.compareAndSet(false, true)) {
            call.reject("已有便携包解析在进行，请稍后")
            return
        }
        try {
            val rawPath = call.getString("path") ?: throw IOException("缺少 path 参数")
            val file = File(rawPath)
            if (!file.isFile) throw IOException("便携包文件不存在: " + rawPath)
            if (!PortablePackageRules.hasPortableExtension(file.name)) {
                throw IOException("只支持最新的 .zip.lln 便携包（不再兼容旧 .zip）")
            }
            val uri = Uri.fromFile(file)
            call.setKeepAlive(true)
            Thread {
                try {
                    call.resolve(extractArchive(uri))
                } catch (e: Exception) {
                    call.reject("便携包无效: " + (e.message ?: e.javaClass.simpleName))
                } finally {
                    pickInFlight.set(false)
                }
            }.start()
        } catch (e: Exception) {
            pickInFlight.set(false)
            call.reject(e.message ?: e.javaClass.simpleName)
        }
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
                        if (entryCount > PortablePackageRules.MAX_ENTRIES) throw IOException("zip 条目过多（上限 " + PortablePackageRules.MAX_ENTRIES + "）")
                        val rawName = entry.name ?: throw IOException("zip 条目缺少名称")
                        // 条目名裁决 = PortablePackageRules（zip-slip 语义，JVM 单测 PortablePackageRulesTest）。
                        if (PortablePackageRules.hasIllegalEntryPath(rawName)) throw IOException("zip 条目含非法路径")
                        val name = PortablePackageRules.normalizeEntryName(rawName)
                        if (name.isEmpty()) continue
                        if (PortablePackageRules.hasForbiddenSegment(name)) throw IOException("zip 条目含上级目录")
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
                                if (totalBytes > PortablePackageRules.PORTABLE_LIMIT_BYTES) throw IOException("便携包超过 4GiB 上限")
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
        if (manifestFile.length() > PortablePackageRules.MAX_MANIFEST_BYTES) throw IOException("portable.json 过大")
        val text = manifestFile.readText(Charsets.UTF_8)
        val obj = JSONObject(text)
        if (obj.optString("format") != PORTABLE_FORMAT) throw IOException("不是 LakexLocalNotes 便携包")
        if (obj.optInt("formatVersion", 0) != PORTABLE_FORMAT_VERSION) throw IOException("便携包格式版本不支持")
        if (obj.optLong("limitBytes", 0L) != PortablePackageRules.PORTABLE_LIMIT_BYTES) throw IOException("便携包上限声明不匹配")
        val source = obj.optJSONObject("source") ?: throw IOException("便携包来源缺失")
        when (source.optString("platform")) {
            "desktop" -> {
                // v2（261122）：清单恒无 hasHistory 字段（历史不进包）；布局必须与来源配对。
                if (obj.optString("layout") != "desktop-workspace") throw IOException("便携包布局与来源不匹配")
                // baseline 允许为 null（纯离线包）：此时包内只有内容哈希，不写同步账本。
                val baseline = obj.optJSONObject("baseline")
                if (baseline != null && (baseline.optString("epoch").isEmpty() || baseline.optString("lakeCommit").isEmpty() ||
                        baseline.optString("quickNotesCommit").isEmpty())
                ) throw IOException("便携包基线不完整")
                if (!File(stage, "desktop/metadata.sqlite3").isFile) throw IOException("缺少 desktop/metadata.sqlite3")
                if (!File(stage, "desktop/quick-notes/metadata.sqlite3").isFile) throw IOException("缺少 desktop/quick-notes/metadata.sqlite3")
                if (!File(stage, "desktop/sync-v3/baseline.json").isFile) throw IOException("缺少 desktop/sync-v3/baseline.json")
            }
            // 261117 D 项：手机整机快照（导出便携包到文件）也可以被「从便携包导入」选中并恢复。
            "mobile" -> {
                if (obj.optString("layout") != SNAPSHOT_LAYOUT) throw IOException("快照布局不支持")
                if (!File(stage, "mobile/databases/" + MOBILE_DB_FILE).isFile) throw IOException("快照缺少数据库")
                if (!File(stage, "mobile/files").isDirectory) throw IOException("快照缺少数据目录")
            }
            else -> throw IOException("便携包来源非法")
        }
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
        val dir = File(stagingPath).canonicalFile
        if (!isInside(importRoot(), dir)) throw IOException("staging 路径越界")
        dir.deleteRecursively()
    }

    // ---- import 2) 只读读桌面库（分页） ----

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
                // 261124 行丢失复盘加固：分页**必须 ORDER BY rowid**——无 ORDER BY 的 LIMIT/OFFSET 页序未定义，
            // 页间计划器变化会跳/重行（真机曾间歇丢行）；staged 库是静态文件也按同一口径。
            db.rawQuery("SELECT * FROM " + table + " ORDER BY rowid LIMIT " + limit + " OFFSET " + offset, null).use { cursor ->
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
        if (!isInside(importRoot(), stage)) throw IOException("staging 路径越界")
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
            if (!isInside(importRoot(), stage)) throw IOException("staging 路径越界")
            val file = File(stage, "desktop/sync-v3/baseline.json")
            if (!file.isFile) throw IOException("便携包缺少同步基线文件")
            if (file.length() > 64L * 1024 * 1024) throw IOException("同步基线文件过大")
            call.resolve(JSObject().put("ok", true).put("json", file.readText(Charsets.UTF_8)))
        } catch (e: Exception) {
            call.reject("读取同步基线失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    // ---- import 3) 复制正文/资产/小记文件到 App 私有 Data ----

    @PluginMethod
    fun copyPayload(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        call.setKeepAlive(true)
        Thread {
            try {
                val stage = File(stagingPath).canonicalFile
                val filesRoot = context.filesDir.canonicalFile
                if (!isInside(importRoot(), stage)) throw IOException("staging 路径越界")
                var files = 0L
                var bytes = 0L
                for (relative in PAYLOAD_DIRS) {
                    val source = File(stage, "desktop/" + relative)
                    if (!source.isDirectory) continue
                    val target = File(filesRoot, relative).canonicalFile
                    if (!isInside(filesRoot, target)) throw IOException("目标路径越界")
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

    // ---- import 4) 回滚隔离 / 提交 / 恢复 ----

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

    private fun beginImportInternal(stagingPath: String, extraDirs: List<String> = emptyList()): JSObject {
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

            for (relative in PAYLOAD_DIRS + extraDirs) {
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
        // M-03：原子写收口 [AtomicFiles]（tmp 命名 / fsync / rename 重试同源；旧 "pending.json.tmp" 残留由 isTemp 兼容）。
        AtomicFiles.writeAtomic(pendingFile(), obj.toString().toByteArray(Charsets.UTF_8))
    }

    @PluginMethod
    fun commitImport(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            try {
                commitPendingInternal()
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("提交导入失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    /** 提交当前 pending：删回滚目录 + staging + pending 标记（导入与快照恢复共用）。 */
    private fun commitPendingInternal() {
        val pending = readPending()
        if (pending != null) {
            val rollbackDir = File(pending.optString("rollbackDir"))
            if (isInside(importRoot(), rollbackDir)) rollbackDir.deleteRecursively()
            deleteStagingDir(pending.optString("stagingPath"))
        }
        pendingFile().delete()
        // M-03：清原子写临时残留（含历史 "pending.json.tmp" 与 ".tmp-*" 命名，isTemp 双判前/后缀）。
        for (f in importRoot().listFiles() ?: emptyArray()) if (f.isFile && AtomicFiles.isTemp(f.name)) f.delete()
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
        if (!isInside(importRoot(), rollbackDir)) throw IOException("rollback 目录越界")
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

    // ---- snapshot 5) 261117 D 项：移动端导出便携快照（卸载/换机前的 100% 可靠备份） ----

    /**
     * 把**当前移动端全量数据**打成 store 快照 zip（写到 App 私有 files/portable-export/，再由 JS 调
     * OpenFile.saveAs 落到用户可见目录）：
     *   portable.json                              ← 清单（source.platform = mobile，layout = mobile-snapshot）
     *   mobile/databases/<主库及 wal/shm/journal>   ← 关库后复制，保证一致
     *   mobile/files 下的 notes / usheets / … / history / draft-journal  ← 全量正文/资产/历史/草稿
     * 调用方（JS）必须**先关闭数据库连接**（桥的 closeDbForPortableImport），导出完成后重开。
     */
    @PluginMethod
    fun exportSnapshot(call: PluginCall) {
        call.setKeepAlive(true)
        // JS 侧解析 MobileV3Baseline 后把四个 ref 字段传进来（解析口径单一来源在 TS；纯离线传 null）。
        val baselineRef = call.getObject("baseline")
        Thread {
            try {
                call.resolve(exportSnapshotInternal(baselineRef))
            } catch (e: Exception) {
                call.reject("导出便携包失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun exportSnapshotInternal(baselineRef: JSONObject?): JSObject {
        val exportRoot = File(context.filesDir, EXPORT_ROOT).apply { mkdirs() }
        // 清掉上一次导出遗留（同目录只留最新的包，避免占空间）
        exportRoot.listFiles()?.forEach { it.deleteRecursively() }
        val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date())
        val fileName = SNAPSHOT_PREFIX + stamp + PortablePackageRules.PORTABLE_EXTENSION
        val outFile = File(exportRoot, fileName)
        val dbDir = context.getDatabasePath(MOBILE_DB_FILE).parentFile
            ?: throw IOException("无法定位应用数据库目录")
        val dbFiles = mainDbFiles(dbDir)
        if (dbFiles.isEmpty()) throw IOException("本机还没有数据库文件，先打开一次 App 再导出")

        var entries = 0
        var bytes = 0L
        val counts = readSnapshotCounts(dbDir)
        val manifest = JSONObject()
            .put("format", PORTABLE_FORMAT)
            .put("formatVersion", PORTABLE_FORMAT_VERSION)
            .put("layout", SNAPSHOT_LAYOUT)
            .put("appVersion", appVersionName())
            .put("exportedAt", isoNow())
            .put("source", JSONObject().put("platform", "mobile"))
            .put("baseline", baselineRef ?: JSONObject.NULL)
            .put("limitBytes", PortablePackageRules.PORTABLE_LIMIT_BYTES)
            .put("counts", counts)
            .put("note", "明文全量备份（不含历史快照；含草稿/素材/同步基线），请妥善保管")
        try {
            java.util.zip.ZipOutputStream(java.io.BufferedOutputStream(FileOutputStream(outFile))).use { zos ->
                // 清单先写（用户/工具先看到）
                writeZipText(zos, "portable.json", manifest.toString())
                entries += 1
                // 数据库（关库后复制；wal/shm 一并带上）。历史索引行在打包前清掉（261122 裁决：
                // 历史快照不进导入导出 ⇒ 快照库连 note_history 行一起清，包内自洽无悬空条目）。
                // 只动 staging 副本（本插件仍不写手机业务库）；开副本会顺带合并/清掉其 wal。
                val scrubDir = File(exportRoot, "scrub").apply { mkdirs() }
                for (file in dbFiles) file.copyTo(File(scrubDir, file.name), overwrite = true)
                SQLiteDatabase.openDatabase(
                    File(scrubDir, MOBILE_DB_FILE).absolutePath, null, SQLiteDatabase.OPEN_READWRITE
                ).use { scrubDb ->
                    // 仅本机数据不随包（261122 裁决）：历史索引、AI 会话、同步记录账本、GC 审计、孤儿资产派生表。
                    for (table in listOf(
                        "note_history", "ai_conversations", "sync_conflicts", "s3_gc_pending", "s3_gc_log", "orphan_assets",
                    )) {
                        val exists = scrubDb.rawQuery(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", arrayOf(table)
                        ).use { c -> c.moveToFirst() }
                        if (exists) scrubDb.execSQL("DELETE FROM $table")
                    }
                }
                for (file in mainDbFiles(scrubDir)) {
                    bytes += writeZipFile(zos, "mobile/databases/" + file.name, file)
                    entries += 1
                    if (bytes > PortablePackageRules.PORTABLE_LIMIT_BYTES) throw IOException("数据超过 4GiB，暂不支持分卷")
                }
                // 正文/资产/历史/草稿目录
                val filesRoot = context.filesDir
                for (relative in SNAPSHOT_DIRS) {
                    val dir = File(filesRoot, relative)
                    if (!dir.isDirectory) continue
                    val added = writeZipDir(zos, "mobile/files/" + relative, dir)
                    entries += added.first
                    bytes += added.second
                    if (bytes > PortablePackageRules.PORTABLE_LIMIT_BYTES) throw IOException("数据超过 4GiB，暂不支持分卷")
                }
            }
        } catch (e: Exception) {
            outFile.delete()
            throw e
        } finally {
            // scrub staging 无条件清理（成功/失败都不留残余）。
            File(exportRoot, "scrub").deleteRecursively()
        }
        return JSObject()
            .put("ok", true)
            .put("path", outFile.absolutePath)
            .put("name", fileName)
            .put("bytes", bytes)
            .put("entries", entries)
            .put("counts", counts)
    }

    /**
     * 导出自检（解析即校验）：解开刚导出的快照，校验 portable.json、只读打开包内 SQLite 数行数，
     * 并抽查「notes 表里的每条文档都有正文条目」。返回的 counts 用于 UI 显示「可恢复 N 篇」。
     */
    @PluginMethod
    fun inspectSnapshot(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            try {
                val path = call.getString("path") ?: throw IOException("path required")
                val file = File(path)
                if (!isUnderAppSandbox(file)) throw IOException("path outside app sandbox")
                if (!file.isFile) throw IOException("快照文件不存在")
                call.resolve(inspectSnapshotInternal(file))
            } catch (e: Exception) {
                call.reject("便携包自检失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun inspectSnapshotInternal(file: File): JSObject {
        val tempDir = File(importRoot(), "inspect-" + System.currentTimeMillis()).apply { mkdirs() }
        try {
            var entries = 0
            var totalBytes = 0L
            val names = mutableSetOf<String>()
            java.util.zip.ZipFile(file).use { zip ->
                val manifestEntry = zip.getEntry("portable.json") ?: throw IOException("不是便携包（缺 portable.json）")
                val manifestText = zip.getInputStream(manifestEntry).use { it.readBytes().toString(Charsets.UTF_8) }
                if (manifestText.length > PortablePackageRules.MAX_MANIFEST_BYTES) throw IOException("portable.json 过大")
                val manifest = JSONObject(manifestText)
                if (manifest.optString("format") != PORTABLE_FORMAT) throw IOException("不是 LakexLocalNotes 便携包")
                if (manifest.optInt("formatVersion", 0) != PORTABLE_FORMAT_VERSION) throw IOException("便携包格式版本不支持")
                val source = manifest.optJSONObject("source") ?: throw IOException("便携包来源缺失")
                if (source.optString("platform") != "mobile") throw IOException("这不是手机导出的快照包（source.platform≠mobile）")
                if (manifest.optString("layout") != SNAPSHOT_LAYOUT) throw IOException("快照布局不支持")

                val enumeration = zip.entries()
                while (enumeration.hasMoreElements()) {
                    val entry = enumeration.nextElement()
                    entries += 1
                    if (entries > PortablePackageRules.MAX_ENTRIES) throw IOException("zip 条目过多（上限 " + PortablePackageRules.MAX_ENTRIES + "）")
                    val name = entry.name ?: continue
                    if (name.contains("\\") || name.startsWith("/") || name.split('/').any { it == ".." || it == "." }) {
                        throw IOException("zip 条目含非法路径")
                    }
                    names.add(name)
                    totalBytes += entry.size.coerceAtLeast(0)
                    if (totalBytes > PortablePackageRules.PORTABLE_LIMIT_BYTES) throw IOException("快照超过 4GiB 上限")
                }
                val dbEntryName = "mobile/databases/" + MOBILE_DB_FILE
                val dbEntry = zip.getEntry(dbEntryName) ?: throw IOException("快照缺少数据库")
                val dbCopy = File(tempDir, MOBILE_DB_FILE)
                zip.getInputStream(dbEntry).use { input -> FileOutputStream(dbCopy).use { output -> copy(input, output) } }
                val db = SQLiteDatabase.openDatabase(dbCopy.path, null, SQLiteDatabase.OPEN_READONLY)
                val counts = try {
                    JSONObject()
                        .put("notes", countOf(db, "notes"))
                        .put("folders", countOf(db, "folders"))
                        .put("quickNotes", countOf(db, "quick_notes"))
                        .put("tags", countOf(db, "tags"))
                } finally {
                    db.close()
                }
                // 抽查正文：notes 表里每条有 kind 的文档都应有对应的 mobile/files/... 条目。
                var missingBodies = 0
                val checked = SQLiteDatabase.openDatabase(dbCopy.path, null, SQLiteDatabase.OPEN_READONLY)
                try {
                    checked.rawQuery("SELECT id, doc_kind FROM notes LIMIT 500", null).use { cursor ->
                        while (cursor.moveToNext()) {
                            val id = cursor.getString(0)
                            val kind = cursor.getString(1) ?: "doc"
                            val dir = when (kind) {
                                "usheet" -> "usheets"; "bitable" -> "bitables"; "board" -> "boards"; "ink" -> "inks"; else -> "notes"
                            }
                            val anyBody = names.any { it.startsWith("mobile/files/" + dir + "/" + id + ".") }
                            if (!anyBody) missingBodies += 1
                        }
                    }
                } finally {
                    checked.close()
                }
                return JSObject()
                    .put("ok", true)
                    .put("entries", entries)
                    .put("bytes", totalBytes)
                    .put("counts", counts)
                    .put("missingBodies", missingBodies)
                    .put("manifestJson", manifestText)
            }
        } finally {
            tempDir.deleteRecursively()
        }
    }

    private fun copy(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
        }
        output.flush()
    }

    private fun isUnderAppSandbox(file: File): Boolean {
        return try {
            val canonical = file.canonicalPath
            val roots = arrayOf(context.filesDir, context.getExternalFilesDir(null))
            roots.any { root -> root != null && (canonical == root.canonicalPath || canonical.startsWith(root.canonicalPath + File.separator)) }
        } catch (e: Exception) {
            false
        }
    }

    private fun appVersionName(): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }

    private fun isoNow(): String {
        val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
        format.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return format.format(java.util.Date())
    }

    private fun countOf(db: SQLiteDatabase, table: String): Long {
        return try {
            db.rawQuery("SELECT COUNT(*) FROM " + table, null).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
        } catch (e: Exception) {
            0L
        }
    }

    private fun readSnapshotCounts(dbDir: File): JSONObject {
        val out = JSONObject()
        try {
            val dbFile = File(dbDir, MOBILE_DB_FILE)
            if (!dbFile.isFile) return out
            val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)
            try {
                out.put("notes", countOf(db, "notes"))
                out.put("folders", countOf(db, "folders"))
                out.put("quickNotes", countOf(db, "quick_notes"))
                out.put("tags", countOf(db, "tags"))
            } finally {
                db.close()
            }
        } catch (e: Exception) {
            // 计数失败不影响导出（缺键按 0 显示）；不阻断。
        }
        // v2 清单 counts 六键齐全（core portableFormat 严格校验）：assets/bytes 按打包白名单同口径统计。
        var assetFiles = 0
        var totalBytes = 0L
        for (relative in SNAPSHOT_DIRS) {
            val dir = File(context.filesDir, relative)
            if (!dir.isDirectory) continue
            dir.walkTopDown().filter { it.isFile }.forEach { file ->
                totalBytes += file.length()
                if (relative == "note-assets" || relative == "quick-notes/assets") assetFiles += 1
            }
        }
        for (file in mainDbFiles(dbDir)) totalBytes += file.length()
        out.put("assets", assetFiles)
        out.put("bytes", totalBytes)
        return out
    }

    private fun writeZipText(zos: java.util.zip.ZipOutputStream, name: String, text: String) {
        val data = text.toByteArray(Charsets.UTF_8)
        zos.putNextEntry(java.util.zip.ZipEntry(name))
        zos.write(data)
        zos.closeEntry()
    }

    private fun writeZipFile(zos: java.util.zip.ZipOutputStream, name: String, file: File): Long {
        zos.putNextEntry(java.util.zip.ZipEntry(name))
        var bytes = 0L
        FileInputStreamSafeCopy(file, zos)
        zos.closeEntry()
        return file.length()
    }

    private fun FileInputStreamSafeCopy(file: File, out: java.io.OutputStream) {
        java.io.FileInputStream(file).use { input -> copy(input, out) }
    }

    private fun writeZipDir(zos: java.util.zip.ZipOutputStream, prefix: String, dir: File): Pair<Int, Long> {
        var entries = 0
        var bytes = 0L
        val children = dir.listFiles() ?: return entries to bytes
        for (child in children) {
            if (child.isDirectory) {
                val sub = writeZipDir(zos, prefix + "/" + child.name, child)
                entries += sub.first
                bytes += sub.second
            } else {
                bytes += writeZipFile(zos, prefix + "/" + child.name, child)
                entries += 1
            }
        }
        return entries to bytes
    }

    // ---- snapshot 6) 261117 D 项：从手机整机快照恢复（覆盖本机，复用导入的回滚/pending 机制） ----

    /**
     * 把「导出便携包到文件」生成的手机整机快照恢复到本机：
     *   校验 staging（mobile-snapshot 清单/库/目录）→ 读计数 → beginImport（隔离当前 DB + 全部快照目录，写 pending）
     *   → 拷回快照 DB 与 mobile/files 下各目录 → 提交（删回滚/pending）。任何一步失败 ⇒ doRollback 恢复导入前数据。
     * 调用方（JS）必须**先关闭数据库连接**，成功后重开。
     */
    @PluginMethod
    fun restoreSnapshot(call: PluginCall) {
        val stagingPath = call.getString("stagingPath") ?: ""
        call.setKeepAlive(true)
        Thread {
            try {
                val stage = File(stagingPath).canonicalFile
                val root = importRoot().canonicalPath
                if (!stage.path.startsWith(root + File.separator)) throw IOException("staging 路径越界")
                validateSnapshotStaging(stage)
                val counts = snapshotStagingCounts(stage)
                val hasBaseline = File(stage, "mobile/files/sync-v3/baseline.json.gz.b64").isFile
                beginImportInternal(stagingPath, SNAPSHOT_EXTRA_DIRS)
                try {
                    val dbDir = context.getDatabasePath(MOBILE_DB_FILE).parentFile
                        ?: throw IOException("无法定位应用数据库目录")
                    var files = 0L
                    var bytes = 0L
                    val stagedDbDir = File(stage, "mobile/databases")
                    stagedDbDir.listFiles()?.forEach { file ->
                        if (file.isFile) {
                            file.copyTo(File(dbDir, file.name), overwrite = true)
                            files += 1
                            bytes += file.length()
                        }
                    }
                    val filesRoot = context.filesDir.canonicalFile
                    for (relative in SNAPSHOT_DIRS) {
                        val staged = File(stage, "mobile/files/" + relative)
                        if (!staged.isDirectory) continue
                        val live = File(filesRoot, relative).canonicalFile
                        if (!live.path.startsWith(filesRoot.path + File.separator)) throw IOException("目标路径越界")
                        if (live.exists()) live.deleteRecursively()
                        val copied = copyDirectory(staged, live)
                        files += copied.first
                        bytes += copied.second
                    }
                    commitPendingInternal()
                    call.resolve(
                        JSObject()
                            .put("ok", true)
                            .put("counts", counts)
                            .put("hasBaseline", hasBaseline)
                            .put("files", files)
                            .put("bytes", bytes)
                    )
                } catch (e: Exception) {
                    try { doRollback() } catch (ignored: Exception) { /* 保留 pending 供下次启动恢复 */ }
                    throw e
                }
            } catch (e: Exception) {
                call.reject("恢复手机快照失败: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun validateSnapshotStaging(stage: File) {
        val manifestFile = File(stage, "portable.json")
        if (!manifestFile.isFile) throw IOException("缺少 portable.json")
        if (manifestFile.length() > PortablePackageRules.MAX_MANIFEST_BYTES) throw IOException("portable.json 过大")
        val obj = JSONObject(manifestFile.readText(Charsets.UTF_8))
        if (obj.optString("format") != PORTABLE_FORMAT) throw IOException("不是 LakexLocalNotes 便携包")
        if (obj.optInt("formatVersion", 0) != PORTABLE_FORMAT_VERSION) throw IOException("便携包格式版本不支持")
        val source = obj.optJSONObject("source") ?: throw IOException("便携包来源缺失")
        if (source.optString("platform") != "mobile") throw IOException("这不是手机快照包")
        if (obj.optString("layout") != SNAPSHOT_LAYOUT) throw IOException("快照布局不支持")
        if (!File(stage, "mobile/databases/" + MOBILE_DB_FILE).isFile) throw IOException("快照缺少数据库")
        if (!File(stage, "mobile/files").isDirectory) throw IOException("快照缺少数据目录")
    }

    private fun snapshotStagingCounts(stage: File): JSONObject {
        val dbCopy = File(stage, "mobile/databases/" + MOBILE_DB_FILE)
        val db = SQLiteDatabase.openDatabase(dbCopy.path, null, SQLiteDatabase.OPEN_READONLY)
        return try {
            JSONObject()
                .put("notes", countOf(db, "notes"))
                .put("folders", countOf(db, "folders"))
                .put("quickNotes", countOf(db, "quick_notes"))
                .put("tags", countOf(db, "tags"))
        } finally {
            db.close()
        }
    }

}