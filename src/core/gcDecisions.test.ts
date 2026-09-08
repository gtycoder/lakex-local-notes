import { describe, expect, it } from "vitest";
import { buildGcKeepSet } from "./gcDecisions.js";
import type { Manifest } from "./manifestTypes.js";

describe("buildGcKeepSet", () => {
  it("manifest 对象/资产引用 + 历史引用 全部进保留集（带 prefix）", () => {
    const manifest: Manifest = {
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "t", contentHash: "hash1", updatedAt: "2026-01-01T00:00:00.000Z", deleted: false, parentId: "nb", sortOrder: 0, isConflict: false, assets: [{ filename: "a.png", size: 1, hash: "h" }] }],
      folders: [],
    };
    const keep = buildGcKeepSet({ manifest, prefix: "lake-notes", historyRefs: ["assets/n2/b.png"] });
    expect(keep.has("lake-notes/objects/n1-hash1.lake")).toBe(true);
    expect(keep.has("lake-notes/assets/n1/a.png")).toBe(true);
    expect(keep.has("lake-notes/assets/n2/b.png")).toBe(true);
  });

  it("null manifest 只保留历史引用", () => {
    const keep = buildGcKeepSet({ manifest: null, prefix: "p", historyRefs: ["assets/n1/x.png"] });
    expect(keep.has("p/assets/n1/x.png")).toBe(true);
    expect(keep.size).toBe(1);
  });
});
