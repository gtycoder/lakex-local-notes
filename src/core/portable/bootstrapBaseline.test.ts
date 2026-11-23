/**
 * 合并底稿基线（bootstrap baseline）纯逻辑单测（261123，docs/PORTABLE-TRANSFER.md §3.1）。
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../syncUtils.js";
import {
  buildBootstrapBaseline,
  isBootstrapBaseline,
  rebaseBootstrapBaseline,
  type BootstrapRowSet,
} from "./bootstrapBaseline.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry } from "../s3v3/protocol/s3v3Index.js";

const H = (s: string) => sha256Hex(new TextEncoder().encode(s));
const ISO = "2026-11-23T00:00:00.000Z";

function note(id: string, body: string, extra: Partial<LakeNoteEntry> = {}): LakeNoteEntry {
  return { id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(body), ...extra };
}
function folder(id: string): LakeFolderEntry {
  return { id, title: "F" + id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: ISO, space: null };
}
function quick(id: string, body: string): QuickNoteEntry {
  return { id, createdAt: ISO, updatedAt: ISO, contentHash: H(body) };
}
function rows(partial: Partial<BootstrapRowSet> = {}): BootstrapRowSet {
  return { notes: [], folders: [], quickItems: [], ...partial };
}

describe("buildBootstrapBaseline（261123 合并底稿）", () => {
  it("合成：谱系留空 + bootstrap 标记；条目原样保留（含标签关系与 purged 墓碑）", () => {
    const base = buildBootstrapBaseline(rows({
      notes: [note("n1", "a", { tagIds: ["t2", "t1"], tagsUpdatedAt: ISO, trashedAt: ISO, deletedFromParentId: "p" })],
      folders: [folder("f1")],
      quickItems: [quick("q1", "b")],
      quickTags: [{ id: "t1", name: "标签", createdAt: ISO, updatedAt: ISO }],
      quickPurged: ["q9"],
    }));
    expect(base.bootstrap).toBe(true);
    expect(base.epoch).toBe("");
    expect(base.generation).toBe(0);
    expect(base.lakeCommit).toBe("");
    expect(base.quickNotesCommit).toBe("");
    expect(base.lake.notes).toHaveLength(1);
    expect(base.lake.notes[0]).toMatchObject({ id: "n1", contentHash: H("a"), tagIds: ["t2", "t1"], trashedAt: ISO });
    expect(base.lake.folders).toHaveLength(1);
    expect(base.quickNotes.items).toHaveLength(1);
    expect(base.quickNotes.tags).toHaveLength(1);
    expect(base.quickNotes.purged).toEqual(["q9"]);
  });

  it("坏条目逐条丢弃、不毁整包（坏 hash / 重复 id / 非法 id）", () => {
    const base = buildBootstrapBaseline(rows({
      notes: [
        note("n1", "a"),
        note("n2", "b", { contentHash: "not-a-hash" }),
        note("n1", "dup"),
        note("../evil", "c"),
      ],
    }));
    expect(base.lake.notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("空世界也合法（空底稿 ≠ 抛错）", () => {
    const base = buildBootstrapBaseline(rows());
    expect(base.bootstrap).toBe(true);
    expect(base.lake.notes).toEqual([]);
  });
});

describe("isBootstrapBaseline / rebaseBootstrapBaseline", () => {
  it("判据与血缘对齐：内容底稿不变、谱系采纳云端、bootstrap 标记保留", () => {
    const base = buildBootstrapBaseline(rows({ notes: [note("n1", "a")] }));
    expect(isBootstrapBaseline(base)).toBe(true);
    expect(isBootstrapBaseline(null)).toBe(false);
    expect(isBootstrapBaseline({ ...base, bootstrap: undefined } as never)).toBe(false);
    const rebased = rebaseBootstrapBaseline(base, {
      epoch: "epoch-x", generation: 7, lakeCommit: "lc", quickNotesCommit: "qc",
    });
    expect(rebased.epoch).toBe("epoch-x");
    expect(rebased.generation).toBe(7);
    expect(rebased.lakeCommit).toBe("lc");
    expect(rebased.quickNotesCommit).toBe("qc");
    expect(rebased.bootstrap).toBe(true);
    expect(rebased.lake.notes).toEqual(base.lake.notes);
    expect(isBootstrapBaseline(rebased)).toBe(true);
  });
});
