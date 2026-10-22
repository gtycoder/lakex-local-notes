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
    const keep = buildGcKeepSet({ manifest, prefix: "local-lakex-notes", historyRefs: ["assets/n2/b.png"] });
    expect(keep.has("local-lakex-notes/objects/n1-hash1.lake")).toBe(true);
    expect(keep.has("local-lakex-notes/assets/n1/a.png")).toBe(true);
    expect(keep.has("local-lakex-notes/assets/n2/b.png")).toBe(true);
  });

  it("null manifest 只保留历史引用", () => {
    const keep = buildGcKeepSet({ manifest: null, prefix: "p", historyRefs: ["assets/n1/x.png"] });
    expect(keep.has("p/assets/n1/x.png")).toBe(true);
    expect(keep.size).toBe(1);
  });

  it("supports desktop-relative keys when no prefix is supplied", () => {
    const keep = buildGcKeepSet({ manifest: null, prefix: "", historyRefs: ["assets/n1/x.png"] });
    expect(keep.has("assets/n1/x.png")).toBe(true);
    expect(keep.has("/assets/n1/x.png")).toBe(false);
  });

  it("extraManifests（prev 链）的旧对象引用也进保留集", () => {
    const latest: Manifest = { version: 4, workspaceId: "default", commitId: "c2", prevCommitId: "c1", createdAt: "2026-01-02T00:00:00.000Z", notes: [{ id: "n1", title: "t", contentHash: "hash1", updatedAt: "2026-01-02T00:00:00.000Z", deleted: false, parentId: "nb", sortOrder: 0, isConflict: false, assets: [] }], folders: [] };
    const prev: Manifest = { version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z", notes: [{ id: "n1", title: "t", contentHash: "hash0", updatedAt: "2026-01-01T00:00:00.000Z", deleted: false, parentId: "nb", sortOrder: 0, isConflict: false, assets: [] }], folders: [] };
    const keep = buildGcKeepSet({ manifest: latest, extraManifests: [prev], prefix: "p", historyRefs: [] });
    expect(keep.has("p/objects/n1-hash1.lake")).toBe(true);
    expect(keep.has("p/objects/n1-hash0.lake")).toBe(true); // prev 链旧对象不删
  });
});
