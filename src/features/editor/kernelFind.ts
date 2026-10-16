/**
 * 桌面「文档内查找」入口 → 唤起**内核自带**的查找替换面板（261016，B2/A 批次实测）。
 *
 * 内核侧事实（vendor bundle + 隔离实例实测）：
 *  - 插件 search 的面板 = `.ne-ui-search-panel`（「查找 / 替换」两个页签、上一个/下一个、命中计数）；
 *    热键由同一个 descriptor 注册，本构建开了虚拟渲染 ⇒ **⌘F**（源码：virtualRendering ? ['cmd','F'] : ⇧⌘F）。
 *  - **只有真实按键能唤起它**：合成 KeyboardEvent（untrusted）实测无效；内核也没导出打开面板的 API
 *    （hotKey 插件未注册 service；`renderer._$services[]` 上的 triggerHotKey('openSearchPanel') 调用后无效果）。
 *  - 热键要求**编辑器自己持有焦点**：顶栏按钮点过之后焦点在按钮上，此时 ⌘F 无反应（实测）。
 * ⇒ 所以这里的顺序是：① 用内核自己的 focus 命令把焦点交还编辑器；② 让主进程注入一次 trusted ⌘F。
 */
import { native } from "../../lib/native";
import { activeEditorMount } from "./activeEditor";
import { editorInstanceAt } from "./editorRegistry";

/** 打开当前文档的内核查找面板；返回 false = 当前没有可用的文档编辑器实例。 */
export async function openKernelFindPanel(): Promise<boolean> {
  const editor = editorInstanceAt(activeEditorMount());
  if (!editor) return false;
  try { editor.execCommand?.("focus"); } catch { /* 内核未就绪：下面这次注入仍是安全 no-op */ }
  // ⚠️ 这里**不能用 requestAnimationFrame**：CDP 依附/隐藏窗口下 rAF 不触发（AGENTS §4 的坑），
  // 会让入口静默失效。focus 是同步生效的，让出一拍即可。
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  try {
    const result = await native.findInDocument();
    return result?.ok !== false;
  } catch {
    return false;
  }
}
