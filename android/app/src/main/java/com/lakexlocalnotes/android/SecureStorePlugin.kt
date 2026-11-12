package com.lakexlocalnotes.android

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

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
 *
 * 261112 R1（Q22A）：加解密实现统一到 [SecretBox]（AES-256-GCM + Keystore 生成/保管 + 失败清键），
 * 本插件只保留「别名/prefs 名 + JS 契约」。ALIAS/PREFS 两个值**不可改**：改了等于换密钥库，
 * 已保存的 S3 密钥会全部解不开（用户需重填）。
 */
@CapacitorPlugin(name = "SecureStore")
class SecureStorePlugin : Plugin() {
    companion object {
        /** 加密密钥在 AndroidKeyStore 里的别名（历史值，不可改）。 */
        private const val ALIAS = "lakex-local-notes-mobile.secret.v1"

        /** 密文落盘位置（应用私有 SharedPreferences，历史值不可改）。 */
        private const val PREFS = "lakex-local-notes-secure"
    }

    private val box = SecretBox(ALIAS, PREFS)

    @PluginMethod
    fun set(call: PluginCall) {
        val key = call.getString("key")
        val value = call.getString("value")
        if (key.isNullOrEmpty() || value == null) { call.reject("key/value 必填"); return }
        try {
            box.put(context, key, value)
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
        // SecretBox.get：不存在/解密失败都返回 null；解密失败时已把该键清掉（让用户重填）。
        val value = box.get(context, key)
        val out = JSObject()
        if (value != null) out.put("value", value)
        call.resolve(out)
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrEmpty()) { call.reject("key 必填"); return }
        box.remove(context, key)
        call.resolve()
    }
}
