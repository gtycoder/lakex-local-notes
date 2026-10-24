/**
 * 互斥域判据（单一来源，桌面与移动端共用）—— F16 的红线化。
 *
 * ## 为什么存在（261010 实测）
 * 移动端曾把「整轮同步（含全部网络往返）」与「所有本地写」塞进**同一条 key 固定为 "main"** 的
 * KeyedAsyncQueue ⇒ 弱网下用户保存要等整轮同步：实测 **152.0s**（基线写 32ms）。
 * 桌面从来没有这个问题：它的维护队列只有 3 个调用点（整轮同步 / 数据库备份 / 定期 GC 对账），
 * 普通笔记保存根本不入队。
 *
 * ⇒ 根因不是"锁的粒度"，而是**本地写被错误地并进了维护队列**。
 *
 * ## 不变量
 * - **I1（F16）**：`write` 与 `maintenance` 必须落在**不同互斥域**；网络往返期间不得持有写域。
 * - **I2**：跨网络窗口的「读 → 标记已同步」必须靠**"未变才标"守卫**（内容 hash 比较），
 *   不得依赖全局互斥。Lake 侧已有 `markSyncedIfUnchanged`（V5 §5.2）；
 *   小记侧 `markSynced` 缺守卫，是本判据落地的前置条件（见 quickNotesSyncEngine）。
 * - **I3**：同一互斥域内串行；**禁止嵌套获取同一域**（KeyedAsyncQueue 无重入 ⇒ 会自锁）。
 *   证据：`bridge.ts` 的 `restoreTreeItem` 注释「仍走同一串行队列，不嵌套 → 不会自锁」。
 *
 * ## 三个类的含义（判据 = "它进哪条队列"）
 * - `write`：本地状态写。入**写域**（短锁），可与网络阶段并行。
 * - `maintenance`：**轮次级**网络/维护操作。入**维护域**，彼此串行。
 * - `none`：不需要互斥 —— 只读、只碰文件系统/系统能力，或**委托给已入队的写方法**。
 *
 * 本模块是**纯数据 + 纯函数**：零平台依赖（由 scripts/check-core-boundaries.mjs 卡住）。
 */

/** 操作类别（= 它进哪条队列）。 */
export type OpClass = "write" | "maintenance" | "priority" | "none";

/** 互斥域。null = 不取锁。 */
export type LockDomain = "write" | "maintenance" | "priority" | null;

/**
 * 本地写：必须与网络阶段**并行**（I1），但彼此串行（I3）。
 * 表 = 两端"要串行化的本地写"的权威清单。
 */
export const WRITE_OPS = [
  // 目录树 CRUD
  "createNotebook", "createGroup", "renameTreeNode", "setNodeIcon", "moveTreeNodeOrdered", "reorderSiblings",
  // 小记写入
  "saveQuickNote", "saveQuickNoteWithImages", "saveQuickNoteContent", "createQuickNote",
  "deleteQuickNote", "restoreQuickNote", "purgeQuickNote",
  "saveQuickNoteDraft", "clearQuickNoteDraft",
  // 小记标签目录（261024）
  "createQuickNoteTag", "updateQuickNoteTag", "reorderQuickNoteTags", "mergeQuickNoteTags", "deleteQuickNoteTag",
  // 正文
  "saveNote", "createInk",
  // 历史快照
  "deleteHistory", "saveHistorySettings", "snapshotNote", "cleanupHistory",
  // 孤儿资产
  "deleteOrphanAsset", "cleanOrphanAssets",
  // S3 GC 账本（本地表）
  "addS3GcPending", "removeS3GcPending", "recordS3GcLog",
  // 回收站（软删 / 恢复 / 彻底删除）
  "trashNote", "trashTreeItem", "restoreTreeItem", "purgeTreeItem",
] as const;

/**
 * 轮次级网络 / 维护操作：彼此串行，但**不得持有写域**（I1）。
 *
 * 注意：单发网络操作（`testS3Connection` / `uploadObject` / `uploadResource`）**不在此列** ——
 * 它们是用户当场发起的单次请求，串进维护域会让"插一张图 / 测一次连通"同样等满一轮同步（F16 的翻版）。
 */
export const MAINTENANCE_OPS = [
  "syncNow",
  "gcDeepCleanup",
  "ensureTrashNoteAssets",
] as const;

/**
 * **高优先域**：用户当场发起、且必须**不等整轮同步**的「把这一条推到云端」操作（261013）。
 *
 * 为什么单列一域（既不并进维护域，也不归 none）：
 *  · 并进维护域 ⇒ 长按小记 → 写完点「保存并同步」，若正好撞上冷启动/回前台触发的整轮同步，**要排队等它跑完**
 *    （弱网实测整轮可到分钟级）—— 而这正是本功能的高频场景（"记好了要让桌面端及时看到"）；
 *  · 归 none ⇒ 连自己之间都不串行：连点两下会两颗请求交叉"读 → 改 → 写"同一份**无 CAS 的小记清单**；
 *  · ⇒ **彼此串行，但绝不排在整轮同步后面**（用户 261013 定稿）。
 * 它与整轮同步的交叉风险（整轮同步拿旧快照覆盖我们刚写的清单条目）由**推送后回核**兜底：
 * 调用方在推送结束后往**维护域队尾**排一次幂等回核（见 src/mobile/bridge.ts、electron/ipc/registerQuickNotes.ts）。
 */
export const PRIORITY_OPS = [
  "syncQuickNote",
] as const;

/**
 * 不需要互斥：只读、只碰文件系统/系统能力，或**委托给已入队的写方法**（委托者无需自己取锁）。
 */
export const NONE_OPS = [
  // 启动 / 只读
  "init", "getHomeSnapshot", "getWorkspaceSnapshot", "getQuickNotePage", "readNote", "noteGoneState", "searchNotes",
  "readQuickNote", "getQuickNoteDraft", "getQuickNoteImage", "listQuickNoteTrash", "listQuickNoteTags",
  "listNoteHistory", "getNoteInfo", "readAssetPreview", "previewHistorySnapshot",
  "listOrphanAssets", "listS3GcPending", "getHistorySettings",
  "listTrashed", "listTrashTree", "listDeletedNotesForSync", "readDeletedContent",
  "getSyncSettings", "getS3Settings", "getDiagnostics", "isFolderPurged",
  // 只读：UI 用它给「保存并同步」置灰（关云同步时）
  "getCloudState",
  // 委托型写（内部调用已入队的写方法，由被委托方取锁）
  "createNote", "createUsheet", "createBoard", "createBitable", "restoreNote", "restoreHistory", "markTombstonesPublished",
  // 设置写入（device_state / 密钥，同步不触碰同表）
  "saveSyncSettings", "saveS3Settings",
  // 单发网络（见 MAINTENANCE_OPS 注释）
  "testS3Connection", "uploadResource",
  // 文件系统 / 系统能力（只碰文件/系统能力，不写库行）
  "openAttachment", "saveAssetAs", "stageQuickNoteAsset",
] as const;

export type WriteOp = (typeof WRITE_OPS)[number];
export type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];
export type PriorityOp = (typeof PRIORITY_OPS)[number];
export type NoneOp = (typeof NONE_OPS)[number];
/** 移动端 bridge 的全部操作（完整性由 src/mobile/maintenancePolicyCoverage.test.ts 对着真对象卡住）。 */
export type BridgeOp = WriteOp | MaintenanceOp | PriorityOp | NoneOp;

const CLASS_OF = new Map<string, OpClass>();
for (const op of WRITE_OPS) CLASS_OF.set(op, "write");
for (const op of MAINTENANCE_OPS) CLASS_OF.set(op, "maintenance");
for (const op of PRIORITY_OPS) CLASS_OF.set(op, "priority");
for (const op of NONE_OPS) CLASS_OF.set(op, "none");

/** 判定操作类别；未知操作**抛错**（新增方法必须登记，否则单测先红）。 */
export function classifyOp(op: string): OpClass {
  const cls = CLASS_OF.get(op);
  if (cls === undefined) {
    throw new Error(`未登记的桥操作 "${op}"：请在 src/core/maintenancePolicy.ts 登记它的互斥域`);
  }
  return cls;
}

/** 类别 → 互斥域。 */
export function lockDomainOf(cls: OpClass): LockDomain {
  switch (cls) {
    case "write": return "write";
    case "maintenance": return "maintenance";
    case "priority": return "priority";
    case "none": return null;
  }
}

/** 该操作是否属于维护域（= 网络/维护轮次，禁止持有写域）。 */
export function isMaintenanceOp(op: string): op is MaintenanceOp {
  return CLASS_OF.get(op) === "maintenance";
}

/** 该操作是否属于写域（= 本地写，必须不被网络阶段阻塞）。 */
export function isWriteOp(op: string): op is WriteOp {
  return CLASS_OF.get(op) === "write";
}

/** 该操作是否属于高优先域（= 用户当场发起、必须不等整轮同步）。 */
export function isPriorityOp(op: string): op is PriorityOp {
  return CLASS_OF.get(op) === "priority";
}
