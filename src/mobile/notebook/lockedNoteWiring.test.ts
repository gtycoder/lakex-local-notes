/**
 * 移动端编辑锁 UI 接线（261112 task-56 N4）与同步 warning 逐项可见（复用 core/syncWarningText）。
 *
 * 源码接线断言：锁的「数据/文案/拦截」三处必须同时在位（缺一处 = 桌面锁在移动端形同虚设）：
 *  ① tabs 知道 editLocked 并在进入编辑时回调提示；
 *  ② 工作区胶囊/面板宿主给只读横幅，并把 editing 强制为 false；
 *  ③ 编辑入口（toggleEdit）与保存入口（bridge.saveNote）双保险拦截；
 *  ④ 设置页 warning 列表不再手写一份文案（必须走 core/syncWarningText）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const TABS = code(read("src/mobile/notebook/useNotebookTabs.ts"));
const PANES = code(read("src/mobile/notebook/NotePaneHost.tsx"));
const SESSION = code(read("src/mobile/notebook/useWorkspaceSession.ts"));
const WORKSPACE = code(read("src/mobile/notebook/NotebookWorkspace.tsx"));
const BRIDGE = code(read("src/mobile/bridge/notes.ts"));
const SETTINGS = code(read("src/mobile/settings/SettingsDrawer.tsx"));

describe("编辑锁在移动端真正生效（task-56 N4）", () => {
  it("tabs：读正文后落 editLocked 并强制退出编辑态；已知锁定时进入编辑会给宿主回调", () => {
    expect(TABS).toContain("editLocked?: boolean");
    expect(TABS).toContain("editLocked: note.editLocked === true");
    expect(TABS).toContain("editing: note.editLocked ? false : tab.editing");
    expect(TABS).toContain("onLockedEditRef.current?.(id)");
  });

  it("面板宿主：只读横幅 + 所有 kind 的 editing 都强制 && !t.editLocked（含手写板 readOnly）", () => {
    expect(PANES).toContain("该文档已在桌面端锁定（只读）");
    const forced = PANES.match(/editing=\{t\.editing && !t\.editLocked\}/g) ?? [];
    // bitable 多一个「只有活动页可编辑」条件，单独断言；合计 5 个宿主（doc/board/ink/usheet/bitable）。
    expect(forced.length).toBeGreaterThanOrEqual(3);
    expect(PANES).toContain("editing={t.editing && t.id === activeId && !t.editLocked}");
    expect(PANES).toContain("readOnly={!t.editing || t.editLocked === true}");
  });

  it("双保险拦截：编辑入口（toggleEdit）+ 保存入口（bridge.saveNote）都给明确文案", () => {
    expect(SESSION).toContain("if (active.editLocked)");
    expect(BRIDGE).toContain("SELECT is_locked FROM notes WHERE id=?");
    expect(BRIDGE).toContain("文档已锁定（只读），保存被拒绝");
    expect(WORKSPACE).toContain("onLockedEdit:");
    expect(SESSION).toContain("已在桌面端锁定（只读）");
  });

  it("getNoteInfo 不再硬编码 isEditLocked:false（锁字段透出）", () => {
    expect(BRIDGE).not.toContain("isEditLocked: false");
    expect(BRIDGE).toContain("isEditLocked: row?.is_locked === 1");
  });
});

describe("同步 warning 逐项可见且文案单一来源（task-56 N5/warning）", () => {
  it("设置页使用 core/syncWarningText（摘要/排序/标题/label/hint），不手写一份文案", () => {
    expect(SETTINGS).toMatch(/from "\.\.\/\.\.\/core\/syncWarningText"/);
    for (const fn of ["syncWarningSummary", "syncWarningSummaryText", "syncWarningRows", "syncWarningCopy", "syncWarningTitle"]) {
      expect(SETTINGS).toContain(fn + "(");
    }
    // 旧的整段手写说明已删除（不得再复制一份「可重试类会…」）。
    expect(SETTINGS).not.toContain("可重试类会在下次同步重试");
    expect(SETTINGS).toContain("copy.hint");
  });
});