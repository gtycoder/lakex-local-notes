import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { QuickNotesStore } from "./quickNotes.js";
import { quickNoteTagId } from "../src/core/quickNoteTags.js";
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

  it("标签随 .qnote 往返；仅改标签不刷新 updatedAt", async () => {
    const inspiration = quickNotes.createQuickNoteTag(" 灵感 ").id;
    const todo = quickNotes.createQuickNoteTag("待办").id;
    const inbox = quickNotes.createQuickNoteTag("收件箱").id;
    const saved = quickNotes.createQuickNote({
      text: "带标签",
      body: "<p><br></p>",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      tagIds: [inspiration, todo, inspiration],
    });
    expect(saved.content.tags).toEqual(["灵感", "待办"]);
    expect(quickNotes.readQuickNote(saved.id).content.tags).toEqual(["灵感", "待办"]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = quickNotes.updateQuickNote(saved.id, {
      text: "带标签",
      body: "<p><br></p>",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      retainedImageIds: [],
      tagIds: [todo, inbox],
    });
    expect(updated.content.tags).toEqual(["待办", "收件箱"]);
    expect(updated.updatedAt).toBe(saved.updatedAt);
    expect(updated.contentHash).not.toBe(saved.contentHash);
  });

  it("只改正文时未传 tagIds = 保持原标签；显式传空数组才清空", () => {
    const inspiration = quickNotes.createQuickNoteTag("灵感").id;
    const todo = quickNotes.createQuickNoteTag("待办").id;
    const saved = quickNotes.createQuickNote({
      text: "勾选待办前",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      tagIds: [inspiration, todo],
    });
    const kept = quickNotes.updateQuickNote(saved.id, {
      text: "勾选待办前",
      body: "<p>改过的正文</p>",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      retainedImageIds: [],
    });
    expect(kept.content.tags).toEqual(["灵感", "待办"]);

    const cleared = quickNotes.updateQuickNote(saved.id, {
      text: "勾选待办前",
      body: "<p>改过的正文</p>",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      retainedImageIds: [],
      tagIds: [],
    });
    expect(cleared.content.tags).toEqual([]);
  });

  it("远端标签目录合并：改名/新增/墓碑按 updatedAt 生效，墓碑清掉小记引用", () => {
    const inspiration = quickNotes.createQuickNoteTag("灵感");
    const todo = quickNotes.createQuickNoteTag("待办");
    const note = quickNotes.createQuickNote({
      text: "合并目录",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      tagIds: [inspiration.id, todo.id],
    });
    const at = "2026-10-25T00:00:00.000Z";
    const project = {
      id: quickNoteTagId("项目"),
      name: "项目",
      sortOrder: 2,
      pinned: false,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    quickNotes.applyRemoteQuickNoteTags([
      { ...inspiration, name: "灵感库", updatedAt: at },
      { ...todo, updatedAt: at, deletedAt: at },
      project,
    ]);
    expect(quickNotes.listQuickNoteTags().map((tag) => tag.name)).toEqual(["灵感库", "项目"]);
    expect(quickNotes.readQuickNote(note.id).content.tags).toEqual(["灵感库"]);
    expect(quickNotes.search("待办")).toEqual([]);
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

  it("暂存附件（内核 file 卡）与图片共用 staging/promote，宽高为 null", () => {
    const draftId = crypto.randomUUID();
    const bytes = Buffer.from("attachment body", "utf8");
    const file = quickNotes.stageFile(draftId, { bytes: [...bytes], filename: "报告 v1.pdf" });
    expect(file).toMatchObject({ mimeType: "application/pdf", width: null, height: null, size: bytes.length });
    // 展示名 = 原始文件名（与文档附件卡同口径）；磁盘名是 {13ts}_{8hex}.pdf，只出现在 URL 与资源清单里。
    expect(file.filename).toBe("报告 v1.pdf");
    expect(file.url ?? "").toMatch(/\.pdf$/);
    expect(file.url ?? "").not.toContain("报告");
    const saved = quickNotes.createQuickNote({
      text: "带附件",
      // 资源清单以**正文引用**为准 ⇒ 正文必须引用到该资源的 URL（否则视为幽灵资源被清掉）。
      body: `<p class="ne-p"><card type="inline" name="file" value="data:${encodeURIComponent(JSON.stringify({ src: file.url }))}"></card></p>`,
      draftId,
      stagedImageIds: [file.id],
    });
    expect(saved.content.images[0]).toMatchObject({ id: file.id, mimeType: "application/pdf", width: null });
    const stored = saved.content.images[0].filename;
    expect(stored).not.toBe(file.filename);
    expect(fs.existsSync(path.join(root, "quick-notes", "assets", saved.id, stored))).toBe(true);
    // 往返读取（校验放宽后附件条目仍合法）
    expect(quickNotes.readQuickNote(saved.id).content.images[0].filename).toBe(stored);
  });

  it("正文引用了暂存资源但 stagedImageIds 为空 ⇒ 仍按正文补齐清单（260919 时序修复）", () => {
    const draftId = crypto.randomUUID();
    const bytes = Buffer.from("video body", "utf8");
    const file = quickNotes.stageFile(draftId, { bytes: [...bytes], filename: "v.mp4" });
    const stored = file.url!.split("/").pop()!;
    // 渲染层"点击保存早于上传/插卡落地"时 ids 会是空的，但正文已经引用了该资源。
    const body = `<p class="ne-p"><card type="block" name="video" value="data:${encodeURIComponent(JSON.stringify({ src: file.url }))}"></card></p>`;
    const saved = quickNotes.createQuickNote({ text: "带视频", body, draftId, stagedImageIds: [] });
    expect(saved.content.images.map((item) => item.mimeType)).toEqual(["video/mp4"]);
    expect(fs.existsSync(path.join(root, "quick-notes", "assets", saved.id, stored))).toBe(true);
    expect(fs.existsSync(path.join(root, "quick-notes", "staging", draftId))).toBe(false);
  });

  it("正文不再引用的资源不进清单，且旧文件随保存清掉（幽灵资源）", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "drop.png" });
    const saved = quickNotes.createQuickNote({
      text: "有图",
      body: `<p class="ne-p"><card type="inline" name="image" value="data:${encodeURIComponent(JSON.stringify({ src: image.url }))}"></card></p>`,
      draftId,
      stagedImageIds: [image.id],
    });
    const storedName = saved.content.images[0].filename;
    const assetPath = path.join(root, "quick-notes", "assets", saved.id, storedName);
    expect(fs.existsSync(assetPath)).toBe(true);
    // 再存一次：正文里没有那张卡了（模拟编辑器里删卡）
    const updated = quickNotes.updateQuickNote(saved.id, {
      text: "没图了",
      body: `<p class="ne-p"><span>没图了</span></p>`,
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      retainedImageIds: [saved.content.images[0].id],
    });
    expect(updated.content.images).toEqual([]);
    expect(fs.existsSync(assetPath)).toBe(false);
  });

  it("拒绝伪装成图片的 SVG，不落 staging 文件", async () => {
    const draftId = crypto.randomUUID();
    const svg = Array.from(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"));
    await expect(quickNotes.stageImage(draftId, { bytes: svg, filename: "spoof.svg" }))
      .rejects.toThrow("仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
    expect(fs.existsSync(path.join(root, "quick-notes", "staging", draftId))).toBe(false);
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

  it("I2：同步期间被编辑过 ⇒ 不标 synced（不许把新内容记成已上传）", () => {
    const draftId = crypto.randomUUID();
    const note = quickNotes.createQuickNote({ text: "原始内容", draftId, stagedImageIds: [] });
    const expected = quickNotes.listQuickNotesForSync().find((i) => i.id === note.id)!.contentHash;

    // 模拟「同步读到 expected 之后、标记之前」用户又编辑了一次
    quickNotes.updateQuickNote(note.id, { text: "同步期间改的", draftId, stagedImageIds: [] });
    quickNotes.markSyncedIfUnchanged(note.id, expected);
    expect(quickNotes.listQuickNotesForSync().find((i) => i.id === note.id)!.syncState).toBe("local");

    // 内容未变时可正常标记
    const now = quickNotes.listQuickNotesForSync().find((i) => i.id === note.id)!.contentHash;
    quickNotes.markSyncedIfUnchanged(note.id, now);
    expect(quickNotes.listQuickNotesForSync().find((i) => i.id === note.id)!.syncState).toBe("synced");
  });

  it("拒绝远端多余的不安全文件名，且不留下小记资源目录", () => {
    const raw = Buffer.from(JSON.stringify({ version: 3, text: "远端文本", body: "<p><br></p>", images: [], tagIds: [] }));
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

  it("deleteQuickNote 幂等：删除不存在/已删的小记不抛 NotFound（同步先落地远端删除 → 撤销窗口到期提交不误报）", () => {
    expect(() => quickNotes.deleteQuickNote("never-existed")).not.toThrow();
    const id = quickNotes.createQuickNote({ text: "重复删除", draftId: crypto.randomUUID(), stagedImageIds: [] }).id;
    quickNotes.deleteQuickNote(id);
    expect(() => quickNotes.deleteQuickNote(id)).not.toThrow();
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

  it("正文已 promote + 图片残留 → 新实例补移动图片，不因缺 content.qnote 中断", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "partial.png" });
    const saved = quickNotes.createQuickNote({ text: "部分 promote", draftId, stagedImageIds: [image.id] });
    const itemPath = itemPathFor(saved.id);
    const assetPath = path.join(root, "quick-notes", "assets", saved.id, image.filename);
    const imageBytes = fs.readFileSync(assetPath);
    const contentHash = hashOf(fs.readFileSync(itemPath));

    // 模拟旧顺序/异常中断后的状态：正文已在正式路径，图片仍在 staging。
    fs.rmSync(assetPath, { force: true });
    const opDir = path.join(stagingRoot(), crypto.randomUUID());
    fs.mkdirSync(opDir, { recursive: true });
    fs.writeFileSync(path.join(opDir, image.filename), imageBytes);
    fs.writeFileSync(path.join(opDir, "meta.json"), JSON.stringify({
      operationId: "x", quickNoteId: saved.id, contentHash,
      assetFilenames: [image.filename], createdAt: new Date().toISOString(), state: "prepared",
    }));

    new QuickNotesStore(root);
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(fs.readFileSync(assetPath).equals(imageBytes)).toBe(true);
    expect(fs.existsSync(opDir)).toBe(false);
  });

  it("promote 缺少图片且目标也不存在 → 保留 staging，不静默清理", async () => {
    const draftId = crypto.randomUUID();
    const image = await quickNotes.stageImage(draftId, { bytes: [...PNG], filename: "missing.png" });
    const saved = quickNotes.createQuickNote({ text: "缺图恢复", draftId, stagedImageIds: [image.id] });
    const itemPath = itemPathFor(saved.id);
    const assetPath = path.join(root, "quick-notes", "assets", saved.id, image.filename);
    const contentHash = hashOf(fs.readFileSync(itemPath));

    fs.rmSync(assetPath, { force: true });
    const opDir = path.join(stagingRoot(), crypto.randomUUID());
    fs.mkdirSync(opDir, { recursive: true });
    fs.writeFileSync(path.join(opDir, "meta.json"), JSON.stringify({
      operationId: "x", quickNoteId: saved.id, contentHash,
      assetFilenames: [image.filename], createdAt: new Date().toISOString(), state: "prepared",
    }));

    new QuickNotesStore(root);
    expect(fs.existsSync(assetPath)).toBe(false);
    expect(fs.existsSync(opDir)).toBe(true);
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
describe("R4：import_remote 4 态 journal 恢复（V5 §5.4）", () => {
  function rawQnDb() { return new Database(path.join(root, "quick-notes", "metadata.sqlite3")); }
  function makeItem(text: string) {
    const body = Buffer.from(JSON.stringify({ version: 3, text, body: "<p><br></p>", images: [], tagIds: [] }), "utf8");
    return { item: { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash: crypto.createHash("sha256").update(body).digest("hex"), isConflict: false }, body };
  }
  function insertJournal(db: Database.Database, id: string, itemPath: string, stagingDir: string, stagingKey: string, contentHash: string, state: string) {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO quick_note_file_ops(operation_type,quick_note_id,old_content_path,new_content_path,old_assets_path,new_assets_path,staging_key,content_hash,state,created_at,updated_at) VALUES('import_remote',?,?,?,?,?,?,?,?,?,?)")
      .run(id, itemPath, path.join(stagingDir, "content.qnote"), `${path.join(root, "quick-notes", "assets", id)}.bak-x`, path.join(root, "quick-notes", "assets", id), stagingKey, contentHash, state, now, now);
  }

  it("db_committed 残留 → 新实例补 promote：正文恢复、staging 与 journal 清理", () => {
    const { item, body } = makeItem("远程内容");
    quickNotes.importRemoteQuickNote(item, body, []); // 正常导入建行
    const itemPath = path.join(root, "quick-notes", "items", `${item.id}.qnote`);
    fs.rmSync(itemPath, { force: true }); // 模拟「DB 已提交但 promote 未完成」
    const opId = crypto.randomUUID();
    const stagingDir = path.join(root, "quick-notes", "staging", `import-${opId}`);
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "content.qnote"), body);
    const db = rawQnDb();
    insertJournal(db, item.id, itemPath, stagingDir, `import-${opId}`, item.contentHash, "db_committed");
    db.close();
    new QuickNotesStore(root); // 构造触发 recoverImports
    expect(fs.existsSync(itemPath)).toBe(true);
    expect(fs.readFileSync(itemPath).toString()).toBe(body.toString());
    expect(fs.existsSync(stagingDir)).toBe(false);
    const db2 = rawQnDb();
    const c = (db2.prepare("SELECT COUNT(*) c FROM quick_note_file_ops").get() as { c: number }).c;
    db2.close();
    expect(c).toBe(0);
  });

  it("prepared 残留（DB 未提交）→ 新实例清理 staging + journal", () => {
    const opId = crypto.randomUUID();
    const stagingDir = path.join(root, "quick-notes", "staging", `import-${opId}`);
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "content.qnote"), "x");
    const db = rawQnDb();
    insertJournal(db, "ghost-note", "/tmp/none", stagingDir, `import-${opId}`, "deadbeef", "prepared");
    db.close();
    new QuickNotesStore(root);
    expect(fs.existsSync(stagingDir)).toBe(false);
    const db2 = rawQnDb();
    const c = (db2.prepare("SELECT COUNT(*) c FROM quick_note_file_ops").get() as { c: number }).c;
    db2.close();
    expect(c).toBe(0);
  });


describe("R9：recoverConversions 崩溃恢复（V5 §4，四组状态×目标存在性）", () => {
  function qnDb() { return new Database(path.join(root, "quick-notes", "metadata.sqlite3")); }
  function insertConv(db: Database.Database, sourceId: string, targetId: string, state: string) {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO quick_note_conversions(source_quick_note_id,target_note_id,target_notebook_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(sourceId, targetId, "nb", state, now, now);
  }
  function convState(sourceId: string): string | undefined {
    const db = qnDb();
    const row = db.prepare("SELECT state FROM quick_note_conversions WHERE source_quick_note_id=?").get(sourceId) as { state: string } | undefined;
    db.close();
    return row?.state;
  }

  it("prepared + 目标存在 → 提升 target_created 并 finalize（源删、journal 推进）", () => {
    const source = quickNotes.createQuickNote({ text: "转换源1", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const db = qnDb();
    insertConv(db, source.id, "target-1", "prepared");
    db.close();
    const cleanup = vi.fn();
    quickNotes.recoverConversions(() => true, cleanup); // 目标存在
    expect(quickNotes.listQuickNotes().some((n) => n.id === source.id)).toBe(false); // 源已删
    expect(convState(source.id)).toBe("source_deleted_waiting_sync"); // journal 推进
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("prepared + 目标缺失 → cleanupUntrackedTarget 调用 + journal 删除", () => {
    const source = quickNotes.createQuickNote({ text: "转换源2", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const db = qnDb();
    insertConv(db, source.id, "target-ghost", "prepared");
    db.close();
    const cleanup = vi.fn();
    quickNotes.recoverConversions(() => false, cleanup); // 目标缺失
    expect(cleanup).toHaveBeenCalledWith("target-ghost");
    expect(convState(source.id)).toBeUndefined(); // journal 删除
    expect(quickNotes.listQuickNotes().some((n) => n.id === source.id)).toBe(true); // 源保留
  });

  it("target_created + 目标存在 → finalize（源删、journal 推进）", () => {
    const source = quickNotes.createQuickNote({ text: "转换源3", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const db = qnDb();
    insertConv(db, source.id, "target-3", "target_created");
    db.close();
    quickNotes.recoverConversions(() => true, vi.fn());
    expect(quickNotes.listQuickNotes().some((n) => n.id === source.id)).toBe(false);
    expect(convState(source.id)).toBe("source_deleted_waiting_sync");
  });

  it("target_created + 目标缺失 → 无动作（journal 与源保留，待后续恢复）", () => {
    const source = quickNotes.createQuickNote({ text: "转换源4", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const db = qnDb();
    insertConv(db, source.id, "target-4", "target_created");
    db.close();
    const cleanup = vi.fn();
    quickNotes.recoverConversions(() => false, cleanup);
    expect(convState(source.id)).toBe("target_created"); // journal 保留
    expect(quickNotes.listQuickNotes().some((n) => n.id === source.id)).toBe(true); // 源保留
    expect(cleanup).not.toHaveBeenCalled();
  });
});
  it("promote 幂等：目标已是新内容 → 恢复重跑不破坏", () => {
    const { item, body } = makeItem("幂等测试");
    quickNotes.importRemoteQuickNote(item, body, []); // promote 已完成
    const itemPath = path.join(root, "quick-notes", "items", `${item.id}.qnote`);
    const originalBody = fs.readFileSync(itemPath);
    const opId = crypto.randomUUID();
    const stagingDir = path.join(root, "quick-notes", "staging", `import-${opId}`);
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "content.qnote"), body);
    const db = rawQnDb();
    insertJournal(db, item.id, itemPath, stagingDir, `import-${opId}`, item.contentHash, "db_committed");
    db.close();
    new QuickNotesStore(root);
    expect(fs.readFileSync(itemPath).toString()).toBe(originalBody.toString()); // 未破坏
  });
});
describe("小记全文搜索（独立 FTS）", () => {
  it("正文与标签都能命中，更新后旧词失效、新词生效", () => {
    const inspiration = quickNotes.createQuickNoteTag("灵感").id;
    const saved = quickNotes.createQuickNote({ text: "今天写搜索索引\n第二行", draftId: crypto.randomUUID(), stagedImageIds: [], tagIds: [inspiration] });
    const hits = quickNotes.search("搜索");
    expect(hits.map((hit) => hit.id)).toEqual([saved.id]);
    expect(hits[0].kind).toBe("quick-note");
    expect(hits[0].title).toContain("今天写搜索索引");
    expect(hits[0].snippet).toContain("<mark>");
    expect(quickNotes.search("灵感").map((hit) => hit.id)).toEqual([saved.id]);

    quickNotes.updateQuickNote(saved.id, { text: "改成完全不同的内容", draftId: crypto.randomUUID(), stagedImageIds: [], tagIds: [] });
    expect(quickNotes.search("搜索")).toEqual([]);
    expect(quickNotes.search("不同").map((hit) => hit.id)).toEqual([saved.id]);
  });

  it("保存/删除都会维护索引；重建索引可从 .qnote 文件恢复", () => {
    const keep = quickNotes.createQuickNote({ text: "保留的小记", draftId: crypto.randomUUID(), stagedImageIds: [] });
    const drop = quickNotes.createQuickNote({ text: "删除的小记", draftId: crypto.randomUUID(), stagedImageIds: [] });
    expect(quickNotes.search("小记").length).toBe(2);
    quickNotes.deleteQuickNote(drop.id);
    expect(quickNotes.search("删除")).toEqual([]);
    quickNotes.rebuildSearchIndex();
    expect(quickNotes.search("保留").map((hit) => hit.id)).toEqual([keep.id]);
    expect(quickNotes.search("删除")).toEqual([]);
  });

  it("空查询/无索引时返回空；标签命中也能生成结果", () => {
    expect(quickNotes.search("   ")).toEqual([]);
    expect(quickNotes.search("不存在的词")).toEqual([]);
    const projectA = quickNotes.createQuickNoteTag("项目A").id;
    const saved = quickNotes.createQuickNote({ text: "只有标签能命中", draftId: crypto.randomUUID(), stagedImageIds: [], tagIds: [projectA] });
    const hit = quickNotes.search("项目A")[0];
    expect(hit.id).toBe(saved.id);
    expect(hit.matchType).toBe("body");
  });
});

describe("缺正文小记的恢复路径（261023）", () => {
  const itemPath = (id: string) => path.join(root, "quick-notes", "items", id + ".qnote");

  it("listMissingQuickNotes 只列缺正文小记；搜索缓存可重建纯文本", () => {
    const note = quickNotes.createQuickNote({ text: "缓存里的全文内容", draftId: crypto.randomUUID(), stagedImageIds: [] });
    quickNotes.ensureSearchIndex();
    fs.rmSync(itemPath(note.id));
    const rows = quickNotes.listMissingQuickNotes({ cloudConfigured: false });
    const row = rows.find((r) => r.id === note.id);
    expect(row?.recovery).toBe("text");
    expect(row?.hasTextCache).toBe(true);
    const restored = quickNotes.recoverQuickNoteFromText(note.id);
    expect(restored.content.text).toContain("缓存里的全文内容");
    expect(fs.existsSync(itemPath(note.id))).toBe(true);
    expect(quickNotes.listMissingQuickNotes({ cloudConfigured: false }).some((r) => r.id === note.id)).toBe(false);
  });

  it("缺正文恢复不拆坏含空格的标签（账本 JSON，不再用空格拼接）", () => {
    const projectA = quickNotes.createQuickNoteTag("项目 A").id;
    const inspiration = quickNotes.createQuickNoteTag("灵感").id;
    const note = quickNotes.createQuickNote({
      text: "缓存文本",
      draftId: crypto.randomUUID(),
      stagedImageIds: [],
      tagIds: [projectA, inspiration],
    });
    fs.rmSync(itemPath(note.id));
    const restored = quickNotes.recoverQuickNoteFromText(note.id);
    expect(restored.content.tags).toEqual(["项目 A", "灵感"]);
  });

  it("purgeMissingQuickNote：彻底删除并写墓碑", () => {
    const note = quickNotes.createQuickNote({ text: "待删除", draftId: crypto.randomUUID(), stagedImageIds: [] });
    fs.rmSync(itemPath(note.id));
    quickNotes.purgeMissingQuickNote(note.id);
    expect(quickNotes.listMissingQuickNotes({ cloudConfigured: false }).some((r) => r.id === note.id)).toBe(false);
    expect(() => quickNotes.readQuickNote(note.id)).toThrow();
    const db = new Database(path.join(root, "quick-notes", "metadata.sqlite3"), { readonly: true });
    try {
      const row = db.prepare("SELECT purged_at FROM quick_note_deleted WHERE id=?").get(note.id) as { purged_at: string | null } | undefined;
      expect(row?.purged_at).toBeTruthy();
    } finally { db.close(); }
  });
});
