import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "vitest";
import { QuickNotesStore } from "./quickNotes.js";
import { createQuickNotesSyncPort } from "./quickNotesSync.js";
import {
  runQuickNotesConflictContract,
  runQuickNotesRemoteImportRollbackContract,
  runQuickNotesRoundTripContract,
  type QuickNotesContractDevice,
} from "../src/testing/quickNotesSyncContract.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-quick-contract-"));
});

function makeDevice(name: string): QuickNotesContractDevice {
  const store = new QuickNotesStore(path.join(root, name));
  return {
    port: createQuickNotesSyncPort(store),
    create(text) {
      const note = store.createQuickNote({
        text,
        draftId: crypto.randomUUID(),
        stagedImageIds: [],
      });
      return { id: note.id, contentHash: note.contentHash };
    },
    edit(id, text) {
      store.updateQuickNote(id, {
        text,
        draftId: crypto.randomUUID(),
        stagedImageIds: [],
        retainedImageIds: [],
      });
    },
    text(id) {
      try {
        return store.readQuickNote(id).content.text;
      } catch {
        return null;
      }
    },
    activeIds() {
      return store.listQuickNotes().map((note) => note.id);
    },
    deletedIds() {
      return store.listQuickNoteTrash().map((note) => note.id);
    },
    restore(id) {
      store.restoreQuickNote(id);
    },
  };
}

describe("desktop quick-notes sync contract", () => {
  it("keeps create, tombstone, and restore semantics aligned", async () => {
    await runQuickNotesRoundTripContract(makeDevice("author"), makeDevice("peer"));
  });

  it("archives the losing local version on conflict", async () => {
    await runQuickNotesConflictContract(makeDevice("author"), makeDevice("peer"));
  });

  it("rolls back a remote import when an image is missing", async () => {
    await runQuickNotesRemoteImportRollbackContract(makeDevice("single"));
  });
});
