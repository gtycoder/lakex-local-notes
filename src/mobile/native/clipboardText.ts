/**
 * 读系统剪贴板的**最新一条文本**（「剪切板小记」快捷入口，261119）。
 *
 * - 原生 = 自有 ClipboardText 插件（Android ClipboardManager.primaryClip，只取文本项、不取图片/URI）；
 * - web 预览 = navigator.clipboard.readText（不可用/被拒一律返回空串）；
 * - 任何失败都不抛错：读不到只是「拿不到预填内容」，由调用方给「剪贴板没有文本」提示 + 空白写作卡。
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface ClipboardTextPluginApi {
  readText(): Promise<{ text: string | null }>;
}

const ClipboardText = registerPlugin<ClipboardTextPluginApi>("ClipboardText");

/** 读最新一条剪贴板文本；空/非文本/失败一律返回空串（不抛错）。 */
export async function readClipboardText(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return readWebClipboardText();
  try {
    const result = await ClipboardText.readText();
    return typeof result?.text === "string" ? result.text : "";
  } catch {
    return "";
  }
}

/** web 预览：navigator.clipboard 不可用/被拒 = 空串。 */
async function readWebClipboardText(): Promise<string> {
  try {
    const read = navigator.clipboard?.readText?.();
    if (!read) return "";
    return await read;
  } catch {
    return "";
  }
}
