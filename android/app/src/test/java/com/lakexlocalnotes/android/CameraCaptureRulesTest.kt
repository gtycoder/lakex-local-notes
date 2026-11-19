package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

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

    /** 单飞（261119 P2-3）：在途拍摄期间第二次 claim 必须失败（调用方 reject("busy")），防双击互相覆盖/泄漏临时照片。 */
    @Test
    fun photoSlotIsSingleFlight() {
        val slot = CameraCaptureRules.PhotoSlot()
        val first = File("camera/camera_1_0001.jpg")
        val second = File("camera/camera_2_0002.jpg")
        assertTrue(slot.claim(first))
        assertTrue(slot.busy)
        // 双击第二次拍摄：占位失败 ⇒ reject("busy")，不覆盖在途照片。
        assertFalse(slot.claim(second))
        // 完成 / 取消 / 失败都走 release：交回在途照片、释放槽位；重复释放幂等。
        assertEquals(first, slot.release())
        assertFalse(slot.busy)
        assertNull(slot.release())
        // 释放后可再次拍摄。
        assertTrue(slot.claim(second))
    }
}
