package com.lakenotes.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A4：native 侧「用系统应用打开」的扩展名围栏。
 * 代表集与桌面 src/core/assetNaming.test.ts 的 isSafeShellOpenFilename 用例保持一致 ——
 * 这两份清单分属 Kotlin/TS 无法共享常量，用同一组代表用例把契约两边钉住（替代脆弱的源码解析护栏）。
 */
class OpenFilePluginTest {
    @Test
    fun allowsDocumentsMediaAndArchives() {
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.pdf"))
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.png"))
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.mp4"))
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.zip"))
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.PDF"))
    }

    @Test
    fun deniesExecutablesSvgMacroAndUnknown() {
        val denied = arrayOf("a.exe", "a.command", "a.bat", "a.sh", "a.apk", "a.bin", "a.svg", "a.docm", "a.lnk", "a.xyzzy", "noext")
        for (name in denied) {
            assertFalse(name, OpenFilePlugin.isSafeShellOpenName(name))
        }
    }
}
