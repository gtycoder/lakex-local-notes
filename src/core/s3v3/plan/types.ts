/**
 * v4 SyncPlan 契约（纯类型；Reconciler 层的输出）。
 *
 * 设计（docs/audit-261027/07-rfc-convergence-kernel-v4.md §6.2）：
 *  - plan 只依赖输入快照（本地/基线/远端/意图），**零 IO**、可序列化、可 dry-run；
 *  - apply 只消费 plan；commit 只消费 publish；finalize 只写基线/意图。
 *  - 本文件先落类型与不变量注释，逐步把引擎的决策/调度搬进来（E1-2/E2）。
 */
import type { LakeIndex, QuickNoteTagEntry, QuickNotesIndex } from "../protocol/index.js";

export type Space = "lake" | "quickNotes";

/**
 * 条目元数据（文档/小记共用，字段均可选：小记没有 parentId/sortOrder/title，目录走 folders 分支）。
 * 具体条目对象（LakeNoteEntry/QuickNoteEntry/LakeFolderEntry）都可以直接满足本类型。
 */
export interface EntryMeta {
  id: string;
  title?: string;
  parentId?: string | null;
  sortOrder?: number;
  updatedAt?: string;
  createdAt?: string;
  contentHash?: string;
  assetsHash?: string;
  isLocked?: boolean;
  lockedAt?: string | null;
  /** 目录/文档图标或表情（字段级变更也可能不 bump updatedAt）。 */
  icon?: string | null;
  /** 小记标签关系（远端条目携带；重建条目时必须带上，否则跨端丢标签）。 */
  tagIds?: string[];
  tagsUpdatedAt?: string;
  isConflict?: boolean;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
  kind?: string;
}

/** 只读远端对象（正文/声明/索引片段）：plan 只携带引用，不携带字节。 */
export type ReadOp =
  | { kind: "pointer" }
  | { kind: "index"; space: Space; commit: string }
  | { kind: "body"; space: Space; id: string; hash: string }
  | { kind: "declaration"; space: Space; id: string; declHash: string };

/** 本地写入（applyRemote / 历史快照 / 归档 / 生命周期）。 */
export type WriteOp =
  | { kind: "apply-remote"; space: Space; id: string; meta: EntryMeta; bodyHash: string | null }
  | { kind: "archive-local"; space: Space; id: string; reason: "remote-wins" | "cloud-absent" }
  | { kind: "set-lifecycle"; space: Space; id: string; lifecycle: "active" | "trashed" | "cloud-deleted" | "purged" }
  /** 目录元数据以远端为准（下载/回收站传播）；目录没有正文。 */
  | { kind: "apply-remote-folder"; space: "lake"; id: string; meta: EntryMeta }
  /** 目录在远端已缺席（仅本地副本进回收站/跟随删除）。 */
  | { kind: "remove-folder"; id: string }
  /** 小记在远端已被软删（缺席）：本地跟随进小记回收站。 */
  | { kind: "quick-soft-delete"; space: "quickNotes"; id: string }
  /** 小记已被他端彻底删除（purged 墓碑）：本地不留副本（小记不备份语义）。 */
  | { kind: "quick-purge"; space: "quickNotes"; id: string };

/** 双向传输（PUT/GET）；lazy = 按需资产（首拉不搬媒体，打开时再补）。 */
export interface TransferOp {
  op: "put" | "get";
  space: Space;
  id: string;
  key: string;
  hash: string;
  size: number;
  kind: "body" | "asset" | "declaration" | "index";
  lazy?: boolean;
}

/** 删除（只允许用户 purge 语义；I0：收敛动作不得产生删除）。 */
export interface DeleteOp {
  space: Space;
  id: string;
  reason: "user-purge";
  keys?: string[];
  prefixes?: string[];
}

/** 意图（唯一需要跨轮持久化的东西）。 */
export type Intent =
  | { kind: "delete"; space: Space; id: string; at: string; targetEpoch: string; targetGeneration: number }
  | { kind: "purge"; space: Space; id: string; at: string; purgedAt: string }
  | { kind: "restore"; space: Space; id: string; at: string };

export interface PlanWarning {
  code: "remote_incomplete" | "local_body_missing" | "asset_missing" | "conflict_kept_history" | "cleanup_failed" | "hash_mismatch";
  space: Space;
  id?: string;
  title?: string;
  /** 资产相关警告的文件名（UI 点击定位/诊断需要）。 */
  filename?: string;
  detail?: string;
}

export interface SyncPlan {
  version: 4;
  reads: ReadOp[];
  writes: WriteOp[];
  transfers: TransferOp[];
  deletes: DeleteOp[];
  /**
   * 本地要发布的条目（= 合并结果的 uploadLocal 集）。Commit 用它决定「哪些索引条目以本地为准」，
   * Apply 用它决定「哪些条目要做资产/声明上传」。
   *
   * 为什么必须单独存在（E2-1b 前置）：正文没变、只改锁/图标/标题的轮次**不会**产生 body PUT，
   * 只看 transfers 会静默漏掉这类上传。folders 不参与（没有资产），故不在集合里。
   */
  publishes: { lake: string[]; quickNotes: string[] };
  /** 合并后的小记标签目录（远端优先、本地独有保留）：Apply/Commit 写回设备标签库用。 */
  quickTags?: QuickNoteTagEntry[];
  /** null = 零变更（不发布）。 */
  publish: { lake: LakeIndex; quickNotes: QuickNotesIndex } | null;
  intentChanges: Array<{ op: "add" | "clear"; intent: Intent }>;
  warnings: PlanWarning[];
  /** 确定性总量（UI 进度分母）。 */
  total: { ops: number; bytes: number };
}
