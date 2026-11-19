/**
 * 「添加到桌面」固定快捷方式（Android：ShortcutManager.requestPinShortcut；见 PinShortcutPlugin.kt）。
 *
 * 261119 从 quickNoteShortcut.ts 拆出：这里只有**设置抽屉**（懒分包）在用，
 * 而 quickNoteShortcut.ts 被移动入口静态引入（首帧判 capture）—— 探测/发起不该跟着进 mobile-entry
 * 静态图（拆出的字节让给快捷方式三模式解析）。行为零变化：同一插件、同一返回形状。
 */
import { registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "./quickNoteShortcut";

/** 原生「固定到桌面」插件（Android：ShortcutManager.requestPinShortcut；见 PinShortcutPlugin.kt）。 */
interface PinShortcutPluginApi {
  isAvailable(): Promise<{ available: boolean }>;
  isPinned(): Promise<{ pinned: boolean }>;
  requestPin(): Promise<{ requested: boolean; reason?: string }>;
}
const PinShortcut = registerPlugin<PinShortcutPluginApi>("PinShortcut");

/**
 * 「添加到桌面」的能力探测（对齐思源）：
 * 部分机型/launcher 不支持固定快捷方式或不展示静态快捷方式 ⇒ 需要这个兜底入口。
 * 返回 `null` 表示当前平台没有原生桥（纯浏览器/桌面）。
 */
export async function probePinShortcut(): Promise<{ available: boolean; pinned: boolean } | null> {
  if (!isNativePlatform()) return null;
  try {
    const supported = await PinShortcut.isAvailable();
    if (!supported?.available) return { available: false, pinned: false };
    const pinned = await PinShortcut.isPinned();
    return { available: true, pinned: !!pinned?.pinned };
  } catch {
    return null;
  }
}

/** 发起固定（系统会弹确认框）；返回是否已发起。 */
export async function requestPinQuickNoteShortcut(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const result = await PinShortcut.requestPin();
    return !!result?.requested;
  } catch {
    return false;
  }
}
