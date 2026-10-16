/**
 * 主动弹软键盘（原生插件 ShowKeyboard → Android InputMethodManager.showSoftInput）。
 *
 * 背景（261013 实测，AGENTS §7.28）：**WebView 里程序化 focus 不弹软键盘** —— Android 只允许用户手势触发；
 * 长按桌面图标走深链进「小记」写作卡时没有手势 ⇒ 焦点在、键盘不弹。页面路（点「新建小记」）有手势所以本来就正常。
 * 思源的闪念速记是原生 EditText 所以没这问题；这里用原生补上同一步。
 *
 * 只在需要的地方调（快捷 capture 的写作卡就绪且已自动聚焦之后）；非原生平台 / 插件缺失 / 系统拒绝一律**静默**：
 * 键盘没弹不该阻断输入。
 */
import { registerPlugin } from "@capacitor/core";

interface ShowKeyboardPluginApi {
  show(): Promise<void>;
}

const ShowKeyboard = registerPlugin<ShowKeyboardPluginApi>("ShowKeyboard");

/** 请求系统弹出软键盘（尽力而为，绝不抛）。 */
export function showNativeKeyboard(): void {
  try {
    void ShowKeyboard.show?.().catch(() => undefined);
  } catch {
    /* Web 预览 / vitest：没有原生插件 */
  }
}
