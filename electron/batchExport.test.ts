import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store / noteExport 模块加载即需要 electron（safeStorage 解密 S3 密钥、net）。
const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "./store.js";
import {
  BATCH_EXPORT_MAX_ITEMS,
  defaultBatchExportDeps,
  defaultBatchExportFormat,
  normalizeBoardImages,
  expandBatchExportTargets,
  exportNotesBatch,
  sanitizeBatchExportTitle,
  uniqueBatchExportPath,
  type BatchExportDeps,
} from "./batchExport.js";
import { createInkDoc, inkToBody } from "../src/core/inkDoc.js";

/**
 * 261106 批量导出（数据层）：格式映射（5 类 kind）、分组递归展开、去重/上限、重名「 (2)」、
 * 逐条结果（部分失败不影响整批）、画板 skipped、**只读不写源**。
 *
 * 261106 二轮默认格式：doc→markdown（资料包**目录**）、usheet/bitable→csv、ink→pdf、board→pdf（skipped）。
 * 真导出链路（PDF 隐藏窗口 printToPDF / markdown 资料包 / usheet csv）在单测里用注入 deps 产出，
 * 格式映射与编排逻辑才是本任务的契约；markdown 资料包是目录 ⇒ 用目录验证"目录也能改名/避重名"。
 */
let root: string;
let store: Store;
let outDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-batch-export-store-"));
  store = new Store(root);
  store.bootstrap();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-batch-export-out-"));
});
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  for (const dir of [root, outDir]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
});

/** stub 导出器：写一个假文件（同名不同后缀），用于验证命名/改名声明的路径。 */
function stubDeps(over: Partial<BatchExportDeps> = {}) {
  const calls: string[] = [];
  const write = (dir: string, name: string, ext: string): string => {
    const target = path.join(dir, name + "." + ext);
    fs.writeFileSync(target, "stub-" + ext);
    return target;
  };
  const deps: BatchExportDeps = {
    // 真实导出器自己也会避重名（-2 后缀）；stub 用带 id 的临时名，让批量层统一改名到「 (2)」
    // doc 的产物是**目录**（markdown 资料包），同样要能被改名
    exportDocMarkdown: async (_store, id, dir) => {
      calls.push("markdown:" + id);
      const target = path.join(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4));
      fs.mkdirSync(path.join(target, "images"), { recursive: true });
      fs.writeFileSync(path.join(target, store.readNote(id).title + ".md"), "# stub");
      return target;
    },
    exportUsheetCsv: async (_store, id, dir) => { calls.push("csv:" + id); return write(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4), "csv"); },
    exportBitableCsv: async (_store, id, dir) => { calls.push("csv:" + id); return write(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4), "csv"); },
    exportInkPdf: async (_store, id, dir) => { calls.push("pdf:" + id); return write(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4), "pdf"); },
    // 画板：字节由渲染层给（测试里直接写 stub 文件）；真实实现见 boardImagePdf.ts
    exportBoardPdf: async (_store, id, options) => {
      calls.push("board-pdf:" + id);
      fs.writeFileSync(options.targetPath, "stub-board-pdf");
      return options.targetPath;
    },
    ...over,
  };
  return { deps, calls };
}

function seed() {
  const notebook = store.createNotebook("知识库");
  const group = store.createGroup(notebook.id, "分组");
  const doc = store.createNoteIn(group.id, "文档 A");
  const usheet = store.createUsheetIn(group.id, "表格 B");
  const bitable = store.createBitableIn(notebook.id, "多维表 C");
  const board = store.createBoardIn(notebook.id, "画板 D");
  const ink = store.createInkIn(notebook.id, "手写 E");
  // 手写板正文：两页（验证多页分文件）
  const doc0 = createInkDoc("page-1");
  doc0.pages.push({ ...doc0.pages[0], id: "page-2" });
  store.saveNote(ink.id, "手写 E", inkToBody(doc0));
  return { notebook, group, doc, usheet, bitable, board, ink };
}

describe("默认格式映射（261106 二轮：5 类 kind）", () => {
  it("doc→markdown / usheet→csv / bitable→csv / board→pdf / ink→pdf；未知 kind = null", () => {
    expect(defaultBatchExportFormat("doc")).toBe("markdown");
    expect(defaultBatchExportFormat(undefined)).toBe("markdown");
    expect(defaultBatchExportFormat("usheet")).toBe("csv");
    expect(defaultBatchExportFormat("bitable")).toBe("csv");
    expect(defaultBatchExportFormat("board")).toBe("pdf");
    expect(defaultBatchExportFormat("ink")).toBe("pdf");
    expect(defaultBatchExportFormat("unknown-kind")).toBeNull();
  });
});

describe("命名：清洗非法字符 + 重名 (2)", () => {
  it("清洗 / \\ : * ? < > | 与首尾空格；空标题回落未命名", () => {
    expect(sanitizeBatchExportTitle('a/b\\c:d*e?f<g>h|i')).toBe("a b c d e f g h i");
    expect(sanitizeBatchExportTitle("  标题  ")).toBe("标题");
    expect(sanitizeBatchExportTitle("...隐藏")).toBe("隐藏");
    expect(sanitizeBatchExportTitle("")).toBe("未命名");
  });

  it("同一批内重名追加「 (2)」「 (3)」；已存在文件也让位；**无扩展名 = 目录（markdown 资料包）**", () => {
    const reserved = new Set<string>();
    const first = uniqueBatchExportPath(outDir, "文档", "pdf", { reserved });
    const second = uniqueBatchExportPath(outDir, "文档", "pdf", { reserved });
    const third = uniqueBatchExportPath(outDir, "文档", "pdf", { reserved });
    expect(path.basename(first)).toBe("文档.pdf");
    expect(path.basename(second)).toBe("文档 (2).pdf");
    expect(path.basename(third)).toBe("文档 (3).pdf");
    // 磁盘上已存在 => 也不覆盖
    fs.writeFileSync(path.join(outDir, "已有.pdf"), "x");
    expect(path.basename(uniqueBatchExportPath(outDir, "已有", "pdf"))).toBe("已有 (2).pdf");
    // doc 的 markdown 资料包是目录：ext 传空串 ⇒ 不带点
    expect(path.basename(uniqueBatchExportPath(outDir, "资料包", ""))).toBe("资料包");
  });
});

describe("分组递归展开", () => {
  it("笔记本/分组 id 展开为其中文档（不导出容器本身），并去重、保持顺序", () => {
    const { notebook, group, doc, usheet, bitable } = seed();
    const nodes = store.listTreeNodes();
    const expanded = expandBatchExportTargets(nodes, [notebook.id, group.id, doc.id]);
    const ids = expanded.targets.map((node) => node.id);
    expect(expanded.unknown).toEqual([]);
    expect(ids).toContain(doc.id);
    expect(ids).toContain(usheet.id);
    expect(ids).toContain(bitable.id);
    expect(ids.filter((id) => id === doc.id)).toHaveLength(1); // 去重
    expect(ids).not.toContain(notebook.id);
    expect(ids).not.toContain(group.id);
  });

  it("不存在 / 已删的 id 进 unknown", () => {
    const { notebook } = seed();
    const expanded = expandBatchExportTargets(store.listTreeNodes(), ["ghost", notebook.id]);
    expect(expanded.unknown).toEqual(["ghost"]);
  });
});

describe("exportNotesBatch：逐条结果 / 上限 / 部分失败", () => {
  it("五类导出一条不落：doc→markdown 目录 / usheet·bitable→csv / ink→pdf，board skipped", async () => {
    const { notebook } = seed();
    const { deps } = stubDeps();
    const result = await exportNotesBatch({ store, ids: [notebook.id], dirPath: outDir, deps });
    expect(result.dirPath).toBe(outDir);
    // 5 篇文档：markdown(目录) + csv(usheet) + csv(bitable) + pdf(ink) 成功，board skipped
    expect(result.summary).toEqual({ total: 5, done: 4, failed: 0, skipped: 1 });
    expect(result.ok).toBe(true);
    const formats = result.results.map((item) => item.format);
    expect(formats.filter((format) => format === "csv")).toHaveLength(2);
    expect(formats).toContain("markdown");
    expect(formats).toContain("pdf");
    const board = result.results.find((item) => item.skipped);
    expect(board).toMatchObject({ format: "pdf", ok: false });
    // 261106 task-95：board 现在是「缺字节 ⇒ skipped」（字节由渲染层经 boardImages 给）
    expect(board?.reason).toContain("缺少画板图像字节");
    const docItem = result.results.find((item) => item.format === "markdown");
    expect(path.basename(docItem!.path!)).toBe("文档 A");
    expect(fs.statSync(docItem!.path!).isDirectory()).toBe(true);
    expect(fs.readdirSync(docItem!.path!).sort()).toEqual(["images", "文档 A.md"]);
    const inkItem = result.results.find((item) => item.format === "pdf" && item.ok);
    expect(path.extname(inkItem!.path!)).toBe(".pdf");
    const written = fs.readdirSync(outDir).sort();
    // 目录（markdown 资料包）+ 3 个文件（2 csv + 1 ink pdf）
    expect(written).toEqual(["文档 A", "手写 E.pdf", "多维表 C.csv", "表格 B.csv"].sort());
  });

  it("同名文档 → 「 (2)」（同批内不覆盖）", async () => {
    const notebook = store.createNotebook("重名");
    const first = store.createNoteIn(notebook.id, "同名");
    const second = store.createNoteIn(notebook.id, "同名");
    const { deps } = stubDeps();
    const result = await exportNotesBatch({ store, ids: [first.id, second.id], dirPath: outDir, deps });
    // doc 默认 markdown ⇒ 产物是目录：同名 → 「同名」/「同名 (2)」
    const names = result.results.map((item) => path.basename(item.path ?? "")).sort();
    expect(names).toEqual(["同名", "同名 (2)"]);
    expect(fs.readdirSync(outDir).sort()).toEqual(["同名", "同名 (2)"].sort());
    expect(new Set(result.results.map((item) => item.path)).size).toBe(2);
  });

  it("部分失败只影响该条（其余照常导出，ok:false + failed 计数）", async () => {
    const notebook = store.createNotebook("部分失败");
    const ok = store.createNoteIn(notebook.id, "正常");
    const bad = store.createNoteIn(notebook.id, "坏");
    const { deps } = stubDeps({
      exportDocMarkdown: async (_store, id, dir) => {
        if (id === bad.id) throw new Error("正文文件缺失");
        const target = path.join(dir, "正常-stub");
        fs.mkdirSync(target, { recursive: true });
        return target;
      },
    });
    const result = await exportNotesBatch({ store, ids: [ok.id, bad.id], dirPath: outDir, deps });
    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 1, skipped: 0 });
    expect(result.results.find((item) => item.id === bad.id)).toMatchObject({ ok: false, reason: "正文文件缺失" });
    expect(fs.existsSync(path.join(outDir, "正常"))).toBe(true);
  });

  it("空 ids / 超上限 500 / 目录不可创建 整批拒绝", async () => {
    const { deps } = stubDeps();
    expect(await exportNotesBatch({ store, ids: [], dirPath: outDir, deps })).toMatchObject({ ok: false, reason: "empty-ids" });
    const tooMany = Array.from({ length: BATCH_EXPORT_MAX_ITEMS + 1 }, (_, index) => "id-" + index);
    const rejected = await exportNotesBatch({ store, ids: tooMany, dirPath: outDir, deps });
    expect(rejected).toMatchObject({ ok: false, reason: "too-many" });
    expect(rejected.summary.total).toBe(0);
  });
});

describe("board→pdf：渲染层字节 → 主进程内嵌 PDF", () => {
  const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

  it("提供 boardImages ⇒ ok + <标题>.pdf（调用 exportBoardPdf）；缺字节 ⇒ skipped 且不产出文件", async () => {
    const { board } = seed();
    const { deps, calls } = stubDeps();
    const withBytes = await exportNotesBatch({
      store, ids: [board.id], dirPath: outDir, deps,
      boardImages: { [board.id]: { bytes: PNG, format: "png" } },
    });
    expect(withBytes.summary).toEqual({ total: 1, done: 1, failed: 0, skipped: 0 });
    expect(withBytes.results[0]).toMatchObject({ ok: true, format: "pdf" });
    expect(path.basename(withBytes.results[0].path!)).toBe("画板 D.pdf");
    expect(calls).toContain("board-pdf:" + board.id);
    expect(fs.readFileSync(withBytes.results[0].path!, "utf8")).toBe("stub-board-pdf");

    const before = fs.readdirSync(outDir);
    const without = await exportNotesBatch({ store, ids: [board.id], dirPath: outDir, deps });
    expect(without.results[0]).toMatchObject({ ok: false, skipped: true, format: "pdf" });
    expect(without.results[0].reason).toContain("缺少画板图像字节");
    expect(without.summary).toEqual({ total: 1, done: 0, failed: 0, skipped: 1 });
    expect(fs.readdirSync(outDir)).toEqual(before); // 不伪造、不产文件
  });

  it("boardImages 归一化：非 PNG/SVG 内容、声明不符、空字节一律丢弃（对应画板 skipped）", () => {
    const normalized = normalizeBoardImages({
      "b-png": { bytes: Array.from(PNG), format: "png" },
      "b-svg": { bytes: Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), format: "svg" },
      "b-mismatch": { bytes: Array.from(PNG), format: "svg" },
      "b-empty": { bytes: [], format: "png" },
      "b-garbage": { bytes: Array.from(Buffer.from("not-an-image")), format: "png" },
      "b-string": "x",
    });
    expect(Object.keys(normalized).sort()).toEqual(["b-png", "b-svg"]);
    expect(normalized["b-png"].bytes).toBeInstanceOf(Uint8Array);
    expect(normalizeBoardImages(null)).toEqual({});
  });

  it("board 导出异常 ⇒ 该条 failed（其余照常）", async () => {
    const { board } = seed();
    const { deps } = stubDeps({ exportBoardPdf: async () => { throw new Error("PDF 渲染超时（60 秒）"); } });
    const result = await exportNotesBatch({
      store, ids: [board.id], dirPath: outDir, deps,
      boardImages: { [board.id]: { bytes: PNG, format: "png" } },
    });
    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({ ok: false, format: "pdf" });
    expect(result.results[0].reason).toContain("PDF 渲染超时");
    expect(result.summary).toEqual({ total: 1, done: 0, failed: 1, skipped: 0 });
  });
});

describe("doc→markdown：真实资料包（不 stub）", () => {
  it("产物是 <标题>/ 目录：内含 <标题>.md 与 images/，图片引用被改写成相对路径", async () => {
    const notebook = store.createNotebook("资料包");
    const doc = store.createNoteIn(notebook.id, "带图文档");
    const assetDir = path.join(root, "note-assets", doc.id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "pic.png"), Buffer.from("png-bytes"));
    const url = "http://127.0.0.1:19876/" + doc.id + "/pic.png";
    store.updateNoteCaches(doc.id, "# 标题\n\n![图](" + url + ")\n", "标题");
    // doc 走**真链路**（exportNotePackage，纯 Node）；只把不需要的 ink 覆盖成 stub
    const deps = { ...defaultBatchExportDeps, exportInkPdf: async (_store: Store, id: string, dir: string) => path.join(dir, store.readNote(id).title + ".pdf") };
    const result = await exportNotesBatch({ store, ids: [doc.id], dirPath: outDir, deps });
    expect(result.summary).toEqual({ total: 1, done: 1, failed: 0, skipped: 0 });
    const exportPath = result.results[0].path!;
    expect(result.results[0].format).toBe("markdown");
    expect(path.basename(exportPath)).toBe("带图文档");
    expect(fs.statSync(exportPath).isDirectory()).toBe(true);
    const files = fs.readdirSync(exportPath).sort();
    expect(files).toEqual(["images", "带图文档.md"]);
    const markdown = fs.readFileSync(path.join(exportPath, "带图文档.md"), "utf8");
    expect(markdown).toContain("images/pic.png");
    expect(markdown).not.toContain("127.0.0.1");
    expect(fs.existsSync(path.join(exportPath, "images", "pic.png"))).toBe(true);
  });
});

describe("只读：批量导出不改源数据", () => {
  it("导出前后：文档行 dirty 标记、正文文件内容、同步待办摘要都不变", async () => {
    const { notebook } = seed();
    const before = {
      summaries: store.listNoteSummaries().map((note) => ({ id: note.id, dirty: !!note.isDirty })),
      pending: store.getSyncPendingSummary(),
      docs: store.listNoteSummaries().map((note) => note.id).map((id) => store.readNote(id).content),
    };
    const { deps } = stubDeps();
    await exportNotesBatch({ store, ids: [notebook.id], dirPath: outDir, deps });
    expect(store.listNoteSummaries().map((note) => ({ id: note.id, dirty: !!note.isDirty }))).toEqual(before.summaries);
    // generatedAt 每次都变：只比计数（这才是"没有新增待同步"的判据）
    const strip = (summary: { documents: number; folders: number; resources: number }) => ({
      documents: summary.documents, folders: summary.folders, resources: summary.resources,
    });
    expect(strip(store.getSyncPendingSummary())).toEqual(strip(before.pending));
    expect(store.listNoteSummaries().map((note) => note.id).map((id) => store.readNote(id).content)).toEqual(before.docs);
  });
});
