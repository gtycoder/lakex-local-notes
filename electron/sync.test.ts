import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncNow } from "./sync.js";
import type { Store } from "./store.js";

// ===== 内存 S3 mock（ObjectStore 依赖的 @aws-sdk/client-s3 命令子集） =====
const s3 = vi.hoisted(() => ({
  bucket: new Map<string, Buffer>(),
  puts: [] as string[],
  reset() { this.bucket.clear(); this.puts.length = 0; },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Command {
    constructor(public input: Record<string, unknown>) {}
  }
  class HeadBucketCommand extends S3Command {}
  class GetObjectCommand extends S3Command {}
  class PutObjectCommand extends S3Command {}
  class S3Client {
    async send(command: S3Command) {
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key as string;
        const bytes = s3.bucket.get(key);
        if (!bytes) {
          const err = new Error(`NoSuchKey: ${key}`);
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key as string;
        s3.bucket.set(key, Buffer.from(command.input.Body as Buffer));
        s3.puts.push(key);
        return {};
      }
      throw new Error(`未知命令: ${command.constructor.name}`);
    }
  }
  return { S3Client, HeadBucketCommand, GetObjectCommand, PutObjectCommand };
});

// ===== 本地类型（与 sync.ts 内部结构一致，避免引入 Electron/原生依赖） =====
interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}
interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean; deletedAt?: string;
}
interface Manifest {
  version: number; workspaceId: string; commitId: string; createdAt: string; notes: ManifestNote[];
}

const SETTINGS: S3Settings = {
  endpoint: "https://s3.cn-north-1.example.com", region: "cn-north-1", bucket: "test-bucket",
  prefix: "lake-notes", accessKeyId: "test-ak", secretAccessKey: "test-sk", forcePathStyle: true,
};
const key = (suffix: string) => `lake-notes/${suffix}`;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function readManifest(): Manifest {
  const raw = s3.bucket.get(key("manifests/latest.json"));
  if (!raw) throw new Error("测试前置失败：远端清单不存在");
  return JSON.parse(raw.toString("utf8"));
}
function writeManifest(manifest: Manifest): void {
  s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify(manifest), "utf8"));
}

// ===== FakeStore：实现 sync.ts 用到的 Store 子集（内存态 + 临时文件） =====
class FakeStore {
  settings: S3Settings | null = null;
  notes = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean }>();
  deleted = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string }>();
  baseHashes = new Map<string, string>();
  orphans = new Set<string>();
  syncedAt: string | null = null;
  lastResult: unknown = null;
  private dir: string;

  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-sync-test-"));
    fs.mkdirSync(path.join(this.dir, "notes"), { recursive: true });
  }
  private notePath(id: string) { return path.join(this.dir, "notes", `${id}.lake`); }

  // ---- 测试辅助 ----
  createNote(id: string, title: string, content: string) {
    const updatedAt = new Date().toISOString();
    this.notes.set(id, { id, title, parentId: null, sortOrder: this.notes.size, updatedAt, isConflict: false });
    fs.writeFileSync(this.notePath(id), content, "utf8");
  }
  modifyNote(id: string, content: string) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    n.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.notePath(id), content, "utf8");
  }
  addAsset(noteId: string, filename: string, bytes: Buffer) {
    const dir = path.join(this.dir, "note-assets", noteId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), bytes);
  }

  // ---- Store 接口子集 ----
  getS3Settings() { return this.settings; }
  saveS3Settings(settings: S3Settings) { this.settings = settings; }
  listNotesForSync() { return [...this.notes.values()].map((n) => ({ ...n })); }
  listDeletedNotesForSync() { return [...this.deleted.values()].map((d) => ({ ...d })); }
  contentHash(id: string) { return crypto.createHash("sha256").update(fs.readFileSync(this.notePath(id))).digest("hex"); }
  notePathFor(id: string) { return this.notePath(id); }
  noteAssetsPathFor(id: string) { return path.join(this.dir, "note-assets", id); }
  listOrphanAssets() {
    return [...this.orphans].map((fileKey) => {
      const [noteId, filename] = fileKey.split("/");
      return { id: 0, noteId, filename, filePath: "", size: 0, mimeType: "", detectedAt: "" };
    });
  }
  baseHash(id: string) { return this.baseHashes.get(id) ?? null; }
  setBaseHash(id: string, hash: string) { this.baseHashes.set(id, hash); }
  markSynced() {}
  importRemoteNote(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean }, content: Buffer, assets: { filename: string; bytes: Buffer }[]) {
    fs.writeFileSync(this.notePath(note.id), content, "utf8");
    if (assets.length > 0) {
      const dir = path.join(this.dir, "note-assets", note.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const asset of assets) fs.writeFileSync(path.join(dir, asset.filename), asset.bytes);
    }
    this.notes.set(note.id, { ...note });
  }
  deleteTreeNode(id: string) {
    const n = this.notes.get(id);
    if (n) {
      // 与真实 Store 一致：删除时记录墓碑
      this.deleted.set(id, { id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, deletedAt: new Date().toISOString() });
      this.notes.delete(id);
    }
    fs.rmSync(this.notePath(id), { force: true });
    fs.rmSync(path.join(this.dir, "note-assets", id), { recursive: true, force: true });
  }
  pruneTombstones(ids: string[]) { for (const id of ids) this.deleted.delete(id); }
  markSyncComplete(at: string) { this.syncedAt = at; }
  recordSyncResult(json: string) { this.lastResult = JSON.parse(json); }
}

function newStore(): FakeStore {
  const store = new FakeStore();
  store.saveS3Settings(SETTINGS);
  return store;
}

describe("syncNow 增量同步", () => {
  beforeEach(() => s3.reset());

  it("首次同步上传本地笔记并写入清单；二次同步幂等（0/0）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    const r1 = await syncNow(store as unknown as Store);
    expect(r1.uploaded).toBe(1);
    expect(r1.downloaded).toBe(0);
    expect(r1.conflicts).toBe(0);
    expect(s3.bucket.has(key(`objects/${store.contentHash("n1")}.lake`))).toBe(true);
    const manifest = readManifest();
    expect(manifest.version).toBe(2);
    expect(manifest.notes).toHaveLength(1);
    expect(manifest.notes[0].contentHash).toBe(store.contentHash("n1"));

    const r2 = await syncNow(store as unknown as Store);
    expect(r2.uploaded).toBe(0);
    expect(r2.downloaded).toBe(0);
    expect(r2.conflicts).toBe(0);
  });

  it("远端新增笔记时下载到本地（含 .lake 与资源）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    await syncNow(store as unknown as Store);

    // 模拟另一台设备新增 n2：上传对象 + 更新清单
    const n2Content = "<p>remote content</p>";
    const n2Hash = sha256(n2Content);
    s3.bucket.set(key(`objects/${n2Hash}.lake`), Buffer.from(n2Content, "utf8"));
    const manifest = readManifest();
    manifest.notes.push({
      id: "n2", title: "远端笔记", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: n2Hash, isConflict: false,
      assets: [{ filename: "img.png", size: 3, hash: sha256("img") }],
    });
    writeManifest(manifest);
    s3.bucket.set(key("assets/n2/img.png"), Buffer.from("img", "utf8"));

    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(1);
    expect(store.notes.has("n2")).toBe(true);
    expect(fs.readFileSync(store.notePathFor("n2"), "utf8")).toBe(n2Content);
    expect(fs.readFileSync(path.join(store.noteAssetsPathFor("n2"), "img.png"), "utf8")).toBe("img");
  });

  it("本地与远端同时修改时生成冲突副本，本地版本保留并覆盖远端", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);

    store.modifyNote("n1", "<p>v2 local</p>");
    const remoteHash = sha256("<p>v2 remote</p>");
    s3.bucket.set(key(`objects/${remoteHash}.lake`), Buffer.from("<p>v2 remote</p>", "utf8"));
    const manifest = readManifest();
    manifest.notes[0].contentHash = remoteHash;
    writeManifest(manifest);

    const r = await syncNow(store as unknown as Store);
    expect(r.conflicts).toBe(1);
    const conflict = [...store.notes.values()].find((n) => n.isConflict);
    expect(conflict).toBeTruthy();
    expect(conflict!.title).toContain("冲突副本");
    expect(fs.readFileSync(store.notePathFor("n1"), "utf8")).toBe("<p>v2 local</p>");
    const finalManifest = readManifest();
    expect(finalManifest.notes.find((n) => n.id === "n1")!.contentHash).toBe(store.contentHash("n1"));
  });

  it("本地删除后云端标记 deleted 且墓碑被剪除（不重拉）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.createNote("n2", "笔记B", "<p>b</p>");
    await syncNow(store as unknown as Store);

    store.deleteTreeNode("n2");
    expect(store.listDeletedNotesForSync()).toHaveLength(1);

    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(0);
    const manifest = readManifest();
    expect(manifest.notes.find((n) => n.id === "n2")?.deleted).toBe(true);
    expect(store.listDeletedNotesForSync()).toHaveLength(0); // 墓碑已剪除
    expect(store.notes.has("n2")).toBe(false);
  });

  it("云端标记 deleted 时本地删除该笔记", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.createNote("n2", "笔记B", "<p>b</p>");
    await syncNow(store as unknown as Store);

    const manifest = readManifest();
    const n2 = manifest.notes.find((n) => n.id === "n2")!;
    n2.deleted = true;
    n2.deletedAt = new Date().toISOString();
    writeManifest(manifest);

    const r = await syncNow(store as unknown as Store);
    expect(store.notes.has("n2")).toBe(false);
    expect(store.notes.has("n1")).toBe(true);
  });

  it("笔记内容变更时，云端同 hash 资源不重复上传（增量优化）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.addAsset("n1", "img1.png", Buffer.from("png-bytes", "utf8"));
    await syncNow(store as unknown as Store);
    expect(s3.bucket.has(key("assets/n1/img1.png"))).toBe(true);

    store.modifyNote("n1", "<p>b</p>"); // 只改内容，资源不变
    const assetPutsBefore = s3.puts.filter((k) => k.startsWith(key("assets/"))).length;
    await syncNow(store as unknown as Store);
    const assetPutsAfter = s3.puts.filter((k) => k.startsWith(key("assets/"))).length;
    expect(assetPutsAfter - assetPutsBefore).toBe(0); // 资源零重传
    const manifest = readManifest();
    expect(manifest.notes[0].assets).toHaveLength(1);
  });

  it("未配置 S3 时直接报错", async () => {
    const store = new FakeStore();
    await expect(syncNow(store as unknown as Store)).rejects.toThrow("请先保存 S3 配置");
  });
});
