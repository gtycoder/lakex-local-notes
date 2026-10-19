/**
 * 内核预热（261010）：**空闲时创建并立刻销毁**一个内核实例，把内核的模块级初始化（插件注册/单例/图标表）点燃。
 *
 * 依据（实测，AVD `lake_mobile`）：同一张「小记未展开卡片」——
 *   · **内核未加载**时开：334–928ms（打开文档 366–427ms）
 *   · **内核已就绪**时开：**62–73ms**（与纯 textarea 的 65–88ms 同量级）
 *   · 内核 chunk 的加载/求值只占 **27ms** ⇒ 贵的不是"下载 chunk"，而是**首次实例化**。
 * 所以这里只做"点燃一次"，不预取 chunk。
 *
 * **只点燃、不保留实例**：不引入实例池/移交 —— 内核有模块级单例，跨实例移交容易串台（AGENTS §7「模块级单例」）。
 * 释放走 `destroyLakeEditor`（它才会清 `__disposeExtras` / `__disposeBookmarkDegrade`，只调 `editor.destroy()` 不够）。
 * 失败一律吞掉：预热只是优化，绝不能影响功能。
 */
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import { loadQuickNoteComposer } from "../home/quickNoteComposerLazy";

/** 会话内只排一次（多次挂载/重渲不重复点火）。 */
let scheduled = false;

export function scheduleKernelPrewarm(): void {
  if (scheduled) return;
  scheduled = true;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  /**
   * 261014 实测（AVD）：内核预览改成懒加载后，入口不再预载内核 ⇒ 这里"点燃"要**现拉 6.1MB + 内核样式 + dock 分包 + 实例化**，
   * 是一个 **1695ms** 的长任务（A/B 验证：把 requestIdleCallback 变空 ⇒ 长任务完全消失、首页 798ms）。
   * 而 `requestIdleCallback(cb, {timeout})` 的 timeout 只是**上限** —— 主线程一空它就马上回调，
   * 实测仍是"就绪后 ~2.4s"砸下来，正好在用户刚开始用的那几秒。
   * ⇒ 先**延迟 4s**（让首屏 + 首批交互彻底干净），再排进第一段空闲；真开文档时该付的加载成本照付（与不预热时一致）。
   * 想彻底关掉预热就删掉这个排期 —— 代价 = 首次开文档/小记多花"内核分包加载 + 实例化"那一段。
   */
  const start = () => { if (typeof ric === "function") ric(() => { void runPrewarm(); }, { timeout: 2000 }); else void runPrewarm(); };
  window.setTimeout(start, 4000);
}

/** 仅供测试/调试：重置排期闩。 */
export function resetKernelPrewarmForTest(): void { scheduled = false; }

/**
 * 小记编辑器分包**提前预取**（261019）：只 `import`、不实例化内核。
 * 冷启动后用户很快点「编辑小记」/「新建小记」时，QuickNoteComposer 的懒加载兜底（"正在加载编辑器…"）
 * 就是这里在现拉分包；提前在首屏空闲时把分包（含内核 chunk 与内核样式）拉好，打开时只剩实例化那一段。
 * 与内核预热分开排期：预热仍延到 4s（实例化贵、会抢首屏），这里就绪后直接排空闲（纯拉取/求值，实测约几十 ms）。
 */
let composerScheduled = false;

export function scheduleComposerPrewarm(): void {
  if (composerScheduled) return;
  composerScheduled = true;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  const start = (): void => {
    if (typeof ric === "function") ric(() => { void loadQuickNoteComposer().catch(() => undefined); }, { timeout: 1500 });
    else void loadQuickNoteComposer().catch(() => undefined);
  };
  // 就绪 effect 本身在首屏绘制之后才跑；分包只"拉取+求值"（实测 ~30ms），直接排空闲即可。
  // 内核预热（要实例化，贵）仍是 4s 后的独立排期，不合并。
  start();
}

/** 仅供测试/调试：重置小记分包预取排期闩。 */
export function resetComposerPrewarmForTest(): void { composerScheduled = false; }

export async function runKernelPrewarmNow(): Promise<"ok" | "failed"> {
  let mount: HTMLElement | null = null;
  try {
    // ① 预取 capture 用到的懒加载分包（**实测打开时还在现拉**：QuickNoteComposer.js 4ms / style.js 4ms /
    //    style.css 16ms / 字体 4ms ⇒ 这一段在关键路径上）。只 import 模块、不建实例。
    void loadQuickNoteComposer().catch(() => undefined);
    const { createLakeDocument, destroyLakeEditor } = await import("../../features/editor/lakeRuntime");
    mount = document.createElement("div");
    mount.setAttribute("aria-hidden", "true");
    mount.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:200px;visibility:hidden;pointer-events:none";
    document.body.appendChild(mount);
    const editor = createLakeDocument(mount, "editor", () => { /* prewarm：不需要回调 */ }, false, "kernel-prewarm");
    editor.setDocument("text/lake", emptyLakeBody("kernel-prewarm"));
    destroyLakeEditor(editor);
    return "ok";
  } catch {
    return "failed";
  } finally {
    try { mount?.remove(); } catch { /* ignore */ }
  }
}

async function runPrewarm(): Promise<void> {
  await runKernelPrewarmNow();
}