/**
 * 移动端编辑锁（261112 task-56 N4）：锁字段必须透出、用户保存必须被拦、解锁后恢复可写。
 *
 * 背景：desktop 锁定 = 只读；移动端此前 getNoteInfo 硬编码 isEditLocked:false 且 saveNote 不查锁 ⇒
 * 桌面锁定的文档在手机端可编辑可保存（语义不等价）。
 * 不变量：
 *  ① getNoteInfo 透出 isEditLocked/editLockedAt；
 *  ② 锁定行的用户保存明确拒绝（文案含「锁定」），正文不变；
 *  ③ 解锁后同一入口可保存；
 *  ④ 显式恢复（历史写回）不受锁影响（恢复是内容动作，不是编辑）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../native/nativeSqliteDb.js", async () =>
  (await import("../native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  listQuickNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
  removeQuickNoteAssetFilesFs: vi.fn(async () => {}),
  removeNoteAssetsDirFs: vi.fn(async () => {}),
  removeQuickNoteAssetsDirFs: vi.fn(async () => {}),
}));
vi.mock("../native/secretStore.js", () => ({
  mobileSecretStore: { read: vi.fn(async () => null), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
}));
vi.mock("./sync", () => ({
  downloadDeclaredAssetsFor: vi.fn(async () => {}),
  ensureAssetsNative: vi.fn(async () => {}),
  mobileCloudState: vi.fn(() => ({})),
  syncDomain: {},
}));

import { ensureDb } from "./context";
import { notesDomain } from "./notes";
import * as noteRepository from "../data/noteRepository.js";
import * as historyRepository from "../data/historyRepository.js";

const T = "2026-11-12T00:00:00.000Z";

const rowOf = async (id: string) => {
  const d = await ensureDb();
  return await d.prepare("SELECT is_locked, locked_at, content_hash, trashed_at FROM notes WHERE id=?").get(id) as
    | { is_locked: number; locked_at: string | null; content_hash: string; trashed_at: string | null }
    | undefined;
};

describe("移动端编辑锁（task-56 N4）", () => {
  beforeEach(async () => {
    const d = await ensureDb();
    for (const table of ["note_history", "sync_conflicts", "deleted_notes", "notes", "folders"]) await d.prepare("DELETE FROM " + table).run();
    await d.prepare("INSERT OR IGNORE INTO folders (id,title,parent_id,sort_order,node_type,updated_at,is_dirty) VALUES ('nb1','笔记本一',NULL,0,'notebook',?,1)").run(T);
  });

  it("getNoteInfo 透出锁字段；锁定行保存被拒（正文不变）；解锁后可保存", async () => {
    const d = await ensureDb();
    await noteRepository.createNote(d, "n1", "文档", "<p>v1</p>", "nb1", new Map(), undefined, "doc");
    await d.prepare("UPDATE notes SET is_locked=1, locked_at=? WHERE id='n1'").run(T);

    const info = await notesDomain.getNoteInfo("n1");
    expect(info.isEditLocked).toBe(true);
    expect(info.editLockedAt).toBe(T);

    const before = (await rowOf("n1"))!;
    await expect(notesDomain.saveNote("n1", "文档", "<p>用户编辑</p>")).rejects.toThrow(/锁定/);
    const after = (await rowOf("n1"))!;
    expect(after.content_hash).toBe(before.content_hash); // 一个字节都没写
    expect(await noteRepository.readNote(d, "n1").then((n) => n?.content)).toBe("<p>v1</p>");

    await d.prepare("UPDATE notes SET is_locked=0, locked_at=NULL WHERE id='n1'").run();
    await expect(notesDomain.saveNote("n1", "文档", "<p>解锁后的编辑</p>")).resolves.toBeUndefined();
    expect(await noteRepository.readNote(d, "n1").then((n) => n?.content)).toBe("<p>解锁后的编辑</p>");
  });

  it("锁定行仍允许「恢复历史版本」（恢复是内容动作，不是编辑）", async () => {
    const d = await ensureDb();
    await noteRepository.createNote(d, "n2", "文档", "<p>当前</p>", "nb1", new Map(), undefined, "doc");
    await historyRepository.createHistorySnapshot(d, "n2", "<p>历史</p>", { title: "文档", parentId: "nb1", sortOrder: 0 });
    const historyId = (await historyRepository.listNoteHistory(d, "n2"))[0].id;
    await d.prepare("UPDATE notes SET is_locked=1, locked_at=? WHERE id='n2'").run(T);

    await expect(notesDomain.restoreHistory(historyId)).resolves.toBeUndefined();
    expect(await noteRepository.readNote(d, "n2").then((n) => n?.content)).toBe("<p>历史</p>");
    expect((await rowOf("n2"))!.is_locked).toBe(1);
  });
});
