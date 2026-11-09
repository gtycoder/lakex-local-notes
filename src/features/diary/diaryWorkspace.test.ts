import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 日记空间（桌面片B）的**接线护栏**：数据/判据在 core+主进程（其他片），这里钉渲染层六件事：
 * ① 空间注册：DesktopWorkspace 联合类型 + 顶栏空间菜单（日记 ⌘4）；
 * ② App：lazy 挂载 DiaryWorkspace、keep-alive 分区、shell class；
 * ③ 文档空间目录树过滤：Sidebar 收到的是 `documentTreeWithoutDiary(treeNodes)`，不是原始树；
 * ④ 左栏分组**只来自 core**：组件调 `groupDiaryEntries`，不得自己算年/月；
 * ⑤ 主区复用现有 EditorTab（且只能 lazy 进来，不破 P12 内核边界）；
 * ⑥ 打开某天只经 IPC 端口 `diary_open_date`（渲染层不自己建文档）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const APP = read("../../App.tsx");
const TYPES = read("../../desktop/desktopTypes.ts");
const TOPBAR = read("../../desktop/DesktopTopBar.tsx");
const WORKSPACE = read("./DiaryWorkspace.tsx");
const OPEN = read("./diaryOpen.ts");
const TREE = read("./diaryTree.ts");
const CHROME = read("../../styles/chrome.css");

describe("日记空间接线", () => {
  it("① 空间注册：类型联合 + 顶栏空间菜单（日记 / ⌘4 / NotebookPen）", () => {
    expect(TYPES).toContain('"diary"');
    expect(TOPBAR).toContain('diary: { label: "日记", Icon: NotebookPen }');
    expect(TOPBAR).toContain('{ id: "diary", label: "日记", Icon: NotebookPen, hint: "⌘4" }');
    expect(TOPBAR).toContain("NotebookPen");
  });

  it("② App：lazy 挂载 + keep-alive 分区 + shell class + ⌘4", () => {
    expect(APP).toContain('lazy(() => import("./features/diary/DiaryWorkspace")');
    // 必须是模板插值（少了 `$` 会变成 className 里的字面量文本，类名永远不生效）
    const shellLine = APP.split("\n").find((line) => line.includes('diary-space-active" : ""')) ?? "";
    expect(shellLine).toContain('${desktopWorkspace === "diary" ? "diary-space-active" : ""}');
    expect(APP).toContain('(desktopWorkspace === "diary" ? "" : " workspace-view--hidden")');
    expect(APP).toContain('workspace="diary"');
    expect(APP).toContain("<DiaryWorkspace");
    // ⌘4 绑定（与 ⌘1/⌘2 同判据：meta/ctrl + 无 alt/shift）
    expect(APP).toMatch(/event\.key !== "4"/);
    expect(APP).toContain('switchDesktopWorkspace("diary")');
  });

  it("②b shell：进入日记空间隐藏左侧目录栏与状态栏（与标签/回收站同口径）", () => {
    expect(CHROME).toContain(".app-shell.diary-space-active .sidebar { display: none; }");
    expect(CHROME).toContain(".app-shell.diary-space-active .statusbar { display: none; }");
    expect(CHROME).toMatch(/\.app-shell\.diary-space-active \{[\s\S]{0,180}grid-template-columns: var\(--activity-rail-width\) 0 minmax\(0, 1fr\);/);
  });

  it("③ 文档空间目录树过滤：Sidebar/小记转正选择器收到过滤后的树（不显示日记本）", () => {
    expect(APP).toContain("documentTreeWithoutDiary(treeNodes)");
    expect(APP).toContain("<Sidebar nodes={sidebarTreeNodes}");
    expect(APP).toContain("notebooks={sidebarTreeNodes}");
    // 过滤只在渲染层：组件适配层调 core 的 withoutDiaryNotebook，不碰存储
    expect(TREE).toContain("withoutDiaryNotebook");
    expect(TREE).toContain("diaryEntries");
    expect(TREE).toContain("diaryNotebooks");
  });

  it("③b 搜索收窄判据已备好（纯函数，未来 SearchPanel 接 scope 时直接用）", () => {
    const SEARCH = read("./diarySearch.ts");
    // 目标集合来自 core 的日记条目（文档 id），不在搜索侧另算
    expect(SEARCH).toContain("diaryDocumentIds");
    expect(APP).toContain("diaryEntryIds(treeNodes)");
    // 判据是"拿集合做成员判断"，不是再解析日期/标题
    expect(SEARCH).toContain("diaryDocumentIds.has(hit.id)");
    expect(SEARCH).not.toContain("parseDiaryDateKey");
  });

  it("④ 左栏分组只来自 core：调 groupDiaryEntries，组件里不得重算年/月", () => {
    expect(WORKSPACE).toContain("groupDiaryEntries(entries)");
    expect(WORKSPACE).toContain("diaryEntryViews(treeNodes)");
    // 反例：组件里出现任何日期换算/分桶 ⇒ 分组判据就有第二套来源
    expect(WORKSPACE).not.toContain("getFullYear");
    expect(WORKSPACE).not.toContain("getMonth");
    expect(WORKSPACE).not.toContain("diaryGroupTitles");
    expect(WORKSPACE).not.toContain("MONTH_TITLE_PATTERN");
  });

  it("⑤ 主区复用现有 EditorTab，且只能 lazy 进入（P12 内核边界）", () => {
    expect(WORKSPACE).toContain('lazy(() => import("../editor/EditorTab")');
    expect(WORKSPACE).not.toContain('import { EditorTab } from');
    expect(WORKSPACE).toContain("<EditorTab");
    // 不新写编辑器：组件里没有 contenteditable / createLakeDocument
    expect(WORKSPACE).not.toContain("contentEditable");
    expect(WORKSPACE).not.toContain("createLakeDocument");
  });

  it("⑥ 打开某天只经 `diary_open_date` 端口；渲染层不自己建文档/建笔记本", () => {
    expect(OPEN).toContain("diaryOpenDate");
    expect(OPEN).toContain("diary_open_date");
    expect(OPEN).toContain("parseDiaryDateKey");
    expect(APP).toContain("requestDiaryOpenDate(todayKey)");
    expect(APP).toContain("planDiaryOpen(treeNodes, todayKey)");
    // 渲染层不得直接调建树 IPC 来"顺便"建日记（ensure 在主进程单事务里）
    expect(APP).not.toMatch(/requestDiaryOpenDate[\s\S]{0,200}createNoteIn/);
    expect(WORKSPACE).not.toContain("native.");
  });

  it("样式只用令牌：无颜色/字号字面量、无 !important、无内联 style", () => {
    // 与 scripts/ui-metrics.mjs 同口径：先剥块注释（注释里提到 !important / #hex 不算声明）。
    const css = read("./diary.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/font-size\s*:\s*[0-9.]+px/);
    expect(css).not.toContain("!important");
    expect(WORKSPACE).not.toContain("style={{");
  });
});
