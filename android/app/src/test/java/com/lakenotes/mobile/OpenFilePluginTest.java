package com.lakenotes.mobile;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * A4：native 侧「用系统应用打开」的扩展名围栏。
 * 代表集与桌面 src/core/assetNaming.test.ts 的 isSafeShellOpenFilename 用例保持一致 ——
 * 这两份清单分属 Java/TS 无法共享常量，用同一组代表用例把契约两边钉住（替代脆弱的源码解析护栏）。
 */
public class OpenFilePluginTest {
    @Test
    public void allowsDocumentsMediaAndArchives() {
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.pdf"));
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.png"));
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.mp4"));
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.zip"));
        assertTrue(OpenFilePlugin.isSafeShellOpenName("a.PDF"));
    }

    @Test
    public void deniesExecutablesSvgMacroAndUnknown() {
        String[] denied = { "a.exe", "a.command", "a.bat", "a.sh", "a.apk", "a.bin", "a.svg", "a.docm", "a.lnk", "a.xyzzy", "noext" };
        for (String name : denied) {
            assertFalse(name, OpenFilePlugin.isSafeShellOpenName(name));
        }
    }
}