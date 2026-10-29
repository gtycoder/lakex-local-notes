package com.lakexlocalnotes.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * S3 密钥等 secret 的 **Android Keystore** 存储（261010）。
 *
 * 为什么需要：先前的实现把密文放 WebView 存储（WebCrypto AES-GCM + localStorage），
 * 密钥材料是**固定派生**的（`lakex-local-notes-mobile.secret-key.v1`）—— 拿到 WebView 存储就能解开，
 * 属于"混淆"而非硬件级保护。这里改为：
 *   · 密钥由 **AndroidKeyStore** 生成并保管（不落盘、不出安全硬件/TEE 支持范围）；
 *   · 密文（`base64(iv):base64(ciphertext)`，AES-256-GCM）落 **应用私有 SharedPreferences**；
 *   · 解锁/使用由系统负责，应用不接触裸密钥。
 *
 * 接口与 core 的 `SecretStore` 端口一对一（get/set/remove），JS 侧见 src/mobile/native/keystoreSecretStore.ts。
 * 失败语义：解密失败（换锁屏 / 恢复出厂 / 数据损坏）⇒ **清掉该键并返回空**，让用户重填 ——
 * 对齐桌面 safeStorage 密钥丢失的语义（绝不返回错误密钥去签名）。
 */
@CapacitorPlugin(name = "SecureStore")
class SecureStorePlugin : Plugin() {
    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "lakex-local-notes-mobile.secret.v1"
        private const val PREFS = "lakex-local-notes-secure"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 取（或首次生成）Keystore 里的 AES 密钥。别名已存在但类型不符时清掉重建。 */
    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val entry = try { ks.getEntry(ALIAS, null) } catch (e: Exception) { null }
        if (entry is KeyStore.SecretKeyEntry) return entry.secretKey
        if (ks.containsAlias(ALIAS)) {
            // 残留但不可用（例如旧算法/被系统失效）：删掉重建，避免每次调用都抛。
            try { ks.deleteEntry(ALIAS) } catch (e: Exception) { /* ignore */ }
        }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val key = call.getString("key")
        val value = call.getString("value")
        if (key.isNullOrEmpty() || value == null) { call.reject("key/value 必填"); return }
        try {
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(ct, Base64.NO_WRAP)
            prefs().edit().putString(key, packed).apply()
            call.resolve()
        } catch (e: Exception) {
            // 写失败必须让调用方知道（"看起来保存成功"是最坏结果）
            call.reject("Keystore 写入失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrEmpty()) { call.reject("key 必填"); return }
        val packed = prefs().getString(key, null)
        val out = JSObject()
        if (packed == null) { call.resolve(out); return }  // 未写过：不给 value（JS 侧 ?? null）
        try {
            val parts = packed.split(":")
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
            out.put("value", String(cipher.doFinal(ct), Charsets.UTF_8))
            call.resolve(out)
        } catch (e: Exception) {
            // 密钥失效/数据损坏 ⇒ 清掉当未配置（让用户重填），而不是拿坏密钥去签名。
            prefs().edit().remove(key).apply()
            call.resolve(out)
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrEmpty()) { call.reject("key 必填"); return }
        prefs().edit().remove(key).apply()
        call.resolve()
    }
}