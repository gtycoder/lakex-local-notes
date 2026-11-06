/**
 * 261106 批量导出（数据层）：多选文档/分组 → 按类型默认格式导出到同一目录。
 *
 * 默认格式（用户 261106 拍板）：doc → pdf；usheet → **xlsx**；bitable → **csv**；board → png；ink → png。
 * 分组/笔记本**递归展开**为文档（自身不导出）；上限 500 项；重名追加「 (2)」；逐条结果；**只读不写源**。
 *
 * 为什么 board 在这里只给 skipped：画板导 PNG 走的是 Drawnix 画布自己的导出（必须在渲染层、
 * 且画板得先打开，见 src/features/board/boardExport.ts）——主进程没有画板渲染引擎，不伪造。
 * ⇒ 批量导出对 board 返回 skipped + 可读原因（UI 由 task-88 给单独入口），绝不产出坏文件。
 *
 * 只读约束：本模块只调 store 的读/导出方法（exportPdfHtml / exportUsheetXlsx / exportBitableCsv /
 * readInkPageSvg）+ 写导出目录，**不 saveNote、不标 dirty、不广播**（导出不该改源数据）。
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Store } from "./store.js";
import { exportNote } from "./export.js";
import { parseInkBody } from "../src/core/inkDoc.js";

/** 单批上限（与批量操作同口径）。 */
export const BATCH_EXPORT_MAX_ITEMS = 500;

export type BatchExportFormat = "pdf" | "csv" | "xlsx" | "png";
export type BatchExportKind = "doc" | "usheet" | "bitable" | "board" | "ink";

/** 按文档类型取默认导出格式（未知类型 = null ⇒ 不导出）。 */
export function defaultBatchExportFormat(kind: string | null | undefined): BatchExportFormat | null {
  switch (kind ?? "doc") {
    case "doc": return "pdf";
    case "bitable": return "csv";
    case "usheet": return "xlsx";
    case "board": return "png";
    case "ink": return "png";
    default: return null;
  }
}

/** 文件名清洗：双端非法字符 + 控制字符 + 首尾空格；空标题回落「未命名」。 */
export function sanitizeBatchExportTitle(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") // 首部点 = 隐藏文件
    .slice(0, 120)
    .trim();
  return cleaned || "未命名";
}

/**
 * 批量导出的唯一文件名："<title>.<ext>"，冲突追加「 (2)」「 (3)」…
 * isTaken 缺省 = 目标已存在；reserved 让同一批内重名也不撞（大小写不敏感，兼容 macOS/Windows）。
 */
export function uniqueBatchExportPath(
  dir: string,
  baseTitle: string,
  ext: string,
  options: { isTaken?: (absolutePath: string) => boolean; reserved?: Set<string> } = {},
): string {
  const isTaken = options.isTaken ?? ((candidate: string) => fs.existsSync(candidate));
  const reserved = options.reserved;
  const taken = (candidate: string): boolean => (reserved ? reserved.has(candidate.toLowerCase()) : false) || isTaken(candidate);
  const first = path.join(dir, baseTitle + "." + ext);
  if (!taken(first)) { reserved?.add(first.toLowerCase()); return first; }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = path.join(dir, baseTitle + " (" + index + ")." + ext);
    if (!taken(candidate)) { reserved?.add(candidate.toLowerCase()); return candidate; }
  }
  const fallback = path.join(dir, baseTitle + " (" + Date.now() + ")." + ext);
  reserved?.add(fallback.toLowerCase());
  return fallback;
}

export interface BatchExportTargetNode {
  id: string;
  parentId: string | null;
  nodeType: string;
  title: string;
  kind?: string | null;
}

/**
 * 把请求的 id 列表展开成「按文档顺序的导出目标」：
 * - 文档直接收；分组/笔记本递归收其下的文档（自身不导出）；
 * - 不存在 / 在回收站（listTreeNodes 不含回收站）的 id 进 unknown；
 * - 结果去重（同一文档被多个分组包含时只导一次），保持首次出现顺序。
 */
export function expandBatchExportTargets(
  nodes: ReadonlyArray<BatchExportTargetNode>,
  ids: readonly string[],
): { targets: BatchExportTargetNode[]; unknown: string[] } {
  const byId = new Map<string, BatchExportTargetNode>();
  const children = new Map<string, BatchExportTargetNode[]>();
  for (const node of nodes) {
    byId.set(node.id, node);
    const key = node.parentId ?? "";
    const list = children.get(key);
    if (list) list.push(node);
    else children.set(key, [node]);
  }
  const targets: BatchExportTargetNode[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  const collect = (node: BatchExportTargetNode): void => {
    if (node.nodeType === "note") {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      targets.push(node);
      return;
    }
    for (const child of children.get(node.id) ?? []) collect(child);
  };
  for (const id of ids) {
    const node = byId.get(id);
    if (!node) { unknown.push(id); continue; }
    collect(node);
  }
  return { targets, unknown };
}

export interface BatchExportItemResult {
  id: string;
  ok: boolean;
  /** 导出文件（ink 多页时给首个路径；全部见 paths）。 */
  path?: string;
  paths?: string[];
  format?: BatchExportFormat;
  /** 未导出（board / 未知类型）：不是失败，但要给原因。 */
  skipped?: boolean;
  reason?: string;
}

export interface BatchExportSummary { total: number; done: number; failed: number; skipped: number }

export interface BatchExportResult {
  ok: boolean;
  results: BatchExportItemResult[];
  summary: BatchExportSummary;
  /** 实际导出目录（取消时缺省）。 */
  dirPath?: string;
  /** 用户在目录选择框里取消。 */
  cancelled?: boolean;
  reason?: "too-many" | "empty-ids" | "invalid-input" | "cancelled";
  message?: string;
}

/** 可注入的导出实现（测试可替换；生产用 defaultBatchExportDeps）。 */
export interface BatchExportDeps {
  exportDocPdf(store: Store, id: string, dirPath: string): Promise<string>;
  exportUsheetXlsx(store: Store, id: string, dirPath: string): Promise<string>;
  exportBitableCsv(store: Store, id: string, dirPath: string): Promise<string>;
  exportInkPng(store: Store, id: string, options: {
    dirPath: string;
    title: string;
    resolvePath: (baseTitle: string, ext: string) => string;
  }): Promise<string[]>;
}

/** 生产实现：全部复用既有导出链路（不新增依赖、不另写渲染）。 */
export const defaultBatchExportDeps: BatchExportDeps = {
  exportDocPdf: async (store, id, dirPath) => (await exportNote(store, id, "pdf", dirPath)).exportPath,
  exportUsheetXlsx: async (store, id, dirPath) => (await store.exportUsheetXlsx(id, dirPath)).exportPath,
  exportBitableCsv: async (store, id, dirPath) => store.exportBitableCsv(id, dirPath).exportPath,
  exportInkPng: async (store, id, { title, resolvePath }) => {
    const note = store.readNote(id);
    const doc = parseInkBody(note.content);
    if (!doc || doc.pages.length === 0) throw new Error("手写板正文无法解析或没有页面，未导出");
    const safeTitle = sanitizeBatchExportTitle(note.title || title);
    const single = doc.pages.length === 1;
    const paths: string[] = [];
    for (let index = 0; index < doc.pages.length; index += 1) {
      const page = doc.pages[index];
      const { svg } = await store.readInkPageSvg(id, [page.id]);
      const target = resolvePath(single ? safeTitle : safeTitle + " - 第" + (index + 1) + "页", "png");
      // 主进程栅格化（sharp/librsvg）：手写板页 SVG 自包含（底纹 + 页图 data URI + 笔迹路径）
      const png = await sharp(Buffer.from(svg, "utf8"), { density: 144 }).png().toBuffer();
      fs.writeFileSync(target, png);
      paths.push(target);
    }
    return paths;
  },
};

/** 把既有导出器产出的文件改名成本批统一命名（冲突以「 (2)」为准）。 */
function moveToDesiredPath(produced: string, desired: string): string {
  if (!produced || produced === desired) return desired;
  try {
    fs.renameSync(produced, desired);
    return desired;
  } catch {
    return produced; // 改不动就如实回报实际路径，不让整条失败
  }
}

export interface BatchExportOptions {
  store: Store;
  ids: readonly unknown[];
  dirPath: string;
  deps?: Partial<BatchExportDeps>;
  log?: (message: string) => void;
}

/**
 * 批量导出（逐条失败不影响其它）。调用方负责目录选择/授权（见 ipc/registerBatchExport）。
 * 注意：**不写源数据**、不触发同步。
 */
export async function exportNotesBatch(options: BatchExportOptions): Promise<BatchExportResult> {
  const { store, dirPath } = options;
  const deps: BatchExportDeps = { ...defaultBatchExportDeps, ...options.deps };
  const rawIds = Array.isArray(options.ids) ? options.ids : [];
  const ids: string[] = [];
  const seenIds = new Set<string>();
  for (const value of rawIds) {
    if (typeof value !== "string" || !value.trim()) continue;
    const id = value.trim();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    ids.push(id);
  }
  const empty = { ok: false, results: [], summary: { total: 0, done: 0, failed: 0, skipped: 0 } } as BatchExportResult;
  if (ids.length === 0) return { ...empty, reason: "empty-ids", message: "请先选择要导出的条目" };
  if (ids.length > BATCH_EXPORT_MAX_ITEMS) {
    return { ...empty, reason: "too-many", message: "单次最多导出 " + BATCH_EXPORT_MAX_ITEMS + " 项（当前 " + ids.length + " 项）" };
  }
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch (error) {
    return { ...empty, reason: "invalid-input", message: "无法创建导出目录：" + (error instanceof Error ? error.message : String(error)) };
  }

  const nodes = store.listTreeNodes() as BatchExportTargetNode[];
  const { targets, unknown } = expandBatchExportTargets(nodes, ids);
  const results: BatchExportItemResult[] = [];
  const reserved = new Set<string>();
  const resolvePath = (baseTitle: string, ext: string): string => uniqueBatchExportPath(dirPath, baseTitle, ext, { reserved });

  for (const id of unknown) results.push({ id, ok: false, reason: "条目不存在或已在回收站（无法导出）" });

  for (const target of targets) {
    const kind = (target.kind ?? "doc") as BatchExportKind;
    const format = defaultBatchExportFormat(kind);
    if (!format) {
      results.push({ id: target.id, ok: false, skipped: true, reason: "该类型不支持批量导出：" + kind });
      continue;
    }
    if (kind === "board") {
      // 画板渲染在渲染层（Drawnix 画布），主进程不伪造 PNG。
      results.push({ id: target.id, ok: false, skipped: true, format, reason: "画板需要先在应用中打开再导出（批量导出暂不支持画板）" });
      continue;
    }
    const title = sanitizeBatchExportTitle(target.title);
    try {
      if (kind === "doc") {
        const desired = resolvePath(title, "pdf");
        const produced = await deps.exportDocPdf(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "pdf", path: moveToDesiredPath(produced, desired) });
      } else if (kind === "usheet") {
        const desired = resolvePath(title, "xlsx");
        const produced = await deps.exportUsheetXlsx(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "xlsx", path: moveToDesiredPath(produced, desired) });
      } else if (kind === "bitable") {
        const desired = resolvePath(title, "csv");
        const produced = await deps.exportBitableCsv(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "csv", path: moveToDesiredPath(produced, desired) });
      } else {
        // ink：多页分文件（每页 <标题> - 第N页.png；单页直接 <标题>.png）
        const paths = await deps.exportInkPng(store, target.id, { dirPath, title, resolvePath });
        results.push({ id: target.id, ok: paths.length > 0, format: "png", path: paths[0], paths, ...(paths.length === 0 ? { reason: "手写板没有可导出的页面" } : {}) });
      }
    } catch (error) {
      results.push({ id: target.id, ok: false, format, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const done = results.filter((item) => item.ok).length;
  const skipped = results.filter((item) => !item.ok && item.skipped).length;
  const failed = results.length - done - skipped;
  options.log?.("[export-batch] " + JSON.stringify({ requested: ids.length, targets: targets.length, done, failed, skipped, dirPath }));
  return { ok: failed === 0, results, summary: { total: results.length, done, failed, skipped }, dirPath };
}
