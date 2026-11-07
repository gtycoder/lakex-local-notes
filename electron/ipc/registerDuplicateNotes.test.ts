import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store 模块加载即需要 electron（safeStorage 解密 S3 密钥、net）
const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "../store.js";
import { registerDuplicateNotesIpc, runDesktopDuplicateNotes, type DuplicateNotesIpcDeps } from "./registerDuplicateNotes.js";
import type { DuplicateNotesResultShape } from "../../src/lib/types.js";

/**
 * 261106 文档「创建副本」：新 id + 新建管线；同父级下方；正文/资源全量复制且 URL 重写；
 * 逐条独立（一条失败不影响其它）；请求级不合法整批拒绝。
 */
let root: string;
let store: Store;

function fresh() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-duplicate-notes-"));
  store = new Store(root);
  store.bootstrap();
  return store.createNotebook("笔记本");
}

beforeEach(() => { fresh(); });
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  fs.rmSync(root, { recursive: true, force: true });
});

const deps = (over: Partial<DuplicateNotesIpcDeps> = {}): DuplicateNotesIpcDeps => ({ store, ...over });
const run = (payload: unknown, over: Partial<DuplicateNotesIpcDeps> = {}): Promise<DuplicateNotesResultShape> =>
  runDesktopDuplicateNotes(payload, deps(over)) as Promise<DuplicateNotesResultShape>;

type Handler = (...args: unknown[]) => unknown;
function registerHarness(over: Partial<DuplicateNotesIpcDeps> = {}) {
  const handlers = new Map<string, Handler>();
  const ipc = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); }, handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); }, registry: new Map() };
  const progress: unknown[] = [];
  registerDuplicateNotesIpc(ipc as unknown as Parameters<typeof registerDuplicateNotesIpc>[0], deps(over));
  return {
    channels: () => [...handlers.keys()],
    progress,
    call: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)!;
      if (channel === "duplicate_notes") {
        return handler({ sender: { send: (name: string, payload: unknown) => { if (name === "duplicate-progress") progress.push(payload); } } }, ...args);
      }
      return handler(...args);
    },
  };
}

const bodyPath = (id: string) => path.join(root, "notes", id + ".lake");
const assetsDir = (id: string) => path.join(root, "note-assets", id);
function seedBodyAndAssets(id: string, label: string): void {
  fs.writeFileSync(bodyPath(id), '<p>' + label + '</p><img src="http://127.0.0.1:19876/' + id + '/1700_ab.png">');
  fs.mkdirSync(assetsDir(id), { recursive: true });
  fs.writeFileSync(path.join(assetsDir(id), "1700_ab.png"), "png-bytes");
}

describe("duplicate_notes：通道与基本语义", () => {
  it("只注册 duplicate_notes；成功条带 newId、同父级、紧邻源之后", async () => {
    const notebook = store.createNotebook("N");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    seedBodyAndAssets(a.id, "A正文");

    const h = registerHarness();
    expect(h.channels()).toEqual(["cancel_duplicate_notes", "duplicate_notes"]);
    const result = await h.call("duplicate_notes", { ids: [a.id] }) as DuplicateNotesResultShape;
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 1, done: 1, failed: 0 });
    const copy = result.results[0];
    expect(copy.ok).toBe(true);
    expect(copy.newId).toBeTruthy();
    expect(copy.newId).not.toBe(a.id);

    const nodes = store.listTreeNodes().filter((node) => node.parentId === notebook.id);
    const aIndex = nodes.findIndex((node) => node.id === a.id);
    const copyIndex = nodes.findIndex((node) => node.id === copy.newId);
    const bIndex = nodes.findIndex((node) => node.id === b.id);
    expect(copyIndex).toBe(aIndex + 1); // 紧邻源之后
    expect(bIndex).toBeGreaterThan(copyIndex); // 后续同级后移
    const copyNode = nodes[copyIndex];
    expect(copyNode.title).toContain(" 副本 ");
    expect(copyNode.isDirty).toBe(true);
  });

  it("正文资源 URL 重写成新 id；资源文件复制到新目录（内容一致）", async () => {
    const notebook = store.createNotebook("N");
    const src = store.createNoteIn(notebook.id, "图文");
    seedBodyAndAssets(src.id, "正文");
    const result = await run({ ids: [src.id] });
    const newId = result.results[0].newId!;

    const body = fs.readFileSync(bodyPath(newId), "utf8");
    expect(body).toContain("/" + newId + "/1700_ab.png");
    expect(body).not.toContain("/" + src.id + "/1700_ab.png");
    expect(fs.readFileSync(path.join(assetsDir(newId), "1700_ab.png"), "utf8")).toBe("png-bytes");
    // 源资源仍在（独立副本）
    expect(fs.existsSync(path.join(assetsDir(src.id), "1700_ab.png"))).toBe(true);
  });

  it("块 id 全量重映射：副本不再与源共用 id，list/fid 引用一致，资源 URL 已换新 noteId", async () => {
    const notebook = store.createNotebook("N");
    const src = store.createNoteIn(notebook.id, "带块id");
    const body = [
      '<h1 data-lake-id="u11111111" id="u11111111"><span data-lake-id="u22222222" id="u22222222">标题</span></h1>',
      '<p data-lake-id="' + src.id + '-body" id="' + src.id + '-body"><span data-lake-id="u33333333" id="u33333333">正文</span></p>',
      '<ul list="u44444444"><li fid="u44444444" data-lake-id="u55555555" id="u55555555"><span data-lake-id="u66666666" id="u66666666">项</span></li></ul>',
      '<p><card type="inline" name="image" value="data:%7B%22src%22%3A%22http%3A%2F%2F127.0.0.1%3A19876%2F' + src.id + '%2Fa.png%22%7D"></card></p>',
    ].join("");
    fs.writeFileSync(bodyPath(src.id), body);
    const result = await run({ ids: [src.id] });
    const newId = result.results[0].newId!;
    const copy = fs.readFileSync(bodyPath(newId), "utf8");
    for (const oldId of ["u11111111", "u22222222", "u33333333", "u44444444", "u55555555", "u66666666", src.id + "-body"]) {
      expect(copy, oldId).not.toContain(oldId);
    }
    // 资源 URL 走新 noteId（百分号编码形态）
    expect(copy).toContain("%2F" + newId + "%2Fa.png");
    // list/fid 引用一致（同一新 id）
    const listId = /<ul list="([^"]+)"/.exec(copy)![1];
    expect(copy).toContain('fid="' + listId + '"');
    // 源正文不被改动
    expect(fs.readFileSync(bodyPath(src.id), "utf8")).toBe(body);
  });

  it("副本正文进全文索引（建完即可搜到，不等用户编辑）", async () => {
    const notebook = store.createNotebook("N");
    const src = store.createNoteIn(notebook.id, "索引源");
    fs.writeFileSync(bodyPath(src.id), '<p>唯一检索词XYZZY</p>');
    const result = await run({ ids: [src.id] });
    const newId = result.results[0].newId!;
    const hits = store.searchNotes("唯一检索词XYZZY", 20);
    expect(hits.some((hit) => hit.id === newId)).toBe(true);
  });

  it("自引用防护：源里的引用保持指向原目标，副本里不出现指向自己的 lake-note://{新id}", async () => {
    const notebook = store.createNotebook("N");
    const src = store.createNoteIn(notebook.id, "引用源");
    const other = "66666666-6666-4666-8666-666666666666";
    fs.writeFileSync(bodyPath(src.id), '<p><a href="lake-note://' + src.id + '">指向自己</a><a href="lake-note://' + other + '">指向别篇</a></p>');
    const result = await run({ ids: [src.id] });
    const newId = result.results[0].newId!;
    const copy = fs.readFileSync(bodyPath(newId), "utf8");
    // 源里的自引用在副本里 = 指向"原目标"，允许；副本绝不能引用自己。
    expect(copy).toContain("lake-note://" + src.id);
    expect(copy).not.toContain("lake-note://" + newId);
    // 指向别篇的引用原样保留
    expect(copy).toContain("lake-note://" + other);
  });

  it("kind 保持：usheet 副本落 usheets/{newId}.usheet.json", async () => {
    const notebook = store.createNotebook("N");
    const sheet = store.createUsheetIn(notebook.id, "表格");
    const result = await run({ ids: [sheet.id] });
    const newId = result.results[0].newId!;
    expect(fs.existsSync(path.join(root, "usheets", newId + ".usheet.json"))).toBe(true);
    expect(store.readNote(newId).kind).toBe("usheet");
  });

  it("批量：三篇各自副本按 A,A',B,B',C,C' 排列，newId 全不同", async () => {
    const notebook = store.createNotebook("N");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const c = store.createNoteIn(notebook.id, "C");
    const result = await run({ ids: [a.id, b.id, c.id] });
    expect(result.ok).toBe(true);
    const ids = result.results.map((item) => item.newId!);
    expect(new Set(ids).size).toBe(3);
    const order = store.listTreeNodes().filter((node) => node.parentId === notebook.id).map((node) => node.id);
    expect(order).toEqual([a.id, ids[0], b.id, ids[1], c.id, ids[2]]);
  });

  it("标签关系复制（新笔记独立关系）", async () => {
    const notebook = store.createNotebook("N");
    const src = store.createNoteIn(notebook.id, "带标签");
    store.documentTags.setNoteTags(src.id, ["t_0123456789abcdef", "t_fedcba9876543210"]);
    const result = await run({ ids: [src.id] });
    const newId = result.results[0].newId!;
    expect(store.documentTags.getDocumentTagIds(newId)).toEqual(["t_0123456789abcdef", "t_fedcba9876543210"]);
    // 改副本标签不影响源（完全独立）
    store.documentTags.setNoteTags(newId, ["t_0123456789abcdef"]);
    expect(store.documentTags.getDocumentTagIds(src.id)).toEqual(["t_0123456789abcdef", "t_fedcba9876543210"]);
  });
});

describe("duplicate_notes：并发与混合类型（261107）", () => {
  it("两个请求同时发起 ⇒ 单飞串行，各自紧邻源、sort_order 唯一", async () => {
    const notebook = store.createNotebook("并发");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const [r1, r2] = await Promise.all([run({ ids: [a.id] }), run({ ids: [b.id] })]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const ids = store.listTreeNodes().filter((node) => node.parentId === notebook.id).map((node) => [node.id, node.sortOrder] as const);
    const order = ids.sort((x, y) => x[1] - y[1]).map(([id]) => id);
    expect(order).toEqual([a.id, r1.results[0].newId, b.id, r2.results[0].newId]);
    expect(new Set(ids.map(([, sort]) => sort)).size).toBe(ids.length);
  });

  it("同一源并发复制两次 ⇒ 两个独立副本（不同 newId），源正文不变", async () => {
    const notebook = store.createNotebook("同源并发");
    const src = store.createNoteIn(notebook.id, "源");
    fs.writeFileSync(bodyPath(src.id), "<p>正文</p>");
    const [r1, r2] = await Promise.all([run({ ids: [src.id] }), run({ ids: [src.id] })]);
    expect(r1.results[0].ok).toBe(true);
    expect(r2.results[0].ok).toBe(true);
    expect(r1.results[0].newId).not.toBe(r2.results[0].newId);
    expect(fs.readFileSync(bodyPath(src.id), "utf8")).toBe("<p>正文</p>");
  });

  it("混合类型 + 资源：doc（带图）与 usheet 同一批，各自资源独立、URL 重写、类型保持", async () => {
    const notebook = store.createNotebook("混合");
    const doc = store.createNoteIn(notebook.id, "图文");
    seedBodyAndAssets(doc.id, "混排");
    const sheet = store.createUsheetIn(notebook.id, "表格");
    fs.mkdirSync(assetsDir(sheet.id), { recursive: true });
    fs.writeFileSync(path.join(assetsDir(sheet.id), "1700_cd.png"), "sheet-bytes");
    const sheetBodyPath = path.join(root, "usheets", sheet.id + ".usheet.json");
    fs.writeFileSync(sheetBodyPath, JSON.stringify({ image: "http://127.0.0.1:19876/" + sheet.id + "/1700_cd.png" }));
    const result = await run({ ids: [doc.id, sheet.id] });
    expect(result.summary).toEqual({ total: 2, done: 2, failed: 0 });
    const docCopy = result.results[0].newId!;
    const sheetCopy = result.results[1].newId!;
    expect(store.readNote(docCopy).kind).toBe("doc");
    expect(store.readNote(sheetCopy).kind).toBe("usheet");
    expect(fs.readFileSync(path.join(assetsDir(docCopy), "1700_ab.png"), "utf8")).toBe("png-bytes");
    expect(fs.readFileSync(path.join(assetsDir(sheetCopy), "1700_cd.png"), "utf8")).toBe("sheet-bytes");
    const sheetCopyBody = fs.readFileSync(path.join(root, "usheets", sheetCopy + ".usheet.json"), "utf8");
    expect(sheetCopyBody).toContain("/" + sheetCopy + "/1700_cd.png");
    expect(sheetCopyBody).not.toContain("/" + sheet.id + "/1700_cd.png");
  });
});

describe("duplicate_notes：拒绝与部分失败", () => {
  it("请求级：空 / 超上限 / 非法 id ⇒ 整批拒绝且不建任何副本", async () => {
    const notesBefore = store.listTreeNodes().filter((node) => node.nodeType === "note").length;
    for (const payload of [{ ids: [] }, undefined, { ids: ["a", "../x"] }, { ids: Array.from({ length: 501 }, (_, i) => "n" + i) }]) {
      const result = await run(payload);
      expect(result.ok).toBe(false);
      expect(result.results).toEqual([]);
      expect(["empty-ids", "invalid-input", "invalid-id", "too-many-ids"]).toContain(result.reason);
    }
    expect(store.listTreeNodes().filter((node) => node.nodeType === "note").length).toBe(notesBefore);
  });

  it("逐条独立：回收站 / 正文缺失 / 不存在 各自 reason，正常条仍成功", async () => {
    const notebook = store.createNotebook("N");
    const ok = store.createNoteIn(notebook.id, "正常");
    const trashed = store.createNoteIn(notebook.id, "回收站");
    store.deleteTreeNode(trashed.id);
    const missing = store.createNoteIn(notebook.id, "缺正文");
    fs.rmSync(bodyPath(missing.id));
    const result = await run({ ids: [ok.id, trashed.id, missing.id, "ghost-id"] });
    expect(result.summary).toEqual({ total: 4, done: 1, failed: 3 });
    const byId = new Map(result.results.map((item) => [item.id, item]));
    expect(byId.get(ok.id)!.ok).toBe(true);
    expect(byId.get(trashed.id)!.reason).toBe("already-trashed");
    expect(byId.get(missing.id)!.reason).toBe("body-missing");
    expect(byId.get("ghost-id")!.reason).toBe("not-found");
  });

  it("执行期异常 ⇒ failed（其它条不回滚）", async () => {
    const notebook = store.createNotebook("N");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const result = await run({ ids: [a.id, b.id] }, {
      duplicateOne: (id) => { if (id === a.id) throw new Error("boom"); return store.duplicateNote(id); },
    });
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 1 });
    expect(result.results.find((item) => item.id === a.id)!.reason).toBe("failed");
    expect(result.results.find((item) => item.id === b.id)!.ok).toBe(true);
  });
});

describe("duplicate_notes：261108 进度与取消", () => {
  it("进度事件按阶段发送，requestId 原样回传", async () => {
    const notebook = store.createNotebook("P");
    const a = store.createNoteIn(notebook.id, "A");
    const h = registerHarness();
    const result = await h.call("duplicate_notes", { ids: [a.id], requestId: "req-progress" }) as DuplicateNotesResultShape;
    expect(result.ok).toBe(true);
    const events = h.progress as Array<{ requestId: string; phase: string; done: number; total: number }>;
    expect(events.every((event) => event.requestId === "req-progress")).toBe(true);
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining(["prepare", "copy", "commit"]));
  });

  it("取消标记 ⇒ 未提交条目返回 canceled，不物理删除任何东西", async () => {
    const notebook = store.createNotebook("C");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const h = registerHarness();
    await h.call("cancel_duplicate_notes", "req-cancel");
    const result = await h.call("duplicate_notes", { ids: [a.id, b.id], requestId: "req-cancel" }) as DuplicateNotesResultShape;
    expect(result.ok).toBe(false);
    expect(result.results.every((item) => !item.ok && item.reason === "canceled")).toBe(true);
    expect(store.listNoteSummaries().filter((note) => note.title.includes("副本"))).toHaveLength(0);
  });
});
