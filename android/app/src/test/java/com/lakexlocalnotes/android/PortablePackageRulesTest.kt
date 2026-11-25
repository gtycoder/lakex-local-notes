package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 便携包纯规则测试（M-16②）：zip-slip 条目名裁决 / 上限常量 / .zip.lln 后缀闸。
 * 这些断言此前只能靠插件体的解压实测覆盖；规则抽出后在 JVM 层钉死语义（防 zip-slip 类回归）。
 */
class PortablePackageRulesTest {

    @Test
    fun zipSlipEntryNamesRejected() {
        // 绝对路径 / 反斜杠（Windows 盘符与 UNC 变体都走这条）
        assertTrue(PortablePackageRules.hasIllegalEntryPath("/etc/passwd"))
        assertTrue(PortablePackageRules.hasIllegalEntryPath("..\\..\\evil"))
        assertFalse(PortablePackageRules.hasIllegalEntryPath("notes/abc.lake"))
        // "." ".." 空段（"../x"、"a/../../b"、"a/./b"、"a//b" 一律拒绝）
        for (name in listOf("../x", "a/../../b", "a/./b", "a//b", "..", ".")) {
            assertTrue(name, PortablePackageRules.hasForbiddenSegment(PortablePackageRules.normalizeEntryName(name)))
        }
        assertFalse(PortablePackageRules.hasForbiddenSegment(PortablePackageRules.normalizeEntryName("notes/2024/abc.lake")))
        assertFalse(PortablePackageRules.hasForbiddenSegment(PortablePackageRules.normalizeEntryName("portable.json")))
    }

    @Test
    fun entryNameNormalization() {
        assertEquals("a/b", PortablePackageRules.normalizeEntryName("./a/b"))
        assertEquals("a/b", PortablePackageRules.normalizeEntryName("a/b/"))
        // 空条目（空名）归一后为空串 ⇒ 调用方跳过，不是错误（原插件 continue 语义）
        assertEquals("", PortablePackageRules.normalizeEntryName(""))
        // "./" 归一后是 "." ⇒ 落到路径段闸被拒（与原插件同语义，别当空条目跳过）
        assertEquals(".", PortablePackageRules.normalizeEntryName("./"))
    }

    @Test
    fun suffixGateOnlyAcceptsLatestExtension() {
        assertTrue(PortablePackageRules.hasPortableExtension("backup.zip.lln"))
        assertTrue(PortablePackageRules.hasPortableExtension("BACKUP.ZIP.LLN"))
        // 261110 用户定稿：旧 .zip 不兼容（不写历史数据兼容，AGENTS §3#7）
        assertFalse(PortablePackageRules.hasPortableExtension("backup.zip"))
        assertFalse(PortablePackageRules.hasPortableExtension("backup.lln"))
    }

    @Test
    fun limitsPinned() {
        // 与 core/portableFormat.ts 同拍（261122 大统一口径）；改值必须两端一起改
        assertEquals(500_000, PortablePackageRules.MAX_ENTRIES)
        assertEquals(4L * 1024 * 1024 * 1024, PortablePackageRules.PORTABLE_LIMIT_BYTES)
        assertEquals(2 * 1024 * 1024, PortablePackageRules.MAX_MANIFEST_BYTES)
        assertEquals(".zip.lln", PortablePackageRules.PORTABLE_EXTENSION)
    }
}
