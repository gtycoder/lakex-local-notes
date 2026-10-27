package com.locallakexnotes.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class AssetSyncPluginTest {
    @Test
    fun lakeAssetKeyStaysInsideCanonicalAssetRoot() {
        val root = Files.createTempDirectory("lake-assets").toFile()
        val assets = root.resolve("note-assets")
        val file = resolveLocalAssetFile(root, "note-assets/note-1/image.png")

        assertTrue(file.path.startsWith(assets.canonicalPath + java.io.File.separator))
        assertEquals(assets.resolve("note-1/image.png").canonicalPath, file.path)
    }

    @Test
    fun quickNoteAssetKeyStaysInsideCanonicalQuickRoot() {
        val root = Files.createTempDirectory("lake-assets").toFile()
        val quick = root.resolve("quick-notes/assets")
        val file = resolveLocalAssetFile(root, "quick-notes/assets/q1/img.png")

        assertTrue(file.path.startsWith(quick.canonicalPath + java.io.File.separator))
        assertEquals(quick.resolve("q1/img.png").canonicalPath, file.path)
    }

    @Test
    fun rejectsTraversalAbsoluteSiblingPrefixAndUnknownRoots() {
        val root = Files.createTempDirectory("lake-assets").toFile()
        val invalid = listOf(
            "../databases/app.db",
            "/tmp/evil",
            ".",
            "",
            "note-1/image.png",                    // 旧格式（无资产根前缀）不再接受
            "note-assets/../../databases/app.db",  // 借 note-assets 前缀穿越
            "quick-notes/assets/../../../tmp/x",   // 借小记根穿越
            "quick-notes/assets/../x",             // 字节级穿越
            "other-root/file.png",
        )
        for (localKey in invalid) {
            var rejected = false
            try {
                resolveLocalAssetFile(root, localKey)
            } catch (_: IllegalArgumentException) {
                rejected = true
            }
            assertTrue("应拒绝 localKey=$localKey", rejected)
        }
    }
}
