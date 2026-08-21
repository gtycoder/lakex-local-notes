/**
 * 上传增量决策（lake-core 纯逻辑，V5 Phase 1；Lake 笔记与 Quick Notes 共用）。
 * - skip-fast：synced 且远端条目 hash == 本地基线 → 无需读盘/资源扫描，
 *              直接复用远端 assets 写入清单（零 IO 快路径，万级条目时省约 2 万次文件 IO）；
 * - upload：需要读盘计算 hash / 扫描资源 / 按需上传内容对象。
 */

export type UploadDecision = "skip-fast" | "upload";

export interface UploadDecisionInput {
  syncState: string;
  /** 本地同步基线 hash（sync_base.base_hash）；无 → null */
  baseHash: string | null;
  /** 远端清单条目 contentHash；远端无此条目 → null */
  remoteContentHash: string | null;
  /** 远端条目是否已删除（deleted 墓碑不参与快路径） */
  remoteDeleted: boolean;
}

export function decideUpload(input: UploadDecisionInput): UploadDecision {
  if (
    input.syncState === "synced" &&
    input.baseHash !== null &&
    input.remoteContentHash !== null &&
    !input.remoteDeleted &&
    input.remoteContentHash === input.baseHash
  ) {
    return "skip-fast";
  }
  return "upload";
}
