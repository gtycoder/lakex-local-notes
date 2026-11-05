/**
 * 261105 P1 第 4 项：引擎→端口接线（真实同步轮次产生「远端覆盖」记录，恢复动作可挽回）。
 * A/B 双端冲突：B 本地编辑被 A 远端版本覆盖 ⇒ B 的同步记录出现 remote_wins（带历史快照引用）；
 * restoreSyncConflict 用历史快照恢复 B 的本地版并标 dirty（下次同步 local-wins）。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-conflict-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const quick = new QuickNotesStore(root);
  const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
  await adapter.init();
  return { root, store, adapter };
}

describe("同步记录账本：引擎→端口（桌面 A/B）", () => {
  it("B 本地编辑被远端覆盖 ⇒ remote_wins 入账（带 historyRef）；恢复后回到 B 本地版并标 dirty", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    const b = await device("b");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>base</p>", [], "doc-c");
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    expect(b.store.readNote("doc-c").content).toBe("<p>base</p>");

    // B 本地编辑（被覆盖方）；A 稍后编辑并发布（远端胜）。
    b.store.saveNote("doc-c", "Doc", "<p>B-local</p>");
    a.store.saveNote("doc-c", "Doc", "<p>A-remote</p>");
    await ea.sync();
    await eb.sync();
    expect(b.store.readNote("doc-c").content).toBe("<p>A-remote</p>");

    const conflicts = b.store.listSyncConflicts();
    const row = conflicts.items.find((item) => item.noteId === "doc-c" && item.kind === "remote_wins");
    expect(row).toBeTruthy();
    expect(row!.historyRef).toBeTruthy();
    expect(conflicts.unacked).toBeGreaterThan(0);

    const restored = b.store.restoreSyncConflict(row!.id);
    expect(restored.resolution).toBe("restored");
    expect(b.store.readNote("doc-c").content).toBe("<p>B-local</p>");
    expect(b.store.listNoteSummaries().find((note) => note.id === "doc-c")?.isDirty).toBe(true);
    expect(b.store.getSyncConflict(row!.id)?.ackedAt).toBeTruthy();
  }, 120_000);
});
