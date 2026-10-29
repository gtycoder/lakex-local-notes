package com.lakexlocalnotes.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android Keystore 加密小盒（261023）：密文落应用私有 SharedPreferences，明文不落盘。
 *
 * 与 SecureStorePlugin 同款算法（AES-256-GCM，密钥由 AndroidKeyStore 生成保管），
 * 但用**独立别名与独立 prefs**：AI 配置与 S3 密钥互不影响，清理其一不会误伤另一个。
 * 失败语义：解密失败（换锁屏/恢复出厂/数据损坏）⇒ 删除该键并返回 null（让用户重填）。
 */
internal class SecretBox(private val alias: String, private val prefsName: String) {
    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }

    private fun prefs(context: android.content.Context) =
        context.getSharedPreferences(prefsName, android.content.Context.MODE_PRIVATE)

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val entry = try { ks.getEntry(alias, null) } catch (e: Exception) { null }
        if (entry is KeyStore.SecretKeyEntry) return entry.secretKey
        if (ks.containsAlias(alias)) {
            try { ks.deleteEntry(alias) } catch (e: Exception) { /* 残留不可用：删掉重建 */ }
        }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun put(context: android.content.Context, key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ct, Base64.NO_WRAP)
        prefs(context).edit().putString(key, packed).apply()
    }

    fun get(context: android.content.Context, key: String): String? {
        val packed = prefs(context).getString(key, null) ?: return null
        return try {
            val parts = packed.split(":")
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            prefs(context).edit().remove(key).apply()
            null
        }
    }

    fun remove(context: android.content.Context, key: String) {
        prefs(context).edit().remove(key).apply()
    }
}
