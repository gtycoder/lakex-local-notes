package com.lakexlocalnotes.android

import java.io.File

/**
 * 资产路径解析的**单一来源**（261112 R1，Q21A）。
 *
 * 改前有 3 份近似实现，允许集合与过滤顺序不一致：
 *   · `AssetServer.kt` handle() 内联 `when`（URL 路径 → 物理根）+ canonical 前缀校验（**多放行** `quick-notes/staging`）；
 *   · `AssetSyncPlugin.kt` 顶层 `resolveLocalAssetFile`（只认两个资产根，不给 staging）；
 *   · `AssetSyncPlugin.resolveAssetFsPath`（assetFs 读写，自己又写了一遍 segment 过滤）。
 * 任一方以后加根/加例外，另一方不会自动跟上 ⇒ 这是安全面最容易静默分叉的位置。
 *
 * 本对象把「根清单 + segment 过滤 + canonical 前缀校验」收成一份；staging 只能由读取面显式开启
 * （[resolveServed]，永远只读），写路径（[resolveAsset]）永远不允许 staging。
 *
 * 契约（失败一律抛 [IllegalArgumentException]，调用方按各自语义转 403 / reject / null）：
 *   ① key 非空、非绝对路径、不含 NUL、长度 ≤ [MAX_KEY_CHARS]；
 *   ② 按 `/` 切分后不得有 `.` / `..` / 空段（含首尾斜杠与连续斜杠）；
 *   ③ 必须落在允许的根前缀下（**按段匹配**，`note-assetsX/` 不算 `note-assets/`）；
 *   ④ canonical 解析后仍在该根之下（软链逃逸由这一条兜底）。
 *
 * 编码约定：本对象**不做 URL 解码**（解码只做一次，在 AssetServer 里用 `URI.getPath()`）。
 * 因此 `%2e%2e` 这种字面段只会落到根内的同名目录，不可能逃逸；解码后的 `..` 由 ② 拒绝。
 */
internal object AssetPaths {
    /** 读写语义：写路径禁止 staging；两个资产根读写相同。 */
    enum class Mode { READ, WRITE }

    const val LAKE_ROOT = "note-assets"
    const val QUICK_ASSETS_ROOT = "quick-notes/assets"
    const val QUICK_STAGING_ROOT = "quick-notes/staging"

    /**
     * key 长度上限：真实资产 key = 根前缀(20) + id(36) + 文件名(≤255) ≈ 312。
     * 1024 只用于拒绝异常输入（超长目录名/畸形请求），不参与正常资产命名。
     */
    const val MAX_KEY_CHARS = 1024

    /** 资产读写语义：只接受两个资产根（staging 不可达）。 */
    fun resolveAsset(filesDir: File, localKey: String, mode: Mode): File =
        resolve(filesDir, localKey, mode, allowStaging = false)

    /** HTTP 读取面语义：允许 staging（小记草稿图预览），但只能读。 */
    fun resolveServed(filesDir: File, physicalKey: String): File =
        resolve(filesDir, physicalKey, Mode.READ, allowStaging = true)

    /**
     * @param allowStaging 只有 AssetServer 读取面传 true；staging 段同时要求 [Mode.READ]。
     */
    fun resolve(filesDir: File, key: String, mode: Mode, allowStaging: Boolean): File {
        require(key.isNotBlank()) { "empty asset key" }
        require(key.length <= MAX_KEY_CHARS) { "asset key too long: " + key.length }
        require(!key.contains('\u0000')) { "NUL in asset key" }
        require(!File(key).isAbsolute && !key.startsWith("/") && !key.startsWith("\\")) { "absolute asset key: " + key }
        val segments = key.split('/')
        require(segments.none { it.isEmpty() || it == "." || it == ".." }) { "invalid asset key segments: " + key }

        val rootKey = rootKeyOf(key) ?: throw IllegalArgumentException("asset key outside known roots: " + key)
        if (rootKey == QUICK_STAGING_ROOT) {
            require(allowStaging) { "staging is not a writable asset root: " + key }
            require(mode == Mode.READ) { "staging is read-only: " + key }
        }

        val filesCanonical = filesDir.canonicalFile
        val rootCanonical = File(filesCanonical, rootKey).canonicalFile
        val target = File(filesCanonical, key).canonicalFile
        require(target.path.startsWith(rootCanonical.path + File.separator)) { "asset key escapes root: " + key }
        return target
    }

    /** 按段匹配根前缀（不用字符串 startsWith，避免 "note-assetsX/" 这类前缀绕过）。 */
    private fun rootKeyOf(key: String): String? = when {
        key == LAKE_ROOT || key.startsWith(LAKE_ROOT + "/") -> LAKE_ROOT
        key == QUICK_ASSETS_ROOT || key.startsWith(QUICK_ASSETS_ROOT + "/") -> QUICK_ASSETS_ROOT
        key == QUICK_STAGING_ROOT || key.startsWith(QUICK_STAGING_ROOT + "/") -> QUICK_STAGING_ROOT
        else -> null
    }
}
