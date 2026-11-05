/**
 * 桌面标签「删除 = 缺席」（261105 定稿）的同步级用例：
 * - `quickTagRemoved`（基线有 / 远端缺席）⇒ 本端物理删行 + 清关联/版本（**删除压编辑**：本地改名也不上诉）；
 * - `pendingTagDeletes`（本机离线删过）⇒ **抑制远端重发**，不会被远端索引里的同 id 条目复活。
 * 走真实引擎 + 内存远端，覆盖 port/plan/engineBridge 的协作（不是只测仓库层）。
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-tag-absent-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const quick = new QuickNotesStore(root);
  const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
  await adapter.init();
  return { root, store, quick, adapter };
}

/** 远端 quick-notes 索引里发布的标签 id（= 云端 tags[]，删除 = 缺席后不得出现墓碑/已删标签）。 */
async function remoteTagIds(remote: MemoryRemote): Promise<string[]> {
  const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { quickNotes: { commit: string } };
  const index = JSON.parse(new TextDecoder().decode((await remote.get("quick-notes/meta/index/" + pointer.quickNotes.commit + ".json"))!)) as { tags?: Array<{ id: string }> };
  return (index.tags ?? []).map((tag) => tag.id);
}

describe("桌面标签同步：删除 = 缺席（261105）", () => {
  it("远端缺席 + 基线有 ⇒ 本地删（删除压编辑：他端删了，本地改名也不上诉），待删在确认后结算", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    const b = await device("b");
    const tag = a.quick.tags.create("项目");
    const q = a.quick.createQuickNote({ text: "带标签", draftId: "d1", stagedImageIds: [] });
    a.quick.setQuickNoteTags(q.id, [tag.id]);
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    expect(b.quick.tags.list().map((t) => t.id)).toEqual([tag.id]);
    expect(b.quick.links.listFor(q.id)).toEqual([tag.id]);

    // B 本地改名（编辑），随后 A 删除标签 ⇒ 删除压编辑：B 的改名不上诉。
    b.quick.tagService.update(tag.id, { name: "项目（B改）" });
    a.quick.tagService.delete(tag.id);
    await ea.sync();
    await eb.sync();

    expect(b.quick.tags.list()).toEqual([]); // 目录行物理删除，不是墓碑
    expect(b.quick.links.listFor(q.id)).toEqual([]); // 关联清掉
    expect(b.quick.links.tagsUpdatedAt(q.id)).toBe(""); // 关系版本一起清
    expect(b.quick.tags.listPendingDeletes()).toEqual([tag.id]); // 本机待删：远端确认缺席前保持抑制

    // 再同步一轮：远端已缺席 ⇒ 待删结算清空（否则同名标签以后永远建不回来）。
    await eb.sync();
    expect(b.quick.tags.listPendingDeletes()).toEqual([]);
    // 同名重建成功：派生 ID 与刚删的相同也不会撞主键（旧墓碑会撞）。
    const again = b.quick.tags.create("项目");
    expect(again.id).toBe(tag.id);
  }, 120_000);

  it("本机待删抑制远端重发：离线删过的标签不会被远端索引复活", async () => {
    const remote = new MemoryRemote();
    const a = await device("pend-a");
    const b = await device("pend-b");
    const tag = a.quick.tags.create("离线删");
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    expect(await remoteTagIds(remote)).toEqual([tag.id]);

    // A 离线删除（远端索引此时还带着它）；B 改名并同步 ⇒ 远端仍是 active（模拟「远端重发」）。
    a.quick.tagService.delete(tag.id);
    expect(a.quick.tags.listPendingDeletes()).toEqual([tag.id]);
    b.quick.tagService.update(tag.id, { name: "离线删（B改）" });
    await eb.sync();
    expect(await remoteTagIds(remote)).toEqual([tag.id]);

    // A 同步：pending 抑制 + 本轮发布「缺席」⇒ 本地不复活，云端也不得再带着它。
    await ea.sync();
    expect(a.quick.tags.list()).toEqual([]);
    expect(a.quick.tags.listPendingDeletes()).toEqual([tag.id]); // 远端还没确认缺席（本轮才刚发布）
    expect(await remoteTagIds(remote)).toEqual([]);

    // B 下一轮按「基线有 / 远端缺席」删本地（不是把 A 的删除当新增重发）。
    await eb.sync();
    expect(b.quick.tags.list()).toEqual([]);

    // A 再同步：远端已确认缺席 ⇒ 待删结算。
    await ea.sync();
    expect(a.quick.tags.listPendingDeletes()).toEqual([]);
  }, 120_000);
});
