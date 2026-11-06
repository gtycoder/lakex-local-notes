/**
 * 文档「创建副本」的**两端共用纯逻辑**（261106 用户定稿）。
 *
 * 语义（与用户口径一致）：
 * - 副本 = **全新笔记**：新 id、走各自「新建笔记」管线、同父级紧邻原笔记下方；
 * - 标题 = 原名称 + " 副本 " + 本地时间（YYYY-MM-DD HH:mm:ss，单一来源 `duplicateNoteTitle`）；
 * - 正文/资源全部复制，但资源 URL 里的原 noteId 段**必须重写**成新 id（否则副本会引用原笔记的资产）；
 * - 副本与原笔记**完全独立**：编辑/删除/标签/历史/S3 对象互不影响（新 id ⇒ 新正文 hash、新资产声明、
 *   新本地历史目录；同步侧无需任何改动）。
 *
 * 职责边界：本模块只做「输入清洗 → 命名/URL 重写 → 结果汇总」；读盘/写盘/DB 全在平台端
 * （桌面 = electron/ipc/registerDuplicateNotes.ts + Store；移动 = src/mobile/bridge/duplicateNotes.ts）。
 */

/** 单批上限（与 batchNotes 同口径；防误选整库 + 防一次 IO 过大）。 */
export const DUPLICATE_NOTES_MAX_IDS = 500;

/**
 * 逐条拒绝原因（**契约取值**；桌面 IPC 与移动 bridge 同形）：
 * - 请求级：invalid-input / empty-ids / too-many-ids / invalid-id（整批不执行）
 * - 条目级：not-found（不存在/已 purge）/ unsupported（笔记本、分组、小记）/ already-trashed（在回收站）
 * - 执行级：body-missing（正文文件缺失，按缺正文语义拒绝，不复制空正文）/ failed（平台异常）
 */
export const DUPLICATE_NOTES_REASONS = [
  "invalid-input", "empty-ids", "too-many-ids", "invalid-id",
  "not-found", "unsupported", "already-trashed",
  "body-missing", "failed",
] as const;

/** 契约 reason：**由运行时数组派生**（单一来源；新增 reason 只改数组）。 */
export type DuplicateNotesReason = (typeof DUPLICATE_NOTES_REASONS)[number];

/**
 * 逐条原因 → 中文标签（两端共用；文案口径只有这一份）。
 * 平台仍有各自的"结果摘要"格式（桌面按条数聚合、移动端更紧凑），但 reason 标签不再复制两份。
 */
export const DUPLICATE_NOTES_REASON_LABELS: Record<DuplicateNotesReason, string> = {
  "invalid-input": "参数不合法",
  "empty-ids": "没有选中条目",
  "too-many-ids": "单次最多复制 500 篇，请分批处理",
  "invalid-id": "笔记 id 无效",
  "not-found": "笔记不存在或已彻底删除",
  unsupported: "该类型不支持创建副本（笔记本、分组、小记不能复制）",
  "already-trashed": "笔记已在回收站里",
  "body-missing": "正文文件缺失，无法复制",
  failed: "创建副本失败",
};

export interface DuplicateNotesItemResult {
  /** 源笔记 id（请求里的那个）。 */
  id: string;
  ok: boolean;
  /** 成功时 = 新笔记 id。 */
  newId?: string;
  reason?: DuplicateNotesReason;
}

export interface DuplicateNotesSummary {
  total: number;
  done: number;
  failed: number;
}

export interface DuplicateNotesResult {
  ok: boolean;
  results: DuplicateNotesItemResult[];
  summary: DuplicateNotesSummary;
  /** 请求级拒绝/执行期异常的原因（results 已按条标注，这里给一句总结）。 */
  reason?: DuplicateNotesReason;
  message?: string;
}

export interface NormalizeDuplicateIdsOk { ok: true; ids: string[] }
export interface NormalizeDuplicateIdsFail { ok: false; reason: DuplicateNotesReason; message: string }

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 副本标题：原名称 + " 副本 " + 本地时间（YYYY-MM-DD HH:mm:ss）。
 * 自动去重不靠标题（树允许同名）；秒级时间戳让批量同批不同条尽量可区分。
 */
export function duplicateNoteTitle(title: string, now: Date = new Date()): string {
  const base = (title ?? "").trim() || "无标题文档";
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} `
    + `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  return `${base} 副本 ${stamp}`;
}

/** Lake 正文改写三件套已拆到 ./lakeBodyRewrite.ts（单一来源；两端只调 prepareDuplicateBody）。 */
export {
  defaultBlockId,
  forbidSelfNoteRefs,
  prepareDuplicateBody,
  remapBlockIds,
  rewriteAssetNoteIds,
} from "./lakeBodyRewrite.js";

/**
 * 条目级失败（两端共用）：带契约 reason。
 * 桌面 Store.duplicateNote 与移动数据层都抛它；IPC/bridge 用 duplicateReasonOf 统一映射，
 * 不再用 Object.assign(AppError, ...) 这类无类型补丁。
 */
export class DuplicateNoteFailure extends Error {
  readonly duplicateReason: DuplicateNotesReason;

  constructor(reason: DuplicateNotesReason, message: string) {
    super(message);
    this.name = "DuplicateNoteFailure";
    this.duplicateReason = reason;
  }
}

/** 从任意异常里取契约 reason（未知异常 = failed）。 */
export function duplicateReasonOf(error: unknown): DuplicateNotesReason {
  const tagged = (error as { duplicateReason?: DuplicateNotesReason } | null)?.duplicateReason;
  return tagged ?? "failed";
}

/** 输入清洗：去重、上限、安全 id（任一不合法 ⇒ 整批不执行，与 batchNotes 同口径）。 */
export function normalizeDuplicateIds(raw: unknown): NormalizeDuplicateIdsOk | NormalizeDuplicateIdsFail {
  if (!Array.isArray(raw)) return { ok: false, reason: "invalid-input", message: "ids 必须是数组" };
  if (raw.length === 0) return { ok: false, reason: "empty-ids", message: "没有选中任何条目" };
  if (raw.length > DUPLICATE_NOTES_MAX_IDS) {
    return { ok: false, reason: "too-many-ids", message: `一次最多复制 ${DUPLICATE_NOTES_MAX_IDS} 篇` };
  }
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isSafeDuplicateId(item)) {
      return { ok: false, reason: "invalid-id", message: "存在不合法的笔记 id" };
    }
    if (!ids.includes(item)) ids.push(item);
  }
  if (ids.length === 0) return { ok: false, reason: "empty-ids", message: "没有选中任何条目" };
  return { ok: true, ids };
}

/** id 只允许单路径段（与正文/资源路径构造同一校验口径）。 */
function isSafeDuplicateId(id: string): boolean {
  if (!id || id.length > 128) return false;
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && id !== "..";
}

/** 结果汇总（两端共用；部分失败不回滚其它条）。 */
export function summarizeDuplicateResults(results: readonly DuplicateNotesItemResult[]): DuplicateNotesSummary {
  const done = results.filter((item) => item.ok).length;
  return { total: results.length, done, failed: results.length - done };
}
