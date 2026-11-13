/**
 * 移动端 gone 判定接线（源码护栏；行为侧在 data/noteRepository.test.ts 与
 * notebook/useWorkspaceSession.test.ts 里逐条覆盖）：
 *  · 打开文档的两个入口（openNote / openDiaryEntry）都必须把 trashedAt 传给 core.isGoneNote ——
 *    删笔记本/分组的级联只标 trashed_at、子文档 parent_id 不变（AGENTS §3#16），只按 parentId 判会漏；
 *  · 保存屏障（useWorkspaceSession）命中 gone 时走 discardTab，不能拿保存去撞写边界（会永久失败 ⇒ tab 关不掉）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const APP = code(read("src/mobile/MobileApp.tsx"));
const SESSION = code(read("src/mobile/notebook/useWorkspaceSession.ts"));
const REPO = code(read("src/mobile/data/noteRepository.ts"));

describe("移动端 isGoneNote 调用点必须带 trashedAt（AGENTS §3#16）", () => {
  it("openNote：回收站/他端 purge 判定带 trashedAt（不再只按 parentId）", () => {
    expect(APP).toContain("isGoneNote({ parentId: st.parentId, syncState: st.syncState, trashedAt: st.trashedAt })");
    expect(APP).not.toMatch(/isGoneNote\(\{ parentId: st\.parentId, syncState: st\.syncState \}\)/);
  });

  it("openDiaryEntry：日记条目同样带 trashedAt", () => {
    expect(APP).toContain("isGoneNote({ parentId: state.parentId, syncState: state.syncState, trashedAt: state.trashedAt })");
    expect(APP).not.toMatch(/isGoneNote\(\{ parentId: state\.parentId, syncState: state\.syncState \}\)/);
  });

  it("判定原料 noteGoneState 从 notes.trashed_at 读取（级联删除不改 parent_id）", () => {
    expect(REPO).toMatch(/SELECT parent_id, trashed_at, is_dirty, is_purged FROM notes/);
    expect(REPO).toContain("trashedAt: row.trashed_at");
  });
});

describe("保存屏障命中 gone ⇒ discardTab（不再保存被拒的行）", () => {
  it("用 core.isGoneNote 同一份判据，trashedAt 必传", () => {
    expect(SESSION).toContain('import { isGoneNote } from "../../core/syncDecisions"');
    expect(SESSION).toContain("isGoneNote({ parentId: state.parentId, syncState: state.syncState, trashedAt: state.trashedAt })");
  });

  it("保存前先判 gone，命中即取消待保存并丢弃标签（全量 flush 不再写被拒的行）", () => {
    // captureAndSaveTab = 保存屏障的唯一入口：必须先 tabIsGone 再 flushAutoSave。
    expect(SESSION).toMatch(/const captureAndSaveTab[\s\S]{0,200}tabIsGone\(tab\.id\)[\s\S]{0,200}flushAutoSave/);
    // 丢弃时取消待保存（cancelAutoSave），否则全量 flush 仍会去写回收站行。
    expect(SESSION).toMatch(/const discardTab[\s\S]{0,120}cancelAutoSave\(id\)/);
    expect(SESSION).toContain("discardGoneTab");
  });
});
