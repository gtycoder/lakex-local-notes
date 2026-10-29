import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MOB-01（261027 审计）：Android 返回键必须先关移动端的浮层，不能直接退出 App / 退出工作区。
 * 归口 = 统一返回栈（src/mobile/ui/backStack.ts）：浮层打开时登记，关闭后注销。
 * 这里对两个**无法在 node 里挂载**的组件（工作区要真库 + 内核；设置抽屉要整条设置数据链）
 * 做源码级护栏；行为级用例见 home/mobileQuickNoteTagSheetBack.test.ts（真实挂载）、
 * ui/MobileSheet.render.test.ts 与 notebook/useWorkspaceOverlays.test.ts。
 *
 * MOB-02 / MOB-11（261027 审计）：工作区浮层收成 `useWorkspaceOverlays` 的单一 owner；
 * 手写 scrim/sheet 骨架收成 `ui/MobileSheet` 原语（返回栈只在原语里登记一次）。
 * 本文件同时钉住「工作区不得重复登记自带返回栈的种类」——重复登记会让返回键跳过子菜单下钻。
 */
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const WORKSPACE = read("./notebook/NotebookWorkspace.tsx");
const OVERLAYS = read("./notebook/useWorkspaceOverlays.ts");
const SHEET = read("./ui/MobileSheet.tsx");
const INFO = read("./ui/NoteInfoSheet.tsx");
const TAG = read("./home/MobileQuickNoteTagSheet.tsx");
const SETTINGS = read("./settings/SettingsDrawer.tsx");
const SHEET_MENU = read("./ui/MobileSheetMenu.tsx");
const CREATE_NOTEBOOK = read("./settings/CreateNotebookSheet.tsx");
const SEARCH = read("./settings/SearchSheet.tsx");
const DOC_LIST = read("./editor/DocListSheet.tsx");
const OUTLINE = read("./editor/OutlineSheet.tsx");
const FIELD_SHEET = read("./bitable/MobileBitableFieldSheet.tsx");
const RECORD_SHEET = read("./bitable/MobileBitableRecordSheet.tsx");
const HOME = read("./home/HomePage.tsx");
const AI_CORPUS = read("./ai/AiCorpusSheet.tsx");
const AI_IMAGE = read("./ai/AiImageSheet.tsx");
const AI_SEND = read("./ai/AiSendSheet.tsx");
const AI_PAGE = read("./ai/MobileAiPage.tsx");
const CONFIRM = read("./ui/ConfirmDialog.tsx");
const CREATE = read("./ui/CreateSheet.tsx");
const PICKER = read("./ui/PickerSheet.tsx");

describe("移动端返回键先关浮层（MOB-01 / MOB-02）", () => {
  it("工作区：唯一 owner 单一判据（overlay.kind），任一浮层打开就登记、只关最上层", () => {
    // 互斥与状态都在 owner 里 ⇒ 工作区只剩一条按 kind 的返回处理器
    expect(WORKSPACE).toContain("useWorkspaceOverlays()");
    expect(WORKSPACE).toContain("if (!overlayKind || SELF_REGISTERED_OVERLAY_KINDS.has(overlayKind)) return;");
    expect(WORKSPACE).toContain("pushBackHandler(() => { closeOverlay(overlayKind); return true; })");
    // 旧的 10 个独立 useState / 手写互斥不许回来（互斥只在 owner 的 open 里）
    expect(WORKSPACE).not.toContain("const [sidebarOpen, setSidebarOpen]");
    expect(WORKSPACE).not.toContain("const [tabsOpen, setTabsOpen]");
    expect(WORKSPACE).not.toContain("const topOverlay =");
    // 自带返回栈的种类由原语自己登记；工作区重复登记会让返回键跳过子菜单下钻（MOB-01 已踩过）
    expect(OVERLAYS).toContain('"create", "menu", "notebookSwitch", "info"');
    expect(SHEET_MENU).toContain("return pushBackHandler(() => { if (back()) return true; close(); return true; });");
  });

  it("MobileSheet：返回栈 / 右滑 / 遮罩 / 焦点滚动锁只有这一份实现", () => {
    expect(SHEET).toContain("pushBackHandler");
    expect(SHEET).toContain("useSwipeToClose");
    expect(SHEET).toContain("data-prevent-swipe");
    expect(SHEET).toContain("return pushBackHandler(() => { onClose(); return true; });");
    // 关闭 = 遮罩/右滑/返回/× 共用同一个回调（dismissible=false 时只能由流程关）
    expect(SHEET).toContain("dismissible = true");
  });

  it("两个漏返回栈的面板已迁移到 MobileSheet（不再自己写 scrim / 自己登记返回栈）", () => {
    for (const [name, src] of [["NoteInfoSheet", INFO], ["MobileQuickNoteTagSheet", TAG]] as Array<[string, string]>) {
      expect(src, name).toContain("MobileSheet");
      expect(src, name).toContain("<MobileSheet");
      expect(src, name).not.toContain('className="mb-scrim"');
      expect(src, name).not.toContain("pushBackHandler");
    }
    // 表面类名沿用既有 mb-sheet 系列（视觉 / 快照不变）
    expect(INFO).toContain('titleClassName="mb-ellipsis"');
    expect(TAG).toContain('bodyClassName="qn-tag-sheet__body"');
  });

  it("MOB-11 续：新建知识库 / 搜索 Sheet 也走 MobileSheet（类名/DOM 不变，返回键只关面板）", () => {
    for (const [name, src, extra] of [
      ["CreateNotebookSheet", CREATE_NOTEBOOK, 'bodyClassName="mb-sheet__body--form"'],
      ["SearchSheet", SEARCH, 'className="mb-sheet--search"'],
    ] as Array<[string, string, string]>) {
      expect(src, name).toContain("<MobileSheet");
      expect(src, name).toContain(extra);
      expect(src, name).not.toContain('className="mb-scrim"');
      expect(src, name).not.toContain("useSwipeToClose");
    }
  });

  it("MOB-11 收尾：工作区图标/历史、文档列表/大纲、多维表两个面板、首页图标都走 MobileSheet", () => {
    for (const [name, src] of [
      ["NotebookWorkspace.icon/history", WORKSPACE],
      ["DocListSheet", DOC_LIST],
      ["OutlineSheet", OUTLINE],
      ["MobileBitableFieldSheet", FIELD_SHEET],
      ["MobileBitableRecordSheet", RECORD_SHEET],
      ["HomePage.icon", HOME],
    ] as Array<[string, string]>) {
      expect(src, name).toContain("<MobileSheet");
      expect(src, name).not.toContain('className="mb-scrim"');
      expect(src, name).not.toContain("useSwipeToClose");
    }
    // 工作区：图标/历史由原语自己登记返回栈 ⇒ owner 不得重复登记（否则返回键跳过子层）
    expect(OVERLAYS).toContain('"icon", "history"');
    // 表面类名逐字保留（迁移不新造第二套弹层）
    expect(WORKSPACE).toContain('bodyClassName="mb-list"');
    expect(FIELD_SHEET).toContain('titleClassName="mb-ellipsis"');
    expect(RECORD_SHEET).toContain('bodyClassName="mb-sheet__body--form"');
    expect(OUTLINE).toContain('className="med-outline-sheet"');
    // 大纲的右侧抽屉变体不是底部 sheet 语义（手势由全局 usePanelDrag 管），必须保留
    expect(OUTLINE).toContain("side-panel--right");
  });

  it("MOB-11 例外：AI 三面板 / 附件菜单 / 确认框 / 新建面板 / 选择器 / 下钻菜单不套 MobileSheet，但各自必须自带返回栈", () => {
    // 结构与语义不同的例外（逐条理由见 docs/MOBILE-SHEET-EXCEPTIONS.md）。
    for (const [name, src] of [
      ["AiCorpusSheet", AI_CORPUS],
      ["AiImageSheet", AI_IMAGE],
      ["AiSendSheet", AI_SEND],
      ["MobileAiPage.actionSheet", AI_PAGE],
      ["ConfirmDialog", CONFIRM],
      ["CreateSheet", CREATE],
      ["PickerSheet", PICKER],
      ["MobileSheetMenu", SHEET_MENU],
    ] as Array<[string, string]>) {
      expect(src, name).toContain("pushBackHandler");
    }
    // MobileAiPage 的附件 ActionSheet 也是浮层：返回键必须先关它，不能直接退出整个 AI 页。
    expect(AI_PAGE).toContain("if (!actionsOpen) return;");
    expect(AI_PAGE).toContain("pushBackHandler(() => { setActionsOpen(false); return true; })");
  });

  it("设置抽屉：子页 / 回收站预览打开时登记返回栈，返回 = 回菜单（不关整个抽屉）", () => {
    expect(SETTINGS).toContain('import { pushBackHandler } from "../ui/backStack"');
    expect(SETTINGS).toContain("if (!open || (!isSub && !previewNoteId)) return;");
    const block = SETTINGS.slice(SETTINGS.indexOf("pushBackHandler(() => {"), SETTINGS.indexOf("pushBackHandler(() => {") + 400);
    expect(block).toContain("setPreviewNoteId(null)");
    expect(block).toContain('setView("menu")');
  });
});
