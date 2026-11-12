/**
 * 旧 quick-notes 同步通道的类型残留 + 「保存并同步」的结果形状（无 IO/无平台逻辑）。
 *
 * 261026 转正 v3 后，旧实现 src/core/quickNotesSyncEngine.ts / quickNotePush.ts 已删除；
 * 仍被 UI/IPC 引用的几个形状集中在这里，避免它们继续挂在已删除模块的导入路径上。
 * **不要**在此文件加 IO/平台逻辑或恢复旧通道；**纯数据 + 纯函数**（如下面的理由→文案映射）
 * 放这里是刻意的 —— 两端 UI 共用同一份语义，避免各写一套（AGENTS §3「单一来源」）。
 *
 * CORE-12（261028）：移动端 data/quickNotesDbPort.ts 的 30+ 方法死端口实现已删（建表 DDL
 * 迁入 mobile/data/schema.ts）⇒ QuickNotesSyncDbPort / QuickNoteSyncItemImage 已随之删除。
 */

/**
 * 「保存并同步」需要回退整轮的 4 个理由（与 core/s3v3/quickPush/types.ts 的
 * `QuickPushResult.full-sync.reason` **同一词表**，两端适配层原样透传、不得折叠）。
 *
 * F-04（261112 审计）：此前桌面/移动都把非 remote-deleted 的理由一律折叠成
 * `no-remote-manifest`，导致「云端索引已变化」「本机缺基线」被谎报成「云端还没有小记数据」。
 */
export type QuickNoteFullSyncReason = "no-cloud" | "no-baseline" | "cloud-changed" | "remote-deleted";

/**
 * 4 个理由 → 用户可见文案（**两端共用**：桌面 QuickNotesWorkspace / 移动 QuickNoteComposer）。
 * remote-deleted 不是同步失败，是「按删除处理」——文案里同时说明已跑过一次整轮。
 */
export const QUICK_NOTE_FULL_SYNC_TEXT: Record<QuickNoteFullSyncReason, string> = {
  "no-cloud": "云端还没有小记数据，已改为执行一次完整同步",
  "no-baseline": "本机还没有这条小记的同步记录，已改为执行一次完整同步",
  "cloud-changed": "云端小记索引已变化，已改为执行一次完整同步",
  "remote-deleted": "这条小记已在其他设备删除，已改为执行一次完整同步并按删除处理",
};

/** 单条推送的结果（v3 单条快路径 runQuickPush 的返回；必须整轮时 status=full-sync）。 */
export type QuickNotePushOutcome =
  | { status: "pushed"; uploadedContent: boolean; uploadedAssets: number; unchanged: boolean; manifestId: string | null }
  | { status: "full-sync"; reason: QuickNoteFullSyncReason; result: QuickNotesSyncResult }
  | { status: "not-found" };

/** 旧小记整轮同步的汇总（仅移动端 bridge 的历史返回字段引用）。 */
export interface QuickNotesSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  manifestId: string;
  completedAt: string;
}
