/**
 * 261106 批量操作（A 方案：显式「选择」模式）——桌面 IPC `batch_notes`。
 *
 * 分工（与移动端 `batchNotes` 同一套 core 编排，结果结构一致）：
 * - 校验/分类/环/标签参数全在 `src/core/batchNotes`（纯逻辑，两端共用）；
 * - 这里只提供**桌面端口**（树查询 / 小记查询 / 标签目录）与**单事务执行**：先全部校验通过，再在
 *   对应库的事务里逐条调用既有单条写方法（复用内部逻辑，不重复实现）。执行期抛错 ⇒ 整批回滚，
 *   core 按 `failed` 返回（不会留下半批）。
 * - **删除 = 移入回收站**（261106 用户更正）：lake 走 `deleteTreeNode`（软删，可恢复）；
 *   quickNotes 走 `deleteQuickNote`（进小记回收站，可恢复）。这里**没有任何 purge/物理删除分支**。
 * - dirty：既有写方法已把受影响行 `is_dirty=1`（tree_nodes / notes / quick_notes / tag_link_versions）；
 *   广播不在这里做 —— main 的 afterInvoke 单点对 `batch_notes` 广播一次 `library-changed` +
 *   最多一次 `pending-summary-changed`（整批一次，绝不逐条）。
 */
import type { IpcRegistrar } from "./registrar.js";
import type { Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";
import { log } from "../logger.js";
import {
  runBatchNotes,
  type BatchNotesAction,
  type BatchNotesExecutor,
  type BatchNotesItem,
  type BatchNotesNodeInfo,
  type BatchNotesReason,
  type BatchNotesResult,
  type BatchNotesSpace,
} from "../../src/core/batchNotes.js";

/** 单条落地动作（测试可注入覆盖以实现"执行期异常/回滚"用例）。 */
export interface BatchNotesApplyDeps {
  /** 该空间对应的库事务（lake = 主库；quickNotes = 小记库）。 */
  transaction<T>(space: BatchNotesSpace, fn: () => T): T;
  nextSortOrder(parentId: string | null): number;
  moveToEnd(id: string, parentId: string | null, sortOrder: number): void;
  /** lake：移入回收站（软删）。 */
  trashNode(id: string): void;
  /** quickNotes：移入小记回收站（软删，可恢复）。 */
  trashQuickNote(id: string): void;
}

/**
 * 桌面支持面：
 * - lake：文档全部动作；分组只支持 move；笔记本由 core 先按 notebook-not-batchable 拦死。
 * - quickNotes：只有 trash（移入小记回收站）；其余动作 unsupported。
 */
export function desktopBatchSupports(action: BatchNotesAction, node: BatchNotesNodeInfo, space: BatchNotesSpace): true | BatchNotesReason {
  if (space === "quickNotes") return action === "trash" && node.kind === "quick-note" ? true : "unsupported";
  if (node.kind === "note") return true;
  if (action === "move" && node.kind === "folder") return true;
  return "unsupported";
}

/** 在单事务里逐条落地（**调用方保证已全部校验通过**；批内 space 只有一个，所以恰好一个事务）。 */
export function applyBatchNotesItems(items: readonly BatchNotesItem[], deps: BatchNotesApplyDeps): void {
  const bySpace = new Map<BatchNotesSpace, BatchNotesItem[]>();
  for (const item of items) {
    const list = bySpace.get(item.space);
    if (list) list.push(item);
    else bySpace.set(item.space, [item]);
  }
  for (const [space, list] of bySpace) {
    deps.transaction(space, () => {
      /** 同一目标父级的多条移动要依次追加，不能都拿同一个 sortOrder。 */
      const nextOrder = new Map<string | null, number>();
      for (const item of list) {
        if (item.action === "move") {
          const order = nextOrder.get(item.parentId) ?? deps.nextSortOrder(item.parentId);
          deps.moveToEnd(item.id, item.parentId, order);
          nextOrder.set(item.parentId, order + 1);
          continue;
        }
        if (item.action === "trash") {
          if (space === "quickNotes") deps.trashQuickNote(item.id);
          else deps.trashNode(item.id);
          continue;
        }
      }
    });
  }
}

/** 小记库端口（space=quickNotes 的 describe/trash）；降级时返回 null ⇒ 该空间条目按 not-found 处理。 */
export type BatchNotesQuickNotesPort = Pick<QuickNotesStore, "readQuickNote" | "deleteQuickNote" | "deletedRecord" | "batchTransaction">;

export interface BatchNotesIpcDeps {
  store: Store;
  /** 小记库（**惰性取**：注册 IPC 时可用性可能还没定；降级期间返回 null）。 */
  getQuickNotes(): BatchNotesQuickNotesPort | null;
  /** 测试注入：覆盖单条落地动作（默认走 store）。 */
  apply?: Partial<BatchNotesApplyDeps>;
}

/** 小记空间 describe：purged / 已转成文档的墓碑不在批量范围内（返回 null = 不存在）。 */
function describeQuickNote(quickNotes: BatchNotesQuickNotesPort, id: string): BatchNotesNodeInfo | null {
  const tomb = quickNotes.deletedRecord(id);
  if (tomb) {
    if (tomb.purgedAt) return null; // 已彻底删除（历史遗留）：不是可批量条目
    if (tomb.conversionTargetNoteId) return null; // 已转成文档：不属于小记空间
    return { kind: "quick-note", trashed: true };
  }
  try {
    quickNotes.readQuickNote(id);
    return { kind: "quick-note", trashed: false };
  } catch {
    return null;
  }
}

/** 组装桌面 executor（导出便于单测直接跑 core 编排）。 */
export function createDesktopBatchExecutor(deps: BatchNotesIpcDeps): BatchNotesExecutor {
  const { store } = deps;
  const apply: BatchNotesApplyDeps = {
    transaction: (space, fn) => {
      if (space !== "quickNotes") return store.batchNotes.transaction(fn);
      const quick = deps.getQuickNotes();
      return quick ? quick.batchTransaction(fn) : fn();
    },
    nextSortOrder: (parentId) => store.batchNotes.nextSortOrder(parentId),
    moveToEnd: (id, parentId, sortOrder) => { store.moveTreeNode(id, parentId, sortOrder); },
    trashNode: (id) => { store.deleteTreeNode(id); },
    trashQuickNote: (id) => { deps.getQuickNotes()?.deleteQuickNote(id); },
    ...deps.apply,
  };
  return {
    describe: (id, space) => {
      if (space !== "quickNotes") return store.batchNotes.describe(id);
      const quick = deps.getQuickNotes();
      return quick ? describeQuickNote(quick, id) : null;
    },
    supports: desktopBatchSupports,
    describeParent: (parentId) => store.batchNotes.describeParent(parentId),
    wouldCreateCycle: (id, parentId) => store.batchNotes.wouldCreateCycle(id, parentId),
    execute: (items) => applyBatchNotesItems(items, apply),
  };
}

/** 跑一批（IPC 与测试共用入口）：core 编排 + 审计日志一条。 */
export function runDesktopBatchNotes(raw: unknown, deps: BatchNotesIpcDeps): BatchNotesResult {
  const result = runBatchNotes(raw, createDesktopBatchExecutor(deps));
  const request = (raw ?? {}) as { action?: unknown; space?: unknown; ids?: unknown };
  log.app.info("[batch] " + JSON.stringify({
    action: typeof request.action === "string" ? request.action : null,
    space: typeof request.space === "string" ? request.space : "lake",
    requested: Array.isArray(request.ids) ? request.ids.length : 0,
    total: result.summary.total,
    done: result.summary.done,
    failed: result.summary.failed,
    reason: result.reason ?? null,
  }));
  return result;
}

export function registerBatchNotesIpc(ipc: IpcRegistrar, deps: BatchNotesIpcDeps): void {
  // payload：{ action: "move"|"trash", ids, space?, parentId? }（桌面不做批量打标）。
  ipc.handle("batch_notes", (raw: unknown) => runDesktopBatchNotes(raw, deps));
}
