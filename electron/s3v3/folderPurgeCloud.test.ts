/**
 * task-77（P1，F-01b 回归）：本地 purge 目录后云端 lake 索引 `folders[]` 必须稳定不含该目录。
 *
 * 叠加缺口（均已修，判据单一来源在 core）：
 *  1. `commit/engineBridge.ts`.planStateOf 把 folderPurgeIntents 硬编码 [] ⇒ 目录 purge 墓碑（deleted_notes
 *     node_type=folder，loadState 早已投影进 state.intents）传不到 plan；
 *  2. `plan/plan.ts` 发布 folders 只排除 local-purge/local-delete，未排除 remote-purged-trash ⇒ 对端把
 *     「已 purge 目录的本地回收站副本」当普通条目 publish 回去（与文档同口径修复）；
 *  3. `s3v3Merge.ts` 文件夹分支「无基线 + 本地 trashed」被判成 upload：对端纯拉取轮会把基线推进到
 *     「不含该目录」的远端索引 ⇒ 下一轮把回收站副本重新发布（每轮复活 / 两端互刷）。
 *  4. `plan/plan.ts` 对被 purge 的条目也走 fieldChanged 强制上传：对端副本的回收站 parent 归一触发
 *     fieldChanged ⇒ 已删除正文被重新 PUT 回云端（孤儿复活）。回收站副本强制不上传。
 *
 * 断言口径：首轮同步云端就不含 → 对端同步不重建、不回传（含正文对象）→ 多轮 pointer 不动（零变更轮）→ 无复活。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { parseLakeIndexBytes, type LakeIndex } from "../../src/core/s3v3/protocol/s3v3Index.js";
import { S3V3_POINTER_KEY, indexKey } from "../../src/core/s3v3/protocol/s3v3Keys.js";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) {
    this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length }));
  }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) {
    const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of ks) this.objects.delete(k);
    return ks.length;
  }
}

async function desktop(label: string, remote: S3v3Remote) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-f01b-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const device = new DesktopStoreDevice(store, root);
  await device.init();
  return { root, store, device, engine: new S3v3SyncEngine({ remote, device, deviceId: label }) };
}

/** 读云端 lake 索引（与引擎同一份对象，不另造口径）。 */
async function cloudLake(remote: MemoryRemote): Promise<{ generation: number; index: LakeIndex }> {
  const pointerBytes = await remote.get(S3V3_POINTER_KEY);
  if (!pointerBytes) throw new Error("缺少 v3 pointer");
  const pointer = JSON.parse(new TextDecoder().decode(pointerBytes)) as { generation: number; lake: { commit: string } };
  const indexBytes = await remote.get(indexKey("lake", pointer.lake.commit));
  if (!indexBytes) throw new Error("缺少 lake 索引");
  return { generation: pointer.generation, index: parseLakeIndexBytes(indexBytes).index };
}

describe("task-77 F-01b：purge 目录后云端 folders[] 不残留（桌面 A 档）", () => {
  it("purge 目录 → 首轮云端不含 → 对端不重建/不回传 → 多轮零变更 → 不复活", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("A", remote);
    const nb = a.store.createNotebook("NB");
    const g = a.store.createGroup(nb.id, "待彻底删除的组");
    a.store.createNoteInAtTopWithContent(g.id, "组内文档", "<p>x</p>", [], "f01b-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });

    const b = await desktop("B", remote);
    await b.engine.sync();

    // A 删除目录（进回收站）→ 同步 → B 拿到回收站目录（为「对端重新发布副本」准备现场）
    a.store.deleteTreeNode(g.id);
    await a.engine.sync();
    await b.engine.sync();

    // A 彻底删除（task-62 的整棵子树 purge：目录 + 子文档墓碑）→ 首轮同步后云端 folders[] 不含该目录
    a.store.purgeTrashItem(g.id);
    const first = await a.engine.sync();
    expect(first.published).toBe(true);
    const afterPurge = await cloudLake(remote);
    expect(afterPurge.index.folders.map((f) => f.id)).not.toContain(g.id);
    expect(afterPurge.index.notes.map((n) => n.id)).not.toContain("f01b-n1");
    // 彻底删除 = 零痕迹：正文对象在首轮同步就清了
    expect(await remote.list("objects/f01b-n1-")).toHaveLength(0);

    // 缺口①的现场证据：目录 purge 墓碑在 → loadState 投影成意图（folderPurgeIntents 的来源）
    expect(a.store.listPurgedTombstones().map((t) => t.id)).toContain(g.id);
    const aState = (await a.device.loadState())!;
    expect(aState.intents.map((i) => i.noteId)).toContain(g.id);

    // 对端同步不得把「已 purge 目录」的回收站副本重新发布（旧缺陷：每轮复活 / 两端互刷），
    // 不得把回收站副本正文重新 PUT 回云端；A 再同步是零变更轮（pointer 不动）。
    const gen = afterPurge.generation;
    for (let round = 0; round < 3; round += 1) {
      const rb = await b.engine.sync();
      expect(rb.published).toBe(false);
      expect(rb.uploadedNotes).toBe(0);
      expect((await cloudLake(remote)).index.folders.map((f) => f.id)).not.toContain(g.id);
      expect(await remote.list("objects/f01b-n1-")).toHaveLength(0);
      const ra = await a.engine.sync();
      expect(ra.published).toBe(false);
      expect(ra.uploadedNotes).toBe(0);
      const stable = await cloudLake(remote);
      expect(stable.generation).toBe(gen);
      expect(stable.index.folders.map((f) => f.id)).not.toContain(g.id);
      expect(stable.index.notes.map((n) => n.id)).not.toContain("f01b-n1");
      expect(await remote.list("objects/f01b-n1-")).toHaveLength(0);
    }

    // 对端：目录不在活跃树（本地只留回收站副本，不参与 S3）；子文档只留在回收站（删除权威）。
    const bState = (await b.device.loadState())!;
    expect(bState.folders.some((f) => f.id === g.id && !f.trashedAt)).toBe(false);
    expect(bState.lake.notes.some((n) => n.id === "f01b-n1" && !n.trashedAt)).toBe(false);
  }, 180_000);
});
