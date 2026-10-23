/**
 * S3 清单锁字段的「线上键冻结」round-trip（261023）。
 *
 * 内存类型已改名为 isEditLocked / editLockedAt（锁编辑，≠ 文档加密），
 * 但**线上清单 JSON 键仍是 isLocked / lockedAt**（跨端与旧数据契约）。
 * 本护栏钉死两个边界：
 *   ① 解析：旧清单（只有 isLocked/lockedAt 键）读进来锁状态正确，且内存里不再有线上键；
 *   ② 写出：新写出的 JSON 仍只有 isLocked/lockedAt 键，**没有** isEditLocked/editLockedAt 键。
 */
import { describe, expect, it } from "vitest";
import { parseLakeManifest, manifestToWire } from "./syncUtils.js";
import type { Manifest, ManifestNote } from "./manifestTypes.js";

const HASH_A = "a".repeat(64);
const enc = (value: string) => new TextEncoder().encode(value);

/** 旧线上清单：锁字段只有冻结键 isLocked / lockedAt。 */
function wireManifest(notes: Array<Record<string, unknown>>, folders: Array<Record<string, unknown>> = []): string {
  return JSON.stringify({
    version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null,
    createdAt: "2026-01-01T00:00:00.000Z", notes, folders,
  });
}

const wireNote = (extra: Record<string, unknown> = {}) => ({
  id: "n1", title: "笔记", parentId: null, sortOrder: 0,
  updatedAt: "2026-01-01T00:00:00.000Z", contentHash: HASH_A, isConflict: false, assets: [],
  ...extra,
});

function memoryManifest(notes: ManifestNote[]): Manifest {
  return {
    version: 1, workspaceId: "default", commitId: "c2", prevCommitId: "c1",
    createdAt: "2026-01-02T00:00:00.000Z", notes, folders: [],
  };
}

describe("S3 清单锁字段：线上键冻结的解析边界", () => {
  it("旧清单（只有 isLocked/lockedAt）读进来 → 内存是 isEditLocked/editLockedAt，且不残留线上键", () => {
    const parsed = parseLakeManifest(enc(wireManifest([
      wireNote({ isLocked: true, lockedAt: "2026-01-02T00:00:00.000Z" }),
    ])));
    const note = parsed.notes[0];
    expect(note.isEditLocked).toBe(true);
    expect(note.editLockedAt).toBe("2026-01-02T00:00:00.000Z");
    // 线上键不得泄漏到内存对象（否则序列化边界会写出两种键）
    expect(note).not.toHaveProperty("isLocked");
    expect(note).not.toHaveProperty("lockedAt");
  });

  it("锁字段缺席的条目保持缺席（墓碑不凭空长出锁字段）", () => {
    const parsed = parseLakeManifest(enc(wireManifest([
      wireNote({ id: "t1", deleted: true, deletedAt: "2026-01-03T00:00:00.000Z", contentHash: "t1" }),
    ])));
    const note = parsed.notes[0];
    expect(note).not.toHaveProperty("isEditLocked");
    expect(note).not.toHaveProperty("editLockedAt");
  });

  it("线上键类型非法仍按线上键名报错", () => {
    expect(() => parseLakeManifest(enc(wireManifest([wireNote({ isLocked: "yes" })]))))
      .toThrow("清单格式无效：isLocked 非法");
    expect(() => parseLakeManifest(enc(wireManifest([wireNote({ lockedAt: 42 })]))))
      .toThrow("清单格式无效：lockedAt 非法");
  });
});

describe("S3 清单锁字段：线上键冻结的写出边界", () => {
  it("内存 isEditLocked/editLockedAt → JSON 只有 isLocked/lockedAt 键，没有内存键", () => {
    const wire = manifestToWire(memoryManifest([{
      id: "n1", title: "笔记", parentId: null, sortOrder: 0,
      updatedAt: "2026-01-01T00:00:00.000Z", contentHash: HASH_A, isConflict: false, assets: [],
      isEditLocked: true, editLockedAt: "2026-01-02T00:00:00.000Z",
    }]));
    const json = JSON.stringify(wire);
    expect(json).toContain('"isLocked":true');
    expect(json).toContain('"lockedAt":"2026-01-02T00:00:00.000Z"');
    expect(json).not.toContain("isEditLocked");
    expect(json).not.toContain("editLockedAt");
    expect(wire.notes[0]).toMatchObject({ isLocked: true, lockedAt: "2026-01-02T00:00:00.000Z" });
  });

  it("写出 → 再解析：锁状态原样 round-trip", () => {
    const before = memoryManifest([{
      id: "n1", title: "笔记", parentId: null, sortOrder: 0,
      updatedAt: "2026-01-01T00:00:00.000Z", contentHash: HASH_A, isConflict: false, assets: [],
      isEditLocked: true, editLockedAt: "2026-01-02T00:00:00.000Z",
    }]);
    const after = parseLakeManifest(enc(JSON.stringify(manifestToWire(before))));
    expect(after.notes[0].isEditLocked).toBe(true);
    expect(after.notes[0].editLockedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
