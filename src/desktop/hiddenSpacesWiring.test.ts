import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 桌面「空间关闭」接线护栏（261114 用户点单：仅日记 / AI 写作可关闭）。
 * 关闭 = 隐藏一级入口（菜单 + ⌘3/⌘4 + 默认空间选项），**数据保留**、可随时重新开启；
 * 知识库 / 小记 / 标签固定显示。判据/存储/订阅各自的纯函数与单测见 spaceVisibility / hiddenSpaces。
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const SHELL = read("./useDesktopShell.ts");
const TOPBAR = read("./DesktopTopBar.tsx");
const LIFECYCLE = read("../hooks/useDesktopLifecycle.ts");
const EDITOR_SECTION = read("../components/app/settings/sections/EditorSection.tsx");

describe("桌面空间关闭接线护栏", () => {
  it("空间菜单只过滤可关闭项（知识库/小记/标签恒显示）", () => {
    expect(TOPBAR).toContain("useHiddenDesktopSpaces()");
    expect(TOPBAR).toContain("!isDesktopHideableSpace(space.id) || isSpaceShown(space.id)");
  });

  it("启动落点/当前空间被关闭时都回落知识库；已关闭空间不可进入", () => {
    expect(SHELL).toContain("resolveVisibleSpace(loadDefaultSpace(), DESKTOP_PRIMARY_SPACES, hidden)");
    // 关闭只隐藏入口；内部跳转（搜索打开日记）仍可进入，因此 switch 本身不加阻断。
    expect(SHELL).toContain("isDesktopHideableSpace(current) && hiddenSpacesApi.hidden.includes(current)");
    expect(SHELL).toContain('void switchDesktopWorkspace("library")');
  });

  it("⌘1–5 对已关闭空间不响应（提示也不在菜单里出现）", () => {
    expect(LIFECYCLE).toContain("isDesktopHideableSpace(next) && getHiddenSpaces(");
    expect(LIFECYCLE).toContain("return;");
  });

  it("设置页提供两个开关，且默认空间下拉只列可见空间", () => {
    expect(EDITOR_SECTION).toContain('itemId="space-diary"');
    expect(EDITOR_SECTION).toContain('itemId="space-ai-writing"');
    expect(EDITOR_SECTION).toContain("visibleDefaultOptions");
    expect(EDITOR_SECTION).toContain("options={visibleDefaultOptions}");
    // 关闭当前默认空间 ⇒ 落点回知识库（不留下不可进入的默认空间）
    expect(EDITOR_SECTION).toContain("saveDefaultSpace(DEFAULT_SPACE)");
  });
});
