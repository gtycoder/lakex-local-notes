import type { CloudState, CloudStateInput } from "./s3v3Types.js";

/**
 * 云端状态分类（同步入口第一判据）。
 * 顺序：无基线 → pointer 缺失（空桶/损坏）→ epoch → generation 回滚 → 同 generation 不同 commit 分叉 → 正常。
 * 设计：docs/S3-REDESIGN.md §2.1 / §3 第 1 步 / §15（审计二轮 N4）。
 */
export function classifyCloudState(input: CloudStateInput): CloudState {
  const { pointer, baseline, cloudHasObjects } = input;
  if (!baseline) return "no-baseline";
  if (!pointer) return cloudHasObjects ? "pointer-corrupt" : "empty-cloud";
  if (pointer.epoch !== baseline.epoch) return "epoch-mismatch";
  if (pointer.generation < baseline.generation) return "generation-rollback";
  if (pointer.generation === baseline.generation) {
    if (pointer.lake.commit !== baseline.lakeCommit || pointer.quickNotes.commit !== baseline.quickNotesCommit) return "fork";
    return "ok";
  }
  return "ok";
}
