import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QuickNotesStore } from "./quickNotes.js";
import { convertQuickNoteToLake } from "./quickNoteConversion.js";
import { Store } from "./store.js";

const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let root: string;
let quickNotes: QuickNotesStore;
let notes: Store;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-quick-notes-test-"));
  notes = new Store(root);
  quickNotes = new QuickNotesStore(root);
});

describe("QuickNotesStore", () => {
  it("无标题文字小记保存为独立 .qnote，并按时间线读取", () => {
    const saved = quickNotes.createQuickNote({ text: "临时想法\n第二行", draftId: crypto.randomUUID(), stagedImageIds: [] });
    expect(saved.content.text).toBe("临时想法\n第二行");
    expect(saved.previewText).toBe("临时想法 第二行");
    expect(fs.existsSync(path.join(root, "quick-notes", "items", `${saved.id}.qnote`))).toBe(true);
    expect(quickNotes.listQuickNotes().map((item) => item.id)).toContain(saved.id);
  });

  it("暂存图片保存后移动到独立 assets，并清理整个 staging 草稿目录", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "clip.png" });
    const saved = quickNotes.createQuickNote({ text: "有图", draftId, stagedImageIds: [image.id] });
    const assetsDir = path.join(root, "quick-notes", "assets", saved.id);
    expect(fs.existsSync(path.join(assetsDir, image.filename))).toBe(true);
    expect(fs.existsSync(path.join(root, "quick-notes", "staging", draftId))).toBe(false);
    expect(saved.content.images[0]).toMatchObject({ id: image.id, hash: image.hash, filename: image.filename });
  });

  it("转换会复制图片到独立 Lake 资源空间，并生成固定格式的无标题文档", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "convert.png" });
    const source = quickNotes.createQuickNote({ text: "第一行\n第二行", draftId, stagedImageIds: [image.id] });
    const notebookId = notes.listTreeNodes().find((node) => node.nodeType === "notebook")!.id;

    const target = convertQuickNoteToLake(quickNotes, notes, source.id, notebookId);
    const converted = notes.readNote(target.id);
    expect(converted.title).toMatch(/^未命名文档 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(converted.content).toContain(encodeURIComponent(`http://127.0.0.1:19876/${target.id}/${image.filename}`));
    // 每个小记换行必须成为独立 Lake 段落，不能用同一个段落内的 <br>，否则后续
    // 切换为有序/无序列表会被 Lake 识别成同一条列表项中的软换行。
    expect(converted.content).toMatch(/第一行<\/span><\/p><p[^>]*>.*第二行/);
    expect(converted.content).not.toContain("第一行<br />第二行");
    const copied = fs.readFileSync(path.join(root, "note-assets", target.id, image.filename));
    expect(copied.equals(PNG)).toBe(true);
    expect(fs.existsSync(path.join(root, "quick-notes", "assets", source.id))).toBe(false);
  });

  it("拒绝远端多余的不安全文件名，且不留下小记资源目录", () => {
    const raw = Buffer.from(JSON.stringify({ version: 1, text: "远端文本", images: [] }));
    const contentHash = crypto.createHash("sha256").update(raw).digest("hex");
    expect(() => quickNotes.importRemoteQuickNote(
      { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash, isConflict: false },
      raw,
      [{ filename: "../escape.png", bytes: PNG }],
    )).toThrow(/文件名无效/);
    expect(fs.readdirSync(path.join(root, "quick-notes", "assets"))).toEqual([]);
  });

  it("删除创建小记 tombstone，转换 tombstone 在 Lake 同步成功前不会进入同步列表", () => {
    const ordinary = quickNotes.createQuickNote({ text: "将删除", draftId: crypto.randomUUID(), stagedImageIds: [] });
    quickNotes.deleteQuickNote(ordinary.id);
    expect(quickNotes.listDeletedForSync().map((item) => item.id)).toContain(ordinary.id);

    const source = quickNotes.createQuickNote({ text: "将转正文", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const notebookId = notes.listTreeNodes().find((node) => node.nodeType === "notebook")!.id;
    const target = convertQuickNoteToLake(quickNotes, notes, source.id, notebookId);
    expect(notes.readNote(target.id).title).toMatch(/^未命名文档 ·/);
    expect(quickNotes.listQuickNotes().map((item) => item.id)).not.toContain(source.id);
    expect(quickNotes.listDeletedForSync().map((item) => item.id)).not.toContain(source.id);
    quickNotes.markTargetNotesSynced(new Set([target.id]));
    expect(quickNotes.listDeletedForSync().map((item) => item.id)).toContain(source.id);
  });
});
