package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 远程图片原生长下载的纯规则测试（261114 三批）：魔数嗅探 / 命名格式 / 状态分类 / SSRF 目标判定。 */
class RemoteAssetRulesTest {
    private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

    @Test
    fun sniffMagicRecognizesDesktopFormats() {
        assertEquals("png", RemoteAssetRules.sniffMagic(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0))?.extension)
        assertEquals("jpg", RemoteAssetRules.sniffMagic(bytes(0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0))?.extension)
        assertEquals("gif", RemoteAssetRules.sniffMagic(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0))?.extension)
        val webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)
        assertEquals("webp", RemoteAssetRules.sniffMagic(webp)?.extension)
        val avif = "\u0000\u0000\u0000\u001cftypavif".toByteArray(Charsets.ISO_8859_1)
        assertEquals("avif", RemoteAssetRules.sniffMagic(avif)?.extension)
    }

    @Test
    fun sniffRejectsHtmlAndShortBuffers() {
        assertNull(RemoteAssetRules.sniffMagic(bytes(0x3C, 0x68, 0x74, 0x6D, 0x6C, 0x3E, 0, 0, 0, 0, 0, 0)))
        assertNull(RemoteAssetRules.sniffMagic(bytes(0x89, 0x50)))
    }

    @Test
    fun assetFilenameMatchesDesktopFormat() {
        assertEquals("1700000000000_ab12.png", RemoteAssetRules.assetFilename("png", "ab12", 1700000000000L))
        assertEquals(4, RemoteAssetRules.randomHex4().length)
    }

    @Test
    fun statusClassification() {
        assertTrue(RemoteAssetRules.isRetryableStatus(503))
        assertTrue(RemoteAssetRules.isRetryableStatus(429))
        assertTrue(RemoteAssetRules.isRetryableStatus(403))
        assertFalse(RemoteAssetRules.isRetryableStatus(404))
        assertFalse(RemoteAssetRules.isRetryableStatus(410))
        assertTrue(RemoteAssetRules.isRedirect(302))
        assertFalse(RemoteAssetRules.isRedirect(200))
        assertTrue(RemoteAssetRules.isHtmlContentType("text/html; charset=utf-8"))
    }

    @Test
    fun forbiddenHostsCoverLoopbackAndPrivateRanges() {
        assertTrue(RemoteAssetRules.isForbiddenHost("localhost"))
        assertTrue(RemoteAssetRules.isForbiddenHost("app.localhost"))
        assertTrue(RemoteAssetRules.isForbiddenHost("127.0.0.1"))
        assertTrue(RemoteAssetRules.isForbiddenHost("10.1.2.3"))
        assertTrue(RemoteAssetRules.isForbiddenHost("192.168.1.5"))
        assertTrue(RemoteAssetRules.isForbiddenHost("172.16.0.9"))
        assertTrue(RemoteAssetRules.isForbiddenHost("::1"))
    }
}
