package com.lakexlocalnotes.android

import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * 「拍照变相册」两条根因的回归钉（261118）：
 *  ① file_paths.xml 必须覆盖 Capacitor capture 临时照片目录（external-files/Pictures）与本插件落盘目录（files/camera）——
 *     缺任一 ⇒ FileProvider.getUriForFile 抛「未配置根」⇒ capture 静默退化成相册；
 *  ② AndroidManifest 必须有 <queries> 声明 IMAGE_CAPTURE —— Android 11+ 包可见性下没有它，
 *     resolveActivity(IMAGE_CAPTURE) 恒 null ⇒ Capacitor 的 capture 分支直接放弃（同样是退化成相册）。
 * 任一条被谁改回去，这里当场红。
 */
class CameraCaptureConfigTest {
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

    @Test
    fun filePathsCoversCameraOutputs() {
        val root = parse(sourceFile("src/main/res/xml/file_paths.xml"))
        val filesPaths = childrenByTag(root, "files-path").map { it.getAttribute("path") }
        val externalPaths = childrenByTag(root, "external-files-path").map { it.getAttribute("path") }
        // ① CameraCapturePlugin 落盘目录（filesDir/camera/）。
        assertTrue("file_paths.xml 缺 files-path camera/（拍照直出会失败）", filesPaths.contains("camera/"))
        // ① Capacitor WebView 自带 capture 分支的临时照片目录（getExternalFilesDir(Pictures)）。
        assertTrue("file_paths.xml 缺 external-files-path Pictures/（capture 会退化成相册）", externalPaths.contains("Pictures/"))
    }

    @Test
    fun manifestDeclaresCameraVisibility() {
        val root = parse(sourceFile("src/main/AndroidManifest.xml"))
        val queries = childrenByTag(root, "queries")
        assertTrue("AndroidManifest 缺 <queries>（Android 11+ 相机不可见 ⇒ capture 退化成相册）", queries.isNotEmpty())
        val actions = queries.flatMap { childrenByTag(it, "action") }.map { it.getAttribute("android:name") }
        assertTrue("AndroidManifest <queries> 未声明 IMAGE_CAPTURE", actions.contains("android.media.action.IMAGE_CAPTURE"))
    }
}
