/**
 * Lake 笔记下载对账决策（lake-core 纯逻辑，V5 Phase 1）。
 * 收敛 electron/sync.ts 下载阶段"正文不同"分支的判定：
 * 输入本设备同步基线（baseHash）、本地当前正文 hash、远端清单 hash、
 * 本设备最后一次上传的 hash、远端 updatedAt、本设备已确认版本时间戳
 * （lastSyncedMetaAt）、本地条目是否在回收站 → 动作枚举。
 *
 * 核心语义（先同步者胜，与元数据 LWW 同构）：
 * - 远端是"本机更新的"（远端 updatedAt 不新于本设备已确认版本 lastSyncedMetaAt，
 *   即远端仍停留/回落到本机已确认或本机最后上传的版本）→ 本地为准（新编辑/恢复版），
 *   上传覆盖，避免旧内容覆盖新内容；
 * - 远端是其他设备改的（远端 updatedAt 新于 lastSyncedMetaAt）→ 接受远端最新；
 *   本地若持有本机编辑成果（相对基线有改动，或本机最后上传的版本正是本地内容）
 *   → 强制留档进历史（superseded，协议 §4.2）；纯跟随/镜像（从未编辑从未上传）→ 不留档。
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
  /** 远端清单条目的 updatedAt（判断"远端是否本机更新的"的时间维度） */
  remoteUpdatedAt: string;
  /** 本设备上次成功同步时该笔记的 updated_at（sync_base.last_synced_meta_at，已确认版本）；无 → null */
  lastSyncedMetaAt: string | null;
  /** 本地条目是否位于回收站笔记本（TRASH-NOTEBOOK） */
  localInTrash: boolean;
}

export function reconcileLakeNote(input: LakeReconcileInput): LakeReconcileAction {
  const { baseHash, localHash, remoteHash, lastUploadedHash, remoteUpdatedAt, lastSyncedMetaAt, localInTrash } = input;
  const localChanged = localHash !== null && localHash !== baseHash;
  const remoteChanged = remoteHash !== baseHash;
  // 远端是否是"本机更新的"：远端 updatedAt 不新于本设备已确认版本（lastSyncedMetaAt）。
  // 这是时间维度（先同步者胜，与元数据 LWW 同构）；hash 维度（lastUploadedHash）仅为辅助——
  // 其他设备回滚/恢复历史可能重新上传与本机曾上传内容相同（同 hash）但 updatedAt 更新的版本，
  // 光看 hash 会误判"本机传的"→ 保留本地覆盖他端的显式回滚（2026-08-22 二修）。
  // lastSyncedMetaAt 为 null（本机从未确认过该笔记）→ 远端视为未确认的新变更，非本机更新的。
  const remoteIsOurs =
    lastSyncedMetaAt !== null &&
    remoteUpdatedAt <= lastSyncedMetaAt &&
    remoteHash === lastUploadedHash;

  if (remoteIsOurs && !localInTrash) {
    // 远端是本机最后上传/已确认的版本（时间 + hash 双重确认）→ 本地为准（恢复版/新编辑），上传覆盖。
    return { kind: "local-wins", reason: "uploaded-by-us" };
  }
  if (!remoteChanged && localChanged && !localInTrash) {
    // 远端 == 本设备已确认基线 + 本地在其基础上续编 → 本地为准，上传覆盖。
    return { kind: "local-wins", reason: "continued-local" };
  }
  // 远端是其他设备改的（或本机从未上传过该文档）→ 接受远端。
  // superseded 语义 = 「本机编辑成果被远端覆盖才强制留档」（协议 §4.2）：
  // - localChanged（本地相对基线有改动）→ 未上传的编辑被覆盖 → 留档；
  // - localHash === lastUploadedHash（本地内容 == 本机最后上传的版本，本机是作者）→
  //   已上传的编辑被覆盖 → 留档（A 上传 A1 后未再编辑，B 恢复历史续编上传 B2 覆盖 A1 的场景）；
  // - 其余（本地从未编辑/从未上传，被覆盖的只是下载来的基线镜像，云端/他处仍有）→ 无需留档。
  const localIsOwnEdit = localChanged || (localHash !== null && localHash === lastUploadedHash);
  if (localIsOwnEdit) {
    return { kind: "remote-wins", superseded: true, isConflictFromRemote: false };
  }
  return { kind: "remote-wins", superseded: false, isConflictFromRemote: true };
}
