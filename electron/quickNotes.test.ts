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
  it("pending 摘要按未同步小记和图片事实计数，删除后保留 tombstone 计数", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "summary.png" });
    const note = quickNotes.createQuickNote({ text: "待同步摘要", draftId, stagedImageIds: [image.id] });
    expect(quickNotes.getPendingSyncSummary()).toEqual({ items: 1, resources: 1 });
    quickNotes.deleteQuickNote(note.id);
    expect(quickNotes.getPendingSyncSummary()).toEqual({ items: 1, resources: 0 });
  });

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

  it("验收#4：冲突归档——本地版本以新 id 进回收站，原条目不动，恢复后为一条新小记", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "clip.png" });
    const note = quickNotes.createQuickNote({ text: "冲突本地版", draftId, stagedImageIds: [image.id] });
    const archivedId = quickNotes.archiveLocalToTrash(note.id);

    // 归档 = 新 id 的回收站条目：内容文件 + 资源文件都在，原条目不受影响
    expect(archivedId).not.toBe(note.id);
    expect(quickNotes.listQuickNoteTrash().map((i) => i.id)).toContain(archivedId);
    expect(quickNotes.listQuickNotes().some((i) => i.id === note.id)).toBe(true);
    expect(fs.existsSync(path.join(root, "quick-notes", "items", `${archivedId}.qnote`))).toBe(true);
    expect(fs.existsSync(path.join(root, "quick-notes", "assets", archivedId, image.filename))).toBe(true);

    // 恢复 = 一条新小记（新 id、内容一致、不再是冲突副本）
    const restored = quickNotes.restoreQuickNote(archivedId);
    expect(restored.id).toBe(archivedId);
    expect(restored.content.text).toBe("冲突本地版");
    expect(restored.isConflict).toBe(false);
    expect(quickNotes.listQuickNoteTrash().map((i) => i.id)).not.toContain(archivedId);
    expect(quickNotes.listQuickNotes().map((i) => i.id)).toContain(archivedId);
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

describe("小记回收站（M6）", () => {
  it("审计：learned tombstone（他端 purge、本端从未持有）不进入回收站（无内容文件无法恢复）", () => {
    const localId = quickNotes.createQuickNote({ text: "本地删除", draftId: crypto.randomUUID(), stagedImageIds: [] }).id;
    quickNotes.deleteQuickNote(localId); // 本地软删：有内容文件
    expect(quickNotes.listQuickNoteTrash().map((i) => i.id)).toContain(localId);
    // 模拟收到他端 purge 墓碑、本端从未持有该小记（rememberDeleted 只写墓碑、无内容文件）
    quickNotes.rememberDeleted({ id: "learned-tombstone-id", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString() });
    const trash = quickNotes.listQuickNoteTrash();
    expect(trash.map((i) => i.id)).not.toContain("learned-tombstone-id");
    expect(trash.map((i) => i.id)).toContain(localId);
  });

  it("软删保留内容、可恢复；purge 后无法恢复且墓碑 purged_at 标记", () => {
    const id = quickNotes.createQuickNote({ text: "可恢复的小记", draftId: crypto.randomUUID(), stagedImageIds: [] }).id;
    quickNotes.deleteQuickNote(id);
    expect(quickNotes.listQuickNoteTrash().map((i) => i.id)).toContain(id);

    const restored = quickNotes.restoreQuickNote(id);
    expect(restored.id).toBe(id);
    expect(restored.content.text).toBe("可恢复的小记");
    expect(quickNotes.listQuickNoteTrash().map((i) => i.id)).not.toContain(id);

    quickNotes.deleteQuickNote(id);
    quickNotes.purgeQuickNote(id);
    expect(quickNotes.listQuickNoteTrash().map((i) => i.id)).not.toContain(id);
    expect(() => quickNotes.restoreQuickNote(id)).toThrow();
  });
});
describe("R3：save staging 恢复（V5 §5.3）", () => {
  const stagingRoot = () => path.join(root, "quick-notes", "staging");
  const itemPathFor = (id: string) => path.join(root, "quick-notes", "items", `${id}.qnote`);
  const hashOf = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

  it("DB 已提交 + staging 残留 → 新实例启动恢复补 promote，并清理 staging", () => {
    const saved = quickNotes.createQuickNote({ text: "恢复测试", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const itemPath = itemPathFor(saved.id);
    const body = fs.readFileSync(itemPath); // 已 promote 的正文
    const contentHash = hashOf(body);
    // 模拟「DB 提交后 promote 前崩溃」：删正式正文，留 staging（content.qnote + meta.json）
    fs.rmSync(itemPath, { force: true });
    const opDir = path.join(stagingRoot(), crypto.randomUUID());
    fs.mkdirSync(opDir, { recursive: true });
    fs.writeFileSync(path.join(opDir, "content.qnote"), body);
    fs.writeFileSync(path.join(opDir, "meta.json"), JSON.stringify({ operationId: "x", quickNoteId: saved.id, contentHash, assetFilenames: [], createdAt: new Date().toISOString(), state: "prepared" }));
    const quickNotes2 = new QuickNotesStore(root); // 构造触发 recoverStagedSaves
    expect(fs.existsSync(itemPath)).toBe(true); // 补 promote
    expect(fs.existsSync(opDir)).toBe(false);   // staging 清理
    expect(quickNotes2.listQuickNotes().some((n) => n.id === saved.id)).toBe(true);
  });

  it("DB 未提交 + staging 残留 → 新实例清理 staging（不误补 promote）", () => {
    const opDir = path.join(stagingRoot(), crypto.randomUUID());
    fs.mkdirSync(opDir, { recursive: true });
    fs.writeFileSync(path.join(opDir, "content.qnote"), "x");
    fs.writeFileSync(path.join(opDir, "meta.json"), JSON.stringify({ operationId: "x", quickNoteId: "ghost-note", contentHash: "deadbeef", assetFilenames: [], createdAt: new Date().toISOString(), state: "prepared" }));
    new QuickNotesStore(root);
    expect(fs.existsSync(opDir)).toBe(false); // 未提交 → 删
  });

  it("staging 不完整（缺正文）→ 保留待查、不误删不误 promote", () => {
    const saved = quickNotes.createQuickNote({ text: "不完整测试", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const itemPath = itemPathFor(saved.id);
    const body = fs.readFileSync(itemPath);
    const contentHash = hashOf(body);
    fs.rmSync(itemPath, { force: true });
    const opDir = path.join(stagingRoot(), crypto.randomUUID());
    fs.mkdirSync(opDir, { recursive: true });
    // 有 meta 无 content.qnote（不完整）
    fs.writeFileSync(path.join(opDir, "meta.json"), JSON.stringify({ operationId: "x", quickNoteId: saved.id, contentHash, assetFilenames: [], createdAt: new Date().toISOString(), state: "prepared" }));
    new QuickNotesStore(root);
    expect(fs.existsSync(opDir)).toBe(true);      // 保留待查
    expect(fs.existsSync(itemPath)).toBe(false);  // 未误 promote
  });
});
