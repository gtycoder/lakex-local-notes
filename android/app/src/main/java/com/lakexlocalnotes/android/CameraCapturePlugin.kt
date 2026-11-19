package com.lakexlocalnotes.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * 拍照（相机直出）：ACTION_IMAGE_CAPTURE + FileProvider 落盘（filesDir/camera/）→ 回传路径，
 * JS 侧（src/mobile/native/cameraCapture.ts）读字节后走**与相册选图同一条** insertFiles/资源上传链路。
 *
 * 为什么不走 WebView `<input type=file capture>`（261118 真机：小米，「拍照」打开的是系统相册）——
 * Capacitor BridgeWebChromeClient.onShowFileChooser 的 capture 分支有两条会静默退化的路：
 *  ① Android 11+ 包可见性：无 <queries> 声明 IMAGE_CAPTURE ⇒ resolveActivity() 返回 null ⇒
 *     showImageCapturePicker 直接放弃（targetSdk 36 ⇒ 全部在网设备都命中）；
 *  ② file_paths.xml 未覆盖 external-files/Pictures（createImageFile 落盘点）⇒ FileProvider.getUriForFile
 *     抛「未配置根」⇒ 同样放弃；
 * 两者都落进「capture 起不来就退普通文件选择器」分支（logcat 指纹：FileChooser 标签下
 * "Media capture intent could not be launched. Falling back to default file picker."），而 Android 13+ 的
 * 普通选择器就是系统 Photo Picker（相册）。①② 已在本仓补上（AndroidManifest <queries> + file_paths.xml，
 * 保住 <input capture> 的降级路径），但「拍照」入口进一步收口到本插件：**拍照要么进相机、要么显式报错**，
 * 绝不静默打开相册。用户取消（返回键）回传 cancelled，不回退任何选择器。
 *
 * 不声明 CAMERA 权限：ACTION_IMAGE_CAPTURE 由系统相机应用完成拍摄，本应用只提供输出 URI，无需相机权限。
 */
@CapacitorPlugin(name = "CameraCapture")
class CameraCapturePlugin : Plugin() {
    /** 单飞：相机交互同一时刻只会有一个在途（JS 侧入口都是用户手势触发）。 */
    private var pendingPhoto: File? = null

    @PluginMethod
    fun takePhoto(call: PluginCall) {
        if (getActivity() == null) {
            call.reject("no activity")
            return
        }
        val dir = File(getContext().filesDir, CameraCaptureRules.DIR)
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("camera output dir unavailable")
            return
        }
        val photo = File(dir, CameraCaptureRules.photoFileName(System.currentTimeMillis(), CameraCaptureRules.randomHex4()))
        val uri: Uri = try {
            FileProvider.getUriForFile(getContext(), getContext().packageName + ".fileprovider", photo)
        } catch (e: Exception) {
            call.reject("file provider unavailable: " + e.message)
            return
        }
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        // 部分 OEM 相机（MIUI 等）只认 ClipData 传播的 URI 权限、不看 flags ⇒ 两边都带上。
        intent.clipData = ClipData.newRawUri("camera", uri)
        pendingPhoto = photo
        try {
            startActivityForResult(call, intent, "takePhotoResult")
        } catch (e: ActivityNotFoundException) {
            // 没有相机应用（模拟器无相机 / 精简 ROM）：显式报错，JS 提示改用「图片」，绝不静默开相册。
            pendingPhoto = null
            photo.delete()
            call.reject("camera unavailable")
        } catch (e: Exception) {
            pendingPhoto = null
            photo.delete()
            call.reject("camera launch failed: " + e.message)
        }
    }

    @ActivityCallback
    private fun takePhotoResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val photo = pendingPhoto
        pendingPhoto = null
        if (photo == null) {
            call.resolve(cancelled())
            return
        }
        val ok = result.resultCode == Activity.RESULT_OK
        // 少数 OEM 相机不写 EXTRA_OUTPUT、只在 getData() 回传 content:// —— 兜着收一份再判。
        if (ok && photo.length() <= 0L) {
            val data: Uri? = result.data?.data
            if (data != null) {
                try {
                    getContext().contentResolver.openInputStream(data)?.use { input ->
                        photo.outputStream().use { output -> input.copyTo(output) }
                    }
                } catch (_: Exception) {
                    // 兜底失败按「没有可用照片」处理（下面统一清理并回 cancelled）。
                }
            }
        }
        if (!CameraCaptureRules.isUsablePhoto(ok, photo.length())) {
            photo.delete()
            call.resolve(cancelled())
            return
        }
        val payload = JSObject()
        payload.put("cancelled", false)
        payload.put("path", CameraCaptureRules.relativePath(photo.name))
        payload.put("name", photo.name)
        payload.put("mimeType", CameraCaptureRules.MIME_JPEG)
        payload.put("size", photo.length())
        call.resolve(payload)
    }

    /** 用户取消/空白拍摄：回 cancelled，JS 不回退选择器（取消是明确意图，不再弹相册）。 */
    private fun cancelled(): JSObject = JSObject().put("cancelled", true)
}
