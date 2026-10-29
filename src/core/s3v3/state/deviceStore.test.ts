/**
 * E2-4 phase A：共享「文件型资产 IO」与落盘标记合并的内存驱动单测。
 * 桌面适配器已切到这份实现；下一批移动端接同一实现（驱动换成 Capacitor Filesystem）。
 */
import { describe, expect, it } from "vitest";
import type { FileDriver } from "./ports.js";
import { SAFE_ASSET_FILENAME, createFileBackedAssetIo, mergeSyncMarkers } from "./deviceStore.js";
import { DEVICE_STATE_VERSION, type IntentLogStateV3 } from "./intentLogState.js";

/** 内存 FileDriver：与 fs 语义对齐（读缺失 → null、列缺失 → []、原子写先 tmp 后 rename）。 */
function memoryFiles(): FileDriver & { files: Map<string, Uint8Array>; dirs: Set<string> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const norm = (p: string): string => p.replace(/\/+$/, "");
  return {
    files, dirs,
    async read(path) { return files.get(norm(path)) ?? null; },
    async writeAtomic(path, bytes) { files.set(norm(path), new Uint8Array(bytes)); },
    async remove(path) { files.delete(norm(path)); },
    async removeDir(path) {
      const prefix = norm(path) + "/";
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
      for (const dir of [...dirs]) if (dir === norm(path) || dir.startsWith(prefix)) dirs.delete(dir);
    },
    async list(path) {
      const prefix = norm(path) + "/";
      return [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
    },
    async mkdir(path) { dirs.add(norm(path)); },
    async stat(path) { const b = files.get(norm(path)); return b ? { size: b.length, mtimeMs: 1 } : null; },
  };
}

describe("createFileBackedAssetIo（E2-4 共享实现）", () => {
  it("读写/列/删：过滤 .tmp、排序、非法文件名拒绝或读回 null", async () => {
    const f = memoryFiles();
    const io = createFileBackedAssetIo({ files: f, assetDirFor: (id) => "root/assets/" + id });
    await io.writeAsset("n1", "b.png", new Uint8Array([2]));
    await io.writeAsset("n1", "a.png", new Uint8Array([1]));
    f.files.set("root/assets/n1/tmp.tmp-1", new Uint8Array([9])); // 原子写残留的临时文件
    expect(await io.listAssets("n1")).toEqual(["a.png", "b.png"]); // 已过滤 tmp + 排序
    expect(await io.readAsset("n1", "a.png")).toEqual(new Uint8Array([1]));
    // 白名单：读非法名 → null；写非法名 → 抛（SEC-13a 纵深防御）
    expect(await io.readAsset("n1", "../escape.png")).toBeNull();
    await expect(io.writeAsset("n1", "a b.png", new Uint8Array([3]))).rejects.toThrow(/非法资源文件名/);
    expect(SAFE_ASSET_FILENAME.test("1786123456789_abc12345.png")).toBe(true);
    await io.deleteAssetsDir("n1");
    expect(await io.listAssets("n1")).toEqual([]);
  });

  it("deleteAssetsDir 走 removeAssetsDir 钩子时不立即删（桌面延迟到行落库后）", async () => {
    const f = memoryFiles();
    const removed: string[] = [];
    const io = createFileBackedAssetIo({
      files: f, assetDirFor: (id) => "root/assets/" + id,
      removeAssetsDir: async (id) => { removed.push(id); },
    });
    await io.writeAsset("n1", "a.png", new Uint8Array([1]));
    await io.deleteAssetsDir("n1");
    expect(removed).toEqual(["n1"]);
    expect(await io.readAsset("n1", "a.png")).not.toBeNull(); // 仍未删
  });

  it("不接小记的端：list/read/delete 空操作，write 明确抛「未注入」", async () => {
    const f = memoryFiles();
    const io = createFileBackedAssetIo({ files: f, assetDirFor: (id) => "root/assets/" + id });
    expect(await io.listQuickAssets("q1")).toEqual([]);
    expect(await io.readQuickAsset("q1", "a.png")).toBeNull();
    await expect(io.writeQuickAsset("q1", "a.png", new Uint8Array([1]))).rejects.toThrow(/quickNotes 未注入/);
    await expect(io.deleteQuickAssetsDir("q1")).resolves.toBeUndefined();
  });

  it("接小记时走独立根目录（小记资产不落到文档资产目录）", async () => {
    const f = memoryFiles();
    const io = createFileBackedAssetIo({
      files: f,
      assetDirFor: (id) => "root/note-assets/" + id,
      quickAssetDirFor: (id) => "root/quick-notes/assets/" + id,
    });
    await io.writeAsset("n1", "a.png", new Uint8Array([1]));
    await io.writeQuickAsset("q1", "b.png", new Uint8Array([2]));
    expect([...f.files.keys()]).toEqual(["root/note-assets/n1/a.png", "root/quick-notes/assets/q1/b.png"]);
    expect(await io.listQuickAssets("q1")).toEqual(["b.png"]);
    await io.deleteQuickAssetsDir("q1");
    expect(await io.listQuickAssets("q1")).toEqual([]);
  });

  it("原生路径端口：给了 nativeAssetPathFor 才挂载（桌面不实现 = 引擎走字节路径）", async () => {
    const f = memoryFiles();
    const plain = createFileBackedAssetIo({ files: f, assetDirFor: (id) => "root/assets/" + id });
    expect(plain.assetNativePathFor).toBeUndefined();
    expect(plain.assetNativePath).toBeUndefined();
    const io = createFileBackedAssetIo({
      files: f, assetDirFor: (id) => "root/assets/" + id,
      nativeAssetPathFor: async (space, id, filename) => space + "/" + id + "/" + filename,
    });
    expect(await io.assetNativePathFor!("quickNotes", "q1", "a.png")).toBe("quickNotes/q1/a.png");
    expect(await io.assetNativePath!("n1", "a.png")).toBe("lake/n1/a.png"); // 旧口径只看 lake
  });
});

describe("mergeSyncMarkers（persistSyncMarkers 共用；v3 records）", () => {
  const persisted: IntentLogStateV3 = {
    version: DEVICE_STATE_VERSION,
    records: [
      { kind: "delete-intent", noteId: "n1", targetEpoch: "e1", targetGeneration: 1 },
      { kind: "quick-delete", id: "q1" },
      { kind: "quick-purge", id: "q2", at: "2026-10-03T00:00:00.000Z" },
      { kind: "restore", noteId: "n2" },
      { kind: "cloud-deleted", id: "n3" },
      { kind: "asset-retry", payload: { space: "lake", id: "n1", filename: "a.png", size: 1, hash: "c".repeat(64), attempts: 1 } },
    ],
    assets: { lake: { n1: "a".repeat(64) }, quickNotes: {} },
    hashCache: { n1: { mtimeMs: 1, size: 2, hash: "b".repeat(64) } },
  };
  const idsOf = (next: IntentLogStateV3, kind: "cloud-deleted" | "restore"): string[] => next.records.flatMap((r) => {
    if (kind === "cloud-deleted" && r.kind === "cloud-deleted") return [r.id];
    if (kind === "restore" && r.kind === "restore") return [r.noteId];
    return [];
  });

  it("只替换云端删除/恢复标记，其余 records/资产/缓存原样保留", () => {
    const next = mergeSyncMarkers(persisted, { remotePurged: ["n9"], restorePending: ["n10"] });
    expect(idsOf(next, "cloud-deleted")).toEqual(["n9"]);
    expect(idsOf(next, "restore")).toEqual(["n10"]);
    expect(next.records.filter((r) => r.kind === "delete-intent")).toEqual([{ kind: "delete-intent", noteId: "n1", targetEpoch: "e1", targetGeneration: 1 }]);
    expect(next.records.filter((r) => r.kind === "quick-delete")).toEqual([{ kind: "quick-delete", id: "q1" }]);
    expect(next.records.filter((r) => r.kind === "quick-purge")).toEqual([{ kind: "quick-purge", id: "q2", at: "2026-10-03T00:00:00.000Z" }]);
    expect(next.records.filter((r) => r.kind === "asset-retry")).toHaveLength(1);
    expect(next.assets).toEqual(persisted.assets);
    expect(next.hashCache).toEqual(persisted.hashCache);
    expect(next.version).toBe(DEVICE_STATE_VERSION);
  });

  it("输入数组被拷贝（调用方后续修改不影响已合并结果）", () => {
    const remote = ["n9"];
    const next = mergeSyncMarkers(persisted, { remotePurged: remote, restorePending: [] });
    remote.push("n11");
    expect(idsOf(next, "cloud-deleted")).toEqual(["n9"]);
  });
});
