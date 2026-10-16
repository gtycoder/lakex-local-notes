import path from "node:path";
import crypto from "node:crypto";
import { describe, it, vi } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyQuickNotesSyncSchema, createQuickNotesSyncDbPort } from "./quickNotesDbPort.js";
import {
  contractQuickNoteContent,
  runQuickNotesConflictContract,
  runQuickNotesRemoteImportRollbackContract,
  runQuickNotesRoundTripContract,
  type QuickNotesContractDevice,
} from "../../testing/quickNotesSyncContract.js";
import { previewQuickNote } from "../../core/quickNoteModel.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import type { QuickNotesAssetFsDeps } from "./quickNotesDbPort.js";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

function makeAssetDeps(): QuickNotesAssetFsDeps & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const deps: QuickNotesAssetFsDeps = {
    assetBytes: new Map(),
    saveAssetFile: async (key, bytes) => {
      files.set(key, bytes);
    },
    loadAssetFile: async (key) => files.get(key) ?? null,
    removeAssetFile: async (key) => {
      files.delete(key);
    },
  };
  return { ...deps, files };
}

async function makeDevice(): Promise<QuickNotesContractDevice> {
  const db = await SqlJsDb.open();
  db.exec(`CREATE TABLE quick_notes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    image_count INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'local',
    is_conflict INTEGER NOT NULL DEFAULT 0,
    restore_pending_at TEXT
  )`);
  const mobileDb = new SqlJsAsyncDb(db);
  await applyQuickNotesSyncSchema(mobileDb);
  const assets = makeAssetDeps();

  const insert = (id: string, text: string) => {
    const now = new Date().toISOString();
    const content = contractQuickNoteContent(text);
    const contentHash = sha256Sync(new TextEncoder().encode(content));
    db.prepare(
      `INSERT INTO quick_notes (
        id, created_at, updated_at, preview_text, image_count,
        content_hash, content, sync_state, is_conflict
      ) VALUES (?,?,?,?,?,?,?,'local',0)`,
    ).run(id, now, now, previewQuickNote(text, 0), 0, contentHash, content);
    return { id, contentHash };
  };

  return {
    port: createQuickNotesSyncDbPort(mobileDb, assets),
    create(text) {
      return insert(crypto.randomUUID(), text);
    },
    edit(id, text) {
      const now = new Date().toISOString();
      const content = contractQuickNoteContent(text);
      const contentHash = sha256Sync(new TextEncoder().encode(content));
      db.prepare(
        `UPDATE quick_notes SET updated_at=?, preview_text=?, content_hash=?, content=?, sync_state='local'
         WHERE id=?`,
      ).run(now, previewQuickNote(text, 0), contentHash, content, id);
    },
    text(id) {
      const row = db.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as
        | { content: string }
        | undefined;
      if (!row) return null;
      return (JSON.parse(row.content) as { text: string }).text;
    },
    activeIds() {
      return (
        db.prepare("SELECT id FROM quick_notes WHERE deleted_at IS NULL").all() as Array<{
          id: string;
        }>
      ).map((row) => row.id);
    },
    deletedIds() {
      return (
        db.prepare("SELECT id FROM quick_notes WHERE deleted_at IS NOT NULL").all() as Array<{
          id: string;
        }>
      ).map((row) => row.id);
    },
    restore(id) {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, sync_state='local', updated_at=?
         WHERE id=?`,
      ).run(now, now, id);
    },
  };
}

describe("mobile quick-notes sync contract", () => {
  it("keeps create, tombstone, and restore semantics aligned", async () => {
    await runQuickNotesRoundTripContract(await makeDevice(), await makeDevice());
  });

  it("archives the losing local version on conflict", async () => {
    await runQuickNotesConflictContract(await makeDevice(), await makeDevice());
  });

  it("rolls back a remote import when an image is missing", async () => {
    await runQuickNotesRemoteImportRollbackContract(await makeDevice());
  });
});
