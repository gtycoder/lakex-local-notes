/**
 * P0-1（261117）tab gone 只读横幅 · 源码接线护栏（行为侧在 goneBanner.render.test / useNotebookTabs.test /
 * useWorkspaceSession.test / data/noteRepository.test 里逐条覆盖）：
 *  ① 判定原料 trashedAt/isPurged 随 readNote 带出，判定只走 core.isGoneNote（不得自造第二判据）；
 *  ② 标签命中 gone ⇒ 标 gone + 强制退出编辑态，渲染层统一强制只读（一处收口覆盖全部 kind 宿主）；
 *  ③ 横幅文案 = 三事实（已被删除（云端/回收站）/ 保存会被拦截 / 可从回收站恢复），gone 压 editLocked；
 *  ④ 可见性命中点 = 读正文 / 同步轮结束 / 自动保存被拒 —— 保存屏障（discardTab + cancelAutoSave）不动。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const REPO = code(read("src/mobile/data/noteRepository.ts"));
const TABS = code(read("src/mobile/notebook/useNotebookTabs.ts"));
const PANES = code(read("src/mobile/notebook/NotePaneHost.tsx"));
const SESSION = code(read("src/mobile/notebook/useWorkspaceSession.ts"));
const COPY = code(read("src/mobile/notebook/goneBanner.ts"));

describe("tab gone 只读横幅接线（P0-1）", () => {
  it("判定原料随 readNote 带出（trashedAt/isPurged），判定单一来源 = core.isGoneNote", () => {
    expect(REPO).toContain("trashed_at, is_purged FROM notes WHERE id = ?");
    expect(REPO).toContain("trashedAt: String(r.trashed_at)");
    expect(REPO).toContain("isPurged: true");
    // 不得在数据层自造 gone 判据（banned：rowToNote 里直接算 gone）。
    expect(TABS).toContain('import { isGoneNote } from "../../core/syncDecisions"');
    expect(TABS).toContain("isGoneNote({ parentId: note.parentId, trashedAt: note.trashedAt, isPurged: note.isPurged })");
  });

  it("标签层：命中即标 gone 并强制退出编辑态（读正文 / 进入编辑两个口）", () => {
    expect(TABS).toContain("gone?: boolean");
    expect(TABS).toContain("editLocked: note.editLocked === true");
    expect(TABS).toContain("editing: note.editLocked || gone ? false : tab.editing");
    expect(TABS).toContain("editing: enterEditor ? (tab.editLocked || tab.gone ? false : true) : tab.editing");
  });

  it("渲染层：gone 横幅三事实文案 + gone 压 editLocked + 统一强制只读（一处收口全 kind）", () => {
    expect(COPY).toContain("回收站");
    expect(COPY).toContain("保存会被拦");
    expect(COPY).toContain("已被删除");
    expect(PANES).toContain('import { GONE_BANNER_TEXT } from "./goneBanner"');
    expect(PANES).toContain("t.gone ? (");
    expect(PANES).toContain("{GONE_BANNER_TEXT}");
    // 强制只读收口在渲染映射（覆盖 doc/board/ink/usheet/bitable 与未来新增 kind）。
    expect(PANES).toContain("const panes = tabs.map((t) => (t.gone ? { ...t, editing: false } : t))");
    expect(PANES).toContain("{panes.map((t) =>");
  });

  it("可见性命中点：同步轮结束复核 + 自动保存被拒复核 + 编辑入口拦截；保存屏障语义不动", () => {
    expect(SESSION).toContain("subscribeSyncStatus(");
    expect(SESSION).toContain("markTabGone(tab.id)");
    expect(SESSION).toContain("void tabIsGone(id).then((gone) => { if (gone) markTabGone(id); })");
    expect(SESSION).toContain("if (active.gone)");
    expect(SESSION).toContain("updateTab(id, { gone: true, editing: false })");
    // 保存屏障仍是 discardTab + cancelAutoSave（本任务不改写保存路径）。
    expect(SESSION).toMatch(/const discardTab[\s\S]{0,120}cancelAutoSave\(id\)/);
    expect(SESSION).toContain("discardGoneTab");
  });
});
