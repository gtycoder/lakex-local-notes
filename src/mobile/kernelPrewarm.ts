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
import { emptyLakeBody } from "../core/lakeDocForm.js";

/** 会话内只排一次（多次挂载/重渲不重复点火）。 */
let scheduled = false;

export function scheduleKernelPrewarm(): void {
  if (scheduled) return;
  scheduled = true;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(() => { void runPrewarm(); }, { timeout: 3000 });
  else window.setTimeout(() => { void runPrewarm(); }, 1500);
}

/** 仅供测试/调试：重置排期闩。 */
export function resetKernelPrewarmForTest(): void { scheduled = false; }

export async function runKernelPrewarmNow(): Promise<"ok" | "failed"> {
  let mount: HTMLElement | null = null;
  try {
    const { createLakeDocument, destroyLakeEditor } = await import("../features/editor/lakeRuntime");
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