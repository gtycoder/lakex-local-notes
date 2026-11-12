/**
 * 移动端恢复缺口（261112 task-53）：显式恢复不得被用户保存守卫挡住。
 *
 * 背景（审计 13-write-guard-sweep §0.1 / §2 G8）：`restoreHistory` / `restoreSyncConflict` 曾复用
 * `notesDomain.saveNote` 的用户保存守卫 ⇒ 目标行已在回收站时恢复直接失败（桌面可恢复）。
 * 本用例在真实 sql.js 库 + 内存正文后端上锁三条：
 *  ① 目标在回收站 ⇒ 恢复成功、**只写内容**（trashed_at/parent/restore_pending 原样；用户裁决：恢复历史不改生命周期）；
 *  ② 目标已被彻底删除（墓碑）⇒ 仍拒绝，文案含「不可恢复」（不静默）；
 *  ③ 用户直接保存回收站行 ⇒ 仍明确拒绝（文案含「回收站」）。
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
  removeQuickNoteAssetsDirFs: vi.fn(async () => {}),
  removeNoteAssetsDirFs: vi.fn(async () => {}),
  listAllAssetKeysFs: vi.fn(async () => []),
}));
vi.mock("../native/secretStore.js", () => ({
  mobileSecretStore: { read: vi.fn(async () => null), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
}));
// 同步域：本用例不碰网络/资产补拉（恢复后的补拉是后台 best-effort）。
vi.mock("./sync", () => ({
  downloadDeclaredAssetsFor: vi.fn(async () => {}),
  ensureAssetsNative: vi.fn(async () => {}),
  mobileCloudState: vi.fn(() => ({})),
  syncDomain: {},
}));

import { ensureDb } from "./context";
import { notesDomain } from "./notes";
import * as noteRepository from "../data/noteRepository.js";
import * as trashRepository from "../data/trashRepository.js";
import * as historyRepository from "../data/historyRepository.js";
import * as syncConflictRepository from "../data/syncConflictRepository.js";
import { sha256Hex } from "../../core/syncUtils.js";

const sha256 = (text: string): string => sha256Hex(new TextEncoder().encode(text));

const T = "2026-11-12T10:00:00.000Z";

async function seedNotebook(): Promise<void> {
  const d = await ensureDb();
  await d.prepare("INSERT OR IGNORE INTO folders (id,title,parent_id,sort_order,node_type,updated_at,is_dirty) VALUES ('nb1','笔记本一',NULL,0,'notebook',?,1)").run(T);
}

/** 建一篇文档 + 一个历史快照（快照正文 = 传入内容）。 */
async function seedNoteWithHistory(noteId: string, disk: string, snapshot: string): Promise<number> {
  await seedNotebook();
  const d = await ensureDb();
  await noteRepository.createNote(d, noteId, "标题一", disk, "nb1", new Map(), undefined, "doc");
  await historyRepository.createHistorySnapshot(d, noteId, snapshot, { title: "标题一", parentId: "nb1", sortOrder: 0 });
  const list = await historyRepository.listNoteHistory(d, noteId);
  return list[0].id;
}

const rowOf = async (noteId: string) => {
  const d = await ensureDb();
  return await d.prepare("SELECT trashed_at, is_purged, parent_id, content_hash, restore_pending_at FROM notes WHERE id=?").get(noteId) as
    | { trashed_at: string | null; is_purged: number; parent_id: string | null; content_hash: string; restore_pending_at: string | null }
    | undefined;
};

describe("移动端恢复专用写路径（task-53）", () => {
  beforeEach(async () => {
    const d = await ensureDb();
    // 每个用例干净库：只清内容表（schema 保留）。
    for (const table of ["note_history", "sync_conflicts", "deleted_notes", "notes", "folders"]) {
      await d.prepare("DELETE FROM " + table).run();
    }
  });

  it("restoreHistory：目标在回收站 ⇒ 只写内容、**生命周期不变**（trashed/parent/restore_pending 原样）", async () => {
    const historyId = await seedNoteWithHistory("n1", "<p>当前正文</p>", "<p>历史版本</p>");
    const d = await ensureDb();
    await noteRepository.trashNote(d, "n1");
    const before = (await rowOf("n1"))!;
    expect(before.trashed_at).not.toBeNull();
    const beforeTrashedAt = before.trashed_at;

    await expect(notesDomain.restoreHistory(historyId)).resolves.toBeUndefined();

    const row = (await rowOf("n1"))!;
    // 用户裁决：恢复历史版本 = 内容动作，不能顺手把文档移出回收站（对齐桌面 restoreHistory）。
    expect(row.trashed_at).toBe(beforeTrashedAt);
    expect(row.parent_id).toBe("nb1");
    expect(row.restore_pending_at).toBeNull(); // 不写恢复标记（不改变生命周期）
    expect(row.content_hash).toBe(sha256("<p>历史版本</p>"));
    expect(await noteRepository.readNote(d, "n1").then((n) => n?.content)).toBe("<p>历史版本</p>");
  });

  it("restoreSyncConflict：目标在回收站 ⇒ 成功、离开回收站、正文=快照、记录标 resolved", async () => {
    const historyId = await seedNoteWithHistory("n2", "<p>当前正文</p>", "<p>冲突前版本</p>");
    const d = await ensureDb();
    await noteRepository.trashNote(d, "n2");
    await syncConflictRepository.insertSyncConflicts(d, [{
      noteId: "n2", space: "lake", kind: "remote_wins", at: T, title: "标题一",
      localHash: sha256("<p>当前正文</p>"),
      remoteHash: sha256("<p>远端版本</p>"),
      historyRef: String(historyId),
    }]);
    const conflicts = await syncConflictRepository.listSyncConflicts(d);
    const conflictId = conflicts.items[0].id;

    const result = await notesDomain.restoreSyncConflict(conflictId);
    expect(result).toMatchObject({ ok: true, noteId: "n2", restoredFromHistory: true });
    const row = (await rowOf("n2"))!;
    // 同口径：只写回被覆盖版本的内容，生命周期保持（仍在回收站）。
    expect(row.trashed_at).not.toBeNull();
    expect(row.content_hash).toBe(sha256("<p>冲突前版本</p>"));
    expect((await syncConflictRepository.getSyncConflict(d, conflictId))!.resolvedAt).not.toBeNull();
  });

  it("目标行 purged（is_purged=1）⇒ 仍拒绝且文案含「不可恢复」", async () => {
    const historyId = await seedNoteWithHistory("n3", "<p>当前正文</p>", "<p>历史版本</p>");
    const d = await ensureDb();
    // purged 行的另一形态（行仍在、is_purged=1）：常见于旧数据/便携包导入。
    await d.prepare("UPDATE notes SET is_purged=1, trashed_at=? WHERE id=?").run(T, "n3");
    await expect(notesDomain.restoreHistory(historyId)).rejects.toThrow(/不可恢复/);
    expect((await rowOf("n3"))!.is_purged).toBe(1);
  });

  it("目标已彻底删除（墓碑 + 历史已随 purge 清理）⇒ 仍明确报错、不静默", async () => {
    const historyId = await seedNoteWithHistory("n3b", "<p>当前正文</p>", "<p>历史版本</p>");
    const d = await ensureDb();
    await noteRepository.trashNote(d, "n3b");
    await trashRepository.purgeTreeItem(d, "n3b", "note");
    expect(await noteRepository.isTombstoned(d, "n3b")).toBe(true);
    // purge 会连历史快照一起清 ⇒ 恢复必须给「快照已清理」的明确错误（旧实现是无声 return）。
    await expect(notesDomain.restoreHistory(historyId)).rejects.toThrow(/无法恢复/);
    expect(await noteRepository.isTombstoned(d, "n3b")).toBe(true);
    expect(await rowOf("n3b")).toBeUndefined();
  });

  it("未在回收站的行恢复历史 ⇒ 正文变、生命周期无关字段不变", async () => {
    const historyId = await seedNoteWithHistory("n5", "<p>当前正文</p>", "<p>历史版本</p>");
    const d = await ensureDb();
    const before = (await rowOf("n5"))!;
    expect(before.trashed_at).toBeNull();

    await expect(notesDomain.restoreHistory(historyId)).resolves.toBeUndefined();

    const row = (await rowOf("n5"))!;
    expect(row.trashed_at).toBeNull();
    expect(row.parent_id).toBe("nb1");
    expect(row.content_hash).toBe(sha256("<p>历史版本</p>"));
    expect(await noteRepository.readNote(d, "n5").then((n) => n?.content)).toBe("<p>历史版本</p>");
  });

  it("用户直接保存回收站行：仍明确拒绝（用户保存入口不被放开）", async () => {
    await seedNoteWithHistory("n4", "<p>当前正文</p>", "<p>历史版本</p>");
    const d = await ensureDb();
    await noteRepository.trashNote(d, "n4");
    await expect(notesDomain.saveNote("n4", "标题一", "<p>用户编辑</p>")).rejects.toThrow(/回收站或已被删除/);
    expect((await rowOf("n4"))!.trashed_at).not.toBeNull();
  });
});