import { describe, expect, it } from "vitest";
import { reconcileQuickNote, type QuickNoteReconcileAction } from "./quickNoteReconcile.js";

/** 表驱动测试：与旧 electron/quickNotesSync.ts（已删）下载阶段「正文不同」分支一一对应。 */
const cases: Array<{ name: string; input: Parameters<typeof reconcileQuickNote>[0]; expect: QuickNoteReconcileAction }> = [
  { name: "双端都改 → conflict", input: { baseHash: "A", localHash: "B", remoteHash: "C" }, expect: { kind: "conflict" } },
  { name: "仅在本地变更 → local-wins", input: { baseHash: "A", localHash: "B", remoteHash: "A" }, expect: { kind: "local-wins" } },
  { name: "本地无此小记 + 远端新内容 → remote-wins", input: { baseHash: null, localHash: null, remoteHash: "C" }, expect: { kind: "remote-wins" } },
  { name: "仅远端变更（本地未编辑）→ remote-wins", input: { baseHash: "A", localHash: "A", remoteHash: "C" }, expect: { kind: "remote-wins" } },
  { name: "本机从未同步过 + 本地有内容 + 远端有条目 → conflict", input: { baseHash: null, localHash: "B", remoteHash: "C" }, expect: { kind: "conflict" } },
];

describe("reconcileQuickNote（表驱动）", () => {
  it.each(cases.map((c) => [c.name, c.input, c.expect] as const))("%s", (_name, input, expected) => {
    expect(reconcileQuickNote(input)).toEqual(expected);
  });
});
