/**
 * 261105 P1 第 4 项：桌面同步记录账本单测（落库/角标/轮转/恢复/保存守卫）。
 * 判据全部来自 src/core/syncConflictLog（这里只验平台落库与恢复链路）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = "k" + electronMock.secrets.size; electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "./store.js";

const dirs: string[] = [];
function freshStore(): Store {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-sync-conflicts-"));
  dirs.push(root);
  const store = new Store(root);
  store.bootstrap();
  return store;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
});

describe("同步记录账本（桌面）", () => {
  it("落库 + unacked 角标 + ack（单条/全部）+ resolved 同时算已读", () => {
    const store = freshStore();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc a", "<p>x</p>", [], "a");
    store.createNoteInAtTopWithContent(nb.id, "Doc b", "<p>y</p>", [], "b");
    const at = new Date().toISOString();
    store.recordSyncConflictEvents([
      { noteId: "a", space: "lake", kind: "remote_wins", at, title: "Doc a" },
      { noteId: "b", space: "lake", kind: "remote_purged", at },
    ]);
    const listed = store.listSyncConflicts();
    expect(listed.items).toHaveLength(2);
    expect(listed.unacked).toBe(2);
    const first = listed.items[0];
    expect(first).toMatchObject({ noteId: expect.any(String), space: "lake", kind: expect.any(String), ackedAt: null, resolvedAt: null });
    expect(store.ackSyncConflicts([first.id])).toBe(1);
    expect(store.listSyncConflicts().unacked).toBe(1);
    // 全部标记已读
    expect(store.syncConflicts.ackAll()).toBe(1);
    expect(store.listSyncConflicts().unacked).toBe(0);
    // resolved 行仍保留（不删数据），且 ackAll 不再重复计数
    store.syncConflicts.markResolved(first.id, "restored");
    const after = store.getSyncConflict(first.id)!;
    expect(after.resolvedAt).toBeTruthy();
    expect(after.resolution).toBe("restored");
    expect(after.ackedAt).toBeTruthy();
  });

  it("轮转：超过 90 天的旧记录被清掉（500 条上限由 core 判据覆盖）", () => {
    const store = freshStore();
    store.recordSyncConflictEvents([
      { noteId: "old-note", space: "lake", kind: "remote_wins", at: "2020-01-01T00:00:00.000Z" },
      { noteId: "new-note", space: "lake", kind: "remote_wins", at: new Date().toISOString() },
    ]);
    const rows = store.listSyncConflicts().items;
    expect(rows.map((row) => row.noteId)).toEqual(["new-note"]);
  });

  it("remote_wins 落库时自动补 historyRef（最新历史快照），恢复动作还原本地版并标 dirty", () => {
    const store = freshStore();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc r", "<p>local-lost</p>", [], "r");
    const historyId = store.createHistorySnapshot("r", "<p>local-lost</p>", true);
    expect(historyId).not.toBeNull();
    store.saveNote("r", "Doc r", "<p>remote-won</p>");
    store.recordSyncConflictEvents([{ noteId: "r", space: "lake", kind: "remote_wins", at: new Date().toISOString(), title: "Doc r" }]);
    const row = store.listSyncConflicts().items[0];
    expect(row.historyRef).toBe(String(historyId));
    const restored = store.restoreSyncConflict(row.id);
    expect(restored.resolvedAt).toBeTruthy();
    expect(restored.resolution).toBe("restored");
    expect(store.readNote("r").content).toBe("<p>local-lost</p>");
    expect(store.listNoteSummaries().find((note) => note.id === "r")?.isDirty).toBe(true);
  });

  it("历史快照已过期/缺失 ⇒ 明确报错（不静默）", () => {
    const store = freshStore();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc m", "<p>x</p>", [], "m");
    store.recordSyncConflictEvents([{ noteId: "m", space: "lake", kind: "remote_wins", at: new Date().toISOString() }]);
    const row = store.listSyncConflicts().items[0];
    // 无 historyRef ⇒ NotFound（可读）
    expect(() => store.restoreSyncConflict(row.id)).toThrow(/历史快照/);
  });

  it("保存守卫的外部改动也入账本（save_external_changed，不改变保存拦截行为）", () => {
    const store = freshStore();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc s", "<p>disk</p>", [], "s");
    // 模拟磁盘被外部改：直接改文件后，用旧 baseHash 保存 ⇒ 命中保存守卫
    const file = path.join(store.rootPath, "notes", "s.lake");
    fs.writeFileSync(file, "<p>external</p>");
    const result = store.saveNoteVersioned("s", "Doc s", "<p>editor</p>", undefined, "deadbeef");
    expect(result).toMatchObject({ ok: false, code: "external_changed" });
    const rows = store.listSyncConflicts().items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ noteId: "s", kind: "save_external_changed", localHash: "deadbeef" });
    // 磁盘仍保留外部版本（守卫不写盘）
    expect(fs.readFileSync(file, "utf8")).toBe("<p>external</p>");
  });
});
