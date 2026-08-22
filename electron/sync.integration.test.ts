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
import { syncNow, type ObjectStore, type S3Settings } from "./sync.js";
import type { LoggerScopes } from "../src/core/logger.js";
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
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
    const A = makeDevice();
    const B = makeDevice();
    try {
      const note = A.store.createNote("标题");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const edited = A.store.saveNote(note.id, "新标题", "<p>新内容</p>");
      await syncNow(A.store, undefined, remote);
      await syncNow(B.store, undefined, remote);
      const got = B.store.listNotesForSync().find((n) => n.id === note.id);
      expect(got!.title).toBe("新标题");
      expect(B.store.readNote(note.id).content).toBe("<p>新内容</p>");
    } finally { cleanup([A, B]); }
  });

  it("A 删除同步 → B 跟随删除（删除传播，墓碑权威）", async () => {
    const s3 = new MockS3();
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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

  it("A 上传过 A1（本机是作者）后被 B 恢复历史续编版本覆盖 → A 接受 B2 且强制留档（2026-08-22 二修）", async () => {
    const s3 = new MockS3();
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
      const b1Hist = bHist.find((h) => h.contentHash === B.store.contentHash(note.id)); // 当前内容 A1 的历史
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

  it("墓碑学习：B 离线时 A 删除 → B 上线同步不复活删除（防复活）", async () => {
    const s3 = new MockS3();
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
});

  it("A 编辑后删除 + B 编辑被删 → B 恢复回到原父目录（deletedFromParentId 不丢失，2026-08-22 修复）", async () => {
    const s3 = new MockS3();
    const remote = (s: S3Settings, l: LoggerScopes) => s3 as unknown as ObjectStore;
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
