package com.lakenotes.mobile

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * 最小 AWS SigV4 签名器（S3、单块请求、无 query、无 session token）。
 *
 * 原生资产传输用它给原生 HTTP 请求签名，让「S3 <-> 本地文件」的字节完全在原生侧流动、
 * 不过 WebView 桥。实现只覆盖我们需要的子集，并可用 AWS 官方文档的 S3 GET 示例做单测。
 */
internal object AwsV4Signer {
    private const val ALGORITHM = "AWS4-HMAC-SHA256"
    private const val SERVICE = "s3"

    fun sha256Hex(bytes: ByteArray): String = toHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    fun sha256Hex(text: String): String = sha256Hex(text.toByteArray(StandardCharsets.UTF_8))

    fun hmacSha256(key: ByteArray, data: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data.toByteArray(StandardCharsets.UTF_8))
    }

    /** RFC 3986 编码：unreserved 之外全部 %XX（空格用 %20，不用 +）。 */
    fun encodeRfc3986(value: String): String {
        val out = StringBuilder(value.length)
        for (b in value.toByteArray(StandardCharsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            if ((c in 'A'.code..'Z'.code) || (c in 'a'.code..'z'.code) || (c in '0'.code..'9'.code)
                || c == '-'.code || c == '_'.code || c == '.'.code || c == '~'.code
            ) {
                out.append(c.toChar())
            } else {
                out.append('%').append(HEX_UPPER[(c ushr 4) and 0xF]).append(HEX_UPPER[c and 0xF])
            }
        }
        return out.toString()
    }

    /** 返回 Authorization 头值；headers 需包含 host 与 x-amz-* 等要签名的头。 */
    fun authorization(
        method: String,
        canonicalUri: String,
        canonicalQuery: String,
        headers: Map<String, String>,
        payloadSha256: String,
        amzDate: String,
        datestamp: String,
        region: String,
        accessKeyId: String,
        secretAccessKey: String,
        service: String = SERVICE,
    ): String {
        val normalized = headers.entries.associate { it.key.lowercase(Locale.ROOT) to it.value.trim() }
        val sortedKeys = normalized.keys.sorted()
        val canonicalHeaders = sortedKeys.joinToString("") { "$it:${normalized[it]}\n" }
        val signedHeaders = sortedKeys.joinToString(";")
        val canonicalRequest = "$method\n$canonicalUri\n$canonicalQuery\n$canonicalHeaders\n$signedHeaders\n$payloadSha256"
        val scope = "$datestamp/$region/$service/aws4_request"
        val stringToSign = "$ALGORITHM\n$amzDate\n$scope\n${sha256Hex(canonicalRequest)}"
        val kDate = hmacSha256(("AWS4$secretAccessKey").toByteArray(StandardCharsets.UTF_8), datestamp)
        val kRegion = hmacSha256(kDate, region)
        val kService = hmacSha256(kRegion, service)
        val kSigning = hmacSha256(kService, "aws4_request")
        val signature = toHex(hmacSha256(kSigning, stringToSign))
        return "$ALGORITHM Credential=$accessKeyId/$scope, SignedHeaders=$signedHeaders, Signature=$signature"
    }

    private val HEX = "0123456789abcdef".toCharArray()
    private val HEX_UPPER = "0123456789ABCDEF".toCharArray()

    private fun toHex(bytes: ByteArray): String {
        val out = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            out.append(HEX[(v ushr 4) and 0xF]).append(HEX[v and 0xF])
        }
        return out.toString()
    }
}
