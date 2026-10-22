package com.locallakexnotes.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * SigV4 签名器单测：用 AWS 官方 SigV4 测试套件的 get-vanilla 向量对拍（service 作为参数传入），
 * 保证原生签名字节级正确（签名错会静默 403，必须钉死）。
 */
class AwsV4SignerTest {
    private val emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

    @Test
    fun matchesOfficialSigV4GetVanillaVector() {
        val headers = linkedMapOf(
            "host" to "example.amazonaws.com",
            "x-amz-date" to "20150830T123600Z",
        )
        val auth = AwsV4Signer.authorization(
            "GET", "/", "", headers, emptyHash,
            "20150830T123600Z", "20150830", "us-east-1",
            "AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            "service",
        )
        assertEquals(
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
                "SignedHeaders=host;x-amz-date, " +
                "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
            auth,
        )
    }

    @Test
    fun emptyPayloadSha256MatchesKnownVector() {
        assertEquals(emptyHash, AwsV4Signer.sha256Hex(""))
    }

    @Test
    fun rfc3986EncodingUsesUppercaseHex() {
        assertEquals("a%20b%2Fc~_-.", AwsV4Signer.encodeRfc3986("a b/c~_-."))
    }
}
