package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

/**
 * M-03（审计 03-mobile）原子写收口的 JVM 单测：中断不留半文件 / rename 失败重试 / 过滤器兼容三种历史命名。
 * （纯 java.io，不需要 Android 运行时；与 RemoteAssetRulesTest 同为「纯规则对象 + JVM 单测」路线。）
 */
class AtomicFilesTest {

    private fun tempDir(): File = Files.createTempDirectory("atomic-files-test").toFile()

    private fun tempLeftovers(dir: File): List<File> =
        (dir.listFiles() ?: emptyArray()).filter { AtomicFiles.isTemp(it.name) }

    /** 钉 1：写中断（writeBody 抛错）不留半文件 —— 目标保持旧内容或不存在，临时文件清光。 */
    @Test
    fun interruptedWriteLeavesNoPartialFile() {
        val dir = tempDir()
        val target = File(dir, "note.lake")
        target.writeText("old")
        try {
            AtomicFiles.streamAtomic(target) { out ->
                out.write("half".toByteArray(Charsets.UTF_8))
                throw IllegalStateException("模拟中断")
            }
            fail("中断应抛出")
        } catch (e: IllegalStateException) {
            assertEquals("模拟中断", e.message)
        }
        assertEquals("old", target.readText(Charsets.UTF_8))
        assertTrue("中断后不得残留临时文件: " + tempLeftovers(dir).map { it.name }, tempLeftovers(dir).isEmpty())

        // 目标原本不存在：中断后也必须不存在（不落半文件）
        val fresh = File(dir, "fresh.lake")
        try {
            AtomicFiles.streamAtomic(fresh) { out ->
                out.write("half".toByteArray(Charsets.UTF_8))
                throw IllegalStateException("模拟中断")
            }
            fail("中断应抛出")
        } catch (e: IllegalStateException) {
            assertEquals("模拟中断", e.message)
        }
        assertFalse(fresh.exists())
        assertTrue(tempLeftovers(dir).isEmpty())
    }

    /** 钉 2：rename 失败（目标被占位）先删目标再重试收尾；删不掉则抛错且同样不留临时文件。 */
    @Test
    fun renameFailureRetriesThenCommits() {
        val dir = tempDir()
        // 空目录占位：第一次 renameTo 必失败 ⇒ 走「删目标 + 重试」分支
        val target = File(dir, "pending.json")
        assertTrue(target.mkdir())
        AtomicFiles.writeAtomic(target, "new".toByteArray(Charsets.UTF_8))
        assertTrue(target.isFile)
        assertEquals("new", target.readText(Charsets.UTF_8))
        assertTrue(tempLeftovers(dir).isEmpty())

        // 非空目录占位：删目标失败 ⇒ 明确抛错，临时文件照旧清理
        val blocked = File(dir, "blocked.json")
        assertTrue(blocked.mkdir())
        assertTrue(File(blocked, "child").createNewFile())
        try {
            AtomicFiles.writeAtomic(blocked, "new".toByteArray(Charsets.UTF_8))
            fail("旧目标删不掉应抛出")
        } catch (e: IOException) {
            assertEquals("原子写旧目标删除失败", e.message)
        }
        assertTrue("失败后不得残留临时文件: " + tempLeftovers(dir).map { it.name }, tempLeftovers(dir).isEmpty())
    }

    /** 钉 3：isTemp 兼容三种历史命名 + 新统一命名；正常文件名不误判。 */
    @Test
    fun isTempRecognizesHistoricalTempNames() {
        // ① 前缀式：新统一命名 / 旧 getFile / 旧远端下载
        assertTrue(AtomicFiles.isTemp(".tmp-3f2a9c8e-note.lake"))
        assertTrue(AtomicFiles.isTemp(".tmp-note.lake"))
        assertTrue(AtomicFiles.isTemp(".tmp-download-3f2a9c8e"))
        // ② 后缀式：旧 BodyStorePlugin / AssetSyncPlugin 原子写
        assertTrue(AtomicFiles.isTemp("note.lake.tmp-3f2a9c8e"))
        // ③ 旧 PortablePackagePlugin pending 标记
        assertTrue(AtomicFiles.isTemp("pending.json.tmp"))
        // 正常文件不误判
        assertFalse(AtomicFiles.isTemp("note.lake"))
        assertFalse(AtomicFiles.isTemp("1700000000000_ab12.png"))

        // 统一命名本身必须被自己认出
        val name = AtomicFiles.tempName(File("/data/note-assets/n1/note.lake"))
        assertTrue(name.startsWith(".tmp-"))
        assertTrue(name.endsWith("-note.lake"))
        assertTrue(AtomicFiles.isTemp(name))
    }
}
