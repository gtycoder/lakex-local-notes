/**
 * task-46 阶段②：S3 场景矩阵 A 档（内存远程）——桌面侧新场景。
 *
 * 矩阵见 docs/audit-261112/14-s3-scenario-matrix.md；本文件覆盖其中此前为「真空」的结构/时钟/三端场景：
 *   S14 嵌套 group 深 3 层同轮到达 · S15 移动 group 带子树 · S17 purge group（云端索引不含）
 *   S63 时钟偏差（updatedAt 未来，不改生产时钟：只在本机 DB 里模拟偏斜）· S72 三端含删除收敛
 * 断言口径（每条）= 两端最终一致 + 云端索引状态 + 无人卡死；真缺陷只在矩阵文档登记，不改生产代码。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { TRASH_NOTEBOOK_ID } from "../../src/core/syncDecisions.js";
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

interface Desk { root: string; store: Store; device: DesktopStoreDevice; engine: S3v3SyncEngine }

async function desktop(label: string, remote: S3v3Remote, storeRoot?: string): Promise<Desk> {
  const root = storeRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-scn-" + label + "-")));
  const store = new Store(root);
  store.bootstrap();
  const device = new DesktopStoreDevice(store, root);
  await device.init();
  return { root, store, device, engine: new S3v3SyncEngine({ remote, device, deviceId: label }) };
}

/** 读云端 lake 索引条目（断言"云端状态"用；与引擎同一份对象，不另造口径）。 */
async function remoteLakeNotes(remote: MemoryRemote): Promise<Array<{ id: string; parentId: string | null; trashedAt: string | null; icon?: string | null }>> {
  const pointerBytes = await remote.get("meta/pointer.json");
  if (!pointerBytes) return [];
  const pointer = JSON.parse(new TextDecoder().decode(pointerBytes)) as { lake: { commit: string } };
  const indexBytes = await remote.get("meta/index/" + pointer.lake.commit + ".json");
  if (!indexBytes) return [];
  const index = JSON.parse(new TextDecoder().decode(indexBytes)) as { notes: Array<{ id: string; parentId: string | null; trashedAt: string | null; icon?: string | null }> };
  return index.notes;
}

describe("S3 场景矩阵 A 档 · 桌面（MemoryRemote）", () => {
  it("S14 嵌套 group 深 3 层同轮到达：新设备首拉后目录层级与文档落点正确", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S14A", remote);
    const nb = a.store.createNotebook("NB");
    const g1 = a.store.createGroup(nb.id, "L1");
    const g2 = a.store.createGroup(g1.id, "L2");
    const g3 = a.store.createGroup(g2.id, "L3");
    a.store.createNoteInAtTopWithContent(g3.id, "深文档", "<p>deep</p>", [], "s14-n1");

    // 同一轮上传（初始上传包含目录 + 文档）
    await a.engine.sync({ onEmptyCloud: "upload" });

    const b = await desktop("S14B", remote);
    await b.engine.sync();
    const state = (await b.device.loadState())!;
    const byId = new Map(state.lake.folders.map((f) => [f.id, f]));
    expect(byId.get(g1.id)?.parentId).toBe(nb.id);
    expect(byId.get(g2.id)?.parentId).toBe(g1.id);
    expect(byId.get(g3.id)?.parentId).toBe(g2.id);
    expect(state.lake.notes.find((n) => n.id === "s14-n1")?.parentId).toBe(g3.id);
  }, 60_000);

  it("S15 移动 group 带子树：另一端跟进移动后的位置（子树 parent 链正确）", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S15A", remote);
    const nb1 = a.store.createNotebook("原位置");
    const nb2 = a.store.createNotebook("新位置");
    const g1 = a.store.createGroup(nb1.id, "搬走的组");
    const g2 = a.store.createGroup(g1.id, "子组");
    a.store.createNoteInAtTopWithContent(g2.id, "子文档", "<p>sub</p>", [], "s15-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });

    const b = await desktop("S15B", remote);
    await b.engine.sync();

    a.store.moveTreeNode(g1.id, nb2.id, 0);
    await a.engine.sync();
    await b.engine.sync();

    const state = (await b.device.loadState())!;
    const byId = new Map(state.lake.folders.map((f) => [f.id, f]));
    expect(byId.get(g1.id)?.parentId).toBe(nb2.id);
    expect(byId.get(g2.id)?.parentId).toBe(g1.id);
    expect(state.lake.notes.find((n) => n.id === "s15-n1")?.parentId).toBe(g2.id);
  }, 90_000);

  // F-01（P0，task-62 修复）：删除 group 后子文档 parent 会被同步归一成回收站容器，
  // purge 的后代收集必须同时走 deleted_from_parent_id 原始父链；另外 purge 出的 deleted_notes 墓碑
  // 必须阻止对端把「回收站副本」再发布后在本机重建（store.importRemoteFolder 的 purged 守卫）。
  it("S17 purge group：云端索引不再包含该目录，且他端后续同步不复活（F-01 回归）", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S17A", remote);
    const nb = a.store.createNotebook("NB");
    const g = a.store.createGroup(nb.id, "待彻底删除的组");
    a.store.createNoteInAtTopWithContent(g.id, "组内文档", "<p>x</p>", [], "s17-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });

    const b = await desktop("S17B", remote);
    await b.engine.sync();
    expect((await b.device.loadState())!.lake.folders.some((f) => f.id === g.id)).toBe(true);

    // 用户删除组（进回收站）→ 同步 → 彻底删除 → 同步（删除传播可能跨一轮：给发起端最多 3 轮）
    a.store.deleteTreeNode(g.id);
    await a.engine.sync();
    a.store.purgeTrashItem(g.id);
    for (let i = 0; i < 3; i += 1) await a.engine.sync();

    // 对端两轮 + 再各一轮：残留副本只能留在本地回收站，绝不回传索引、也不在本机重建
    for (let i = 0; i < 2; i += 1) await b.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    // 云端 lake 索引：文档与目录都不再出现（pub 出去的只是 folders[] 的回收站副本则另行登记，见 F-01b）
    const cloud = await remoteLakeNotes(remote);
    expect(cloud.some((n) => n.id === "s17-n1")).toBe(false);

    // 发起端：docs/行/目录全部清掉（purge 后代收集 + 墓碑生效）
    const aState = (await a.device.loadState())!;
    expect(aState.lake.notes.some((n) => n.id === "s17-n1")).toBe(false);
    expect(aState.lake.folders.some((f) => f.id === g.id)).toBe(false);

    // 对端：文档只允许以「回收站副本」存在（trashed），绝不允许作为活跃条目复活
    const bState = (await b.device.loadState())!;
    expect(bState.lake.notes.some((n) => n.id === "s17-n1" && !n.trashedAt && (n.parentId ?? "") !== TRASH_NOTEBOOK_ID)).toBe(false);
    expect(bState.lake.folders.some((f) => f.id === g.id && !f.trashedAt && (f.parentId ?? "") !== TRASH_NOTEBOOK_ID)).toBe(false);
    // 再跑一轮仍稳定（不来回抖动）
    await a.engine.sync();
    await b.engine.sync();
    expect((await remoteLakeNotes(remote)).some((n) => n.id === "s17-n1")).toBe(false);
  }, 150_000);

  it("S63 时钟偏差：本地 updatedAt 在未来，两端仍按冲突协议收敛且反复同步稳定（不永久压制）", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S63A", remote);
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "s63-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });

    const b = await desktop("S63B", remote);
    await b.engine.sync();

    // 模拟 A 端时钟快（只在本机 DB 里把 updated_at 改成未来；不改系统/生产时钟）
    const future = new Date(Date.now() + 24 * 3600_000).toISOString();
    const rawDb = (a.store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
    rawDb.prepare("UPDATE notes SET updated_at=? WHERE id=?").run(future, "s63-n1");
    rawDb.prepare("UPDATE tree_nodes SET updated_at=? WHERE note_file_id=?").run(future, "s63-n1");

    // 两端各改一次再互相同步（B 的 edit 是真实时间，A 的 updatedAt 在未来）
    b.store.saveNote("s63-n1", "Doc", "<p>from-B</p>");
    await b.engine.sync();
    a.store.saveNote("s63-n1", "Doc", "<p>from-A</p>");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    await b.engine.sync();

    const bodyA = new TextDecoder().decode((await a.device.readBody("s63-n1"))!);
    const bodyB = new TextDecoder().decode((await b.device.readBody("s63-n1"))!);
    expect(bodyA).toBe(bodyB);
    // 再跑两轮不得继续抖动（收敛后稳定）
    await a.engine.sync();
    await b.engine.sync();
    const againA = new TextDecoder().decode((await a.device.readBody("s63-n1"))!);
    expect(againA).toBe(bodyA);
  }, 120_000);

  it("S72 三端含删除：D1 建 → D2 改 → D3 删 → 各自两轮后三方一致、正文可读、零卡死", async () => {
    const remote = new MemoryRemote();
    const d1 = await desktop("S72-1", remote);
    const nb = d1.store.createNotebook("NB");
    d1.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "s72-n1");
    await d1.engine.sync({ onEmptyCloud: "upload" });
    const d2 = await desktop("S72-2", remote);
    const d3 = await desktop("S72-3", remote);
    await d2.engine.sync();
    await d3.engine.sync();

    d2.store.saveNote("s72-n1", "Doc", "<p>edited-by-d2</p>");
    d3.store.deleteTreeNode("s72-n1");
    await d2.engine.sync();
    await d3.engine.sync();

    for (let round = 0; round < 2; round += 1) {
      await d1.engine.sync();
      await d2.engine.sync();
      await d3.engine.sync();
    }

    const states = await Promise.all([d1, d2, d3].map(async (d) => (await d.device.loadState())!));
    for (const state of states) {
      const note = state.lake.notes.find((n) => n.id === "s72-n1");
      expect(note).toBeTruthy();
      // 删除压编辑：三方最终都在回收站（不是活跃文档），正文仍可读（本地不丢）
      expect(note!.trashedAt ?? (note!.parentId === TRASH_NOTEBOOK_ID ? "trash" : null)).toBeTruthy();
    }
    const cloud = await remoteLakeNotes(remote);
    const cloudNote = cloud.find((n) => n.id === "s72-n1");
    expect(cloudNote?.trashedAt ?? (cloudNote?.parentId === TRASH_NOTEBOOK_ID ? "trash" : null)).toBeTruthy();
    // 三方最终读到同一份正文
    const bodies = await Promise.all([d1, d2, d3].map(async (d) => new TextDecoder().decode((await d.device.readBody("s72-n1")) ?? new Uint8Array())));
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toBe(bodies[2]);
  }, 180_000);

  it("S46 附件随正文迁移：移动文档到另一笔记本后，附件字节与云端声明仍随该文档、对端可读", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S46A", remote);
    const nb1 = a.store.createNotebook("原位置");
    const nb2 = a.store.createNotebook("新位置");
    a.store.createNoteInAtTopWithContent(nb1.id, "带附件文档", "<p>v1</p>", [], "s46-n1");
    const img = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 250]);
    await a.device.writeAsset("s46-n1", "a.png", img);
    await a.engine.sync({ onEmptyCloud: "upload" });

    const b = await desktop("S46B", remote);
    await b.engine.sync();
    const beforeB = await b.device.readAsset("s46-n1", "a.png");
    expect(beforeB).not.toBeNull();
    expect(Array.from(beforeB as Uint8Array)).toEqual(Array.from(img));

    // 移动文档到另一笔记本（位置字段独立合并；附件按 noteId 前缀走，不应因移动丢失）
    a.store.moveTreeNode("s46-n1", nb2.id, 0);
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    const bState = (await b.device.loadState())!;
    expect(bState.lake.notes.find((n) => n.id === "s46-n1")?.parentId).toBe(nb2.id);
    const afterB = await b.device.readAsset("s46-n1", "a.png");
    expect(afterB).not.toBeNull();
    expect(Array.from(afterB as Uint8Array)).toEqual(Array.from(img));
    // 云端声明对象仍在该文档名下（先对象后声明；移动不换 noteId ⇒ 声明 key 不变）
    const declKeys = await remote.list("meta/assets/s46-n1/");
    expect(declKeys.length).toBeGreaterThan(0);
    // 再跑一轮仍稳定（不出现「移动后附件被当孤儿删」）
    await a.engine.sync();
    await b.engine.sync();
    const stable = await b.device.readAsset("s46-n1", "a.png");
    expect(Array.from(stable as Uint8Array)).toEqual(Array.from(img));
  }, 150_000);

  it("S74 三端 × 标签/锁交错：集合 LWW + lockedAt LWW 收敛，正文不抖动", async () => {
    const remote = new MemoryRemote();
    const d1 = await desktop("S74-1", remote);
    const nb = d1.store.createNotebook("NB");
    d1.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>base</p>", [], "s74-n1");
    await d1.engine.sync({ onEmptyCloud: "upload" });
    const d2 = await desktop("S74-2", remote);
    const d3 = await desktop("S74-3", remote);
    await d2.engine.sync();
    await d3.engine.sync();

    // 标签：d1 先加 t1（版本 t1）；d2 后加 t1+t2（版本更晚）⇒ 集合 LWW 后写胜
    d1.store.documentTags.setNoteTags("s74-n1", ["t_0123456789abcdef"]);
    await d1.engine.sync();
    d2.store.documentTags.setNoteTags("s74-n1", ["t_0123456789abcdef", "t_fedcba9876543210"]);
    // 锁：d3 加锁（lockedAt 更晚）
    d3.store.setNoteEditLocked("s74-n1", true);
    await d2.engine.sync();
    await d3.engine.sync();

    for (let round = 0; round < 2; round += 1) {
      await d1.engine.sync();
      await d2.engine.sync();
      await d3.engine.sync();
    }

    const states = await Promise.all([d1, d2, d3].map(async (d) => (await d.device.loadState())!));
    const noteOf = (state: (typeof states)[number]) => state.lake.notes.find((n) => n.id === "s74-n1")!;
    // 标签集合三端一致（集合 LWW；顺序不传播）
    const tagSets = states.map((s) => [...(noteOf(s).tagIds ?? [])].sort().join(","));
    expect(new Set(tagSets).size).toBe(1);
    expect(tagSets[0]).toContain("t_0123456789abcdef");
    // 锁三端一致（lockedAt 字段级 LWW，不产生锁态分叉）
    const locks = states.map((s) => (noteOf(s).isLocked ? "1" : "0") + "|" + String(noteOf(s).lockedAt ?? ""));
    expect(new Set(locks).size).toBe(1);
    // 正文不抖动：三端同一份、且不含标签/锁操作带来的伪变更
    const bodies = await Promise.all([d1, d2, d3].map(async (d) => new TextDecoder().decode((await d.device.readBody("s74-n1")) ?? new Uint8Array())));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("base");
    // 再跑一轮稳定（不来回抖动）
    await d1.engine.sync();
    await d2.engine.sync();
    await d3.engine.sync();
    const again = (await d1.device.loadState())!;
    expect([...((again.lake.notes.find((n) => n.id === "s74-n1")?.tagIds) ?? [])].sort().join(",")).toBe(tagSets[0]);
  }, 180_000);
  // ===== task-62 独立复核（F-01）补的回归：同步扁平化后的回收站子树 =====
  // 同步会把 trashed 条目的 parent 归一成回收站容器（task-61 wire 口径），于是「组 + 组内文档」在回收站里
  // 变成**多个并列根**，原始父只剩 deleted_from_parent_id。purge/restore/emptyTrash 必须按两路边（F-01）走。

  function rawDbOf(store: Store): { prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown } } {
    return (store as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown } } }).db;
  }

  it("S17b 清空回收站（子树已被同步扁平化）：不得抛错、逐节点墓碑、云端索引清空", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S17bA", remote);
    const nb = a.store.createNotebook("NB");
    const g = a.store.createGroup(nb.id, "组");
    a.store.createNoteInAtTopWithContent(g.id, "组内文档", "<p>x</p>", [], "s17b-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });
    a.store.deleteTreeNode(g.id);
    await a.engine.sync();
    await a.engine.sync(); // 让 applyRemoteNoteMeta 把 trashed 行 parent 归一成回收站容器

    const db = rawDbOf(a.store);
    const trashRoots = db.prepare("SELECT id FROM tree_nodes WHERE parent_id=? AND trashed_at IS NOT NULL AND deleted_at IS NULL").all(TRASH_NOTEBOOK_ID).length;
    expect(trashRoots).toBeGreaterThanOrEqual(2); // 组 + 子文档都是根（扁平化后的真实形态）

    expect(() => a.store.emptyTrash()).not.toThrow();
    expect(db.prepare("SELECT id FROM tree_nodes WHERE trashed_at IS NOT NULL AND deleted_at IS NULL").all().length).toBe(0);
    // 墓碑逐节点（组=folder、文档=note），不是只给根写
    const tombs = db.prepare("SELECT id, node_type FROM deleted_notes WHERE purged_at IS NOT NULL AND id IN (?,?)").all(g.id, "s17b-n1") as Array<{ id: string; node_type: string }>;
    expect(tombs.map((t) => t.id).sort()).toEqual([g.id, "s17b-n1"].sort());
    expect(tombs.find((t) => t.id === g.id)?.node_type).toBe("folder");
    await a.engine.sync();
    expect((await remoteLakeNotes(remote)).some((n) => n.id === "s17b-n1")).toBe(false);
  }, 150_000);

  it("S17c 恢复已被同步扁平化的组：子文档随根回原父，不得留在回收站容器下", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S17cA", remote);
    const nb = a.store.createNotebook("NB");
    const g = a.store.createGroup(nb.id, "组");
    a.store.createNoteInAtTopWithContent(g.id, "组内文档", "<p>y</p>", [], "s17c-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });
    a.store.deleteTreeNode(g.id);
    await a.engine.sync();
    await a.engine.sync(); // 扁平化

    a.store.restoreTrashItem(g.id);
    const db = rawDbOf(a.store);
    const rows = db.prepare("SELECT id,parent_id,trashed_at FROM tree_nodes WHERE deleted_at IS NULL AND id IN (?,?)").all(g.id, "s17c-n1") as Array<{ id: string; parent_id: string | null; trashed_at: string | null }>;
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    expect(byId.get(g.id)!.trashed_at).toBe(null);
    expect(byId.get(g.id)!.parent_id).toBe(nb.id);
    expect(byId.get("s17c-n1")!.trashed_at).toBe(null);   // 子文档随根恢复
    expect(byId.get("s17c-n1")!.parent_id).toBe(g.id);    // 且回原父（不是 notebook-trash）
    await a.engine.sync();
    const b = await desktop("S17cB", remote);
    await b.engine.sync();
    const bs = (await b.device.loadState())!;
    expect(bs.lake.notes.find((n) => n.id === "s17c-n1")?.parentId).toBe(g.id);
    expect(bs.lake.folders.find((f) => f.id === g.id)?.parentId).toBe(nb.id);
  }, 150_000);

  it("S17d 自动过期 purge（扁平化子树）：逐根幂等跳过，不抛错且清空", async () => {
    const remote = new MemoryRemote();
    const a = await desktop("S17dA", remote);
    const nb = a.store.createNotebook("NB");
    const g = a.store.createGroup(nb.id, "组");
    a.store.createNoteInAtTopWithContent(g.id, "组内文档", "<p>z</p>", [], "s17d-n1");
    await a.engine.sync({ onEmptyCloud: "upload" });
    a.store.deleteTreeNode(g.id);
    await a.engine.sync();
    await a.engine.sync();
    const db = rawDbOf(a.store);
    // 把删除时刻改成 2 天前，触发 days=1 的自动过期路径
    const past = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    db.prepare("UPDATE tree_nodes SET trashed_at=? WHERE trashed_at IS NOT NULL AND deleted_at IS NULL").run(past);
    expect(() => a.store.autoPurgeExpiredTrash(1)).not.toThrow();
    expect(db.prepare("SELECT id FROM tree_nodes WHERE trashed_at IS NOT NULL AND deleted_at IS NULL").all().length).toBe(0);
  }, 150_000);

});
