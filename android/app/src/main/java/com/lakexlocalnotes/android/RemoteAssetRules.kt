package com.lakexlocalnotes.android

import java.net.Inet6Address
import java.net.InetAddress

/**
 * 远程图片「原生长下载」的纯规则（261114 三批，可 JVM 单测）：
 * - SSRF 目标判定（本机/私网/链路本地/唯一本地 IPv6/组播 或 解析失败 一律拒绝）；
 * - 图片魔数嗅探（与桌面 core/imageUtils 同口径：PNG/JPEG/GIF/WebP/AVIF）；
 * - 资产命名（与桌面 core/assetNaming.buildAssetFilename 同格式：{13 位毫秒}_{4 位 hex}.{ext}）；
 * - HTTP 状态分类（哪些值得重试、哪些是永久失败）。
 *
 * 放纯函数是为了能在 JVM 单测覆盖；网络/文件 IO 留在 AssetSyncPlugin。
 */
internal object RemoteAssetRules {
    const val MAX_BYTES = 25L * 1024 * 1024
    const val MAX_REDIRECTS = 5
    private val REDIRECT_STATUS = setOf(301, 302, 303, 307, 308)

    data class Sniffed(val extension: String, val mimeType: String)

    /** 魔数嗅探（只认桌面支持的五种位图；SVG/其它一律拒绝，避免把 HTML/JS 当图片落盘）。 */
    fun sniffMagic(head: ByteArray): Sniffed? {
        if (head.size < 12) return null
        fun b(i: Int) = head[i].toInt() and 0xFF
        if (b(0) == 0x89 && b(1) == 0x50 && b(2) == 0x4E && b(3) == 0x47) return Sniffed("png", "image/png")
        if (b(0) == 0xFF && b(1) == 0xD8 && b(2) == 0xFF) return Sniffed("jpg", "image/jpeg")
        if (b(0) == 0x47 && b(1) == 0x49 && b(2) == 0x46) return Sniffed("gif", "image/gif")
        if (b(0) == 0x52 && b(1) == 0x49 && b(2) == 0x46 && b(3) == 0x46 &&
            b(8) == 0x57 && b(9) == 0x45 && b(10) == 0x42 && b(11) == 0x50
        ) return Sniffed("webp", "image/webp")
        if (b(4) == 0x66 && b(5) == 0x74 && b(6) == 0x79 && b(7) == 0x70) {
            val brand = String(head, 8, 4, Charsets.US_ASCII)
            if (brand == "avif" || brand == "avis") return Sniffed("avif", "image/avif")
        }
        return null
    }

    /** 与桌面共享命名格式（跨端可读；不要把 desktop 改成 UUID）。 */
    fun assetFilename(extension: String, randomHex4: String, nowMs: Long = System.currentTimeMillis()): String =
        nowMs.toString() + "_" + randomHex4 + "." + extension

    fun randomHex4(): String = String.format("%04x", (0..0xFFFF).random())

    fun isRedirect(status: Int): Boolean = REDIRECT_STATUS.contains(status)

    /** 临时问题才重试：5xx / 408 / 425 / 429，以及可能被防盗链临时拦的 403。 */
    fun isRetryableStatus(status: Int): Boolean =
        status == 403 || status == 408 || status == 425 || status == 429 || status >= 500

    fun isHtmlContentType(contentType: String): Boolean = contentType.lowercase().contains("text/html")

    /** IPv6 唯一本地地址 fc00::/7（isSiteLocalAddress 不覆盖 IPv6）。 */
    fun isUniqueLocalV6(address: InetAddress): Boolean {
        if (address !is Inet6Address) return false
        val first = address.address[0].toInt() and 0xFE
        return first == 0xFC
    }

    fun isForbiddenAddress(address: InetAddress): Boolean =
        address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
            address.isSiteLocalAddress || address.isMulticastAddress || isUniqueLocalV6(address)

    /**
     * host 是否禁止下载：localhost 字面、解析到私网/本机/链路本地/组播、或解析失败（宁可误伤不可放行）。
     * 注意：本函数只做「一次解析后校验」，HttpURLConnection 连接时会再解析一次（存在 DNS rebinding 的
     * TOCTOU 窗口）。Android 的 HttpURLConnection 没有钉 IP 的公开接口；个人笔记场景接受该残余风险。
     */
    fun isForbiddenHost(host: String): Boolean {
        val h = host.lowercase().trim('[', ']')
        if (h == "localhost" || h.endsWith(".localhost")) return true
        val addresses = try { InetAddress.getAllByName(host) } catch (_: Exception) { return true }
        if (addresses.isEmpty()) return true
        return addresses.any { isForbiddenAddress(it) }
    }
}
