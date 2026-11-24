/**
 * 261117 D 项：OpenFile 插件（android/app/src/main/java/com/lakexlocalnotes/android/OpenFilePlugin.kt）的 JS 封装 —— 只用到「另存为到用户可见目录」。
 *
 * toDownloads = true ⇒ Android 10+ 直接写 MediaStore「下载」目录（文件管理器可见、卸载后仍在，
 * 不弹系统选择器）；低版本自动回退为 SAF 选择器（用户自选位置）。
 */
import { registerPlugin } from "@capacitor/core";

export interface SaveFileResult {
  ok: boolean;
  name?: string;
  /** 实际落盘字节（zip 压缩后大小；与导出前的累计字节不同）。 */
  bytes?: number;
  /** 用户可见位置：Android 10+ 为 "Download"；低版本 SAF 不返回（由系统面板决定）。 */
  dir?: string;
  error?: string;
}

interface OpenFileApi {
  saveAs(options: { path?: string; localKey?: string; name?: string; mime?: string; toDownloads?: boolean }): Promise<{ ok?: boolean; name?: string; dir?: string; bytes?: number }>;
}

const OpenFile = registerPlugin<OpenFileApi>("OpenFile");

export function isOpenFileNativeAvailable(): boolean {
  try {
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 把 App 私有目录里的文件保存到用户可见位置（便携包用 toDownloads=true；图片保存用 localKey + toDownloads=false = 进相册）。 */
export async function saveFileToUserVisible(options: {
  path?: string;
  /** 资产相对 key（note-assets/<id>/<file> / quick-notes/assets/<id>/<file>）：原生按 App 资产根解析直读。 */
  localKey?: string;
  name: string;
  mime: string;
  toDownloads: boolean;
}): Promise<SaveFileResult> {
  if (!isOpenFileNativeAvailable()) return { ok: false, error: "浏览器预览不支持保存文件，请在 Android 上操作" };
  try {
    const result = await OpenFile.saveAs(options);
    return { ok: result?.ok !== false, name: result?.name ?? options.name, dir: result?.dir, bytes: result?.bytes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error ?? "保存失败") };
  }
}