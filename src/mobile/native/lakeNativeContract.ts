/**
 * window.lakeNative 的调试/自动化契约（对齐桌面 window.lakeNative 语义）。
 *
 * ## 为什么改（B2 单一来源收口，261010）
 * 旧实现在 MobileApp 里**手写 49 个箭头包装**（每个方法一行）。两个问题：
 *  ① 方法数只靠人眼维持 —— 实现本体 bridge 有 **71** 个方法，契约只暴露 47 个 bridge 方法 + 2 个非 bridge 入口，
 *     差别没有任何护栏（而且"到底几个"在不同文档里写过 49/51 两个数）；
 *  ② 逐个手抄转发体，改签名时容易漏。
 * 现在只维护**名字清单**（单一来源），实现从 bridge / 附加入口派生；声明了却不存在 ⇒ 当场抛。
 *
 * 护栏：src/mobile/native/lakeNativeContract.test.ts（名字必须真存在于 bridge 或附加入口）。
 */

/** 从 bridge 派生的方法（CDP 驱动与真机调试用）。 */
export const LAKE_NATIVE_BRIDGE_METHODS = [
  "uploadResource", "syncNow", "testS3Connection",
  "restoreFromCloud", // 261028：从云端恢复（换机/坏库；清本机同步基线后整轮只拉不打）
  "getHomeSnapshot", "getWorkspaceSnapshot", "getQuickNotePage",
  "listOrphanAssets", "cleanOrphanAssets", "deleteOrphanAsset", "gcDeepCleanup",
  "listNoteHistory", "getNoteInfo", "readAssetPreview", "previewHistorySnapshot",
  "openAttachment", "saveAssetAs", "restoreHistory", "cleanupHistory",
  "getHistorySettings", "saveHistorySettings", "snapshotNote", "getDiagnostics",
  "createQuickNote", "deleteQuickNote", "saveQuickNote", "saveQuickNoteWithImages",
  "getQuickNoteImage", "listQuickNoteTrash", "restoreQuickNote", "purgeQuickNote", "syncQuickNote",
  "getCloudState", "getSyncSettings", "saveSyncSettings",
  "listTrashTree", "getS3Settings", "saveS3Settings",
  "createNote", "createBitable", "readNote", "saveNote", "trashNote", "restoreNote", "listTrashed",
  "restoreTreeItem", "purgeTreeItem",
  "createGroup", "renameTreeNode", "setNodeIcon", "reorderSiblings", "moveTreeNodeOrdered", "createNotebook",
  "searchNotes", "ensureSearchIndex",
  "ensureNoteAssets", "ensureQuickNoteAssets", // 261027：按需资产占位补拉（CDP 自动化/调试也会用）
  "aiGetSettings", "aiSaveSettings", "aiTestConnection", "aiChat", "aiCancel",
] as const;

/** 非 bridge 的调试入口（sqlite 迁移/压测辅助）。 */
export const LAKE_NATIVE_EXTRA_METHODS = [
  "runNativeSqliteSpike",
] as const;

export const LAKE_NATIVE_METHODS = [...LAKE_NATIVE_BRIDGE_METHODS, ...LAKE_NATIVE_EXTRA_METHODS] as const;
export type LakeNativeMethod = (typeof LAKE_NATIVE_METHODS)[number];

/** 从实现派生 window.lakeNative。声明了却不存在 ⇒ 抛（改契约必须同时改实现）。 */
export function buildLakeNative(sources: {
  bridge: Record<string, unknown>;
  extra: Record<string, unknown>;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of LAKE_NATIVE_METHODS) {
    const own = sources.bridge[name];
    const fromBridge = typeof own === "function";
    const fn = fromBridge ? own : sources.extra[name];
    if (typeof fn !== "function") {
      throw new Error("lakeNative 契约声明了不存在的方法: " + name + "（改契约必须同时改实现）");
    }
    out[name] = (fn as (...args: unknown[]) => unknown).bind(fromBridge ? sources.bridge : sources.extra);
  }
  return out;
}