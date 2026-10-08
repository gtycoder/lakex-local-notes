import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbLike } from "./dbLike.js";
import type { SyncNote } from "./noteQueries.js";
import { RemoteImportRepository } from "./remoteImportRepository.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeFailingDb(): DbLike {
  return {
    prepare: () => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() }),
    transaction: (() => {
      throw new Error("injected DB failure");
    }) as unknown as DbLike["transaction"],
    pragma: () => undefined,
    exec: () => undefined,
    close: () => undefined,
  };
}

function makeRepository(root: string): RemoteImportRepository {
  return new RemoteImportRepository({
    db: makeFailingDb(),
    workspaceId: "workspace",
    trashNotebookId: "notebook-trash",
    notePathFor: (noteId) => path.join(root, "notes", `${noteId}.lake`),
    bodyPathFor: (noteId, kind) => (kind === "usheet" ? path.join(root, "usheets", `${noteId}.usheet.json`) : path.join(root, "notes", `${noteId}.lake`)),
    assetDirFor: (noteId) => path.join(root, "note-assets", noteId),
    isSafeSegment: () => true,
    detectOrphans: () => undefined,
    ensureNoteCaches: () => true,
    logImport: () => undefined,
  });
}

function seedExistingFiles(root: string): { notePath: string; assetPath: string } {
  const notePath = path.join(root, "notes", "note.lake");
  const assetPath = path.join(root, "note-assets", "note", "asset.png");
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(notePath, "old lake");
  fs.writeFileSync(assetPath, "old asset");
  return { notePath, assetPath };
}

const note: SyncNote = {
  id: "note",
  title: "远程笔记",
  parentId: null,
  sortOrder: 0,
  updatedAt: "2026-09-09T00:00:00.000Z",
  isConflict: false,
};

describe("RemoteImportRepository rollback", () => {
  it("restores previous lake and asset files when the DB transaction fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-remote-import-"));
    tempRoots.push(root);
    const { notePath, assetPath } = seedExistingFiles(root);

    expect(() => makeRepository(root).importNote(
      note,
      Buffer.from("new lake"),
      [{ filename: "asset.png", bytes: Buffer.from("new asset") }],
    )).toThrow("injected DB failure");

    expect(fs.readFileSync(notePath, "utf8")).toBe("old lake");
    expect(fs.readFileSync(assetPath, "utf8")).toBe("old asset");
    expect(fs.readdirSync(path.dirname(notePath))).toEqual(["note.lake"]);
    expect(fs.readdirSync(path.join(root, "note-assets"))).toEqual(["note"]);
    expect(fs.readdirSync(path.dirname(assetPath))).toEqual(["asset.png"]);
  });

  it("keeps the backup and reports its path when asset rollback fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-remote-import-rollback-"));
    tempRoots.push(root);
    const { notePath, assetPath } = seedExistingFiles(root);
    const originalRename = fs.renameSync;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).includes(".backup-") && String(to) === assetPath) {
        throw new Error("injected rollback failure");
      }
      return originalRename(from, to);
    }) as typeof fs.renameSync);

    try {
      let error: unknown;
      try {
        makeRepository(root).importNote(
          note,
          Buffer.from("new lake"),
          [{ filename: "asset.png", bytes: Buffer.from("new asset") }],
        );
      } catch (reason) {
        error = reason;
      }

      const backupDir = fs.readdirSync(path.join(root, "note-assets"))
        .find((name) => name.startsWith("note.backup-"));
      expect(backupDir).toBeTruthy();
      const backupPath = path.join(root, "note-assets", backupDir!, "asset.png");
      expect((error as Error).message).toContain("远端导入回滚失败");
      expect((error as Error).message).toContain(backupPath);
      expect(fs.readFileSync(backupPath, "utf8")).toBe("old asset");
      expect(fs.existsSync(assetPath)).toBe(false);
      expect(fs.readFileSync(notePath, "utf8")).toBe("old lake");
    } finally {
      renameSpy.mockRestore();
    }
  });
});
