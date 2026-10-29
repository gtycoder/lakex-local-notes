import { describe, expect, it } from "vitest";

// DT-14（261028）后 deriveDesktopView 是**纯计算**：不再 import EditorTab/lakeRuntime，也不读 DOM，
// 因此这里不再需要 stub 编辑器/大纲重模块 —— 本文件在 node 环境跑，本身就是「纯函数不碰 DOM」的护栏。
import { deriveDesktopView, type DesktopViewInput } from "./desktopDerivedState";

/**
 * 回归护栏（2026-09-18 用户报）：右键「新建表格」后打开的是 Lake 文档而不是表格。
 * 根因是 deriveDesktopView 把 openTabs 投影成 TabInfo 时漏掉 kind ⇒ MultiTabEditor 收不到
 * kind=sheet，用 EditorTab（Lake）渲染。此处锁死「kind 必须透传」。
 */
function input(openTabs: DesktopViewInput["openTabs"]): DesktopViewInput {
  return {
    activeNoteId: null,
    treeNodes: [],
    notes: [],
    openTabs,
    iconByNoteId: new Map(),
    fontSize: 14,
    showToolbar: true,
    floatingToolbar: true,
    tocEnabled: false,
    outlineEnhance: false,
    desktopWorkspace: "library",
    activeOutlineEmpty: true,
    outlineEmptyOverride: false,
    outlineMode: "collapsed",
    sidebarWidth: 224,
    sidebarMode: "docked",
    narrowOverlay: false,
    outlineSidebarWidth: 280,
  };
}

describe("deriveDesktopView — tabInfos 文档类型透传", () => {
  it("kind=usheet 必须原样带出（否则表格被当成 Lake 文档渲染）", () => {
    const { tabInfos } = deriveDesktopView(input([
      { noteId: "s1", title: "无标题表格", content: "{}", dirty: false, lastAccessedAt: 0, kind: "usheet" },
      { noteId: "d1", title: "文档", content: "", dirty: false, lastAccessedAt: 0, kind: "doc" },
      { noteId: "b1", title: "多维表", content: "{}", dirty: false, lastAccessedAt: 0, kind: "bitable" },
    ]));
    expect(tabInfos.map((t) => t.kind)).toEqual(["usheet", "doc", "bitable"]);
  });

  // 261023：正文文件缺失必须透传 —— 漏掉 ⇒ 缺正文文档会挂编辑器，又回到 ENOENT 报错提示。
  it("bodyMissing 必须原样带出（缺正文文档渲染专用面板）", () => {
    const { tabInfos } = deriveDesktopView(input([
      { noteId: "m1", title: "缺正文", content: "", dirty: false, lastAccessedAt: 0, bodyMissing: true },
      { noteId: "d1", title: "文档", content: "<p>x</p>", dirty: false, lastAccessedAt: 0 },
    ]));
    expect(tabInfos.map((t) => t.bodyMissing)).toEqual([true, undefined]);
  });

  it("kind 缺省时归一为 doc（旧标签无类型字段）", () => {
    const { tabInfos } = deriveDesktopView(input([
      { noteId: "d1", title: "文档", content: "", dirty: false, lastAccessedAt: 0 },
    ]));
    expect(tabInfos[0].kind).toBe("doc");
  });
});

/**
 * 260923 W6：大纲增强（`editor-outline-enhance`，默认 **false**）关闭时零占位护栏。
 * `App.tsx` 用 `outlineVisible` 决定是否挂载 `OutlineSidebar`（未挂载 ⇒ 无控制器/监听/计时器）；
 * `--lake-outline-inset` 是唯一会"占住编辑区右缘"的量，关闭时必须为 0。
 * 锁死：默认关闭 ⇒ 不挂载且不让位；开启 + 固定态 ⇒ 按面板宽让位。
 */
/**
 * 261028 DT-14：派生模块只出值。原先的「活动标签滚回顶部」（读 DOM + 改 scrollTop）自面包屑
 * 下沉进 EditorTab 后已无调用方，整段移除；这里锁死「不再把 DOM 副作用混进纯计算」。
 */
describe("deriveDesktopView — 纯计算（DT-14）", () => {
  it("不返回带 DOM 副作用的回顶闭包", () => {
    expect(deriveDesktopView(input([]))).not.toHaveProperty("scrollActiveEditorToTop");
  });
});

describe("deriveDesktopView — 大纲增强关闭时的零占位（260923 W6）", () => {
  const insetOf = (style: unknown) => (style as Record<string, string>)["--lake-outline-inset"];

  it("outlineEnhance=false ⇒ 不挂载大纲，且正文不让位", () => {
    const r = deriveDesktopView(input([]));
    expect(r.outlineVisible).toBe(false);
    expect(insetOf(r.shellStyle)).toBe("0px");
  });

  it("outlineEnhance=true + toc + 文档 + 固定态 ⇒ 挂载且按面板宽让位", () => {
    const r = deriveDesktopView({
      ...input([]), tocEnabled: true, outlineEnhance: true, activeOutlineEmpty: false, outlineMode: "docked",
    });
    expect(r.outlineVisible).toBe(true);
    expect(insetOf(r.shellStyle)).toBe("280px");
  });
});
