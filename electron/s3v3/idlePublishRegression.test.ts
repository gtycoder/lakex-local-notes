import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

/**
 * P1 回归：v3 空发布抖动。
 *
 * 现象（修前）：两端都无业务变更时仍隔轮各 +1 generation（published=true、uploaded/downloaded=0），
 * 对端零变更从只读 200B pointer 退化为读整份索引（117KB@1000 篇）。
 *
 * 根因：DesktopStoreDevice.saveState 只把「正文」和部分几何字段写回 Store；远端/合并结果里的
 * updatedAt（以及目录 updatedAt）在正文未变时根本没落库。而 v3 三方合并用 updatedAt 判定
 * 「本地元数据是否更新」，于是一端每次同步都把自己的旧时间戳当成新变更再发布一次，另一端的
 * 旧时间戳又被下一次合并判成下载……两个索引版本来回翻转，永不停息。
 * 修复：saveState 把合并结果的元数据（含 updatedAt）原样落库（notes：applyRemoteNoteMeta，
 * 目录：applyRemoteFolderMeta），baseline/本地行/远端索引三者对齐。
 */

class CountingRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  getCount = 0;
  getBytes = 0;
  putCount = 0;
  putKeys: string[] = [];
  async get(key: string): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    const bytes = o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
    this.getCount++;
    this.getBytes += bytes.length;
    return bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.putCount++;
    this.putKeys.push(key);
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
  reset(): void { this.getCount = 0; this.getBytes = 0; this.putCount = 0; this.putKeys = []; }
  pointer(): { generation: number; lake: { commit: string }; quickNotes: { commit: string } } {
    return JSON.parse(new TextDecoder().decode(this.objects.get("meta/pointer.json")!.bytes)) as never;
  }
}

async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-idle-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const quick = new QuickNotesStore(root);
  const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
  await adapter.init();
  return { root, store, quick, adapter };
}

describe("v3 空跑不发布（P1 回归：索引版本抖动）", () => {
  it("两端各有本地种子数据（时间戳不同）时，空闲 5 轮 published=false、零变更、只读 pointer", async () => {
    const remote = new CountingRemote();
    const a = await device("a");
    const b = await device("b");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc1", "idle-body-1", [], "n1");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc2", "idle-body-2", [], "n2");
    const q = a.quick.createQuickNote({ text: "idle-quick", draftId: "d1", stagedImageIds: [] });
    const tag = a.quick.tags.create("idle-tag");
    a.quick.setQuickNoteTags(q.id, [tag.id]);
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    // B 首拉：此时 B 自己的种子（欢迎小记/个人笔记笔记本）时间戳与远端不同，修前从这里开始抖动。
    const first = await eb.sync();
    expect(first.published).toBe(false);
    const gen = remote.pointer().generation;
    const commit = remote.pointer().lake.commit;

    for (let round = 0; round < 5; round++) {
      for (const [who, engine] of [["A", ea], ["B", eb]] as const) {
        remote.reset();
        const r = await engine.sync();
        expect(r.published, who + " round " + round + " 不应发布").toBe(false);
        expect(r.uploadedNotes + r.downloadedNotes, who + " round " + round + " 不应有正文/元数据传输").toBe(0);
        expect(r.generation).toBe(gen);
        // 零业务变更的轮次只允许读 pointer（≈200B）：不许写对象、不许拉索引。
        expect(remote.putCount, who + " round " + round + " 不应写任何对象").toBe(0);
        expect(remote.getBytes, who + " round " + round + " 下行应只有 pointer").toBeLessThan(1024);
        expect(remote.getCount).toBeLessThanOrEqual(2);
      }
    }
    expect(remote.pointer().generation).toBe(gen);
    expect(remote.pointer().lake.commit).toBe(commit);
  }, 120_000);

  it("真实增量下载后立即回闲：本地 metadata 与 baseline 对齐，下一轮不再补发布", async () => {
    const remote = new CountingRemote();
    const a = await device("a2");
    const b = await device("b2");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "v1-body", [], "n1");
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    // A 改正文并发布 → B 下载（saveNote 会把 updated_at 写成 now，修前下一轮 B 会误判本地更新再发布）
    a.store.saveNote("n1", "Doc", "v2-body");
    await ea.sync();
    const down = await eb.sync();
    expect(down.downloadedNotes).toBe(1);
    const gen = remote.pointer().generation;
    for (let round = 0; round < 3; round++) {
      for (const [who, engine] of [["A", ea], ["B", eb]] as const) {
        remote.reset();
        const r = await engine.sync();
        expect(r.published, who + " round " + round + " 增量后回闲不应发布").toBe(false);
        expect(remote.putCount, who + " round " + round + " 不应写对象").toBe(0);
      }
    }
    expect(remote.pointer().generation).toBe(gen);
  }, 120_000);
});
