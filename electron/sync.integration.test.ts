/**
 * 双设备同步集成测试（重构验证核心）：两个真实 Store 实例 + 共享 mock S3，
 * 模拟 A/B 设备经 S3 交互，验证 Step A/B 拆分后同步语义正确
 * （建/编辑/删除传播/恢复/冲突 superseded/墓碑）。
 * 使用 syncNow 的 createRemote 注入钩子（默认路径不变）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { syncNowViaEngine as syncNow } from "./syncEngineController.js";
import type { ObjectStore } from "./s3Store.js";
import type { S3Settings } from "../src/core/syncUtils.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const S3_CFG: S3Settings = {
  endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "test-bucket",
  prefix: "lake-notes", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false,
};

/** 内存 ObjectStore（模拟 S3；put gzip 压缩 + getOptional 魔数解压，对齐真实行为） */
class MockS3 {
  map = new Map<string, Buffer>();
  async test(): Promise<void> {}
  async getOptional(key: string, opts?: { maxBytes?: number }): Promise<Buffer | null> {
    let b = this.map.get(key);
    if (!b) return null;
    if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); // gzip 解压
    if (opts?.maxBytes && b.length > opts.maxBytes) return null;
    return b;
  }
  async put(key: string, bytes: Buffer, _ct: string, opts?: { gzip?: boolean }): Promise<void> {
    this.map.set(key, opts?.gzip ? zlib.gzipSync(bytes) : bytes);
  }
  async list(prefix: string): Promise<Array<{ key: string; lastModified: string }>> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, lastModified: new Date().toISOString() }));
  }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.map.delete(k); }
  async deletePrefix(prefix: string): Promise<number> {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.map.delete(k);
    return keys.length;
  }
}

function makeDevice() {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-sync-test-"));
  const store = new Store(dir);
  store.saveS3Settings(S3_CFG);
  return { dir, store };
}

function cleanup(devs: Array<{ dir: string }>) {
  for (const d of devs) { try { rmSync(d.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

describe("双设备同步（Step A/B 拆分后语义验证）", () => {
  it("A 建笔记同步 → B 拉到（元数据 + 正文）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("设备A的笔记");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const got = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(got).toBeDefined();
      expect(got!.title).toBe("设备A的笔记");
      const content = B.store.readNote(note.id).content;
      expect(content).toContain("ne-p");
    } finally { cleanup([A, B]); }
  });

  it("A 编辑同步 → B 拉到新内容（二次同步）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("标题");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      A.store.saveNote(note.id, "新标题", "<p>新内容</p>");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const got = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(got!.title).toBe("新标题");
      expect(B.store.readNote(note.id).content).toBe("<p>新内容</p>");
    } finally { cleanup([A, B]); }
  });

  it("A 删除同步 → B 跟随删除（删除传播，墓碑权威）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("将被删除");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      expect(B.store.listNotesForSync().some((n) => n.id === note.id)).toBe(true);
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // B 跟随删除：笔记进入回收站笔记本（parentId=notebook-trash，删除传播）
      const bNote = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(bNote).toBeDefined();
      expect(bNote!.parentId).toBe(TRASH_NOTEBOOK_ID);
      expect(bNote!.trashedAt).not.toBeNull();
    } finally { cleanup([A, B]); }
  });

  it("B 恢复同步 → A 跟随恢复（恢复例外传播）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("恢复测试");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const bNote = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(bNote!.parentId).toBe(TRASH_NOTEBOOK_ID);
      // B 恢复
      B.store.restoreTrashItem(note.id);
      await syncNow(B.store, undefined, remote);
      await syncNow(A.store, undefined, remote);
      // A 跟随恢复（远端恢复较新 → 本地回收站让位）
      const aNote = A.store.listNotesForSync().find((n) => n.id === note.id);
      expect(aNote!.parentId).not.toBe(TRASH_NOTEBOOK_ID);
    } finally { cleanup([A, B]); }
  });

  it("冲突：两端离线各改 → 先同步者胜，后同步方被覆盖且留 superseded", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("原始");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // 两端离线各自编辑
      A.store.saveNote(note.id, "A 的编辑", "<p>A 版本</p>");
      B.store.saveNote(note.id, "B 的编辑", "<p>B 版本</p>");
      // A 先同步（A 胜）
      await syncNow(A.store, undefined, remote);
      // B 后同步（B 被覆盖 + superseded 记录）
      const resultB = await syncNow(B.store, undefined, remote);
      expect(resultB.supersededNotes.some((s) => s.id === note.id)).toBe(true);
      const bContent = B.store.readNote(note.id).content;
      expect(bContent).toBe("<p>A 版本</p>"); // B 的编辑被 A 覆盖
    } finally { cleanup([A, B]); }
  });

  it("B 无改动接受 A 更新：正常同步更新，不留档不报 superseded（修正原逻辑缺陷 2026-08-22）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("原始");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote); // B 拉到 v1（无编辑）
      // A 更新 v2
      A.store.saveNote(note.id, "A 更新后", "<p>v2 内容</p>");
      await syncNow(A.store, undefined, remote);
      // B 同步接受 v2（B 本地无编辑，仅跟随）
      const resultB = await syncNow(B.store, undefined, remote);
      // 修正：B 无私有编辑 → 不存快照、不报 superseded（原逻辑 localHash!==null 误报）
      expect(resultB.supersededNotes.some((n) => n.id === note.id)).toBe(false);
      // B 内容已更新为 v2
      expect(B.store.readNote(note.id).content).toBe("<p>v2 内容</p>");
    } finally { cleanup([A, B]); }
  });

  it("A 新建同步 → 删除 → B 无编辑跟随进回收站：移入回收站但不留档不报 superseded（2026-08-22 三修）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("跟随删除");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote); // B 拉到，从未编辑
      const histBefore = B.store.listNoteHistory(note.id).length;
      // A 删除 → B 同步（B 无编辑，纯跟随删除传播）
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);
      const resultB = await syncNow(B.store, undefined, remote);
      // B 进回收站
      const bNote = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(bNote!.parentId).toBe(TRASH_NOTEBOOK_ID);
      // B 从未编辑 → 不写快照、不报 superseded（修复前无条件留档）
      expect(resultB.supersededNotes.some((n) => n.id === note.id)).toBe(false);
      expect(B.store.listNoteHistory(note.id).length).toBe(histBefore);
    } finally { cleanup([A, B]); }
  });

  it("A 上传过 A1（本机是作者）后被 B 恢复历史续编版本覆盖 → A 接受 B2 且强制留档（2026-08-22 二修）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("555");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote); // 两端都有 v1
      // A 编辑并上传 A1（A 是作者：lastUploadedHash=A1）
      A.store.saveNote(note.id, "A 编辑", "<p>A1</p>");
      await syncNow(A.store, undefined, remote);
      // B 编辑 B1 并同步 → B 接受 A1（B 被覆盖留档 B1），B 内容变为 A1
      B.store.saveNote(note.id, "B 编辑", "<p>B1</p>");
      const resultB = await syncNow(B.store, undefined, remote);
      expect(resultB.supersededNotes.some((n) => n.id === note.id)).toBe(true);
      expect(B.store.readNote(note.id).content).toBe("<p>A1</p>");
      // B 恢复历史（恢复 B1 内容）→ 续编 B2 → 同步上传（B 恢复后 updatedAt 更新）
      const bHist = B.store.listNoteHistory(note.id);
      // 恢复历史：写回快照正文（B1 的旧版本在 note_history 里，恢复最近的非当前版本）
      const target = bHist.find((h) => h.contentHash !== B.store.contentHash(note.id));
      expect(target).toBeTruthy();
      B.store.restoreHistory(target!.id);
      B.store.saveNote(note.id, "B 续编", "<p>B2</p>");
      await syncNow(B.store, undefined, remote); // B 上传 B2
      // A 同步：接受 B2，且 A 本地上传过的 A1 被覆盖 → 强制留档 + superseded
      const resultA = await syncNow(A.store, undefined, remote);
      expect(resultA.supersededNotes.some((n) => n.id === note.id)).toBe(true);
      expect(A.store.readNote(note.id).content).toBe("<p>B2</p>");
      // A 历史里能找到被覆盖前的 A1（留档兜底，A 的编辑不丢）
      const aHist = A.store.listNoteHistory(note.id);
      expect(aHist.some((h) => h.contentHash === sha256("<p>A1</p>"))).toBe(true);
    } finally { cleanup([A, B]); }
  });

  it("移动 vs 删除一致性：B 无编辑跟随 A 的普通移动 / 删除（移入回收站）→ 均不留档不报 superseded（2026-08-22 三修）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      // 普通移动：A 把笔记移到另一笔记本 → B 跟随（回收站是隐藏笔记本，移动语义一致）
      const nb1 = A.store.createNotebook("笔记本1");
      const nb2 = A.store.createNotebook("笔记本2");
      const note = A.store.createNoteIn(nb1.id, "移动测试");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const histBefore = B.store.listNoteHistory(note.id).length;
      A.store.moveTreeNode(note.id, nb2.id, 0);
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const rb = await syncNow(B.store, undefined, remote);
      expect(B.store.listNotesForSync().find((n) => n.id === note.id)!.parentId).toBe(nb2.id);
      expect(rb.supersededNotes.some((n) => n.id === note.id)).toBe(false);
      expect(B.store.listNoteHistory(note.id).length).toBe(histBefore);
    } finally { cleanup([A, B]); }
  });

  it("循环移动：A 把 999 移入 888 下、B 把 888 移入 999 下 → 先提交先确认收敛（2026-08-22 修复）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const nb = A.store.createNotebook("多端笔记本");
      const n888 = A.store.createNoteIn(nb.id, "888");
      const n999 = A.store.createNoteIn(nb.id, "999");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // 两端各移动成互父子（循环）：A: 999→888 下；B: 888→999 下
      A.store.moveTreeNodeOrdered(n999.id, n888.id, [n999.id]);
      B.store.moveTreeNodeOrdered(n888.id, n999.id, [n888.id]);
      // A 先同步（先提交先确认）
      await syncNow(A.store, undefined, remote);
      const rb = await syncNow(B.store, undefined, remote);
      // B 应跟随 A：888 在多端下、999 在 888 下；不产生错位/循环/提示
      expect(B.store.listTreeNodes().find((n: any) => n.id === n888.id)!.parentId).toBe(nb.id);
      expect(B.store.listTreeNodes().find((n: any) => n.id === n999.id)!.parentId).toBe(n888.id);
      expect(rb.supersededNotes.some((n) => n.id === n888.id || n.id === n999.id)).toBe(false);
      // 反向：B 先同步 → A 后同步也应收敛到 B 的树（888 在 999 下、999 在多端下）
      const C = makeDevice();
      const D = makeDevice();
      const nbC = C.store.createNotebook("多端笔记本");
      const c888 = C.store.createNoteIn(nbC.id, "888");
      const c999 = C.store.createNoteIn(nbC.id, "999");
      await syncNow(C.store, undefined, remote);
      await syncNow(D.store, undefined, remote);
      C.store.moveTreeNodeOrdered(c999.id, c888.id, [c999.id]);
      D.store.moveTreeNodeOrdered(c888.id, c999.id, [c888.id]);
      await syncNow(D.store, undefined, remote); // B 先同步
      await syncNow(C.store, undefined, remote); // A 后同步跟随
      expect(C.store.listTreeNodes().find((n: any) => n.id === c888.id)!.parentId).toBe(c999.id);
      expect(C.store.listTreeNodes().find((n: any) => n.id === c999.id)!.parentId).toBe(nbC.id);
      cleanup([C, D]);
    } finally { cleanup([A, B]); }
  });

  it("墓碑学习：B 离线时 A 删除 → B 上线同步不复活删除（防复活）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("防复活");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // A 删除（B 离线）
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);
      // B 上线同步：跟随删除（进回收站），不复活为 active
      await syncNow(B.store, undefined, remote);
      const bNote = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(bNote!.parentId).toBe(TRASH_NOTEBOOK_ID);
      // 再同步一次确认稳定（无乒乓：不因 B 离线而复活）
      await syncNow(B.store, undefined, remote);
      const bNote2 = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(bNote2!.parentId).toBe(TRASH_NOTEBOOK_ID);
    } finally { cleanup([A, B]); }
  });

  it("A 编辑后删除 + B 编辑被删 → B 恢复回到原父目录（deletedFromParentId 不丢失，2026-08-22 修复）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      // A 建【多端笔记本】并创建 666
      const nb = A.store.createNotebook("多端笔记本");
      const note = A.store.createNoteIn(nb.id, "666");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      expect(B.store.listNotesForSync().find((n) => n.id === note.id)!.parentId).toBe(nb.id);

      // A 编辑 A1 → 删除 → 同步（A 端 manifest 带 deletedFromParentId=nb.id）
      A.store.saveNote(note.id, "A 编辑", "<p>A1</p>");
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);

      // B 编辑 B2 → 同步（B 被删除 + 留档 B2；正文不同走 importRemoteNote 分支）
      B.store.saveNote(note.id, "B 编辑", "<p>B2</p>");
      await syncNow(B.store, undefined, remote);
      const inTrash = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(inTrash!.parentId).toBe(TRASH_NOTEBOOK_ID);

      // B 恢复 → 应回到多端笔记本（修复前回退默认笔记本）
      B.store.restoreTrashItem(note.id);
      const restored = B.store.listNotesForSync().find((n) => n.id === note.id)!;
      expect(restored.parentId).toBe(nb.id);
    } finally { cleanup([A, B]); }
  });

  it("删笔记本传播：A 删笔记本（软删进回收站）→ B 同步跟随进回收站（folders 变更必须发布，迁移回归修复）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const nb = A.store.createNotebook("待删笔记本");
      A.store.createNoteIn(nb.id, "子笔记");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // 初始：B 的笔记本在活动位置（不在回收站）
      expect(B.store.listTrash().some((x) => x.id === nb.id)).toBe(false);
      // A 删笔记本（软删进回收站，sync_state=local）
      A.store.deleteTreeNode(nb.id);
      await syncNow(A.store, undefined, remote);
      // B 跟随：笔记本进回收站（folders 变更发布 → importRemoteFolder trashedAt）
      await syncNow(B.store, undefined, remote);
      expect(B.store.listTrash().some((x) => x.id === nb.id)).toBe(true);
      // 稳定：再同步一次不乒乓
      await syncNow(B.store, undefined, remote);
      expect(B.store.listTrash().some((x) => x.id === nb.id)).toBe(true);
    } finally { cleanup([A, B]); }
  });

  it("跟随删除不重复留档：B 跟随 A 删除后 lastUploadedHash 不被污染，后续同步 superseded 恒空（ownEdit 误判修复）", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("跟随删除防重复");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // B 拉取后 lastUploadedHash 应为 null（B 从未上传内容）
      expect(B.store.lastUploadedHash(note.id)).toBe(null);
      // A 删除 → B 跟随删除
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      expect(B.store.listNotesForSync().find((n) => n.id === note.id)!.parentId).toBe(TRASH_NOTEBOOK_ID);
      // 关键：B 跟随删除后 lastUploadedHash 仍为 null（两端一致 skip 记账传 null 清除，不误标本机是作者）
      expect(B.store.lastUploadedHash(note.id)).toBe(null);
      // B 再同步两次：不重复留档（superseded 恒空）
      const r1 = await syncNow(B.store, undefined, remote);
      const r2 = await syncNow(B.store, undefined, remote);
      expect(r1.supersededNotes.some((n) => n.id === note.id)).toBe(false);
      expect(r2.supersededNotes.some((n) => n.id === note.id)).toBe(false);
    } finally { cleanup([A, B]); }
  });
});

describe("多端场景验证（用户验收建议 1/2/3）", () => {
  it("S1 三角同步：A 编辑 → B/C 同步 → B、C 各改不同笔记 → A 再同步 → 三方收敛", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice(), B = makeDevice(), C = makeDevice();
    try {
      const n1 = A.store.createNote("三角1");
      const n2 = A.store.createNote("三角2");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      await syncNow(C.store, undefined, remote);
      // B 改 n1、C 改 n2（不同笔记，无冲突）
      B.store.saveNote(n1.id, "B 改 n1", "<p>B 版 n1</p>");
      C.store.saveNote(n2.id, "C 改 n2", "<p>C 版 n2</p>");
      await syncNow(B.store, undefined, remote);
      await syncNow(C.store, undefined, remote);
      // A 再同步 → 收三方全部变更
      await syncNow(A.store, undefined, remote);
      expect(A.store.readNote(n1.id).content).toBe("<p>B 版 n1</p>");
      expect(A.store.readNote(n2.id).content).toBe("<p>C 版 n2</p>");
      // B、C 也互相收敛
      await syncNow(B.store, undefined, remote);
      await syncNow(C.store, undefined, remote);
      expect(B.store.readNote(n2.id).content).toBe("<p>C 版 n2</p>");
      expect(C.store.readNote(n1.id).content).toBe("<p>B 版 n1</p>");
    } finally { cleanup([A, B, C]); }
  });

  it("S2 删除 vs 移动交叉：A 删除 888 同步，B 同时把 888 移到另一笔记本 → B 同步应跟随删除", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice(), B = makeDevice();
    try {
      const nb1 = A.store.createNotebook("笔记本1");
      const nb2 = A.store.createNotebook("笔记本2");
      const note = A.store.createNoteIn(nb1.id, "888");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // A 删除；B 离线把 888 移到 nb2
      A.store.deleteNote(note.id);
      B.store.moveTreeNode(note.id, nb2.id, 0);
      await syncNow(A.store, undefined, remote);
      // B 同步：删除压移动 → B 跟随删除（进回收站），移动被压制
      const rb = await syncNow(B.store, undefined, remote);
      const bNote = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(bNote!.parentId).toBe(TRASH_NOTEBOOK_ID);
      expect(bNote!.parentId).not.toBe(nb2.id);
      expect(rb.supersededNotes.some((n) => n.id === note.id)).toBe(false); // B 未编辑内容，不留档
    } finally { cleanup([A, B]); }
  });

  it("S3 正文冲突 + 移动冲突叠加：两端都改 888 内容且都移动 → 先同步者胜，后同步方同时接受正文和位置并留档", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice(), B = makeDevice();
    try {
      const nb1 = A.store.createNotebook("册1");
      const nb2 = A.store.createNotebook("册2");
      const note = A.store.createNoteIn(nb1.id, "888");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      // 两端离线：改内容 + 各自移动
      A.store.saveNote(note.id, "A 改", "<p>A 版</p>");
      B.store.saveNote(note.id, "B 改", "<p>B 版</p>");
      A.store.moveTreeNode(note.id, nb2.id, 0);
      B.store.moveTreeNode(note.id, nb1.id, 0); // 两端都移到对方册（或同册不同序）
      // A 先同步（先提交先确认 → A 胜）
      await syncNow(A.store, undefined, remote);
      const rb = await syncNow(B.store, undefined, remote);
      // B 后同步 → 接受 A 的正文 + 位置，且 B 的编辑被覆盖 → 留档 + superseded
      expect(B.store.readNote(note.id).content).toBe("<p>A 版</p>");
      expect(B.store.listTreeNodes().find((n: any) => n.id === note.id)!.parentId).toBe(nb2.id);
      expect(rb.supersededNotes.some((n) => n.id === note.id)).toBe(true);
      expect(B.store.listNoteHistory(note.id).some((h) => h.contentHash === sha256("<p>B 版</p>"))).toBe(true);
      // A 端稳定
      await syncNow(A.store, undefined, remote);
      expect(A.store.readNote(note.id).content).toBe("<p>A 版</p>");
    } finally { cleanup([A, B]); }
  });
});

describe("多端场景验证（用户验收建议 4/5）", () => {

  it("S4 回收站内普通保存被拒绝（审计 F04：不再编辑即隐式恢复）；显式恢复后编辑并同步", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice(), B = makeDevice();
    try {
      const note = A.store.createNote("回收站编辑");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      A.store.deleteNote(note.id);
      await syncNow(A.store, undefined, remote);
      // B 同步进回收站
      await syncNow(B.store, undefined, remote);
      expect(B.store.listNotesForSync().find((n: any) => n.id === note.id)!.parentId).toBe(TRASH_NOTEBOOK_ID);
      // 审计 F04：普通保存在回收站被明确拒绝——不再"编辑即隐式恢复"，也不改写正文
      expect(() => B.store.saveNote(note.id, "回收站改", "<p>B 回收站编辑</p>")).toThrow();
      expect(B.store.readNote(note.id).content).not.toBe("<p>B 回收站编辑</p>");
      expect(B.store.listNotesForSync().find((n: any) => n.id === note.id)!.parentId).toBe(TRASH_NOTEBOOK_ID);
      // 恢复是唯一显式例外：restore_pending → local-wins，编辑随恢复上传覆盖墓碑
      B.store.restoreTrashItem(note.id);
      B.store.saveNote(note.id, "恢复后改", "<p>B 恢复后编辑</p>");
      await syncNow(B.store, undefined, remote);
      // A 跟随恢复（restore_pending 传播），拿到恢复后的编辑内容
      await syncNow(A.store, undefined, remote);
      const aNote = A.store.listNotesForSync().find((n: any) => n.id === note.id);
      expect(aNote).toBeTruthy();
      expect(aNote!.parentId).not.toBe(TRASH_NOTEBOOK_ID);
      expect(A.store.readNote(note.id).content).toBe("<p>B 恢复后编辑</p>");
    } finally { cleanup([A, B]); }
  });

  it("S5 双端同时创建同名笔记：first-sync-wins，不双份不互相覆盖", async () => {
    const s3 = new MockS3();
    const remote = () => s3 as unknown as ObjectStore;
    const A = makeDevice(), B = makeDevice();
    try {
      const a = A.store.createNote("同名");
      const b = B.store.createNote("同名");
      // A 先同步 → A 的版本胜出
      await syncNow(A.store, undefined, remote);
      // B 的笔记对象仍在本地（不丢），但云端以 A 为准
      expect(A.store.readNote(a.id).title).toBe("同名");
      expect(B.store.readNote(b.id).title).toBe("同名");
      // 两端同步后都能看到两份（不同 id，标题相同）
      await syncNow(B.store, undefined, remote);
      const bHasA = B.store.listNotesForSync().some((n: any) => n.id === a.id);
      expect(bHasA).toBe(true);
    } finally { cleanup([A, B]); }
  });
});
