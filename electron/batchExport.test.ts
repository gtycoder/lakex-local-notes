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
  defaultBatchExportFormat,
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
 * 真导出链路（PDF 隐藏窗口 printToPDF / usheet xlsx / ink SVG→PNG）在单测里不可用或不必要，
 * 这里用注入的 deps 产出文件；格式映射与编排逻辑才是本任务的契约。
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
    exportDocPdf: async (_store, id, dir) => { calls.push("pdf:" + id); return write(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4), "pdf"); },
    exportUsheetXlsx: async (_store, id, dir) => { calls.push("xlsx:" + id); return write(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4), "xlsx"); },
    exportBitableCsv: async (_store, id, dir) => { calls.push("csv:" + id); return write(dir, store.readNote(id).title + "-stub-" + id.slice(0, 4), "csv"); },
    exportInkPng: async (s, id, options) => {
      calls.push("png:" + id);
      const doc = (await import("../src/core/inkDoc.js")).parseInkBody(s.readNote(id).content);
      const count = doc?.pages.length ?? 1;
      const single = count === 1;
      const paths: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const target = options.resolvePath(single ? options.title : options.title + " - 第" + (index + 1) + "页", "png");
        fs.writeFileSync(target, "stub-png");
        paths.push(target);
      }
      return paths;
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

describe("默认格式映射（5 类 kind）", () => {
  it("doc→pdf / usheet→xlsx / bitable→csv / board→png / ink→png；未知 kind = null", () => {
    expect(defaultBatchExportFormat("doc")).toBe("pdf");
    expect(defaultBatchExportFormat(undefined)).toBe("pdf");
    expect(defaultBatchExportFormat("usheet")).toBe("xlsx");
    expect(defaultBatchExportFormat("bitable")).toBe("csv");
    expect(defaultBatchExportFormat("board")).toBe("png");
    expect(defaultBatchExportFormat("ink")).toBe("png");
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

  it("同一批内重名追加「 (2)」「 (3)」；已存在文件也让位", () => {
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
  it("五类导出一条不落：pdf/xlsx/csv 各一个文件，ink 两页两个文件，board skipped", async () => {
    const { notebook } = seed();
    const { deps } = stubDeps();
    const result = await exportNotesBatch({ store, ids: [notebook.id], dirPath: outDir, deps });
    expect(result.dirPath).toBe(outDir);
    // 5 篇文档：pdf/xlsx/csv + ink(png) 成功，board skipped
    expect(result.summary).toEqual({ total: 5, done: 4, failed: 0, skipped: 1 });
    expect(result.ok).toBe(true);
    const formats = Object.fromEntries(result.results.map((item) => [item.id, item.format]));
    expect(Object.values(formats)).toContain("pdf");
    expect(Object.values(formats)).toContain("xlsx");
    expect(Object.values(formats)).toContain("csv");
    expect(Object.values(formats)).toContain("png");
    const board = result.results.find((item) => item.skipped);
    expect(board?.reason).toContain("画板");
    const inkItem = result.results.find((item) => Array.isArray(item.paths) && item.paths.length === 2);
    expect(inkItem?.paths?.map((file) => path.basename(file))).toEqual(["手写 E - 第1页.png", "手写 E - 第2页.png"]);
    const written = fs.readdirSync(outDir).sort();
    expect(written).toEqual(["手写 E - 第1页.png", "手写 E - 第2页.png", "多维表 C.csv", "文档 A.pdf", "表格 B.xlsx"].sort());
  });

  it("同名文档 → 「 (2)」（同批内不覆盖）", async () => {
    const notebook = store.createNotebook("重名");
    const first = store.createNoteIn(notebook.id, "同名");
    const second = store.createNoteIn(notebook.id, "同名");
    const { deps } = stubDeps();
    const result = await exportNotesBatch({ store, ids: [first.id, second.id], dirPath: outDir, deps });
    const names = result.results.map((item) => path.basename(item.path ?? "")).sort();
    expect(names).toEqual(["同名 (2).pdf", "同名.pdf"]);
    expect(fs.readdirSync(outDir).sort()).toEqual(["同名 (2).pdf", "同名.pdf"].sort());
    expect(new Set(result.results.map((item) => item.path)).size).toBe(2);
  });

  it("部分失败只影响该条（其余照常导出，ok:false + failed 计数）", async () => {
    const notebook = store.createNotebook("部分失败");
    const ok = store.createNoteIn(notebook.id, "正常");
    const bad = store.createNoteIn(notebook.id, "坏");
    const { deps } = stubDeps({
      exportDocPdf: async (_store, id, dir) => {
        if (id === bad.id) throw new Error("正文文件缺失");
        const target = path.join(dir, "正常.pdf");
        fs.writeFileSync(target, "ok");
        return target;
      },
    });
    const result = await exportNotesBatch({ store, ids: [ok.id, bad.id], dirPath: outDir, deps });
    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 1, skipped: 0 });
    expect(result.results.find((item) => item.id === bad.id)).toMatchObject({ ok: false, reason: "正文文件缺失" });
    expect(fs.existsSync(path.join(outDir, "正常.pdf"))).toBe(true);
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
