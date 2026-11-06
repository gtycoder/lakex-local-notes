/**
 * 261106 批量导出（数据层）：多选文档/分组 → 按类型默认格式导出到同一目录。
 *
 * 默认格式（用户 261106 二轮调整）：doc → **markdown**（资料包，图片随包相对引用、可继续编辑）；
 * usheet → **csv**；bitable → **csv**；ink → **pdf**（既有逐页压平链路）；board → **pdf**（待渲染层方案，见下）。
 * 分组/笔记本**递归展开**为文档（自身不导出）；上限 500 项；重名追加「 (2)」；逐条结果；**只读不写源**。
 *
 * 为什么 board 仍只给 skipped：画板渲染在渲染层（Drawnix 画布，且要求画板已打开，见
 * src/features/board/boardExport.ts），主进程没有画板渲染引擎 —— 不伪造，也不产出坏文件。
 * ⇒ 对 board 返回 skipped + 可读原因；落地路径见 docs/HANDOFF 的本任务报告（受控写盘 IPC +
 * 渲染层把 PNG/SVG 字节交回 → 主进程内嵌图片走 pdfRenderer 生成 <标题>.pdf）。
 *
 * 只读约束：本模块只调 store 的读/导出方法（exportPdfHtml / exportUsheetXlsx / exportBitableCsv /
 * readInkPageSvg）+ 写导出目录，**不 saveNote、不标 dirty、不广播**（导出不该改源数据）。
 */
import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.js";
import { exportNote } from "./export.js";
import { boardImageToPdfBuffer, sniffBoardImageFormat, writeFileAtomicSync, type BoardImageFormat } from "./boardImagePdf.js";

/** 单批上限（与批量操作同口径）。 */
export const BATCH_EXPORT_MAX_ITEMS = 500;

export type BatchExportFormat = "markdown" | "csv" | "pdf";
export type BatchExportKind = "doc" | "usheet" | "bitable" | "board" | "ink";

/** 按文档类型取默认导出格式（未知类型 = null ⇒ 不导出）。 */
export function defaultBatchExportFormat(kind: string | null | undefined): BatchExportFormat | null {
  switch (kind ?? "doc") {
    // 261106 二轮：导出物统一成"可编辑/可打印"的两类 —— 文本类给 markdown/csv，页面类给 pdf。
    case "doc": return "markdown";
    case "bitable": return "csv";
    case "usheet": return "csv";
    case "board": return "pdf";
    case "ink": return "pdf";
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
 * 批量导出的唯一路径："<title>.<ext>"，冲突追加「 (2)」「 (3)」…
 * ext 传空串 = 目录（doc 的 markdown 资料包是**目录**，不是单文件）。
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
  const withExt = (stem: string): string => (ext ? stem + "." + ext : stem);
  const first = path.join(dir, withExt(baseTitle));
  if (!taken(first)) { reserved?.add(first.toLowerCase()); return first; }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = path.join(dir, withExt(baseTitle + " (" + index + ")"));
    if (!taken(candidate)) { reserved?.add(candidate.toLowerCase()); return candidate; }
  }
  const fallback = path.join(dir, withExt(baseTitle + " (" + Date.now() + ")"));
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
  /** 导出产物：文件（csv/pdf）或**目录**（doc 的 markdown 资料包）。 */
  path?: string;
  /** 预留：一个条目产出多个文件时给全量路径（当前五类默认格式都是单产物）。 */
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
  /** doc → markdown 资料包（**目录**：<标题>/<标题>.md + images/）。 */
  exportDocMarkdown(store: Store, id: string, dirPath: string): Promise<string>;
  /** usheet → 单个工作表 CSV（导出器自己按「<标题> - <工作表>.csv」命名）。 */
  exportUsheetCsv(store: Store, id: string, dirPath: string): Promise<string>;
  exportBitableCsv(store: Store, id: string, dirPath: string): Promise<string>;
  /** ink → 单文件 PDF（既有逐页压平链路：exportInkPdfHtml + pdfRenderer）。 */
  exportInkPdf(store: Store, id: string, dirPath: string): Promise<string>;
  /**
   * board → 单文件 PDF：渲染层交回整幅 PNG/SVG 字节 ⇒ 主进程内嵌成 A4 单页 PDF。
   * 拿不到字节时**不会**调用它（批量层直接 skipped，绝不伪造坏文件）。
   */
  exportBoardPdf(store: Store, id: string, options: { targetPath: string; image: BoardImageInput }): Promise<string>;
}

/** 生产实现：全部复用既有导出链路（不新增依赖、不另写渲染）。 */
export const defaultBatchExportDeps: BatchExportDeps = {
  // markdown 资料包 = 目录：以既有导出链路的「<标题>/ + images/」为准（图片相对引用 ⇒ 可继续编辑/搬运）。
  // 既有产物的正文入口叫 index.md；批量导出把入口名统一成 <标题>.md（相对图片链接不变，更好认）。
  exportDocMarkdown: async (store, id, dirPath) => {
    const exportDir = (await exportNote(store, id, "markdown", dirPath)).exportPath;
    try {
      const indexMd = path.join(exportDir, "index.md");
      const title = sanitizeBatchExportTitle(path.basename(exportDir));
      const namedMd = path.join(exportDir, title + ".md");
      if (fs.existsSync(indexMd) && namedMd !== indexMd && !fs.existsSync(namedMd)) fs.renameSync(indexMd, namedMd);
    } catch { /* 改名失败不影响资料包本身可用（仍返回目录） */ }
    return exportDir;
  },
  exportUsheetCsv: async (store, id, dirPath) => store.exportUsheetCsv(id, dirPath).exportPath,
  exportBitableCsv: async (store, id, dirPath) => store.exportBitableCsv(id, dirPath).exportPath,
  // 手写板 PDF 复用既有压平链路（每页底纹 + 页图 + 矢量笔迹 → 自包含 HTML → 隐藏窗口 printToPDF）
  exportInkPdf: async (store, id, dirPath) => (await exportNote(store, id, "pdf", dirPath)).exportPath,
  // 画板：图片字节（渲染层给）→ A4 单页 PDF（内嵌图片，复用 pdfRenderer）；写盘走原子写
  exportBoardPdf: async (_store, _id, { targetPath, image }) => {
    const pdf = await boardImageToPdfBuffer(image.bytes);
    writeFileAtomicSync(targetPath, pdf);
    return targetPath;
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

/** 渲染层交回的画板图像字节（批量导出的 board→pdf 输入）。 */
export interface BoardImageInput {
  bytes: Uint8Array;
  /** png / svg（只用于日志；真正认格式的是主进程的魔数校验）。 */
  format: BoardImageFormat;
}

/** 把 IPC/HTTP 传来的 boardImages 归一成 {id → BoardImageInput}（非法条目直接丢弃 ⇒ 该画板 skipped）。 */
export function normalizeBoardImages(raw: unknown): Record<string, BoardImageInput> {
  const out: Record<string, BoardImageInput> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || !id) continue;
    const entry = value as { bytes?: unknown; format?: unknown } | null;
    if (!entry || typeof entry !== "object") continue;
    const bytes = entry.bytes instanceof Uint8Array
      ? entry.bytes
      : Array.isArray(entry.bytes)
        ? Uint8Array.from(entry.bytes.filter((item): item is number => typeof item === "number"))
        : null;
    if (!bytes || bytes.byteLength === 0) continue;
    const format: BoardImageFormat = entry.format === "svg" ? "svg" : "png";
    if (sniffBoardImageFormat(bytes) !== format) continue; // 内容与声明不符 ⇒ 当作没有字节（skipped）
    out[id] = { bytes, format };
  }
  return out;
}

export interface BatchExportOptions {
  store: Store;
  ids: readonly unknown[];
  dirPath: string;
  /** 画板图像字节（渲染层先渲染再传；缺失的画板仍 skipped）。 */
  boardImages?: Record<string, BoardImageInput>;
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
    const title = sanitizeBatchExportTitle(target.title);
    if (kind === "board") {
      // 画板渲染在渲染层（Drawnix 画布）：字节由渲染层经 boardImages 交回，主进程只做「内嵌成 PDF」。
      const image = options.boardImages?.[target.id];
      if (!image) {
        results.push({ id: target.id, ok: false, skipped: true, format, reason: "缺少画板图像字节（画板未渲染或渲染失败），本批已跳过；无字节时不产出坏文件" });
        continue;
      }
      try {
        const targetPath = resolvePath(title, "pdf");
        const produced = await deps.exportBoardPdf(store, target.id, { targetPath, image });
        results.push({ id: target.id, ok: true, format: "pdf", path: produced });
      } catch (error) {
        results.push({ id: target.id, ok: false, format, reason: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    try {
      if (kind === "doc") {
        // markdown 资料包是**目录**（无扩展名）：<标题>/<标题>.md + <标题>/images/*
        const desired = resolvePath(title, "");
        const produced = await deps.exportDocMarkdown(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "markdown", path: moveToDesiredPath(produced, desired) });
      } else if (kind === "usheet") {
        const desired = resolvePath(title, "csv");
        const produced = await deps.exportUsheetCsv(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "csv", path: moveToDesiredPath(produced, desired) });
      } else if (kind === "bitable") {
        const desired = resolvePath(title, "csv");
        const produced = await deps.exportBitableCsv(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "csv", path: moveToDesiredPath(produced, desired) });
      } else {
        // ink：单文件 PDF（多页在内部压平成一份，符合"导出到一个文件夹"的统一目标）
        const desired = resolvePath(title, "pdf");
        const produced = await deps.exportInkPdf(store, target.id, dirPath);
        results.push({ id: target.id, ok: true, format: "pdf", path: moveToDesiredPath(produced, desired) });
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
