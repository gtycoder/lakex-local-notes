/**
 * P12 静态契约：桌面内核（Lake）只能从 lazy 边界进入，不得重新变成入口静态 import。
 *
 * 背景（P11-④ 实测）：内核 chunk ≈1.61MB gz / 6.0MB raw；5 个组件边界全 lazy 后桌面首屏图
 * 2.07MB → 0.22MB gz。只把 EditorTab 改 lazy 不够（内核会变成 modulepreload 仍在首屏）。
 * 本测试按源码文本钉边界（与 quickNoteKernelFallback.test.ts 同姿势）；真正的字节预算由
 * scripts/check-arch.mjs 的桌面首屏预算兜底。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

const MULTI_TAB = read("./MultiTabEditor.tsx");
const PREFETCH = read("./kernelPrefetch.ts");
const APP = read("../../App.tsx");
const OVERLAYS = read("../../desktop/DesktopOverlays.tsx");
const QUICK_NOTES = read("../../components/app/QuickNotesWorkspace.tsx");

describe("P12 桌面内核 lazy 边界（静态契约）", () => {
  it("MultiTabEditor：EditorTab 只能 lazy，不得静态 import", () => {
    expect(MULTI_TAB.includes("import { EditorTab } from")).toBe(false);
    expect(MULTI_TAB).toContain('lazy(() => import("./EditorTab")');
  });

  it("App：TrashPanel / NoteInfoDialog lazy，并在启动就绪 effect 里调用空闲预取", () => {
    expect(APP.includes("import { TrashPanel } from")).toBe(false);
    expect(APP.includes("import { NoteInfoDialog } from")).toBe(false);
    expect(APP).toContain('lazy(() => import("./components/app/TrashPanel")');
    expect(APP).toContain('lazy(() => import("./components/app/NoteInfoDialog")');
    expect(APP).toContain("prefetchEditorKernel()");
  });

  it("DesktopOverlays：TrashPanel / HistoryPanel lazy，且只在打开时挂载", () => {
    expect(OVERLAYS.includes("import { TrashPanel } from")).toBe(false);
    expect(OVERLAYS.includes("import { HistoryPanel } from")).toBe(false);
    expect(OVERLAYS).toContain('lazy(() => import("../components/app/TrashPanel")');
    expect(OVERLAYS).toContain('lazy(() => import("../components/app/HistoryPanel")');
    expect(OVERLAYS).toContain("trashOpen &&");
    expect(OVERLAYS).toContain("historyOpen &&");
  });

  it("QuickNotesWorkspace：QuickNoteEditor lazy（workspace 保持常驻以保住 quickNotesRef 语义）", () => {
    expect(QUICK_NOTES.includes("import { QuickNoteEditor,")).toBe(false);
    expect(QUICK_NOTES).toContain('lazy(() => import("../../features/quickNotes/QuickNoteEditor")');
  });

  it("kernelPrefetch：与 lazy 目标同一模块、空闲回调触发、失败静默", () => {
    expect(PREFETCH).toContain('import("./EditorTab")');
    expect(PREFETCH).toContain("requestIdleCallback");
    expect(PREFETCH).toContain(".catch(");
  });
});
