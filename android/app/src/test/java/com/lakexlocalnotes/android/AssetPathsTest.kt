package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.Paths

/**
 * AssetPaths 对抗单测（261112 R1，Q21A）。
 *
 * 覆盖任务要求的 6 类：`..` / URL 编码 / symlink / 前缀绕过 / 超长 / 空段；
 * 另加 staging 与 mode 的显式契约（读面允许、写面拒绝）。
 */
class AssetPathsTest {
    private fun filesDir(): File = Files.createTempDirectory("lake-paths").toFile().also { it.mkdirs() }

    private fun rejects(filesDir: File, key: String, mode: AssetPaths.Mode = AssetPaths.Mode.READ) {
        try {
            AssetPaths.resolveAsset(filesDir, key, mode)
            throw AssertionError("should reject: " + key)
        } catch (e: IllegalArgumentException) {
            assertTrue("rejection should carry key: " + e.message, e.message?.contains(key) == true || e.message!!.isNotEmpty())
        }
    }

    @Test
    fun happyPathStaysInsideKnownRoots() {
        val dir = filesDir()
        val lake = AssetPaths.resolveAsset(dir, "note-assets/n1/pic.png", AssetPaths.Mode.WRITE)
        val quick = AssetPaths.resolveAsset(dir, "quick-notes/assets/q1/img.png", AssetPaths.Mode.READ)
        assertEquals(File(dir, "note-assets/n1/pic.png").canonicalPath, lake.path)
        assertEquals(File(dir, "quick-notes/assets/q1/img.png").canonicalPath, quick.path)
        assertTrue(lake.path.startsWith(File(dir, "note-assets").canonicalPath + File.separator))
        assertTrue(quick.path.startsWith(File(dir, "quick-notes/assets").canonicalPath + File.separator))
    }

    // ---- ① .. 穿越 ----
    @Test
    fun rejectsDotDotTraversal() {
        val dir = filesDir()
        rejects(dir, "../databases/app.db")
        rejects(dir, "note-assets/../../databases/app.db")
        rejects(dir, "note-assets/n1/../../../databases/app.db")
        rejects(dir, "quick-notes/assets/../../../tmp/x")
        rejects(dir, "quick-notes/assets/../x")
    }

    // ---- ② URL 编码 ----
    /** 字面 %2e%2e 不解码 ⇒ 只是根内一个普通目录名；解码后的 ".." 由 segment 过滤拒绝（AssetServer 只解码一次）。 */
    @Test
    fun urlEncodedTraversalIsLiteralOrRejectedAfterSingleDecode() {
        val dir = filesDir()
        val literal = AssetPaths.resolveAsset(dir, "note-assets/%2e%2e/%2e%2e/app.db", AssetPaths.Mode.READ)
        assertTrue(literal.path.startsWith(File(dir, "note-assets").canonicalPath + File.separator))
        assertFalse(literal.path == File(dir, "app.db").canonicalPath)

        // AssetServer 的解码入口是 URI.getPath()：解码一次后再交给 AssetPaths ⇒ 必须被拒绝
        val decoded = URI("/note-assets/%2e%2e/%2e%2e/databases/app.db").path.removePrefix("/")
        rejects(dir, AssetPaths.LAKE_ROOT + "/" + decoded)
        // %2f 解码成 '/' 后产生空段/穿越 ⇒ 同样拒绝
        val decodedSlash = URI("/note-assets/a%2f..%2fb").path.removePrefix("/")
        rejects(dir, AssetPaths.LAKE_ROOT + "/" + decodedSlash)
    }

    // ---- ③ symlink 逃逸 ----
    @Test
    fun rejectsSymlinkEscapeButFollowsInsideRoot() {
        val base = Files.createTempDirectory("lake-paths-symlink").toFile()
        val dir = base.resolve("files").also { it.mkdirs() }
        val assetRoot = dir.resolve("note-assets").also { it.mkdirs() }
        val outside = base.resolve("outside").also { it.mkdirs() }
        val supported = try {
            Files.createSymbolicLink(assetRoot.toPath().resolve("escape"), outside.toPath())
            Files.createSymbolicLink(assetRoot.toPath().resolve("inside"), assetRoot.toPath().resolve("real"))
            true
        } catch (e: Exception) {
            false
        }
        assumeTrue("filesystem does not support symlinks", supported)

        rejects(dir, "note-assets/escape/evil.png")
        // 根内软链（指向根内）仍然合法
        val inside = AssetPaths.resolveAsset(dir, "note-assets/inside/pic.png", AssetPaths.Mode.READ)
        assertTrue(inside.path.startsWith(assetRoot.canonicalPath + File.separator))
    }

    // ---- ④ 前缀绕过 ----
    @Test
    fun rejectsPrefixBypassAndUnknownRoots() {
        val dir = filesDir()
        rejects(dir, "note-assetsX/file.png")
        rejects(dir, "quick-notes/assetsX/file.png")
        rejects(dir, "quick-notes/asset/file.png")
        rejects(dir, "quick-notes/stagingX/d/f.png")
        rejects(dir, "other-root/file.png")
        rejects(dir, "note-1/image.png") // 旧格式（无资产根前缀）不再接受
    }

    // ---- ⑤ 超长 ----
    @Test
    fun rejectsOverlongKeys() {
        val dir = filesDir()
        val overlong = AssetPaths.LAKE_ROOT + "/" + "a".repeat(AssetPaths.MAX_KEY_CHARS)
        assertTrue(overlong.length > AssetPaths.MAX_KEY_CHARS)
        rejects(dir, overlong)
        // 上限内仍然可用（真实 key 约 312 字符）
        val ok = AssetPaths.resolveAsset(dir, AssetPaths.LAKE_ROOT + "/" + "a".repeat(200) + "/f.png", AssetPaths.Mode.READ)
        assertTrue(ok.path.startsWith(File(dir, AssetPaths.LAKE_ROOT).canonicalPath + File.separator))
    }

    // ---- ⑥ 空段 ----
    @Test
    fun rejectsEmptySegments() {
        val dir = filesDir()
        rejects(dir, "")
        rejects(dir, "   ")
        rejects(dir, "note-assets/")
        rejects(dir, "note-assets//pic.png")
        rejects(dir, "/note-assets/pic.png")
        rejects(dir, "note-assets/./pic.png")
        rejects(dir, "quick-notes/assets//x.png")
    }

    // ---- staging / mode 显式契约 ----
    @Test
    fun stagingIsReadOnlyAndOnlyReachableFromServedPath() {
        val dir = filesDir()
        val served = AssetPaths.resolveServed(dir, "quick-notes/staging/draft1/p.jpg")
        assertTrue(served.path.startsWith(File(dir, "quick-notes/staging").canonicalPath + File.separator))
        // 资产读写（AssetSync）不允许 staging
        rejects(dir, "quick-notes/staging/draft1/p.jpg", AssetPaths.Mode.READ)
        rejects(dir, "quick-notes/staging/draft1/p.jpg", AssetPaths.Mode.WRITE)
        // 即便显式 allowStaging，写模式也拒绝
        try {
            AssetPaths.resolve(dir, "quick-notes/staging/draft1/p.jpg", AssetPaths.Mode.WRITE, allowStaging = true)
            throw AssertionError("staging must be read-only")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.isNotEmpty())
        }
    }

    @Test
    fun nulAndAbsoluteAreRejected() {
        val dir = filesDir()
        rejects(dir, "note-assets/a\u0000b.png")
        rejects(dir, "/tmp/evil.png")
        assertEquals(0, Files.newDirectoryStream(Paths.get(dir.path)).use { stream -> stream.toList().size }) // 解析过程绝不落盘
    }
}
