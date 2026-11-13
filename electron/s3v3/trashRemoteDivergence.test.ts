import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { MemoryRemote } from "./deviceConformance.js";
import { S3V3_POINTER_KEY, indexKey } from "../../src/core/s3v3/protocol/s3v3Keys.js";
import { parseLakeIndexBytes, type LakeIndex } from "../../src/core/s3v3/protocol/s3v3Index.js";

/**
 * 261112 真实 S3 三端验收抓到的三个同步缺陷的回归（桌面端口 + 共享编排）：
 *  P0  本地已进回收站 + 他端编辑并发布 ⇒ 曾整轮抛 INTERNAL saveState 失败，设备永久卡死；
 *  P1-a 同一轮到达的嵌套目录（分组）父先/子后顺序不定 ⇒ 子目录被落成根（parentId=null）；
 *  P1-b 本地 purge 目录后若本轮无其它变更 ⇒ 零变更短路不发布，云端索引永久保留已删目录。
 * 语义裁决（用户定稿）：回收站 = 特殊笔记本，移动 = 位置字段；**内容编辑与位置移动是独立字段**。
 */
async function mkDevice() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-div-"));
  const store = new Store(root);
  store.bootstrap();
  const device = new DesktopStoreDevice(store, root);
  await device.init();
  return { root, store, device };
}

/** 读云端当前 lake 索引（指针 → 内容寻址索引），用于「purge 后索引不含该目录」。 */
async function readCloudIndex(remote: MemoryRemote): Promise<LakeIndex> {
  const pointerBytes = await remote.get(S3V3_POINTER_KEY);
  if (!pointerBytes) throw new Error("缺少 v3 pointer");
  const pointer = JSON.parse(new TextDecoder().decode(pointerBytes)) as { lake: { commit: string } };
  const indexBytes = await remote.get(indexKey("lake", pointer.lake.commit));
  if (!indexBytes) throw new Error("缺少 lake 索引");
  return parseLakeIndexBytes(indexBytes).index;
}


async function readCloudPointer(remote: MemoryRemote): Promise<{ lakeCommit: string; generation: number }> {
  const bytes = await remote.get(S3V3_POINTER_KEY);
  if (!bytes) throw new Error("缺少 v3 pointer");
  const p = JSON.parse(new TextDecoder().decode(bytes)) as { lake: { commit: string }; generation: number };
  return { lakeCommit: p.lake.commit, generation: p.generation };
}
async function readCloudIndexRaw(remote: MemoryRemote): Promise<string> {
  const ptr = await readCloudPointer(remote);
  const bytes = await remote.get(indexKey("lake", ptr.lakeCommit));
  if (!bytes) throw new Error("缺少 lake 索引");
  return new TextDecoder().decode(bytes);
}

describe("同步分歧收口（261112 真实 S3 回归）", () => {
  it("P0：本地回收站 + 他端编辑 → 应用内容、保留回收站、单轮不抛错", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("NB-P0");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc1", "<p>正文一</p>", [], "n1");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();

      // A 本地移入回收站（**不先同步**）；B 编辑并发布（远端仍 active）
      a.store.deleteNote("n1");
      expect(a.store.listTrash().some((t) => t.id === "n1")).toBe(true);
      b.store.saveNote("n1", "标题二", "<p>他端改过</p>");
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();

      // 关键：A 的同步必须成功（修复前抛 INTERNAL，且之后每轮都抛 = 永久卡死）
      const r = await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      expect(r).toBeTruthy();
      // 生命周期保留：仍在回收站、不在活跃树（不隐式恢复）
      expect(a.store.listTrash().some((t) => t.id === "n1")).toBe(true);
      expect(a.store.listTreeNodes().some((n) => n.id === "n1" && n.nodeType === "note")).toBe(false);
      // 内容已应用（内容与位置独立）
      expect(a.store.readNote("n1").content).toBe("<p>他端改过</p>");
      // task-104 F-15：回收站行接收同步正文后 dirty 必须清掉（否则下一轮会把回收站内容当本地改动上传）。
      const dirtyRow = (a.store as unknown as { db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } }).db
        .prepare("SELECT is_dirty FROM notes WHERE id=?").get("n1") as { is_dirty: number } | undefined;
      expect(dirtyRow?.is_dirty).toBe(0);
      // 再跑一轮稳定（不反复失败）
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      expect(a.store.listTrash().some((t) => t.id === "n1")).toBe(true);
      // task-44 收敛：A 必须把自己的位置（回收站）**发布出去**（云端 trashedAt 非空），B 跟随进回收站。
      const idx1 = await readCloudIndex(remote);
      const entry1 = idx1.notes.find((n) => n.id === "n1")!;
      expect(entry1.trashedAt ?? null).not.toBe(null);
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTrash().some((t) => t.id === "n1")).toBe(true);
      // 多轮不抖动：再来两轮，两端都稳定在回收站、云端 trashedAt 保持不变
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(a.store.listTrash().some((t) => t.id === "n1")).toBe(true);
      expect(b.store.listTrash().some((t) => t.id === "n1")).toBe(true);
      expect((await readCloudIndex(remote)).notes.find((n) => n.id === "n1")!.trashedAt ?? null).not.toBe(null);

      // 显式恢复仍是唯一恢复路径（且恢复也要传播回去）
      a.store.restoreTrashItem("n1");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      expect(a.store.listTreeNodes().some((n) => n.id === "n1" && n.nodeType === "note")).toBe(true);
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTreeNodes().some((n) => n.id === "n1" && n.nodeType === "note")).toBe(true);
    } finally {
      a.store.close();
      b.store.close();
    }
  }, 180_000);


  it("P0-b：本地移动 vs 他端内容编辑 → 移动不被内容 edit 回滚，且云端/对端都是移动后的位置", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nbA = a.store.createNotebook("MOVE-A");
      const nbB = a.store.createNotebook("MOVE-B");
      a.store.createNoteInAtTopWithContent(nbA.id, "Doc", "<p>原文</p>", [], "m1");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();

      // A 本地把文档移到 nbB（未同步）；B 改正文（updatedAt 更晚）
      a.store.moveTreeNodeOrdered("m1", nbB.id, ["m1"]);
      b.store.saveNote("m1", "Doc", "<p>B 改过</p>");
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();

      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      // A：正文变 B 版、位置仍在自己移动后的目录
      expect(a.store.readNote("m1").content).toBe("<p>B 改过</p>");
      expect(a.store.listTreeNodes().find((n) => n.id === "m1")!.parentId).toBe(nbB.id);
      // 云端索引：正文 B 版 + 位置 = nbB
      const idx = await readCloudIndex(remote);
      expect(idx.notes.find((n) => n.id === "m1")!.parentId).toBe(nbB.id);
      expect(idx.notes.find((n) => n.id === "m1")!.contentHash).toBe(
        (await import("../../src/core/syncUtils.js")).sha256Hex(new TextEncoder().encode("<p>B 改过</p>")),
      );
      // B 跟随移动
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTreeNodes().find((n) => n.id === "m1")!.parentId).toBe(nbB.id);
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("P0-d：并发移动（两端各移到不同目录）→ 按 updatedAt LWW 选出同一赢家，两端收敛一致", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nbA = a.store.createNotebook("CONC-A");
      const nbB = a.store.createNotebook("CONC-B");
      const nbC = a.store.createNotebook("CONC-C");
      a.store.createNoteInAtTopWithContent(nbA.id, "Doc", "<p>x</p>", [], "c1");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      // B 先移（较晚的 updatedAt 由后续 A 移决定赢家；只断言「收敛到同一方」，不锁方向）
      b.store.moveTreeNodeOrdered("c1", nbB.id, ["c1"]);
      await new Promise((r) => setTimeout(r, 15));
      a.store.moveTreeNodeOrdered("c1", nbC.id, ["c1"]);
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      const pa = a.store.listTreeNodes().find((n) => n.id === "c1")!.parentId;
      const pb = b.store.listTreeNodes().find((n) => n.id === "c1")!.parentId;
      expect(pa).toBe(pb);                      // 两端一致
      expect([nbB.id, nbC.id]).toContain(pa);    // 且落在「本端移动过的其中一方」
      expect((await readCloudIndex(remote)).notes.find((n) => n.id === "c1")!.parentId).toBe(pa);
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("P0-c：首次上传（无基线）就带回收站位置 → 云端 trashedAt 非空（无基线不会被永久压成回收站）", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    try {
      const nb = a.store.createNotebook("FRESH");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>y</p>", [], "f1");
      a.store.deleteNote("f1"); // 还没配云同步就先删了（无基线）
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      const entry = (await readCloudIndex(remote)).notes.find((n) => n.id === "f1")!;
      expect(entry).toBeTruthy();
      expect(entry.trashedAt ?? null).not.toBe(null);   // 位置随首传发布
    } finally { a.store.close(); }
  }, 180_000);

  it("P1-a：同轮到达的嵌套目录 → 父先落库，分组 parent 不为 null", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("NB-NEST");
      const grp = a.store.createGroup(nb.id, "GRP-NEST");
      expect(a.store.listTreeNodes().find((n) => n.id === grp.id)!.parentId).toBe(nb.id);
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      // 云端索引里 parent 正确（publish 侧本来就对）
      const idx = await readCloudIndex(remote);
      expect(idx.folders.find((f) => f.id === grp.id)!.parentId).toBe(nb.id);
      // 对端 apply 后 parent 也必须正确（修复前会被落成根目录 = null）
      expect(b.store.listTreeNodes().find((n) => n.id === grp.id)!.parentId).toBe(nb.id);
      // 多轮同步之后仍必须正确：真实 S3 上「合并层类型丢失」会在后续轮把 parent 覆写成 null
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTreeNodes().find((n) => n.id === grp.id)!.parentId).toBe(nb.id);
    } finally {
      a.store.close();
      b.store.close();
    }
  }, 180_000);


  it("P2（task-61）：wire 不携带本地回收站容器 id（发布 parentId=null / 多轮不抖 / 恢复回原父）", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("T61");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "t61");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();

      // A 移入回收站（本地 notes.parent_id 指向本地容器 notebook-trash）
      a.store.deleteNote("t61");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      const idx = await readCloudIndex(remote);
      const entry = idx.notes.find((n) => n.id === "t61")!;
      expect(entry).toBeTruthy();
      expect(entry.trashedAt ?? null).not.toBe(null);
      expect(entry.parentId ?? null).toBe(null);            // ① trashed 条目 parentId=null
      expect(entry.deletedFromParentId ?? null).toBe(nb.id); // 原始父仍可恢复
      const raw = await readCloudIndexRaw(remote);
      expect(raw).not.toContain("notebook-trash");           // ① 全文无本地容器 id
      expect(idx.folders.some((f) => f.id === "notebook-trash")).toBe(false);

      // ② 双端多轮往返：位置赢家稳定，不产生新的 index 发布（不抖动）
      // 说明：收件端把「远端 tombstone → 本地回收站」按同轮本地动作优先（lifecycleRace 守卫）落自己的 trashedAt，
      // 下一轮会用本机 trashedAt 归一一次（这是既有守卫，不是每轮抖动）⇒ 先跑两轮收敛，再测稳定。
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTrash().some((t) => t.id === "t61")).toBe(true);
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      const before = await readCloudPointer(remote);
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      const after = await readCloudPointer(remote);
      expect(after.lakeCommit).toBe(before.lakeCommit);      // 多轮不抖动（无每轮 indexChanged）
      // 归一后云端 trashedAt 仍是同一值（不被本地容器 id / 时间戳来回改写）
      expect((await readCloudIndex(remote)).notes.find((n) => n.id === "t61")!.parentId ?? null).toBe(null);

      // ③ 恢复回原父（deletedFromParentId 生效 + 发布 parentId 回到原父）
      a.store.restoreTrashItem("t61");
      expect(a.store.listTreeNodes().find((n) => n.id === "t61")!.parentId).toBe(nb.id);
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      const restored = (await readCloudIndex(remote)).notes.find((n) => n.id === "t61")!;
      expect(restored.trashedAt ?? null).toBe(null);
      expect(restored.parentId).toBe(nb.id);
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTreeNodes().find((n) => n.id === "t61")!.parentId).toBe(nb.id);
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("P1-b：本地 purge 目录后，新发布的云端索引不含该目录", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("NB-PURGE");
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect((await readCloudIndex(remote)).folders.some((f) => f.id === nb.id)).toBe(true);

      a.store.deleteTreeNode(nb.id);
      a.store.purgeTrashItem(nb.id);
      // 只同步一次：修复前「零变更短路」会跳过发布，云端索引永久保留已删目录
      await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
      expect((await readCloudIndex(remote)).folders.some((f) => f.id === nb.id)).toBe(false);
      // 对端跟随删除（进回收站），不复活
      await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(b.store.listTreeNodes().some((n) => n.id === nb.id)).toBe(false);
    } finally {
      a.store.close();
      b.store.close();
    }
  }, 180_000);
});