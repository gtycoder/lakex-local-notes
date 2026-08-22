/**
 * Lake 笔记下载对账决策（lake-core 纯逻辑，V5 Phase 1）。
 * 收敛 electron/sync.ts 下载阶段"正文不同"分支的判定：
 * 输入本设备同步基线（baseHash）、本地当前正文 hash、远端清单 hash、
 * 本设备最后一次上传的 hash、本地条目是否在回收站 → 动作枚举。
 *
 * 语义（先同步者胜，与正文 baseHash、小记 baseHash 同构）：
 * - uploaded-by-us：远端 == 本机最后一次上传（本机传的）→ 本地为准（恢复版/新编辑），上传覆盖；
 * - continued-local：远端 == 本设备已确认基线且本地在其基础上续编 → 本地为准，上传覆盖；
 * - remote-wins：远端是其他设备改的（或本机从未上传过）→ 接受远端，本地内容已在历史（快照）兜底。
 * 回收站条目排除在 local-wins 之外（删除压编辑：A 删除、B 离线编辑时，B 的编辑不得溜进回收站内容）。
 *
 * 前提：调用方保证 localHash !== remoteHash（正文相同在更上层走元数据 LWW 分支，不会到达此处）。
 */

export type LakeReconcileAction =
  | { kind: "local-wins"; reason: "uploaded-by-us" | "continued-local" }
  | { kind: "remote-wins"; superseded: boolean; isConflictFromRemote: boolean };

export interface LakeReconcileInput {
  /** 本设备上次成功同步时的正文 hash（sync_base.base_hash）；无基线 → null */
  baseHash: string | null;
  /** 本地当前正文 hash；本地无此笔记 → null */
  localHash: string | null;
  /** 远端清单中的正文 hash */
  remoteHash: string;
  /** 本设备最后一次成功上传到 latest 的 hash（sync_base.last_uploaded_hash）；无 → null */
  lastUploadedHash: string | null;
  /** 本地条目是否位于回收站笔记本（TRASH-NOTEBOOK） */
  localInTrash: boolean;
}

export function reconcileLakeNote(input: LakeReconcileInput): LakeReconcileAction {
  const { baseHash, localHash, remoteHash, lastUploadedHash, localInTrash } = input;
  const localChanged = localHash !== null && localHash !== baseHash;
  const remoteChanged = remoteHash !== baseHash;
  const uploadedByUs = localHash !== null && remoteHash === lastUploadedHash;

  if (uploadedByUs && !localInTrash) {
    return { kind: "local-wins", reason: "uploaded-by-us" };
  }
  if (!remoteChanged && localChanged && !localInTrash) {
    return { kind: "local-wins", reason: "continued-local" };
  }
  if (localChanged) {
    // 远端是其他设备改的（或本机从未上传过该文档）→ 接受远端，本地留档进历史（superseded）。
    return { kind: "remote-wins", superseded: true, isConflictFromRemote: false };
  }
  // 本地相对基线无变化（或本地无此笔记）且远端是其他设备改的 → 接受远端。
  // superseded 语义 = 「本地编辑被远端覆盖才强制留档」（协议 §4.2）：
  // localChanged=false 时本地无私有编辑，被覆盖的只是已确认的基线版本（云端/他处仍有），无需留档。
  // （修复：B 无改动仅同步 A 的更新时不再误存快照——2026-08-22 双端验证发现）
  return { kind: "remote-wins", superseded: false, isConflictFromRemote: true };
}
