package com.lakexlocalnotes.android

import java.io.File

/**
 * 相机直出（261118）的纯规则（照 RemoteAssetRules.kt 先例：可 JVM 单测，IO/Intent 留在 CameraCapturePlugin）。
 *
 * 背景：「拍照」入口原来走 WebView `<input type=file capture>`，Capacitor 的文件选择器在两条线上会把 capture
 * 吞掉并静默退化成系统相册（详见 CameraCapturePlugin 头注释）。自写相机插件后，落盘命名 / 空文件判定 /
 * 回传路径格式收在这里，保证 JVM 可测、与 JS 侧（src/mobile/native/cameraCapture.ts）的读取口径一致。
 */
internal object CameraCaptureRules {
    const val MIME_JPEG = "image/jpeg"
    /** 临时照片子目录（filesDir/camera/；FileProvider 根见 res/xml/file_paths.xml 的 "camera"）。 */
    const val DIR = "camera"

    /** 临时照片命名（与 RemoteAssetRules.assetFilename 同风格：时间戳 + 4 位 hex，便于并存与排障）。 */
    fun photoFileName(nowMs: Long, randomHex4: String): String = "camera_" + nowMs + "_" + randomHex4 + ".jpg"

    fun randomHex4(): String = String.format("%04x", (0..0xFFFF).random())

    /** JS 侧读取用的相对路径（Capacitor Filesystem Directory.Data = filesDir）。 */
    fun relativePath(fileName: String): String = DIR + "/" + fileName

    /**
     * 相机回调是否带回**可用**照片：
     * - RESULT_OK 但 0 字节 = 部分 OEM 相机没写 EXTRA_OUTPUT（会再兜一次 getData()，仍空则当失败）；
     * - 非 RESULT_OK（用户取消）无论文件多大都算取消，绝不把半成品回传给 JS 插入。
     */
    fun isUsablePhoto(resultOk: Boolean, fileLength: Long): Boolean = resultOk && fileLength > 0

    /**
     * 拍摄槽位（单飞，261119 P2-3）：同一时刻只允许一个在途拍摄。
     * claim 成功才许起相机；已有在途 ⇒ false（调用方 reject("busy")，最简口径、不排队）。
     * 背景：双击拍照曾互相覆盖 pendingPhoto —— 第一次的照片文件泄漏 filesDir/camera/、两次回调串照片。
     */
    class PhotoSlot {
        private var pending: File? = null

        val busy: Boolean get() = pending != null

        /** 占位：空槽才成功并记下在途照片；已有在途返回 false。 */
        fun claim(photo: File): Boolean {
            if (pending != null) return false
            pending = photo
            return true
        }

        /** 释放并交回在途照片（无在途返回 null）；完成 / 取消 / 失败都走这里，重复释放幂等。 */
        fun release(): File? {
            val photo = pending
            pending = null
            return photo
        }
    }
}
