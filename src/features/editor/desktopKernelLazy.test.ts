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
const QUICK_NOTES = read("../../components/app/QuickNoteComposer.tsx");
// 261109 AI 写作：答案的内核只读渲染（Markdown → viewer）同样必须 lazy。
const AI_MESSAGE = read("../aiWriting/AiMessageView.tsx");
const AI_VIEWER = read("../aiWriting/AiAnswerViewer.tsx");
const AI_WORKSPACE = read("../aiWriting/AiWritingWorkspace.tsx");
// 261112 R2 S6：意图预取（hover/pointerdown）随 TreeRowFace 搬到 ./sidebar/ ⇒ 聚合读。
const SIDEBAR = read("../../components/app/Sidebar.tsx")
  + "\n" + read("../../components/app/sidebar/TreeRowFace.tsx")
  + "\n" + read("../../components/app/sidebar/TreeRow.tsx");
const SEARCH_PANEL = read("../../components/app/SearchPanel.tsx");

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

  it("AI 写作：答案 viewer 只能 lazy 进入，工作区/消息组件不得静态 import 内核", () => {
    expect(AI_MESSAGE.includes("import { AiAnswerViewer } from")).toBe(false);
    expect(AI_MESSAGE).toContain('lazy(() => import("./AiAnswerViewer")');
    // viewer 自己是边界内部：静态 import 内核是允许且必要的（只能被 lazy chunk 加载）。
    expect(AI_VIEWER).toContain('from "../editor/lakeRuntime"');
    expect(AI_WORKSPACE).not.toContain('from "../editor/lakeRuntime"');
    expect(AI_WORKSPACE).not.toContain("import { AiAnswerViewer }");
  });

  it("kernelPrefetch：与 lazy 目标同一模块、空闲回调 + 立即预取两个入口、失败静默", () => {
    expect(PREFETCH).toContain('import("./EditorTab")');
    expect(PREFETCH).toContain("requestIdleCallback");
    expect(PREFETCH).toContain("export function prefetchEditorKernelNow");
    expect(PREFETCH).toContain(".catch(");
    // 261111：空闲兜底不再等 3s（首帧后最早空闲），并且 Now 与兜底共享同一幂等 flag。
    expect(PREFETCH).not.toContain("3000");
    expect(PREFETCH).toContain("clearTimeout");
  });

  it("261111 冷启动预热：恢复标签 / 冷启动首篇 / 安全模式判据 / 目录与搜索结果意图都触发立即预取", () => {
    expect(APP).toContain("prefetchEditorKernelNow");
    expect(APP).toMatch(/if \(safeModeStatus === "inactive"\) prefetchEditorKernelNow\(\);/);
    const BOOTSTRAP = read("../../hooks/useBootstrap.ts");
    expect(BOOTSTRAP).toContain("prefetchEditorKernelNow");
    // 恢复标签计划确定后、冷启动落点确定后各一次（都在真正的正文读取/挂载之前）。
    expect(BOOTSTRAP.match(/prefetchEditorKernelNow\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(SIDEBAR).toContain("prefetchEditorKernelNow");
    expect(SIDEBAR).toMatch(/onMouseEnter=\{props\.node\.nodeType === "note" \? prefetchEditorKernelNow : undefined\}/);
    expect(SEARCH_PANEL).toContain("prefetchEditorKernelNow");
    // 仍然守住静态边界：任何一处都不得把 EditorTab/lakeRuntime 改成静态 import。
    for (const src of [APP, BOOTSTRAP, SIDEBAR, SEARCH_PANEL]) {
      expect(src.includes("import { EditorTab }")).toBe(false);
      expect(src).not.toMatch(/from "[^"]*lakeRuntime"/);
    }
  });
});
