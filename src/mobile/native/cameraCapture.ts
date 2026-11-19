/**
 * 拍照（相机直出）→ 图片 File（261118）。
 *
 * 背景（真机实测：小米）：「拍照」入口原来走 `<input type=file accept="image/*" capture>`，但 WebView 的文件选择器
 * （Capacitor BridgeWebChromeClient）有两条会把 capture 吞掉的路（Android 11+ 包可见性无 <queries> ⇒
 * resolveActivity 恒 null；file_paths.xml 未覆盖其临时照片目录 ⇒ FileProvider.getUriForFile 抛「未配置根」），
 * 两者都落进「capture 起不来就退普通文件选择器」分支 ⇒ Android 13+ 即系统 Photo Picker/相册。
 * 根因修复在 android/（AndroidManifest <queries> + file_paths.xml，保住 <input capture> 降级路径），
 * 「拍照」入口本身进一步收口到**自写原生插件 CameraCapture**（ACTION_IMAGE_CAPTURE + FileProvider 落盘 → 回传路径）：
 * 拍完走与相册选图**同一条** insertFiles/资源上传链路；相机缺失/读取失败**显式提示**，绝不静默打开相册。
 *
 * web 预览（mobile-preview）无原生桥：**回退既有 file input 方案**（行为与修复前一致，保持现状）。
 *
 * 用法（入口四处：文档/小记 dock 的「拍照」、首页「拍摄」、AI 助手的「拍照」、快捷菜单「拍照小记」）：
 *   const file = await takeCameraPhoto();   // 用户取消/失败 ⇒ null（提示已由本模块给出）
 *   if (file) insertFiles([file]);          // 与相册选出的 File 完全同形
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { pickLocalFile } from "../ui/pickFile";
import { showToast } from "../ui/toastBus";

/** 原生回传（path 相对 filesDir = Capacitor Filesystem Directory.Data；见 CameraCaptureRules.relativePath）。 */
interface CameraCaptureResult {
  cancelled: boolean;
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

interface CameraCapturePluginApi {
  takePhoto(): Promise<CameraCaptureResult>;
}

const CameraCapture = registerPlugin<CameraCapturePluginApi>("CameraCapture");

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 调起系统相机拍一张，返回与相册选图同形的 File（走同一条 insertFiles/上传链路）。
 *
 * 语义（三种结局互不混淆）：
 * - **web 预览 / 无原生桥** ⇒ 回退既有 `pickLocalFile("image/*", "environment")`（隐藏 file input，保持现状）；
 * - **用户取消**（相机里按返回）⇒ null，**不回退任何选择器**（取消是明确意图，不许再弹相册）；
 * - **原生失败**（无相机应用/插件缺失/读字节失败）⇒ 显式 toast + null（拍照绝不静默打开相册）。
 */
export async function takeCameraPhoto(): Promise<File | null> {
  if (!Capacitor.isNativePlatform()) {
    return pickLocalFile("image/*", "environment");
  }
  let result: CameraCaptureResult;
  try {
    result = await CameraCapture.takePhoto();
  } catch {
    // 相机应用缺失 / 插件未实现（旧 APK）等：明说，让用户改走「图片」，绝不静默退化成相册。
    showToast("无法调起相机，可改用「图片」选择照片", { type: "error" });
    return null;
  }
  if (!result || result.cancelled || !result.path || !result.name) return null;
  try {
    const read = await Filesystem.readFile({ path: result.path, directory: Directory.Data });
    const base64 = typeof read.data === "string" ? read.data : "";
    const bytes = base64 ? base64ToBytes(base64) : new Uint8Array();
    if (bytes.length === 0) throw new Error("empty photo");
    // 读成功即消费临时文件（与 sharedContent 的消费语义一致；失败保留，便于设备侧排查）。
    void Filesystem.deleteFile({ path: result.path, directory: Directory.Data }).catch(() => undefined);
    return new File([bytes], result.name, { type: result.mimeType || "image/jpeg" });
  } catch {
    showToast("照片读取失败，请重拍或改用「图片」选择", { type: "error" });
    return null;
  }
}
