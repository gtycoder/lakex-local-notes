import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QuickNotesStore } from "./quickNotes.js";
import { syncQuickNotes } from "./quickNotesSync.js";

const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

const s3 = vi.hoisted(() => ({ bucket: new Map<string, Buffer>(), reset() { this.bucket.clear(); } }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  class HeadBucketCommand extends Command {}
  class GetObjectCommand extends Command {}
  class PutObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class DeleteObjectCommand extends Command {}
  class DeleteObjectsCommand extends Command {}
  class S3Client {
    async send(command: Command) {
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof ListObjectsV2Command) return { Contents: [] };
      const key = command.input.Key as string;
      if (command instanceof GetObjectCommand) {
        const bytes = s3.bucket.get(key);
        if (!bytes) { const error = new Error("NoSuchKey"); (error as { name: string }).name = "NoSuchKey"; throw error; }
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (command instanceof PutObjectCommand) { s3.bucket.set(key, Buffer.from(command.input.Body as Buffer)); return {}; }
      if (command instanceof DeleteObjectCommand) { s3.bucket.delete(key); return {}; }
      if (command instanceof DeleteObjectsCommand) {
        const objects = (command.input.Delete as { Objects?: Array<{ Key: string }> }).Objects ?? [];
        for (const o of objects) s3.bucket.delete(o.Key);
        return { Deleted: objects.map((o) => ({ Key: o.Key })), Errors: [] };
      }
      throw new Error("unknown S3 command");
    }
  }
  return { S3Client, HeadBucketCommand, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand };
});

const settings = { endpoint: "https://s3.example.test", region: "test", bucket: "bucket", prefix: "lake", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: true };
const key = (suffix: string) => `lake/${suffix}`;
let root: string;
let store: QuickNotesStore;

beforeEach(() => {
  s3.reset();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-quick-sync-test-"));
  store = new QuickNotesStore(root);
});

describe("小记独立 S3 同步", () => {
  it("使用 quick-notes/ 独立 manifest/object 前缀，且不需要 Lake manifest", async () => {
    const note = store.createQuickNote({ text: "同步这条小记", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const result = await syncQuickNotes(store, settings);
    expect(result.uploaded).toBe(1);
    expect(s3.bucket.has(key(`quick-notes/objects/${note.contentHash}.qnote`))).toBe(true);
    const manifestRaw = s3.bucket.get(key("quick-notes/manifests/latest.json"));
    expect(manifestRaw).toBeTruthy();
    const manifest = JSON.parse(manifestRaw!.toString("utf8"));
    expect(manifest).toMatchObject({ version: 1, workspaceId: "default" });
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]).toMatchObject({ id: note.id, contentHash: note.contentHash });
    expect(s3.bucket.has(key("manifests/latest.json"))).toBe(false);

    const second = await syncQuickNotes(store, settings);
    expect(second.uploaded).toBe(0);
    expect(store.listQuickNotes()[0].syncState).toBe("synced");
  });

  it("删除 tombstone 使用合法摘要，后续同步可再次解析并保持幂等", async () => {
    const note = store.createQuickNote({ text: "会被删除", draftId: crypto.randomUUID(), stagedImageIds: [] });
    await syncQuickNotes(store, settings);
    store.deleteQuickNote(note.id);

    await syncQuickNotes(store, settings);
    const deletedManifest = JSON.parse(s3.bucket.get(key("quick-notes/manifests/latest.json"))!.toString("utf8"));
    expect(deletedManifest.items).toEqual([expect.objectContaining({
      id: note.id,
      deleted: true,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);

    await expect(syncQuickNotes(store, settings)).resolves.toMatchObject({ uploaded: 0 });
  });

  it("多端删除→恢复 LWW：恢复方上传 active 后，删除方再同步跟随恢复，墓碑让位不回写覆盖", async () => {
    const storeA = new QuickNotesStore(path.join(root, "a"));
    const storeB = new QuickNotesStore(path.join(root, "b"));
    const note = storeB.createQuickNote({ text: "多端小记", draftId: crypto.randomUUID(), stagedImageIds: [] });
    await syncQuickNotes(storeB, settings);
    // A 同步到该小记
    await syncQuickNotes(storeA, settings);
    expect(storeA.listQuickNotes().some((i) => i.id === note.id)).toBe(true);
    // A 删除并同步 → 云端 deleted
    storeA.deleteQuickNote(note.id);
    await syncQuickNotes(storeA, settings);
    expect(JSON.parse(s3.bucket.get(key("quick-notes/manifests/latest.json"))!.toString("utf8"))
      .items.find((i: { id: string }) => i.id === note.id)?.deleted).toBe(true);
    // B 学到删除
    await syncQuickNotes(storeB, settings);
    expect(storeB.listQuickNotes().some((i) => i.id === note.id)).toBe(false);
    // B 恢复（保证恢复时间晚于删除时间）并同步 → 云端 active
    await new Promise((r) => setTimeout(r, 10));
    storeB.restoreQuickNote(note.id);
    await syncQuickNotes(storeB, settings);
    expect(JSON.parse(s3.bucket.get(key("quick-notes/manifests/latest.json"))!.toString("utf8"))
      .items.find((i: { id: string }) => i.id === note.id)?.deleted).not.toBe(true);
    // A 再同步：跟随恢复 + 墓碑撤销 + 不回写覆盖
    await syncQuickNotes(storeA, settings);
    expect(storeA.listQuickNotes().some((i) => i.id === note.id)).toBe(true);
    expect(storeA.listDeletedForSync().some((i) => i.id === note.id)).toBe(false);
    expect(JSON.parse(s3.bucket.get(key("quick-notes/manifests/latest.json"))!.toString("utf8"))
      .items.find((i: { id: string }) => i.id === note.id)?.deleted).not.toBe(true);
    // B 再同步：不被再次删除
    await syncQuickNotes(storeB, settings);
    expect(storeB.listQuickNotes().some((i) => i.id === note.id)).toBe(true);
  });

  it("小记墓碑携带删除前内容：B 同步后回收站 .qnote 为 A 删除前版本，恢复即 A 版", async () => {
    const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
    const storeA = new QuickNotesStore(path.join(root, "a"));
    const storeB = new QuickNotesStore(path.join(root, "b"));
    const note = storeB.createQuickNote({ text: "小记v1", draftId: crypto.randomUUID(), stagedImageIds: [] });
    await syncQuickNotes(storeB, settings);
    await syncQuickNotes(storeA, settings);
    expect(storeA.listQuickNotes().some((i) => i.id === note.id)).toBe(true);
    // A 编辑小记（未同步）→ 删除 → 同步：墓碑应带真实 hash + 上传对象
    storeA.updateQuickNote(note.id, { text: "小记A编辑", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const aHash = sha256(fs.readFileSync(storeA.quickNotePathFor(note.id)));
    storeA.deleteQuickNote(note.id);
    await syncQuickNotes(storeA, settings);
    const tomb = JSON.parse(s3.bucket.get(key("quick-notes/manifests/latest.json"))!.toString("utf8"))
      .items.find((i: { id: string }) => i.id === note.id);
    expect(tomb.deleted).toBe(true);
    expect(tomb.contentHash).toBe(aHash);
    expect(s3.bucket.has(key(`quick-notes/objects/${aHash}.qnote`))).toBe(true);
    // B 同步：先拉到 A 版再软删 → 回收站 .qnote = A 版
    await syncQuickNotes(storeB, settings);
    expect(storeB.listQuickNotes().some((i) => i.id === note.id)).toBe(false);
    expect(sha256(fs.readFileSync(storeB.quickNotePathFor(note.id)))).toBe(aHash);
    // B 恢复 = A 版
    storeB.restoreQuickNote(note.id);
    expect(sha256(fs.readFileSync(storeB.quickNotePathFor(note.id)))).toBe(aHash);
  });

  it("转换 tombstone 未被 Lake 放行前不复活源小记，也不提前从远端 manifest 删除", async () => {
    const { Store } = await import("./store.js");
    const { convertQuickNoteToLake } = await import("./quickNoteConversion.js");
    const notes = new Store(root);
    const source = store.createQuickNote({ text: "转为正式笔记", draftId: crypto.randomUUID(), stagedImageIds: [] });
    await syncQuickNotes(store, settings);

    const notebookId = notes.listTreeNodes().find((node) => node.nodeType === "notebook")!.id;
    const target = convertQuickNoteToLake(store, notes, source.id, notebookId);
    expect(store.deletedRecord(source.id)?.readyToSync).toBe(false);

    await syncQuickNotes(store, settings);
    expect(store.listQuickNotes().some((item) => item.id === source.id)).toBe(false);
    const manifest = JSON.parse(s3.bucket.get(key("quick-notes/manifests/latest.json"))!.toString("utf8"));
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]).toMatchObject({ id: source.id });
    expect(manifest.items[0]).not.toHaveProperty("deleted");
    expect(notes.hasNote(target.id)).toBe(true);
  });
});
