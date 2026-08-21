import { describe, expect, it } from "vitest";
import { decideUpload, type UploadDecision } from "./decideUpload.js";

/** 表驱动测试：Lake 与 Quick Notes 上传快路径判定（与 sync.ts / quickNotesSync.ts 一致）。 */
const cases: Array<{ name: string; input: Parameters<typeof decideUpload>[0]; expect: UploadDecision }> = [
  { name: "synced + 远端 == 本地基线 → skip-fast", input: { syncState: "synced", baseHash: "A", remoteContentHash: "A", remoteDeleted: false }, expect: "skip-fast" },
  { name: "synced + 远端不同 → upload", input: { syncState: "synced", baseHash: "A", remoteContentHash: "B", remoteDeleted: false }, expect: "upload" },
  { name: "synced + 远端无此条目 → upload", input: { syncState: "synced", baseHash: "A", remoteContentHash: null, remoteDeleted: false }, expect: "upload" },
  { name: "synced + 远端是墓碑（deleted）→ upload", input: { syncState: "synced", baseHash: "A", remoteContentHash: "A", remoteDeleted: true }, expect: "upload" },
  { name: "local（待上传）→ upload", input: { syncState: "local", baseHash: null, remoteContentHash: "A", remoteDeleted: false }, expect: "upload" },
  { name: "conflict → upload", input: { syncState: "conflict", baseHash: "A", remoteContentHash: "A", remoteDeleted: false }, expect: "upload" },
  { name: "无本地基线 → upload", input: { syncState: "synced", baseHash: null, remoteContentHash: "A", remoteDeleted: false }, expect: "upload" },
];

describe("decideUpload（表驱动）", () => {
  it.each(cases.map((c) => [c.name, c.input, c.expect] as const))("%s", (_name, input, expected) => {
    expect(decideUpload(input)).toBe(expected);
  });
});
