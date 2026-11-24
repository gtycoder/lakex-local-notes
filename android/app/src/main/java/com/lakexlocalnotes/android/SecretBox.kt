package com.lakexlocalnotes.android

import android.util.Base64
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 自管理加密小盒（261204 用户裁决：**彻底退役系统凭据管理**，不碰 Android Keystore / 系统钥匙串）。
 *
 * 与桌面「本机加密」同语义（electron/secretCipher.ts 的 machine.key 方案）：
 *   · 密钥 = 随机 32 字节，落**应用私有密钥文件**（filesDir/<prefs>.key，0600 尽力收紧）；
 *   · 密文（base64(iv):base64(ciphertext)，AES-256-GCM）落**应用私有 SharedPreferences**；
 *   · 明文不落盘；密钥文件损坏 ⇒ **抛错拒写**（宁可拒绝保存，不静默换钥丢密文，与桌面同口径）。
 *
 * 261204 一次性迁移：首次使用（密钥文件不存在）时若旧 AndroidKeyStore 别名还在 ⇒ 用旧密钥解出
 * prefs 里的存量密文、换写新密钥密文，然后**删除 Keystore 别名**（退役）。迁移后本类永不再碰 Keystore；
 * 解不开的旧键按既有失败语义清掉（让用户重填，绝不返回错误密钥去签名）。
 *
 * ALIAS/PREFS 两个历史值**不可改**：prefs 名决定密文位置与密钥文件名，改了等于换密钥库。
 *（ALIAS 现仅用于迁移期定位旧 Keystore 别名。）
 */
internal class SecretBox(private val alias: String, private val prefsName: String) {
    companion object {
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val KEY_BYTES = 32
    }

    private fun prefs(context: android.content.Context) =
        context.getSharedPreferences(prefsName, android.content.Context.MODE_PRIVATE)

    /** 自管理密钥文件（应用私有 filesDir；文件名随 prefs 独立 ⇒ 两个 SecretBox 互不影响）。 */
    private fun keyFile(context: android.content.Context): File = File(context.filesDir, "$prefsName.key")

    /** 261204 一次性迁移：旧 Android Keystore → 自管理密钥文件；完成后删除别名（退役）。 */
    private fun migrateFromKeystoreIfNeeded(context: android.content.Context) {
        val file = keyFile(context)
        if (file.exists()) return
        val ks = try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } } catch (e: Exception) { return }
        val oldKey: SecretKey = try { (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey } catch (e: Exception) { null } ?: return
        val newKey = loadOrCreateKey(context)
        for ((k, v) in prefs(context).all.toMap()) {
            val packed = v as? String ?: continue
            val plain = tryDecrypt(oldKey, packed) ?: continue
            prefs(context).edit().putString(k, encryptWith(newKey, plain)).apply()
        }
        try { ks.deleteEntry(alias) } catch (e: Exception) { /* 残留无害：别名不再被读 */ }
    }

    /** 读/建自管理密钥；损坏 ⇒ 抛错拒写（与桌面 machine.key 同语义）。 */
    private fun loadOrCreateKey(context: android.content.Context): SecretKeySpec {
        val file = keyFile(context)
        if (file.exists()) {
            val raw = try {
                Base64.decode(file.readText().trim(), Base64.NO_WRAP)
            } catch (e: Exception) {
                throw IllegalStateException("密钥文件损坏：${file.name}——删除后需重新填写密钥", e)
            }
            if (raw.size != KEY_BYTES) throw IllegalStateException("密钥文件损坏（长度 ${raw.size}）：${file.name}——删除后需重新填写密钥")
            return SecretKeySpec(raw, "AES")
        }
        val raw = ByteArray(KEY_BYTES).also { SecureRandom().nextBytes(it) }
        val tmp = File(context.filesDir, "$prefsName.key.tmp-${android.os.Process.myPid()}")
        tmp.writeText(Base64.encodeToString(raw, Base64.NO_WRAP))
        try {
            tmp.setReadable(false, false)
            tmp.setWritable(false, false)
            tmp.setReadable(true, true)
            tmp.setWritable(true, true)
        } catch (e: Exception) { /* 权限尽力（Windows/部分文件系统无 POSIX 位） */ }
        if (!tmp.renameTo(file)) file.writeText(Base64.encodeToString(raw, Base64.NO_WRAP))
        return SecretKeySpec(raw, "AES")
    }

    private fun secretKey(context: android.content.Context): SecretKeySpec {
        migrateFromKeystoreIfNeeded(context)
        return loadOrCreateKey(context)
    }

    private fun encryptWith(key: SecretKey, value: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
    }

    private fun tryDecrypt(key: SecretKey, packed: String): String? {
        return try {
            val parts = packed.split(":")
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    fun put(context: android.content.Context, key: String, value: String) {
        val packed = encryptWith(secretKey(context), value)
        prefs(context).edit().putString(key, packed).apply()
    }

    fun get(context: android.content.Context, key: String): String? {
        val packed = prefs(context).getString(key, null) ?: return null
        val plain = tryDecrypt(secretKey(context), packed)
        if (plain == null) {
            // 解密失败（密钥文件丢失/更换）⇒ 清掉该键并返回空（让用户重填；绝不返回错误密钥去签名）。
            prefs(context).edit().remove(key).apply()
        }
        return plain
    }

    fun remove(context: android.content.Context, key: String) {
        prefs(context).edit().remove(key).apply()
    }
}
