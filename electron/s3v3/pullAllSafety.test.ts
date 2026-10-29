import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

/**
 * P0 止血回归（261027 审计 SD-01 + 用户 261028 裁决）：全量重拉不得删除本地独有数据。
 *
 * 修前：baseline.json.gz 丢失/损坏 ⇒ 走 pullAll（远端索引整体替换 state）⇒ saveState 对
 * 「不在新状态里」的本地行走 deleteNote + purgeTrashItem ⇒ 永久删除正文/附件/历史（不可恢复）。
 * 修后（复用既有「远端已 purge」语义）：本地独有文档 = 其他端已删除并 purge ⇒
 * 软删进回收站 + 打「云端已删除·仅本地」标（cloud_deleted 投影），正文/附件/历史保留，
 * 不参与上传/合并；用户显式恢复时按 restore 意图 local-wins 重新上传。
 */

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  puts: string[] = [];
  async get(key: string): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.puts.push(key);
    this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length }));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
  pointer(): { generation: number; lake: { commit: string }; quickNotes: { commit: string } } {
    return JSON.parse(new TextDecoder().decode(this.objects.get("meta/pointer.json")!.bytes)) as never;
  }
  async lakeIndex(): Promise<{ notes: Array<{ id: string }> }> {
    const commit = this.pointer().lake.commit;
    const o = this.objects.get("meta/index/" + commit + ".json")!;
    const bytes = o.gzip ? gunzipSync(Buffer.from(o.bytes)) : o.bytes;
    return JSON.parse(new TextDecoder().decode(bytes)) as { notes: Array<{ id: string }> };
  }
}

async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-p0-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const adapter = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
  await adapter.init();
  return { root, store, adapter };
}

describe("P0：全量重拉不删除本地独有数据（SD-01 回归）", () => {
  it("baseline 丢失后 pullAll：本地独有文档进回收站（正文/历史保留、不上传）；显式恢复后重新上传", async () => {
    const remote = new MemoryRemote();
    const { root, store, adapter } = await device("a");
    const engine = new S3v3SyncEngine({ remote, device: adapter, deviceId: "P0-A" });
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Shared", "<p>shared-body</p>", [], "shared-1");
    await engine.sync({ onEmptyCloud: "upload" });

    // 首轮同步之后才创建的本地文档（尚未上传）+ 一份历史快照
    store.createNoteInAtTopWithContent(nb.id, "LocalOnly", "<p>local-only-body</p>", [], "local-1");
    store.createHistorySnapshot("local-1", "<p>local-only-body</p>", true);
    expect(store.listNoteIdsWithHistory()).toContain("local-1");

    // 触发条件：baseline 丢失（损坏/被清理/换机只拷了工作区）
    await fs.rm(path.join(root, "sync-v3", "baseline.json.gz"), { force: true });

    const r = await engine.sync();
    expect(r.published).toBe(false); // 全量重拉只拉不推

    // 1) 进回收站（不再物理删除），正文与历史都在
    expect(store.listTrash().map((t) => t.id)).toContain("local-1");
    expect(store.readNote("local-1").content).toContain("local-only-body");
    expect(await fs.stat(store.getNotePaths("local-1").lakePath)).toBeTruthy();
    expect(store.listNoteIdsWithHistory()).toContain("local-1");

    // 2) 同步状态：remotePurged 标记 + 条目带 trashedAt（= 「云端已删除·仅本地」）
    const st = await adapter.loadState();
    expect(st?.remotePurged ?? []).toContain("local-1");
    const entry = st?.lake.notes.find((n) => n.id === "local-1");
    expect(entry?.trashedAt).toBeTruthy();

    // 3) 没被上传/复活（远端索引里没有它），下一轮也不会把它当「本地新建」上传
    expect((await remote.lakeIndex()).notes.some((n) => n.id === "local-1")).toBe(false);
    remote.puts = [];
    const r2 = await engine.sync();
    expect(r2.uploadedNotes).toBe(0);
    expect(remote.puts.some((k) => k.includes("local-1"))).toBe(false);

    // 4) 显式恢复 = 唯一例外：恢复后下一轮 local-wins 重新上传
    store.restoreTrashItem("local-1");
    const r3 = await engine.sync();
    expect(r3.uploadedNotes).toBe(1);
    expect((await remote.lakeIndex()).notes.some((n) => n.id === "local-1")).toBe(true);
    const st2 = await adapter.loadState();
    expect(st2?.remotePurged ?? []).not.toContain("local-1");
  }, 120_000);
});
