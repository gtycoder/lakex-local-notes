import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DraftJournal } from "./draftJournal";

describe("DraftJournal", () => {
  it("writes, lists, sorts and removes crash recovery drafts atomically", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-draft-journal-"));
    const journal = new DraftJournal(root);
    journal.write({ noteId: "note-a", title: "A", content: "draft", updatedAt: "2026-08-20T10:00:00Z" });
    journal.write({ noteId: "note-b", title: "B", content: "newer", updatedAt: "2026-08-20T11:00:00Z" });
    expect(journal.list().map((entry) => entry.noteId)).toEqual(["note-b", "note-a"]);
    journal.remove("note-b");
    expect(journal.list().map((entry) => entry.noteId)).toEqual(["note-a"]);
  });
});
