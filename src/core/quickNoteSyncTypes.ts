/**
 * 旧 quick-notes 同步通道的类型残留（仅类型，无运行时实现）。
 *
 * 261026 转正 v3 后，旧实现 src/core/quickNotesSyncEngine.ts / quickNotePush.ts 已删除；
 * 仍被 UI/IPC 以 **type-only** 引用的几个形状集中在这里，避免它们继续挂在
 * 已删除模块的导入路径上。**不要**在此文件加运行时逻辑，也不要恢复旧通道。
 *
 * CORE-12（261028）：移动端 data/quickNotesDbPort.ts 的 30+ 方法死端口实现已删（建表 DDL
 * 迁入 mobile/data/schema.ts）⇒ QuickNotesSyncDbPort / QuickNoteSyncItemImage 已随之删除。
 */

/** 单条推送的结果（historically: 「保存并同步」的返回类型；现走 v3 整轮同步兜底）。 */
export type QuickNotePushOutcome =
  | { status: "pushed"; uploadedContent: boolean; uploadedAssets: number; unchanged: boolean; manifestId: string | null }
  | { status: "full-sync"; reason: "no-remote-manifest" | "remote-deleted"; result: QuickNotesSyncResult }
  | { status: "not-found" };

/** 旧小记整轮同步的汇总（仅移动端 bridge 的历史返回字段引用）。 */
export interface QuickNotesSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  manifestId: string;
  completedAt: string;
}
