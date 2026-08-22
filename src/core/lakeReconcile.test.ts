import { describe, expect, it } from "vitest";
import { reconcileLakeNote, type LakeReconcileAction } from "./lakeReconcile.js";

/**
 * 表驱动测试：覆盖 V5 Phase 0 已定稿的 Lake 下载对账语义
 * （与 electron/sync.ts 下载阶段「正文不同」分支一一对应）。
 */
const cases: Array<{ name: string; input: Parameters<typeof reconcileLakeNote>[0]; expect: LakeReconcileAction }> = [
  // uploaded-by-us：远端 == 本机最后一次上传 → 本地为准（恢复/新编辑），上传覆盖
  {
    name: "远端是本机传的 + 本地有变化 → local-wins(uploaded-by-us)",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: "A", localInTrash: false },
    expect: { kind: "local-wins", reason: "uploaded-by-us" },
  },
  {
    name: "回收站条目：本机传的 + 本地有变化 → 不得 local-wins（删除压编辑）",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: "A", localInTrash: true },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  // continued-local：远端 == 本设备已确认基线 + 本地续编 → 本地为准
  {
    name: "远端 == 基线 + 本地续编 → local-wins(continued-local)",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: null, localInTrash: false },
    expect: { kind: "local-wins", reason: "continued-local" },
  },
  {
    name: "回收站条目：远端 == 基线 + 本地续编 → 不得 local-wins",
    input: { baseHash: "A", localHash: "B", remoteHash: "A", lastUploadedHash: null, localInTrash: true },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  // localChanged：远端是其他设备改的 → 接受远端，本地留档（superseded=true, isConflictFromRemote=false）
  {
    name: "双端都改且远端非本机所传 → remote-wins(superseded)",
    input: { baseHash: "A", localHash: "B", remoteHash: "C", lastUploadedHash: "A", localInTrash: false },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  {
    name: "本机从未上传过（lastUploadedHash=null）→ remote-wins(superseded)",
    input: { baseHash: null, localHash: "B", remoteHash: "C", lastUploadedHash: null, localInTrash: false },
    expect: { kind: "remote-wins", superseded: true, isConflictFromRemote: false },
  },
  // else：本地相对基线无变化 / 本地无此笔记 → 接受远端
  {
    name: "本地无此笔记 → remote-wins(非 superseded)",
    input: { baseHash: null, localHash: null, remoteHash: "C", lastUploadedHash: null, localInTrash: false },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
  {
    name: "本地未编辑（localHash==base，本地行存在）→ remote-wins(非 superseded，无私有编辑不留档)",
    input: { baseHash: "A", localHash: "A", remoteHash: "C", lastUploadedHash: "A", localInTrash: false },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
  {
    name: "本地在回收站且未编辑（本地行存在）→ remote-wins(非 superseded)",
    input: { baseHash: "A", localHash: "A", remoteHash: "C", lastUploadedHash: "A", localInTrash: true },
    expect: { kind: "remote-wins", superseded: false, isConflictFromRemote: true },
  },
];

describe("reconcileLakeNote（表驱动）", () => {
  it.each(cases.map((c) => [c.name, c.input, c.expect] as const))("%s", (_name, input, expected) => {
    expect(reconcileLakeNote(input)).toEqual(expected);
  });
});
