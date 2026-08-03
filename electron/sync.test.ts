import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncNow, testConnection } from "./sync.js";
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
  rememberDeleted(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string }, deletedAt: string) {
    this.deleted.set(note.id, { id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder, updatedAt: note.updatedAt, deletedAt });
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

  it("本地删除后云端标记 deleted；墓碑保留且标记跨次同步持续（防复活）", async () => {
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
    // 墓碑不剪除：再同步一次，deleted 标记仍必须存在（离线设备上线时才能正确删除）
    await syncNow(store as unknown as Store);
    const manifest2 = readManifest();
    expect(manifest2.notes.find((n) => n.id === "n2")?.deleted).toBe(true);
    expect(store.listDeletedNotesForSync()).toHaveLength(1); // 墓碑保留
    expect(store.notes.has("n2")).toBe(false);
  });

  it("审计#1：正文未变化时连续同步，manifest 资源清单不丢失（修复 assets 清空）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.addAsset("n1", "img1.png", Buffer.from("png-bytes", "utf8"));
    await syncNow(store as unknown as Store);
    expect(readManifest().notes[0].assets).toHaveLength(1);

    // 正文不变，第二次同步：assets 必须仍在 manifest 中（旧实现会变 [])
    await syncNow(store as unknown as Store);
    const manifest = readManifest();
    expect(manifest.notes[0].assets).toHaveLength(1);
    expect(manifest.notes[0].assets[0]).toMatchObject({ filename: "img1.png", size: 9, hash: sha256("png-bytes") });
  });

  it("审计#2：设备A删除并多次同步后，离线设备C上线不复活已删笔记", async () => {
    // 设备 A：创建并同步
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    // 设备 B：同步到 n1
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // 设备 A：删除 + 同步两次（墓碑保留策略下 deleted 标记持续存在）
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // 设备 C（离线后上线）：不得恢复 n1
    const storeC = newStore();
    await syncNow(storeC as unknown as Store);
    expect(storeC.notes.has("n1")).toBe(false);
    // C 同步后本地留存学到的墓碑，且 manifest 仍保留 deleted 标记（不复活）
    expect(storeC.listDeletedNotesForSync()).toHaveLength(1);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // A 设备清空（模拟重装）：C 仍持有墓碑，标记不丢
    const storeA2 = newStore();
    await syncNow(storeA2 as unknown as Store);
    expect(storeA2.notes.has("n1")).toBe(false);
  });

  it("审计#3：恶意 manifest 的 note.id / asset.filename 目录穿越被拒绝", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    // 恶意 note.id（../ 逃逸）
    const manifest = readManifest();
    manifest.notes.push({
      id: "../../evil", title: "evil", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>evil</p>"), isConflict: false,
      assets: [],
    });
    writeManifest(manifest);
    s3.bucket.set(key(`objects/${sha256("<p>evil</p>")}.lake`), Buffer.from("<p>evil</p>", "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/无效的笔记 ID|无效的资源文件名|无效/);

    // 恶意 asset.filename（../ 逃逸）
    const manifest2 = readManifest();
    manifest2.notes[0] = {
      id: "evil2", title: "evil2", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>evil2</p>"), isConflict: false,
      assets: [{ filename: "../../escape.png", size: 3, hash: sha256("abc") }],
    };
    writeManifest(manifest2);
    s3.bucket.set(key(`objects/${sha256("<p>evil2</p>")}.lake`), Buffer.from("<p>evil2</p>", "utf8"));
    s3.bucket.set(key("assets/evil2/../../escape.png"), Buffer.from("abc", "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/无效的资源文件名/);
  });

  it("审计#4：清单声明的资源缺失/损坏时中止导入（不静默跳过）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    // 声明资源但对象缺失
    let manifest = readManifest();
    manifest.notes[0] = {
      id: "n2", title: "远端", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>remote</p>"), isConflict: false,
      assets: [{ filename: "img.png", size: 3, hash: sha256("img") }],
    };
    writeManifest(manifest);
    s3.bucket.set(key(`objects/${sha256("<p>remote</p>")}.lake`), Buffer.from("<p>remote</p>", "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/资源不存在/);
    expect(store.notes.has("n2")).toBe(false); // 未导入半成品

    // 声明资源但内容损坏（hash 不符）
    manifest = readManifest();
    writeManifest(manifest);
    s3.bucket.set(key("assets/n2/img.png"), Buffer.from("xxx", "utf8")); // size 3 但 hash 不符
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/哈希不符/);
    expect(store.notes.has("n2")).toBe(false);
  });

  it("审计#19：远程 manifest 结构非法时同步报错（不按任意 JSON 导入）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify({ version: 2, notes: "not-an-array" }), "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/清单格式无效/);

    s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify({ version: 99, workspaceId: "default", commitId: "c", createdAt: "t", notes: [] }), "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/清单版本不兼容/);
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

describe("S3 配置校验", () => {
  it("testConnection 未保存配置时报错", async () => {
    const store = new FakeStore();
    await expect(testConnection(store as unknown as Store)).rejects.toThrow("请先保存 S3 配置");
  });

  it("endpoint/bucket/密钥任一为空都报同一错误", async () => {
    const cases: Array<Partial<S3Settings>> = [
      { ...SETTINGS, endpoint: "  " },
      { ...SETTINGS, bucket: "" },
      { ...SETTINGS, accessKeyId: " " },
      { ...SETTINGS, secretAccessKey: "" },
    ];
    for (const patch of cases) {
      const store = new FakeStore();
      store.settings = { ...SETTINGS, ...patch };
      await expect(testConnection(store as unknown as Store)).rejects.toThrow("Endpoint、Bucket 和访问密钥均不能为空");
    }
  });

  it("syncNow 配置不完整时同样校验失败", async () => {
    const store = new FakeStore();
    store.settings = { ...SETTINGS, bucket: "" };
    await expect(syncNow(store as unknown as Store)).rejects.toThrow("Endpoint、Bucket 和访问密钥均不能为空");
  });

  it("有效配置可通过校验并成功连接（mock S3）", async () => {
    const store = new FakeStore();
    store.settings = { ...SETTINGS };
    await expect(testConnection(store as unknown as Store)).resolves.toContain("连接成功");
  });
});
