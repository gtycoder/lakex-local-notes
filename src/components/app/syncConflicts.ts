import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { RestoreSyncConflictResult, SyncConflictKind, SyncConflictRow, SyncConflictsSnapshot } from "../../lib/types";

/**
 * 「同步记录」账本的 UI 侧公共逻辑（P1 第 4 项）。
 *
 * 判据全部来自主进程（core/syncConflictLog + task-36 的账本表）；这里只做：
 * - 展示文案（三类事件的唯一来源）；
 * - 时间排序兜底（列表按 at 倒序）；
 * - 能力感知 + 错误文案（老主进程/浏览器端没有通道时给可读提示，不抛 TypeError）；
 * - ack / restore 的调用包装。
 */

/** 三类事件的文案（单一来源；设置页/角标/列表都用它）。 */
export const SYNC_CONFLICT_KIND_LABEL: Record<SyncConflictKind, string> = {
  remote_wins: "远端覆盖本地",
  remote_purged: "他端已删除",
  save_external_changed: "保存时磁盘被改",
};

/** 一行的补充说明（恢复语义/可做什么）。 */
export function syncConflictKindHint(kind: SyncConflictKind): string {
  switch (kind) {
    case "remote_wins": return "本地版本已存入历史；可恢复本地被覆盖版（恢复后按本机版本重新上传）。";
    case "remote_purged": return "该文档已被其它设备彻底删除；本机副本保留在回收站（云端已删除·仅本地）。";
    case "save_external_changed": return "保存时磁盘正文已被外部改过，本次未写盘；请打开文档处理（另存副本/覆盖/载入磁盘版）。";
    default: return "";
  }
}

/**
 * 该行是否支持「恢复本地被覆盖版」：
 * - 保存拦截（save_external_changed）只是审计事件，没有可恢复目标；
 * - 小记没有历史快照 ⇒ 只有 remote_purged 能走「回收站恢复」；
 * - Lake 文档 remote_wins（历史快照）/ remote_purged（回收站）都支持。
 */
export function canRestoreSyncConflict(row: Pick<SyncConflictRow, "kind" | "space" | "resolvedAt">): boolean {
  if (row.resolvedAt) return false;
  if (row.kind === "save_external_changed") return false;
  if (row.space === "quickNotes") return row.kind === "remote_purged";
  return true;
}

/** 时间倒序（主进程已排好；UI 再兜一次，防脏数据打乱顺序）。 */
export function sortConflictsNewestFirst(items: readonly SyncConflictRow[]): SyncConflictRow[] {
  return [...items].sort((a, b) => {
    const at = (b.at || "").localeCompare(a.at || "");
    return at !== 0 ? at : (b.id || "").localeCompare(a.id || "");
  });
}

/** 列表行的主标题：标题快照缺失时用 noteId 兜底（绝不空行）。 */
export function syncConflictTitle(row: Pick<SyncConflictRow, "title" | "noteId">): string {
  const title = (row.title ?? "").trim();
  return title || row.noteId;
}

/** restore_sync_conflict 失败原因 → 用户可读文案（主进程不抛，按 reason 给）。 */
export function restoreFailureText(result: Extract<RestoreSyncConflictResult, { ok: false }>): string {
  switch (result.reason) {
    case "history-missing": return "这条记录没有可用的历史快照，无法恢复本地被覆盖版。";
    case "history-expired": return "历史快照已过期或被清理，无法恢复本地被覆盖版；可从备份/云端另找版本。";
    case "not-found": return "记录或文档已不存在（可能已被彻底删除）。";
    case "unsupported": return "该类型记录不支持在这里恢复（保存拦截请打开文档处理）。";
    case "not-in-trash": return "本机回收站里已找不到该副本，无法恢复。";
    case "internal": return "恢复失败（内部错误）：" + (result.message || "请查看日志");
    default: return "恢复失败：" + (result.message || result.reason);
  }
}

type ConflictBridge = {
  listSyncConflicts?: () => Promise<unknown>;
  ackSyncConflicts?: (ids?: string[]) => Promise<unknown>;
  restoreSyncConflict?: (id: string) => Promise<unknown>;
};

function bridge(): ConflictBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { lakeNative?: ConflictBridge }).lakeNative ?? null;
}

/** 通道是否可用（老主进程/浏览器端 ⇒ 角标不显示、面板给可读提示）。 */
export function syncConflictBridgeAvailable(): boolean {
  const host = bridge();
  return typeof host?.listSyncConflicts === "function" && typeof host?.ackSyncConflicts === "function";
}

/** 读账本（失败/不可用 ⇒ 空快照 + 可读 error，绝不抛给渲染层）。 */
export async function loadSyncConflicts(): Promise<{ snapshot: SyncConflictsSnapshot; error: string | null }> {
  if (!syncConflictBridgeAvailable()) return { snapshot: { items: [], unacked: 0 }, error: null };
  try {
    const raw = await native.listSyncConflicts();
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const unacked = typeof raw?.unacked === "number" ? raw.unacked : items.filter((row) => !row.ackedAt).length;
    return { snapshot: { items: sortConflictsNewestFirst(items), unacked }, error: null };
  } catch (error) {
    return { snapshot: { items: [], unacked: 0 }, error: getNativeErrorMessage(error) };
  }
}

/** 全部标记已读（不删数据）；返回最新未读数。 */
export async function ackAllSyncConflicts(): Promise<number> {
  const result = await native.ackSyncConflicts();
  return typeof result?.unacked === "number" ? result.unacked : 0;
}

/** 恢复「本地被覆盖版」（历史快照 / 回收站）；主进程不抛，失败按 reason 给文案。 */
export async function restoreSyncConflictRow(id: string): Promise<RestoreSyncConflictResult> {
  if (typeof bridge()?.restoreSyncConflict !== "function") {
    return { ok: false, reason: "unsupported", message: "当前版本不支持恢复同步记录" };
  }
  try {
    return await native.restoreSyncConflict(id);
  } catch (error) {
    return { ok: false, reason: "internal", message: getNativeErrorMessage(error) };
  }
}
