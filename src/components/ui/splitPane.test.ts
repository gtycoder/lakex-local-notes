import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SplitPane.tsx", import.meta.url), "utf8");
const HANDLE = readFileSync(new URL("./SplitHandle.tsx", import.meta.url), "utf8");
const KIT = readFileSync(new URL("../../styles/kit.css", import.meta.url), "utf8");
const MISC = readFileSync(new URL("../../styles/app/misc.css", import.meta.url), "utf8");
const PANELS = readFileSync(new URL("../../styles/app/panels.css", import.meta.url), "utf8");
const SIDEBAR = readFileSync(new URL("../app/Sidebar.tsx", import.meta.url), "utf8");
const TRASH = readFileSync(new URL("../app/TrashPanel.tsx", import.meta.url), "utf8");
const HISTORY = readFileSync(new URL("../app/HistoryPanel.tsx", import.meta.url), "utf8");
const ASSETS = readFileSync(new URL("../app/AssetsBrowser.tsx", import.meta.url), "utf8");
const MULTITAB = readFileSync(new URL("../../features/editor/MultiTabEditor.tsx", import.meta.url), "utf8");
const OUTLINE = readFileSync(new URL("../../features/outline/OutlineSidebar.tsx", import.meta.url), "utf8");
const SPLITVIEW = readFileSync(new URL("../../features/editor/splitView.css", import.meta.url), "utf8");

/**
 * 左右分栏（可拖动）结构护栏（用户 261006：回收站 / 历史版本 / 资源 三处都要能左右拖；261008 文档分屏复用）。
 * 判定只看"是不是同一套实现 + 关键行为在不在"，真实拖拽由真机 CDP 验收覆盖。
 */
describe("左右分栏（可拖动）", () => {
  it("三处左右结构共用同一个 SplitPane，不再各写一套", () => {
    const sites: Array<[string, string]> = [[TRASH, "trash"], [HISTORY, "history"], [ASSETS, "resources"]];
    for (const [site, key] of sites) {
      expect(site).toContain("<SplitPane");
      expect(site).toContain(`storageKey="${key}"`);
      expect(site).toContain("ariaLabel=");
      expect(site).toContain("minRight=");
    }
  });

  it("交互只有一处实现：SplitPane 与文档分屏都走 SplitHandle，视觉用 kit 的 .ln-split-handle", () => {
    expect(KIT).toContain(".ln-split-handle {");
    expect(KIT).toContain(".ln-split-handle::before {");   // 命中带
    expect(KIT).toContain(".ln-split-handle::after {");    // 药丸
    expect(HANDLE).toContain("ln-split-handle ${className}"); // 基础视觉类 + 站点定位类
    expect(HANDLE).toContain('role="separator"');
    expect(SRC).toContain("<SplitHandle");
    expect(SRC).not.toContain('className="ln-split-handle"');   // SplitPane 不再自己写一份
    expect(MULTITAB).toContain("<SplitHandle");                   // 文档分屏复用同一实现
    expect(SIDEBAR).toContain('className="sidebar-resize-handle desktop-only"'); // 只叠加侧栏定位类
    // 侧栏那份旧实现里不该再留光标/药丸（已并入 kit 唯一实现），只留它自己的定位
    expect(MISC).not.toContain("cursor: col-resize");
    expect(MISC).not.toContain(".sidebar-resize-handle::after");   // 药丸已搬走
    expect(MISC).toContain(".sidebar-resize-handle {");
  });

  it("宽度设备本地、默认走 CSS（没拖过不写内联变量）、键盘与双击复位齐全", () => {
    expect(SRC).toContain("local-lakex-notes-v3.split.");
    expect(SRC).toContain("localStorage.removeItem");
    expect(HANDLE).toContain("onDoubleClick={() => onCommit(null)}");
    expect(HANDLE).toContain('"ArrowLeft"');
    expect(HANDLE).toContain('"ArrowRight"');
    expect(SRC).toContain("ResizeObserver");              // 容器变窄时夹回合法区间
    expect(PANELS).toContain("flex: 0 0 var(--split-left, 320px)");
    expect(PANELS).toContain(".history-split > .ln-split-handle { position: relative; flex: 0 0 0; width: 0; }");
  });

  it("分屏两栏之间有常驻 1px 发丝线，且画在右栏盒子上（261022 用户点单）", () => {
    // 画在右栏 border-left：子元素都排在 border 右侧 ⇒ 不会被内核 sticky 工具条（z150 白底）盖断
    expect(SPLITVIEW).toMatch(/\[data-pane="right"\] \{[^}]*border-left: 1px solid var\(--lake-border-1\);[^}]*\}/);
    // 别画在手柄上（会在工具条那一行断开）；侧栏/大纲的把手共用 kit 原语，也不画线
    expect(SPLITVIEW).not.toMatch(/\.ln-split-handle \{[^}]*border-left/);
    expect(KIT).not.toMatch(/\.ln-split-handle \{[\s\S]*border-left/);
  });

  it("破坏性按钮只有一种长相：.ft__error 自带透明底（漏写 --outline 也不再是实心块）", () => {
    expect(KIT).toContain(".ln-btn--danger-text { color: var(--lake-status-error); }");
  });

  it("拖拽有 4px 微抖死区，且只按下不移动不落盘（261017 B）", () => {
    expect(HANDLE).toContain("export const DRAG_DEAD_PX = 4;");
    expect(HANDLE).toContain("export function nextSplitDrag");
    expect(HANDLE).toContain("if (!step.engaged) return;");
    expect(HANDLE).toContain("if (drag?.engaged) onCommit(drag.current);");
  });

  it("资料库侧栏 / 大纲栏的 resize 也走 SplitHandle，不再各写一套 pointer 实现（261022 D1）", () => {
    expect(SIDEBAR).toContain("<SplitHandle");
    expect(OUTLINE).toContain("<SplitHandle");
    // 视觉基线仍来自 kit，站点只叠加自己的定位类（CSS 不动）
    expect(SIDEBAR).toContain('className="sidebar-resize-handle desktop-only"');
    expect(OUTLINE).toContain('className="outline-sidebar__resize-handle"');
    // 第二套 pointer resize 痕迹必须消失
    for (const site of [SIDEBAR, OUTLINE]) {
      expect(site).not.toContain("handleResizePointerDown");
      expect(site).not.toContain("handleResizePointerMove");
      expect(site).not.toContain("handleResizeKeyDown");
      expect(site).not.toContain("finishResize");
      expect(site).not.toContain("resizeRef");
      expect(site).not.toContain("setPointerCapture");
      expect(site).not.toContain("releasePointerCapture");
    }
    // 两边差异全部用可选 props 表达，不复制交互
    expect(SIDEBAR).toContain("softClamp={softClampWidth}");
    expect(SIDEBAR).toContain("keyStep={8}");
    expect(SIDEBAR).toContain("keyStepLarge={24}");
    expect(SIDEBAR).toContain("SIDEBAR_DEFAULT_WIDTH");
    expect(OUTLINE).toContain("invert");
    expect(OUTLINE).toContain("stopPropagation");
    expect(OUTLINE).toContain("softClamp={softClampWidth}");
    expect(OUTLINE).toContain("OUTLINE_SIDEBAR_DEFAULT_WIDTH");
    expect(OUTLINE).toContain("onDragEnd={handleSplitDragEnd}");
    // 橡皮筋与方向都收口在唯一原语里
    expect(HANDLE).toContain("export function rubberBandWidth");
    expect(HANDLE).toContain("invert = false");
  });
});
