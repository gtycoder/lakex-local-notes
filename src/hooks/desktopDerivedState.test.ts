import { describe, expect, it, vi } from "vitest";

// deriveDesktopView 运行时 import 了编辑器/大纲重模块（会拉入 Lake vendor bundle，node 环境无 DOM）。
// 本测试只验证 tabInfos 投影，先在这些边界处 stub 掉，避免加载内核。
vi.mock("../features/editor/EditorTab", () => ({ clearScrollMemory: () => {} }));
vi.mock("../features/editor/lakeRuntime", () => ({ resolveScrollNode: () => ({}) }));
vi.mock("../features/outline/registry", () => ({ getOutlineTab: () => null }));

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
  it("kind=sheet 必须原样带出（否则表格被当成 Lake 文档渲染）", () => {
    const { tabInfos } = deriveDesktopView(input([
      { noteId: "s1", title: "无标题表格", content: "{}", dirty: false, lastAccessedAt: 0, kind: "sheet" },
      { noteId: "d1", title: "文档", content: "", dirty: false, lastAccessedAt: 0, kind: "doc" },
      { noteId: "b1", title: "多维表", content: "{}", dirty: false, lastAccessedAt: 0, kind: "bitable" },
    ]));
    expect(tabInfos.map((t) => t.kind)).toEqual(["sheet", "doc", "bitable"]);
  });

  it("kind 缺省时归一为 doc（旧标签无类型字段）", () => {
    const { tabInfos } = deriveDesktopView(input([
      { noteId: "d1", title: "文档", content: "", dirty: false, lastAccessedAt: 0 },
    ]));
    expect(tabInfos[0].kind).toBe("doc");
  });
});
