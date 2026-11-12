import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 日记空间（桌面片B）的**接线护栏**：数据/判据在 core+主进程（其他片），这里钉渲染层六件事：
 * ① 空间注册：DesktopWorkspace 联合类型 + 顶栏空间菜单（日记 ⌘3）；
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
  it("① 空间注册：类型联合 + 顶栏空间菜单（日记 / ⌘3 / NotebookPen）", () => {
    expect(TYPES).toContain('"diary"');
    expect(TOPBAR).toContain('diary: { label: "日记", Icon: NotebookPen }');
    expect(TOPBAR).toContain('{ id: "diary", label: "日记", Icon: NotebookPen, hint: "⌘3" }');
    expect(TOPBAR).toContain("NotebookPen");
  });

  it("② App：lazy 挂载 + keep-alive 分区 + shell class；⌘1–5 快捷键收敛在 hook 一张表", () => {
    expect(APP).toContain('lazy(() => import("./features/diary/DiaryWorkspace")');
    // 必须是模板插值（少了 `$` 会变成 className 里的字面量文本，类名永远不生效）
    const shellLine = APP.split("\n").find((line) => line.includes('diary-space-active" : ""')) ?? "";
    expect(shellLine).toContain('${desktopWorkspace === "diary" ? "diary-space-active" : ""}');
    expect(APP).toContain('(desktopWorkspace === "diary" ? "" : " workspace-view--hidden")');
    expect(APP).toContain('workspace="diary"');
    expect(APP).toContain("<DiaryWorkspace");
    // 快捷键**单一来源** = useDesktopLifecycle 的映射表（261109 收敛；App 里不得再自注册 keydown）。
    const LIFECYCLE = read("../../hooks/useDesktopLifecycle.ts");
    expect(LIFECYCLE).toContain('"3": "diary"');
    expect(LIFECYCLE).toContain('"4": "ai-writing"');
    expect(LIFECYCLE).toContain('"5": "tags"');
    expect(APP, "App 不应再自注册 ⌘4/⌘5 监听").not.toMatch(/event\.key !== "[45]"/);
  });

  it("②j tab 空间分流回归护栏：搜索命中日记切空间、空空间清 active、重启回日记空间、旧 tab 补 space", () => {
    // 搜索命中日记文档 ⇒ 切日记空间 + 按 diary space 打开（否则 tab 被分流隐藏、编辑区空白）
    expect(APP).toContain("if (diaryNoteIds.has(id))");
    expect(APP).toContain('switchDesktopWorkspace("diary")');
    expect(APP).toContain('openNote(id, query, false, "diary")');
    // 目标空间没有任何 tab ⇒ active 必须清空（不是留着旧值）
    expect(APP).toContain("setActiveNoteId(next)");
    // 重启后上次活动是日记 tab ⇒ 自动回日记空间
    expect(APP).toContain("initialSpaceRestoredRef");
    // 已存在的 tab 缺 space 时按入参补上（旧会话/从文档空间搜索打开）
    const LIFECYCLE = read("../../hooks/useTabLifecycle.ts");
    expect(LIFECYCLE).toContain("existing.space !== space");
  });
  it("②h 日记标签右键复用 TabContextMenu（钉住/关闭族），钉住项排在最前且不参与批量关闭", () => {
    expect(APP).toContain("TabContextMenu");
    expect(APP).toContain("diaryTabsOrdered");
    expect(APP).toContain("pinnedNoteIds.has(tab.noteId)");
    expect(APP).toContain("onCloseLeft");
    expect(APP).toContain("onCloseRight");
  });

  it("②i 两个空间的分栏最小宽：日记 / AI 写作 都是 200", () => {
    expect(WORKSPACE).toContain("minWidth={200}");
    const AIW = read("../aiWriting/AiWritingWorkspace.tsx");
    expect(AIW).toContain("minWidth={200}");
  });
  it("②e 「今天」必须跨天刷新：点击时现算 + 定时/回前台同步（debug 版过夜不能拿到昨天）", () => {
    expect(WORKSPACE).toContain("onCreateEntry(formatDiaryDateKey())");
    expect(WORKSPACE).toContain("setInterval(sync, 60_000)");
    expect(WORKSPACE).toContain('window.addEventListener("focus", sync)');
    expect(WORKSPACE).not.toContain("onCreateEntry(todayKey)");
  });

  it("②f 日记头按钮顺序：搜索 → 日历 → ＋（＋在最右；语义不变）", () => {
    const head = WORKSPACE.slice(WORKSPACE.indexOf("diary-dir__head"), WORKSPACE.indexOf("diary-tree ln-scroll"));
    const order = ["搜日记", "选择日期新建日记", "新建今天的日记"].map((key) => head.indexOf(key));
    expect(order.every((index) => index >= 0), "三个入口都要在头部").toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("②g 右键菜单项带图标（转文档 / 转小记）", () => {
    expect(WORKSPACE).toContain("<FileText size={15} aria-hidden=\"true\" />");
    expect(WORKSPACE).toContain("<Feather size={15} aria-hidden=\"true\" />");
  });
  it("②d 空间回落的 effect 必须在 `if (!workspace) return` 之前（放到之后 = hooks 顺序变化 ⇒ 白屏）", () => {
    const effectAt = APP.indexOf("空间切换：活动标签必须属于当前空间");
    const earlyReturnAt = APP.indexOf('if (!workspace) return <main className="loading-screen">');
    expect(effectAt).toBeGreaterThan(-1);
    expect(earlyReturnAt).toBeGreaterThan(-1);
    expect(effectAt, "effect 必须在早期 return 之前").toBeLessThan(earlyReturnAt);
  });
  it("②c 独立 tab：日记/文档各看各的（按 OpenTab.space 分流）；日记条目标题不可改名", () => {
    // 分流判据：优先 tab.space；缺字段（加 space 之前打开的老 tab）回落到「当前树里是不是日记条目」。
    expect(APP).toContain("const ownsDiary");
    expect(APP).toContain("diaryNoteIds.has(tab.noteId)");
    expect(APP).toContain("tabInfos.filter((tab) => !ownsDiary(tab))");
    expect(APP).toContain("tabInfos.filter((tab) => ownsDiary(tab))");
    expect(APP).toContain('aria-label="打开的日记"');
    expect(APP).toContain('openNote(noteId, "", false, "diary")');
    const TREE_ACTIONS = read("../../hooks/useTreeActions.ts");
    expect(TREE_ACTIONS).toContain("isDiaryEntryNode");
    expect(TREE_ACTIONS).toContain("日记标题就是日期，不能改");
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
