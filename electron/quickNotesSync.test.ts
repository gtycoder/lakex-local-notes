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
  class S3Client {
    async send(command: Command) {
      if (command instanceof HeadBucketCommand) return {};
      const key = command.input.Key as string;
      if (command instanceof GetObjectCommand) {
        const bytes = s3.bucket.get(key);
        if (!bytes) { const error = new Error("NoSuchKey"); (error as { name: string }).name = "NoSuchKey"; throw error; }
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (command instanceof PutObjectCommand) { s3.bucket.set(key, Buffer.from(command.input.Body as Buffer)); return {}; }
      throw new Error("unknown S3 command");
    }
  }
  return { S3Client, HeadBucketCommand, GetObjectCommand, PutObjectCommand };
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
