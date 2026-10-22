package com.locallakexnotes.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class AssetSyncPluginTest {
    @Test
    fun localKeyStaysInsideCanonicalAssetRoot() {
        val root = Files.createTempDirectory("lake-assets").toFile()
        val assets = root.resolve("note-assets")
        val file = resolveLocalAssetFile(root, "note-1/image.png")

        assertTrue(file.path.startsWith(assets.canonicalPath + java.io.File.separator))
        assertEquals(assets.resolve("note-1/image.png").canonicalPath, file.path)
    }

    @Test
    fun rejectsTraversalAbsoluteAndSiblingPrefixEscape() {
        val root = Files.createTempDirectory("lake-assets").toFile()
        val invalid = listOf("../databases/app.db", "/tmp/evil", ".", "")
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
