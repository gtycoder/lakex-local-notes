package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * 长按桌面图标静态快捷方式（res/xml/shortcuts.xml）回归钉（261119 三模式）：
 *  ① 三项并列：quick-note（旧「小记」，无参 = plain 零变化）/ quick-note-camera（?src=camera）/
 *     quick-note-clipboard（?src=clipboard）；旧项的 id/深链/文案必须原样（无 query）。
 *  ② 每项的深链走 QuickNoteAlias + android:data URI（query 不影响 intent-filter 匹配，见 ③）。
 *  ③ AndroidManifest 的 quick-note intent-filter 只声明 scheme+host、**没有 path** ——
 *     data URI 带 ?query 才仍能匹配；谁给 filter 加 path，带 query 的两项就再也进不了 App。
 *  任一条被谁改回去，这里当场红。
 */
class ShortcutsConfigTest {
    private fun sourceFile(relative: String): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        throw AssertionError("找不到 " + relative + "（user.dir=" + System.getProperty("user.dir") + "）")
    }

    private fun parse(file: File): Element {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = false
        return factory.newDocumentBuilder().parse(file).documentElement
    }

    private fun childrenByTag(root: Element, tag: String): List<Element> {
        val out = mutableListOf<Element>()
        val nodes = root.getElementsByTagName(tag)
        for (i in 0 until nodes.length) out.add(nodes.item(i) as Element)
        return out
    }

    private fun strings(): Map<String, String> {
        val root = parse(sourceFile("src/main/res/values/strings.xml"))
        return childrenByTag(root, "string").associate { it.getAttribute("name") to it.textContent.trim() }
    }

    @Test
    fun threeShortcutsWithExpectedDeepLinks() {
        val root = parse(sourceFile("src/main/res/xml/shortcuts.xml"))
        val shortcuts = childrenByTag(root, "shortcut")
        assertEquals("shortcuts.xml 应恰有三项（小记 / 拍照小记 / 剪切板小记）", 3, shortcuts.size)
        val byId = shortcuts.associateBy { it.getAttribute("android:shortcutId") }
        val expected = mapOf(
            "quick-note" to "lakexlocalnotes://quick-note",
            "quick-note-camera" to "lakexlocalnotes://quick-note?src=camera",
            "quick-note-clipboard" to "lakexlocalnotes://quick-note?src=clipboard",
        )
        for ((id, data) in expected) {
            val shortcut = byId[id]
            assertTrue("shortcuts.xml 缺快捷方式 $id", shortcut != null)
            val intents = childrenByTag(shortcut!!, "intent")
            assertEquals("$id 应只有一个 intent", 1, intents.size)
            assertEquals("$id 深链 URI 不对", data, intents[0].getAttribute("android:data"))
            assertEquals(
                "$id 应落到 QuickNoteAlias（capture 专用启动主题）",
                "com.lakexlocalnotes.android.QuickNoteAlias",
                intents[0].getAttribute("android:targetClass"),
            )
            assertEquals(
                "$id 图标复用现有快捷方式图标",
                "@mipmap/ic_launcher",
                shortcut.getAttribute("android:icon"),
            )
        }
    }

    @Test
    fun shortcutLabelsResolveAndOldOneUnchanged() {
        val root = parse(sourceFile("src/main/res/xml/shortcuts.xml"))
        val byId = childrenByTag(root, "shortcut").associateBy { it.getAttribute("android:shortcutId") }
        val strings = strings()
        val labels = linkedMapOf(
            "quick-note" to listOf("shortcut_quick_note_short", "shortcut_quick_note_long"),
            "quick-note-camera" to listOf("shortcut_camera_note_short", "shortcut_camera_note_long"),
            "quick-note-clipboard" to listOf("shortcut_clipboard_note_short", "shortcut_clipboard_note_long"),
        )
        for ((id, refs) in labels) {
            val shortcut = byId[id] ?: throw AssertionError("shortcuts.xml 缺快捷方式 $id")
            val shortLabel = shortcut.getAttribute("android:shortcutShortLabel")
            val longLabel = shortcut.getAttribute("android:shortcutLongLabel")
            assertEquals("$id shortLabel 引用不对", "@string/" + refs[0], shortLabel)
            assertEquals("$id longLabel 引用不对", "@string/" + refs[1], longLabel)
            for (ref in refs) {
                val value = strings[ref.removePrefix("@string/")]
                assertTrue("strings.xml 缺 $ref（快捷方式文案未定义）", !value.isNullOrEmpty())
            }
        }
        // 旧「小记」文案零变化。
        assertEquals("新建小记", strings["shortcut_quick_note_short"])
        assertEquals("新建小记", strings["shortcut_quick_note_long"])
    }

    @Test
    fun manifestQuickNoteFilterHasNoPathSoQueryDeepLinksStillMatch() {
        val root = parse(sourceFile("src/main/AndroidManifest.xml"))
        val dataNodes = childrenByTag(root, "data")
            .filter { it.getAttribute("android:scheme") == "lakexlocalnotes" && it.getAttribute("android:host") == "quick-note" }
        assertEquals("AndroidManifest 应只有一处 lakexlocalnotes://quick-note 的 intent-filter data", 1, dataNodes.size)
        val data = dataNodes[0]
        // 只声明 scheme+host：Android 匹配忽略 query；一旦写了 path，带 ?src= 的两条深链就匹配不上。
        assertEquals("filter 不许写 path（会拦掉 ?src=camera / ?src=clipboard）", "", data.getAttribute("android:path"))
        assertEquals("", data.getAttribute("android:pathPrefix"))
        assertEquals("", data.getAttribute("android:pathPattern"))
    }
}
