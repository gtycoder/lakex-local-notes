/**
 * 261105 Batch4-D：手动「重建数据」单测（标题派生 / 坏正文拒绝 / 候选白名单 / 幂等 / 只读语义）。
 * 用真实 Store（临时工作区）验证「新行 + 专用笔记本 + 正文不动 + dirty」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "./store.js";
import {
  RECOVERED_NOTEBOOK_ID,
  RECOVERED_NOTEBOOK_TITLE,
  RecoveredNotesService,
  assertRecoveredBodyReadable,
  deriveRecoveredTitle,
  fallbackRecoveredTitle,
  inspectRecoveredCandidate,
  readRecoveredBodyText,
} from "./recoveredNotes.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-rebuild-notes-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
  }
});

function makeHarness() {
  const root = tempDir();
  const store = new Store(root);
  const logs: string[] = [];
  const service = new RecoveredNotesService({
    root,
    store: {
      listKnownNoteIds: () => store.listNotesSyncMeta().map((note) => note.id),
      hasNote: (id) => store.hasNote(id),
      rebuildRecoveredNotes: (rows) => store.rebuildRecoveredNotes(rows),
    },
    log: (message) => logs.push(message),
    now: () => new Date("2026-11-05T00:00:00.000Z"),
  });
  return { root, store, service, logs };
}

function writeBody(root: string, kindDir: string, filename: string, content: string | Buffer): string {
  const dir = path.join(root, kindDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  return file;
}

describe("标题派生（正文优先，解析不到退化）", () => {
  it("doc（Lake HTML）：首个 H1~H6 文本作为标题", () => {
    expect(deriveRecoveredTitle("doc", '<h1 class="ne-h1">项目计划</h1><p>x</p>', "orphan-1")).toEqual({ title: "项目计划", titleSource: "body" });
    expect(deriveRecoveredTitle("doc", "<h2>第二章</h2>", "orphan-1")).toEqual({ title: "第二章", titleSource: "body" });
  });

  it("doc 没有标题/标题为空 ⇒ 兜底「恢复的笔记 <id 前 8 位>」", () => {
    expect(deriveRecoveredTitle("doc", "<p>只有正文</p>", "abcdef1234567890")).toEqual({ title: "恢复的笔记 abcdef12", titleSource: "fallback" });
    expect(deriveRecoveredTitle("doc", "<h1> </h1>", "x")).toMatchObject({ titleSource: "fallback" });
    expect(fallbackRecoveredTitle("abcdef1234567890")).toBe(RECOVERED_NOTEBOOK_TITLE + " abcdef12");
  });

  it("JSON 四族：当前 schema 无 title ⇒ 反序列化异常/无 title 都退化（为未来字段留口）", () => {
    expect(deriveRecoveredTitle("usheet", "{\"kind\":\"usheet\"}", "u1")).toMatchObject({ titleSource: "fallback" });
    expect(deriveRecoveredTitle("usheet", JSON.stringify({ title: "表格标题" }), "u1")).toEqual({ title: "表格标题", titleSource: "body" });
    expect(deriveRecoveredTitle("board", "not json", "b1")).toMatchObject({ titleSource: "fallback" });
  });
});

describe("正文可读性（损坏拒绝，不覆盖原文件）", () => {
  it("非法 UTF-8 / 含 NUL / 空正文 ⇒ 不可读并给原因", () => {
    const root = tempDir();
    const bad = writeBody(root, "notes", "bad.lake", Buffer.from([0xff, 0xfe, 0x00]));
    expect(readRecoveredBodyText(bad).ok).toBe(false);
    const nul = writeBody(root, "notes", "nul.lake", Buffer.from("abc\u0000def", "utf8"));
    expect(readRecoveredBodyText(nul)).toMatchObject({ ok: false });
    const empty = writeBody(root, "notes", "empty.lake", "   ");
    expect(readRecoveredBodyText(empty)).toMatchObject({ ok: false });
  });

  it("doc 只要非空文本即可；usheet 等 JSON 四族走 core/docBodySafety 单一判据", () => {
    expect(assertRecoveredBodyReadable("doc", "<p>正文</p>")).toEqual({ ok: true });
    expect(assertRecoveredBodyReadable("usheet", "not json").ok).toBe(false);
    // 结构符合 core 判据的 JSON 则放行（与「打开=只读」同源，不另立一套）
    const validUsheet = JSON.stringify({ kind: "usheet", version: 1, workbook: {} });
    expect(assertRecoveredBodyReadable("usheet", validUsheet).ok).toBe(true);
  });

  it("候选不可读 ⇒ rebuildable=false 且带可读原因", () => {
    const root = tempDir();
    writeBody(root, "notes", "bad.lake", Buffer.from([0xff]));
    const candidate = inspectRecoveredCandidate(root, { noteId: "bad", kind: "doc", relativePath: "notes/bad.lake", sizeBytes: 1, mtimeMs: 1 });
    expect(candidate.rebuildable).toBe(false);
    expect(candidate.reason).toContain("UTF-8");
    expect(candidate.titleSource).toBe("fallback");
  });
});

describe("RecoveredNotesService：扫描只读 + 手动重建", () => {
  it("扫描只读：只读正文派生标题，不写库/不改文件", () => {
    const { root, store, service } = makeHarness();
    const file = writeBody(root, "notes", "orphan-read.lake", "<h1>只读扫描</h1>");
    const before = fs.statSync(file).mtimeMs;
    const notesBefore = store.listNoteSummaries().length;
    const result = service.scan();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ noteId: "orphan-read", title: "只读扫描", titleSource: "body", rebuildable: true });
    expect(store.hasNote("orphan-read")).toBe(false);
    expect(store.listNoteSummaries().length).toBe(notesBefore);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("重建成功：新行 + 专用笔记本 + 标 dirty + 正文文件原样不动", async () => {
    const { root, store, service, logs } = makeHarness();
    const content = "<h1>找回的笔记</h1><p>正文</p>";
    const file = writeBody(root, "notes", "orphan-ok.lake", content);
    const before = fs.statSync(file);
    service.scan();
    const out = await service.rebuild(["orphan-ok"]);
    expect(out.notebookId).toBe(RECOVERED_NOTEBOOK_ID);
    expect(out.results).toEqual([{ noteId: "orphan-ok", status: "created", title: "找回的笔记" }]);
    // 行 + 专用笔记本 + dirty（随下次同步上传）
    expect(store.hasNote("orphan-ok")).toBe(true);
    const summary = store.listNoteSummaries().find((note) => note.id === "orphan-ok")!;
    expect(summary.parentId).toBe(RECOVERED_NOTEBOOK_ID);
    expect(summary.isDirty).toBe(true);
    const notebook = store.listTreeNodes().find((node) => node.id === RECOVERED_NOTEBOOK_ID);
    expect(notebook).toMatchObject({ title: RECOVERED_NOTEBOOK_TITLE, nodeType: "notebook" });
    // 正文文件：内容/大小/mtime 都不变（绝不覆盖原文件）
    expect(fs.readFileSync(file, "utf8")).toBe(content);
    const after = fs.statSync(file);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    // 审计日志：一条含 id/路径/标题/结果
    expect(logs.some((line) => line.includes("[rebuild]") && line.includes("orphan-ok") && line.includes("created"))).toBe(true);
  });

  it("坏正文 ⇒ 拒绝（不建行），原文件保持不动", async () => {
    const { root, store, service } = makeHarness();
    const file = writeBody(root, "notes", "orphan-bad.lake", Buffer.from([0xff, 0xfe, 0xfd]));
    const bytes = fs.readFileSync(file);
    service.scan();
    const out = await service.rebuild(["orphan-bad"]);
    expect(out.results[0].status).toBe("rejected");
    expect(out.results[0].reason).toContain("UTF-8");
    expect(store.hasNote("orphan-bad")).toBe(false);
    expect(fs.readFileSync(file)).toEqual(bytes);
  });

  it("非本次扫描候选 id ⇒ 整次拒绝；未扫描就重建 ⇒ 拒绝", async () => {
    const { service } = makeHarness();
    await expect(service.rebuild(["whatever"])).rejects.toThrow(/先点击「扫描」/);
    service.scan();
    await expect(service.rebuild(["whatever"])).rejects.toThrow(/非本次扫描候选/);
    await expect(service.rebuild([])).rejects.toThrow(/勾选/);
  });

  it("幂等：同一候选重建两次，第二次 skipped（行已存在）", async () => {
    const { root, store, service } = makeHarness();
    writeBody(root, "notes", "orphan-twice.lake", "<h1>只建一次</h1>");
    service.scan();
    expect((await service.rebuild(["orphan-twice"])).results[0].status).toBe("created");
    expect((await service.rebuild(["orphan-twice"])).results[0].status).toBe("skipped");
    expect(store.listNoteSummaries().filter((note) => note.id === "orphan-twice")).toHaveLength(1);
  });
});
