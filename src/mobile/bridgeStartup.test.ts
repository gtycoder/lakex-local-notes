import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  loadAssetBytesFs,
  listAssetKeysFs,
  listNoteAssetKeysFs,
  removeAssetBytesFs,
} = vi.hoisted(() => ({
  loadAssetBytesFs: vi.fn(async () => new Uint8Array([1, 2, 3])),
  listAssetKeysFs: vi.fn(async () => ["note-1/image.png"]),
  listNoteAssetKeysFs: vi.fn(async (noteId: string) => [`${noteId}/image.png`]),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

vi.mock("./data/persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
}));

vi.mock("./native/nativeSqliteDb.js", async () =>
  (await import("./native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("./native/nativeSqliteMigration", () => ({
  DEFAULT_MOBILE_DATABASE: "lake-notes-mobile",
  migrateSnapshotToNativeSqlite: vi.fn(async () => ({
    status: "no-snapshot",
    databaseName: "lake-notes-mobile",
  })),
}));

vi.mock("./native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs,
  listAssetKeysFs,
  listNoteAssetKeysFs,
  removeAssetBytesFs,
}));

import { bridge } from "./bridge.js";

describe("mobile startup performance contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listNotes returns metadata without loading every document body", async () => {
    await bridge.saveNote(
      "startup-note",
      "启动测试",
      "<p>large body</p>",
      null,
    );
    expect(listNoteAssetKeysFs).toHaveBeenCalledWith("startup-note");
    expect(listAssetKeysFs).not.toHaveBeenCalled();

    const notes = await bridge.listNotes();

    expect(notes).toEqual([
      {
        id: "startup-note",
        title: "启动测试",
        updatedAt: expect.any(String),
        parentId: null,
      },
    ]);
    expect("content" in notes[0]).toBe(false);
  });

  it("repeatedly saving the same note does not advance its sync timestamp", async () => {
    await bridge.saveNote("mobile-idempotent", "幂等保存", "<p>same</p>", null);
    const first = await bridge.readNote("mobile-idempotent");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await bridge.saveNote("mobile-idempotent", "幂等保存", "<p>same</p>", null);
    const second = await bridge.readNote("mobile-idempotent");
    expect(second?.updatedAt).toBe(first?.updatedAt);
  });

  it("init does not load assets into the JS heap (assets are served from Filesystem by AssetServer)", async () => {
    await bridge.init();

    expect(listAssetKeysFs).not.toHaveBeenCalled();
    expect(loadAssetBytesFs).not.toHaveBeenCalled();

    // 旧迁移（migrateAssetsToFilesystem）已删：init 完全不做资产预加载/迁移，
    // 资产由 AssetServer 直接读 Filesystem 文件（含小记 quick-notes/）。
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listAssetKeysFs).not.toHaveBeenCalled();
    expect(loadAssetBytesFs).not.toHaveBeenCalled();
  });

  it("concurrent startup calls initialize the native database once", async () => {
    vi.resetModules();
    const { migrateSnapshotToNativeSqlite } = await import("./native/nativeSqliteMigration");
    const { bridge: freshBridge } = await import("./bridge.js");
    vi.mocked(migrateSnapshotToNativeSqlite).mockClear();

    await Promise.all([
      freshBridge.init(),
      freshBridge.init(),
      freshBridge.listNotes(),
    ]);

    expect(migrateSnapshotToNativeSqlite).toHaveBeenCalledTimes(1);
  });

  it("SQLite migration marker skips the old snapshot probe on steady-state startup", async () => {
    const values = new Map<string, string>([["lake-notes-mobile.native-sqlite-migration.v1", "1"]]);
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => { values.set(key, value); },
    } as Storage;
    vi.resetModules();
    const { migrateSnapshotToNativeSqlite } = await import("./native/nativeSqliteMigration");
    const { bridge: freshBridge } = await import("./bridge.js");
    vi.mocked(migrateSnapshotToNativeSqlite).mockClear();

    await freshBridge.init();

    expect(migrateSnapshotToNativeSqlite).not.toHaveBeenCalled();
  });
});
