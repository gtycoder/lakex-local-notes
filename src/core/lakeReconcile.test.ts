import { describe, expect, it } from "vitest";
import { reconcileLakeNote, type LakeReconcileAction } from "./lakeReconcile.js";

/**
 * 表驱动测试：覆盖 V5 Phase 0 已定稿的 Lake 下载对账语义
 * （与 electron/sync.ts 下载阶段「正文不同」分支一一对应）。
 *
 * 时间维度约定（先同步者胜，与元数据 LWW 同构）：
 * - remoteUpdatedAt <= lastSyncedMetaAt → 远端不新于本设备已确认版本 → 远端是"本机更新的"（本机传的/已确认的）；
 * - remoteUpdatedAt >  lastSyncedMetaAt → 远端是其他设备改的（含同 hash 回滚重传）→ 接受远端。
 */
const T0 = "2026-01-01T00:00:00.000Z"; // 已确认版本时间
const T1 = "2026-01-02T00:00:00.000Z"; // 其他设备更新的版本时间（新于 T0）

const cases: Array<{ name: string; input: Parameters<typeof reconcileLakeNote>[0]; expect: LakeReconcileAction }> = [
  // uploaded-by-us：远端 == 本机最后一次上传（时间 + hash 双重确认）→ 本地为准（恢复/新编辑），上传覆盖
  {
    name: "远端是本机传的（hash 匹配且时间不新于已确认）+ 本地有变化 → local-wins(uploaded-by-us)",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: "A", remoteUpdatedAt: T0, lastSyncedMetaAt: T0, localInTrash: false },
    expect: { kind: "local-wins", reason: "uploaded-by-us" },
  },
  {
    name: "回收站条目：本机传的 + 本地有变化 → 不得 local-wins（删除压编辑）",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: "A", remoteUpdatedAt: T0, lastSyncedMetaAt: T0, localInTrash: true },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  // 同 hash 但时间更新（其他设备回滚/恢复历史重传了本机曾上传过的内容）→ 不是本机传的，接受远端
  {
    name: "远端 hash 匹配本机曾上传但 updatedAt 新于已确认（他端回滚重传同内容）→ 非本机传，接受远端不留档",
    input: { baseHash: "B", localHash: "B", remoteHash: "A", lastUploadedHash: "A", remoteUpdatedAt: T1, lastSyncedMetaAt: T0, localInTrash: false },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
  // continued-local：远端 == 本设备已确认基线 + 本地续编 → 本地为准
  {
    name: "远端 == 基线 + 本地续编 → local-wins(continued-local)",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: null, remoteUpdatedAt: T0, lastSyncedMetaAt: T0, localInTrash: false },
    expect: { kind: "local-wins", reason: "continued-local" },
  },
  {
    name: "回收站条目：远端 == 基线 + 本地续编 → 不得 local-wins",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: null, remoteUpdatedAt: T0, lastSyncedMetaAt: T0, localInTrash: true },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  // 远端是其他设备改的（updatedAt 新于已确认）且本地有编辑成果 → 接受远端 + 留档
  {
    name: "双端都改且远端非本机所传 → remote-wins(superseded)",
    input: { baseHash: "A", localHash: "B", remoteHash: "C", lastUploadedHash: "A", remoteUpdatedAt: T1, lastSyncedMetaAt: T0, localInTrash: false },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  {
    name: "本机从未上传过（lastUploadedHash=null）→ remote-wins(superseded)",
    input: { baseHash: null, localHash: "B", remoteHash: "C", lastUploadedHash: null, remoteUpdatedAt: T1, lastSyncedMetaAt: null, localInTrash: false },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  // else：远端是其他设备改的且本地无编辑成果 → 接受远端不留档
  {
    name: "本地无此笔记 → remote-wins(非 superseded)",
    input: { baseHash: null, localHash: null, remoteHash: "C", lastUploadedHash: null, remoteUpdatedAt: T1, lastSyncedMetaAt: null, localInTrash: false },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
  {
    name: "本地未编辑且本机从未上传（纯跟随他端更新）→ remote-wins(非 superseded，无本机编辑成果不留档)",
    input: { baseHash: "A", localHash: "A", remoteHash: "C", lastUploadedHash: null, remoteUpdatedAt: T1, lastSyncedMetaAt: T0, localInTrash: false },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
  {
    name: "本地未编辑但本机上传过该版本（lastUploadedHash==localHash，本机是作者）被其他设备覆盖 → 强制留档",
    input: { baseHash: "A", localHash: "A", remoteHash: "C", lastUploadedHash: "A", remoteUpdatedAt: T1, lastSyncedMetaAt: T0, localInTrash: false },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  {
    name: "回收站 + 本机从未上传（lastUploadedHash=null）→ remote-wins(非 superseded)",
    input: { baseHash: "A", localHash: "A", remoteHash: "C", lastUploadedHash: null, remoteUpdatedAt: T1, lastSyncedMetaAt: T0, localInTrash: true },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
  {
    name: "回收站 + 本机上传过该版本（本机是作者）被覆盖 → 强制留档",
    input: { baseHash: "A", localHash: "A", remoteHash: "C", lastUploadedHash: "A", remoteUpdatedAt: T1, lastSyncedMetaAt: T0, localInTrash: true },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
];

describe("reconcileLakeNote（表驱动）", () => {
  it.each(cases.map((c) => [c.name, c.input, c.expect] as const))("%s", (_name, input, expected) => {
    expect(reconcileLakeNote(input)).toEqual(expected);
  });
});
