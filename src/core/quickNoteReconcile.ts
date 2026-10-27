/**
 * Quick Notes 下载对账决策（lake-core 纯逻辑，V5 Phase 1）。
 * 收敛旧 electron/quickNotesSync.ts（已删）下载阶段"正文不同"分支的判定：
 * - conflict：双端都改 → 远端覆盖本地；本地版本归档进回收站（新 id，恢复后为一条新小记）；
 * - local-wins：仅在本地变更 → 不下载，上传阶段将其作为权威版本；
 * - remote-wins：其余（仅远端改 / 新内容）→ 下载导入。
 */

export type QuickNoteReconcileAction =
  | { kind: "conflict" }
  | { kind: "local-wins" }
  | { kind: "remote-wins" };

export interface QuickNoteReconcileInput {
  /** 本设备上次成功同步时的 hash（sync_base.base_hash）；无基线 → null */
  baseHash: string | null;
  /** 本地当前 hash；本地无此小记 → null */
  localHash: string | null;
  /** 远端清单中的 hash */
  remoteHash: string;
}

export function reconcileQuickNote(input: QuickNoteReconcileInput): QuickNoteReconcileAction {
  const localChanged = input.localHash !== null && input.localHash !== input.baseHash;
  const remoteChanged = input.remoteHash !== input.baseHash;
  if (localChanged && remoteChanged) return { kind: "conflict" };
  if (localChanged) return { kind: "local-wins" };
  return { kind: "remote-wins" };
}
