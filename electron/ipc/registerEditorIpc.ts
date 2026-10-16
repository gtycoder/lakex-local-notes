import { BrowserWindow } from "electron";
import type { IpcRegistrar } from "./registrar.js";

/**
 * 编辑器相关的主进程动作（261016，B2「文档内查找」入口）。
 *
 * 为什么必须走主进程：内核「查找替换」面板**只能被真实按键唤起** ——
 * 实测（隔离实例 + CDP）：合成 KeyboardEvent（untrusted）无效；内核没有导出打开面板的 API
 * （hotKey 插件自身未注册 service，`renderer._$services[]` 上的 triggerHotKey('openSearchPanel')
 * 调用后无任何效果）。可用路径只有一条：让编辑器拿到焦点，再注入一次 trusted ⌘F/Ctrl+F，
 * 由内核自己的热键处理器打开 `.ne-ui-search-panel`（含「查找 / 替换」两个页签、上一个/下一个、计数）。
 */
export function registerEditorIpc(ipc: IpcRegistrar): void {
  ipc.handleEvent("find_in_document", (event) => {
    // 注意：本通道也会被 Web 客户端（webApiServer 的 HTTP 传输）调到这里，那条路径的 event 是 stub
    // ⇒ 不能假设 sender 一定是真实 WebContents，取窗口要带兜底。
    let win: BrowserWindow | null = null;
    try { win = BrowserWindow.fromWebContents(event.sender); } catch { win = null; }
    win = win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win || win.isDestroyed()) return { ok: false };
    const modifiers: Array<"meta" | "control"> = process.platform === "darwin" ? ["meta"] : ["control"];
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "F", modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "F", modifiers });
    return { ok: true };
  });
}
