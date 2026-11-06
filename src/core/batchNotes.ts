/**
 * 批量操作**编排**（261106 用户定稿 A 方案：显式「选择」模式）——两端共用纯逻辑。
 *
 * 职责边界（为什么这样切）：
 * - 本模块只做「输入清洗 → 全部校验 → 交给平台执行」：去重、上限、分类、目标父级/环、标签参数；
 *   它**不碰 db / 文件 / IPC / 网络**（平台差异全在注入的 executor 里，见 BatchNotesExecutor）。
 * - **先全部校验、再一次性执行**：任何一条不合法 ⇒ 整批不执行（返回 ok:false + 逐条结果），
 *   避免"批里改了一半"。执行由平台在**单个事务**里完成（抛错 = 平台整批回滚）。
 * - 笔记本 id 一律 `notebook-not-batchable`（**防御**：UI 本就不该把笔记本放进多选；桌面/移动同口径）。
 * - `tag-add` = 追加（合并，不覆盖已有顺序）；`tag-remove` = 只移除指定 tagIds。
 * - **不做批量恢复 / 不提回收站多选**（261106 用户范围调整）：action 只有 move | trash | tag-add | tag-remove。
 *
 * 结果契约（移动端 `batchNotes` 与桌面 `batch_notes` 完全一致，改动必须两端同步改）：
 *   `{ ok, results: [{ id, ok, reason? }], summary: { total, done, failed } }`
 *   `reason` 取值 = BatchNotesReason（新增取值属于契约变更，要同步移动端）。
 */

/** 单批上限（防误选整库 + 防一次事务过大）。 */
export const BATCH_NOTES_MAX_IDS = 500;

export type BatchNotesAction = "move" | "trash" | "tag-add" | "tag-remove";

/** 唯一合法 action 集合（261106：**没有** restore —— 回收站不做多选/批量）。 */
export const BATCH_NOTES_ACTIONS: readonly BatchNotesAction[] = ["move", "trash", "tag-add", "tag-remove"];

/**
 * 空间（payload 可选 `space`，缺省 `lake`）：
 * - `lake` = 文档树（文档 / 分组；trash = 软删进回收站，可恢复）；
 * - `quickNotes` = 小记（trash = 软删进**小记回收站**，可恢复）。
 * **绝无物理删除/清索引/清对象**：批量只做"移入回收站"这一种删除语义（261106 用户更正）。
 */
export type BatchNotesSpace = "lake" | "quickNotes";

export const BATCH_NOTES_SPACES: readonly BatchNotesSpace[] = ["lake", "quickNotes"];

/** 节点分类（平台 describe 的返回）：notebook 不可批处理；folder 可移动；note/quick-note 是文档。 */
export type BatchNotesNodeKind = "notebook" | "folder" | "note" | "quick-note";

/** 目标父级状态（move 用；null = 根层）。 */
export type BatchNotesParentStatus = "ok" | "not-found" | "not-a-container" | "in-trash";

/**
 * 逐条拒绝原因（**契约取值**，UI/移动端按它给文案）：
 * - invalid-input / invalid-action / empty-ids / too-many-ids / invalid-id：请求级（整批不执行）
 * - not-found / notebook-not-batchable / unsupported：节点不可选
 * - already-trashed：条目已在回收站（批量操作只作用在正常目录里的条目）
 * - parent-not-found / parent-not-a-container / parent-in-trash / parent-cycle：目标父级不合法
 * - tag-unavailable / tag-not-found：标签目录不可用 / 标签不存在
 * - failed：平台执行期异常（整批已回滚）
 */
export type BatchNotesReason =
  | "invalid-input" | "invalid-action" | "empty-ids" | "too-many-ids" | "invalid-id"
  | "not-found" | "notebook-not-batchable" | "unsupported"
  | "already-trashed"
  | "parent-not-found" | "parent-not-a-container" | "parent-in-trash" | "parent-cycle"
  | "tag-unavailable" | "tag-not-found"
  | "failed";

/** 请求（IPC / bridge 同形）：字段名固定 `ids`（**不是 targets**）、`space`、`parentId`、`tagIds`。 */
export interface BatchNotesInput {
  action: BatchNotesAction;
  ids: string[];
  /** 空间（缺省 lake）。quickNotes = 小记（trash 进小记回收站）。 */
  space?: BatchNotesSpace;
  /** move 专用：目标父级（null / 省略 = 根层）。 */
  parentId?: string | null;
  /** tag-add / tag-remove 专用。 */
  tagIds?: string[];
}

/** 节点信息（平台端口 describe 的返回）。 */
export interface BatchNotesNodeInfo {
  kind: BatchNotesNodeKind;
  /** 已在回收站（含回收站子树的条目）。 */
  trashed: boolean;
}

/** 已通过校验、交给平台执行的一条。 */
export interface BatchNotesItem {
  id: string;
  action: BatchNotesAction;
  space: BatchNotesSpace;
  parentId: string | null;
  tagIds: string[];
}

export interface BatchNotesItemResult {
  id: string;
  ok: boolean;
  reason?: BatchNotesReason;
}

export interface BatchNotesSummary {
  total: number;
  done: number;
  failed: number;
}

export interface BatchNotesResult {
  ok: boolean;
  results: BatchNotesItemResult[];
  summary: BatchNotesSummary;
  /** 请求级拒绝/执行期异常的原因（results 已按条标注，这里给一句总结）。 */
  reason?: BatchNotesReason;
  /** 可读说明（IPC 层给用户/日志；移动端可只读 reason）。 */
  message?: string;
}

/**
 * 平台执行端口（桌面 = electron/ipc/registerBatchNotes 的主进程实现；移动 = bridge）。
 * - 只读查询（describe / describeParent / wouldCreateCycle / activeTagIds）在校验阶段调用；
 * - `execute` 在**全部校验通过后**调用一次，必须在单个事务里逐条落地（抛错 = 整批回滚）。
 */
export interface BatchNotesExecutor {
  /** 节点分类（按 space 查各自的库）；null = 不存在 / 已彻底删除（purge 过的不算存在）。 */
  describe(id: string, space: BatchNotesSpace): BatchNotesNodeInfo | null;
  /**
   * 平台支持面：true = 允许；返回原因 = 拒绝（桌面：lake 里 trash 只收文档、quickNotes 里只支持 trash…）。
   * 缺省 = 除 notebook 外都允许（notebook 由 core 先拦死）。
   */
  supports?(action: BatchNotesAction, node: BatchNotesNodeInfo, space: BatchNotesSpace): true | BatchNotesReason;
  /** move 专用：目标父级状态；缺省 = 不校验（平台自己兜）。 */
  describeParent?(parentId: string | null): BatchNotesParentStatus;
  /** move 专用：把 id 的父改成 parentId 是否成环；缺省 = 不校验。 */
  wouldCreateCycle?(id: string, parentId: string | null): boolean;
  /** tag-add / tag-remove 专用：目录内 active 标签 id；null = 标签目录不可用。 */
  activeTagIds?(): ReadonlySet<string> | null;
  /** 执行（单个事务；已全部校验通过）。抛错 = 平台整批回滚。 */
  execute(items: readonly BatchNotesItem[]): void;
}

const MAX_ID_LENGTH = 200;
const MAX_TAGS = 200;

/** ids 清洗结果（导出给平台复用/测试）。 */
export function normalizeBatchNotesIds(raw: unknown): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(raw)) return { ids, invalid };
  for (const value of raw) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id || id.length > MAX_ID_LENGTH) { invalid.push(typeof value === "string" ? value : String(value)); continue; }
    if (seen.has(id)) continue; // 去重：同一 id 只执行一次
    seen.add(id);
    ids.push(id);
  }
  return { ids, invalid };
}

function summaryOf(results: BatchNotesItemResult[]): BatchNotesSummary {
  const done = results.filter((item) => item.ok).length;
  return { total: results.length, done, failed: results.length - done };
}

function rejectAll(ids: readonly string[], reason: BatchNotesReason, message: string): BatchNotesResult {
  const results: BatchNotesItemResult[] = ids.map((id) => ({ id, ok: false, reason }));
  return { ok: false, results, summary: summaryOf(results), reason, message };
}

/**
 * 执行一批批量操作。
 *
 * 流程：解析 action / space / ids（去重、≤500）→ 校验参数（move 目标父级、tag 目录）→ 逐条分类校验 →
 * 全部通过才调用 `executor.execute`（单事务）；执行期异常 ⇒ 整批按失败返回（平台已回滚）。
 * 删除语义只有一种：**移入回收站**（lake → 文档回收站；quickNotes → 小记回收站），都可恢复。
 */
export function runBatchNotes(input: unknown, executor: BatchNotesExecutor): BatchNotesResult {
  if (!input || typeof input !== "object") {
    return { ok: false, results: [], summary: { total: 0, done: 0, failed: 0 }, reason: "invalid-input", message: "批量操作参数无效" };
  }
  const raw = input as Partial<BatchNotesInput> & { targets?: unknown };
  const action = raw.action;
  // 兼容口头描述的字段名 targets 会掩盖契约漂移 ⇒ 只认 ids；传 targets 视为无效输入（防御）。
  if (typeof action !== "string" || !BATCH_NOTES_ACTIONS.includes(action as BatchNotesAction)) {
    return { ok: false, results: [], summary: { total: 0, done: 0, failed: 0 }, reason: "invalid-action", message: "不支持的批量操作：" + String(action) };
  }
  const op = action as BatchNotesAction;
  // space：缺省 lake（文档树）；quickNotes = 小记（只换"软删进哪儿"，不改变删除=进回收站的语义）。
  const rawSpace = raw.space;
  if (!(rawSpace === undefined || rawSpace === null || (typeof rawSpace === "string" && BATCH_NOTES_SPACES.includes(rawSpace as BatchNotesSpace)))) {
    return { ok: false, results: [], summary: { total: 0, done: 0, failed: 0 }, reason: "invalid-input", message: "不支持的空间：" + String(rawSpace) };
  }
  const space: BatchNotesSpace = typeof rawSpace === "string" && rawSpace ? (rawSpace as BatchNotesSpace) : "lake";
  if (!Array.isArray(raw.ids)) {
    return { ok: false, results: [], summary: { total: 0, done: 0, failed: 0 }, reason: "invalid-input", message: "ids 必须是数组" };
  }
  const { ids, invalid } = normalizeBatchNotesIds(raw.ids);
  const results: BatchNotesItemResult[] = invalid.map((id) => ({ id, ok: false, reason: "invalid-id" as const }));
  const pushResult = (id: string, reason?: BatchNotesReason): void => {
    results.push(reason ? { id, ok: false, reason } : { id, ok: true });
  };
  if (ids.length === 0) {
    if (results.length === 0) return { ok: false, results, summary: summaryOf(results), reason: "empty-ids", message: "请先选择要操作的条目" };
    // 全部是无效 id：逐条给 invalid-id，不执行。
    return { ok: false, results, summary: summaryOf(results), reason: "invalid-id", message: "选择里有无效的条目 id" };
  }
  if (ids.length > BATCH_NOTES_MAX_IDS) {
    return { ok: false, results, summary: summaryOf(results), reason: "too-many-ids", message: "单次最多 " + BATCH_NOTES_MAX_IDS + " 项（当前 " + ids.length + " 项）" };
  }

  // ---- 参数校验（move / tag）----
  let parentId: string | null = null;
  if (op === "move") {
    const rawParent = raw.parentId;
    if (!(rawParent === undefined || rawParent === null || typeof rawParent === "string")) {
      return rejectAll(ids, "invalid-input", "目标父级参数无效");
    }
    parentId = typeof rawParent === "string" && rawParent.trim() ? rawParent.trim() : null;
    const status = executor.describeParent ? executor.describeParent(parentId) : "ok";
    if (status === "not-found") return rejectAll(ids, "parent-not-found", "目标父级不存在或已删除");
    if (status === "not-a-container") return rejectAll(ids, "parent-not-a-container", "目标父级不是笔记本或分组");
    if (status === "in-trash") return rejectAll(ids, "parent-in-trash", "目标父级在回收站里");
  }

  let tagIds: string[] = [];
  if (op === "tag-add" || op === "tag-remove") {
    const rawTags = raw.tagIds;
    if (!Array.isArray(rawTags)) return rejectAll(ids, "invalid-input", "tagIds 必须是数组");
    const seenTags = new Set<string>();
    const invalidTags: string[] = [];
    for (const value of rawTags) {
      const tagId = typeof value === "string" ? value.trim() : "";
      if (!tagId || tagId.length > MAX_ID_LENGTH) { invalidTags.push(typeof value === "string" ? value : String(value)); continue; }
      if (seenTags.has(tagId)) continue;
      seenTags.add(tagId);
      tagIds.push(tagId);
    }
    if (invalidTags.length > 0) return rejectAll(ids, "invalid-input", "标签 id 无效：" + invalidTags.slice(0, 3).join("、"));
    if (tagIds.length === 0) return rejectAll(ids, "invalid-input", "请先选择标签");
    if (tagIds.length > MAX_TAGS) return rejectAll(ids, "invalid-input", "单次最多操作 " + MAX_TAGS + " 个标签");
    const active = executor.activeTagIds ? executor.activeTagIds() : null;
    if (!active) return rejectAll(ids, "tag-unavailable", "标签目录暂不可用（无法校验标签是否存在）");
    const missing = tagIds.filter((tagId) => !active.has(tagId));
    if (missing.length > 0) return rejectAll(ids, "tag-not-found", "标签不存在或已删除：" + missing.slice(0, 3).join("、"));
  }

  // ---- 逐条校验（不合法 ⇒ 整批不执行）----
  const items: BatchNotesItem[] = [];
  let anyFailed = results.some((item) => !item.ok);
  for (const id of ids) {
    const node = executor.describe(id, space);
    if (!node) { pushResult(id, "not-found"); anyFailed = true; continue; }
    if (node.kind === "notebook") { pushResult(id, "notebook-not-batchable"); anyFailed = true; continue; }
    const support = executor.supports ? executor.supports(op, node, space) : true;
    if (support !== true) { pushResult(id, support); anyFailed = true; continue; }
    // 只有「正常目录里的条目」可批量操作：已在回收站的条目不在树里可见，防御性拒绝。
    if (node.trashed) { pushResult(id, "already-trashed"); anyFailed = true; continue; }
    if (op === "move" && executor.wouldCreateCycle && executor.wouldCreateCycle(id, parentId)) {
      pushResult(id, "parent-cycle"); anyFailed = true; continue;
    }
    items.push({ id, action: op, space, parentId, tagIds });
    pushResult(id);
  }
  if (anyFailed) {
    return { ok: false, results, summary: summaryOf(results), reason: "invalid-input", message: "有 " + results.filter((item) => !item.ok).length + " 项不合法，整批未执行" };
  }

  // ---- 单事务执行（平台负责原子性；抛错 = 已回滚）----
  try {
    executor.execute(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, results: items.map((item) => ({ id: item.id, ok: false, reason: "failed" as const })), summary: { total: items.length, done: 0, failed: items.length }, reason: "failed", message: "批量操作失败（已回滚）：" + message };
  }
  return { ok: true, results, summary: summaryOf(results) };
}
