package com.lakexlocalnotes.android

/**
 * 便携包纯规则（M-16② 从 PortablePackagePlugin.kt 拆出；IO/Activity 留插件，纯规则可 JVM 单测）：
 * - zip 条目名裁决（zip-slip 语义：反斜杠 / 绝对路径 / "." ".." 空段一律拒绝，"./" 前缀剥掉）；
 * - 包体/条目/清单上限（防炸弹闸，与 core/portableFormat.ts 口径同拍）；
 * - ".zip.lln" 后缀闸（261110 用户定稿：旧 .zip 不兼容，不写历史数据兼容，AGENTS §3#7）。
 * ⚠️ 名字层只是第一道闸：落点仍要过 canonical 越界校验（插件 isInside，M-16① 收口）。
 * 护栏：PortablePackageRulesTest.kt（zip-slip / 上限 / 后缀闸断言）。
 */
internal object PortablePackageRules {
    /** 只接受最新后缀；旧 .zip 不再兼容（用户 261110 定稿：不为历史数据做兼容）。 */
    const val PORTABLE_EXTENSION = ".zip.lln"

    /**
     * 条目上限：10k 文档 + 100k 附件实测 = 110,005 条；261122 按大库量级
     * 放宽到 500k（防炸弹闸，与 core portableFormat 的口径同拍）。zip bomb 仍由
     * 4GiB 包体上限、逐条路径/越界校验、解压总量与落盘空间共同兜底。
     */
    const val MAX_ENTRIES = 500_000

    /** 解压/打包总量上限 4GiB（导出与导入两侧同值；清单 limitBytes 必须同值才收）。 */
    const val PORTABLE_LIMIT_BYTES = 4L * 1024 * 1024 * 1024

    /** 清单（portable.json）大小上限 2MiB：超出即不是正常清单。 */
    const val MAX_MANIFEST_BYTES = 2 * 1024 * 1024

    /** 后缀闸：只认 .zip.lln（大小写不敏感）。 */
    fun hasPortableExtension(name: String): Boolean = name.endsWith(PORTABLE_EXTENSION, ignoreCase = true)

    /** 条目名第一道闸：反斜杠（Windows 盘符/UNC 变体）与绝对路径 = 非法。 */
    fun hasIllegalEntryPath(rawName: String): Boolean = rawName.contains('\\') || rawName.startsWith("/")

    /** 条目名归一（剥 "./" 前缀与首尾 "/"）；空串 = 空条目（调用方跳过，不算错误）。 */
    fun normalizeEntryName(rawName: String): String {
        var name = rawName.replace('\\', '/').trim('/')
        while (name.startsWith("./")) name = name.substring(2)
        return name
    }

    /** 条目名第二道闸：归一名里的 "." ".." 空段（"../x"、"a/../../b"、"a/./b"、"a//b" 全部拒绝）。 */
    fun hasForbiddenSegment(name: String): Boolean = name.split('/').any { it == ".." || it == "." || it.isEmpty() }
}
