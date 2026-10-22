package com.locallakexnotes.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.file.Files

class AssetServerTest {
    @Throws(IOException::class)
    private fun tempFileWith(bytes: ByteArray): File {
        val file = File.createTempFile("lake-mime", ".bin")
        file.deleteOnExit()
        Files.write(file.toPath(), bytes)
        return file
    }

    @Test
    @Throws(IOException::class)
    fun webpSniffRequiresCompleteHeader() {
        val riffWithoutWebpBrand = byteArrayOf('R'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte(), 'F'.code.toByte(), 0, 0, 0, 0)
        assertNull(AssetServer.sniffMime(tempFileWith(riffWithoutWebpBrand)))
    }

    @Test
    @Throws(IOException::class)
    fun webpSniffAcceptsCompleteHeader() {
        val webpHeader = byteArrayOf('R'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte(), 'F'.code.toByte(), 0, 0, 0, 0, 'W'.code.toByte(), 'E'.code.toByte(), 'B'.code.toByte(), 'P'.code.toByte())
        assertEquals("image/webp", AssetServer.sniffMime(tempFileWith(webpHeader)))
    }

    /** 与桌面 assetServer 同语义：<img> 等非 CORS 请求（无 Origin）不要求 token。 */
    @Test
    fun noOriginRequestIsAllowedWithoutToken() {
        val uri = URI("/note-1/pic.jpg")
        assertTrue(AssetServer.isAuthorized(uri, null))
    }

    /** CORS 请求：本应用 origin 且缺 token → 拒绝（sToken 未设时同样拒绝）。 */
    @Test
    fun allowedOriginWithoutTokenIsRejected() {
        val uri = URI("/note-1/pic.jpg")
        assertFalse(AssetServer.isAuthorized(uri, "http://localhost"))
    }

    /** CORS 请求：外部网页 origin（即使伪造 token）→ 拒绝。 */
    @Test
    fun foreignOriginIsRejected() {
        val uri = URI("/note-1/pic.jpg?token=x")
        assertFalse(AssetServer.isAuthorized(uri, "http://evil.com"))
    }

    /** HTML/XHTML 附件不得以可执行文档 MIME 直出（桌面同口径：octet-stream）。 */
    @Test
    fun htmlIsDowngradedToOctetStream() {
        assertEquals("application/octet-stream", AssetServer.sanitizeAssetMime("text/html"))
        assertEquals("application/octet-stream", AssetServer.sanitizeAssetMime("application/xhtml+xml"))
        assertEquals("image/png", AssetServer.sanitizeAssetMime("image/png"))
        assertEquals("image/svg+xml", AssetServer.sanitizeAssetMime("image/svg+xml"))
    }

    // ---- 安全响应头（260923 A3，与桌面 electron/assetServer.ts 对齐）----

    @Test
    fun securityHeadersOnlySpecialCaseSvg() {
        val png = AssetServer.securityHeaderLines("image/png")
        assertTrue(png.contains("X-Content-Type-Options: nosniff"))
        assertFalse(png.contains("Content-Security-Policy"))
        assertEquals("", png.replace("X-Content-Type-Options: nosniff\r\n", ""))
    }

    @Test
    fun securityHeadersAddDesktopCspForSvg() {
        val svg = AssetServer.securityHeaderLines("image/svg+xml")
        assertTrue(svg.contains("X-Content-Type-Options: nosniff"))
        // 与桌面 assetServer.ts 的字符串逐字节一致
        assertEquals("sandbox; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'", AssetServer.SVG_CSP)
        assertTrue(svg.contains("Content-Security-Policy: " + AssetServer.SVG_CSP))
        assertTrue(svg.contains("Content-Disposition: inline"))
    }

    // ---- 按需缩略图（?w=，与桌面 assetServer 同口径）----

    @Test
    fun thumbWidthOnlyAcceptsWhitelistedTiers() {
        assertNull(AssetServer.thumbWidthFor(URI("/n/a.png")))
        assertEquals(128, AssetServer.thumbWidthFor(URI("/n/a.png?w=128")))
        assertEquals(1024, AssetServer.thumbWidthFor(URI("/n/a.png?token=t&w=1024")))
        // 非档位值当没传：连续值会把 WebView 磁盘缓存（immutable）打散
        assertNull(AssetServer.thumbWidthFor(URI("/n/a.png?w=100")))
        assertNull(AssetServer.thumbWidthFor(URI("/n/a.png?w=abc")))
        assertNull(AssetServer.thumbWidthFor(URI("/n/a.png?w=")))
    }

    /** GIF（多帧会被压成首帧）与 SVG（矢量）必须跳过；Android 侧其它格式编解码支持不一，也不碰。 */
    @Test
    fun thumbOnlyResizesSafeRasterFormats() {
        assertTrue(AssetServer.isThumbResizable("pic.png"))
        assertTrue(AssetServer.isThumbResizable("PIC.JPG"))
        assertTrue(AssetServer.isThumbResizable("pic.jpeg"))
        assertFalse(AssetServer.isThumbResizable("anim.gif"))
        assertFalse(AssetServer.isThumbResizable("icon.svg"))
        assertFalse(AssetServer.isThumbResizable("pic.webp"))
        assertFalse(AssetServer.isThumbResizable("noext"))
    }

    /** inSampleSize 只取 2 的幂，且「解出来仍不小于目标宽」（宁可略大、绝不小于）。 */
    @Test
    fun sampleSizeNeverUndershootsTarget() {
        assertEquals(1, AssetServer.sampleSizeFor(300, 256))
        assertEquals(2, AssetServer.sampleSizeFor(4000, 1024)) // 4000/4=1000 < 1024 ⇒ 停在 2
        assertEquals(16, AssetServer.sampleSizeFor(4000, 128)) // 4000/32=125 < 128 ⇒ 停在 16
        assertEquals(1, AssetServer.sampleSizeFor(100, 100))
    }
}
