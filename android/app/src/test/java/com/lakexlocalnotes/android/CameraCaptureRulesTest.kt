package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 相机直出纯规则测试（261118）：命名 / 相对路径 / 可用照片判定。 */
class CameraCaptureRulesTest {
    @Test
    fun photoFileNameIsTimestampedJpeg() {
        assertEquals("camera_1700000000000_ab12.jpg", CameraCaptureRules.photoFileName(1700000000000L, "ab12"))
        assertEquals(4, CameraCaptureRules.randomHex4().length)
        assertTrue(CameraCaptureRules.photoFileName(1L, "0000").matches(Regex("camera_1_0000\\.jpg")))
    }

    @Test
    fun relativePathStaysUnderCameraDir() {
        assertEquals("camera/camera_1_ab12.jpg", CameraCaptureRules.relativePath("camera_1_ab12.jpg"))
    }

    @Test
    fun usablePhotoRequiresOkResultAndNonEmptyFile() {
        assertTrue(CameraCaptureRules.isUsablePhoto(true, 1))
        // RESULT_OK 但 0 字节 = OEM 相机没写 EXTRA_OUTPUT 也没给 getData()，当失败（不许回插空图）。
        assertFalse(CameraCaptureRules.isUsablePhoto(true, 0))
        // 用户取消：文件再大也不算（半成品绝不回传）。
        assertFalse(CameraCaptureRules.isUsablePhoto(false, 4096))
    }
}
