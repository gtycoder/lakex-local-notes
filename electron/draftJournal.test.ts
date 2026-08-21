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

  it("rejects unsafe payloads and ignores malformed journal files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-draft-journal-invalid-"));
    const journal = new DraftJournal(root);
    expect(() => journal.write({ noteId: "../escape", title: "x", content: "x", updatedAt: "2026-08-20T10:00:00Z" })).toThrow();
    expect(() => journal.write({ noteId: "note-a", title: "x".repeat(501), content: "x", updatedAt: "2026-08-20T10:00:00Z" })).toThrow();
    expect(() => journal.write({ noteId: "note-a", title: "x", content: "x", updatedAt: "not-a-date" })).toThrow();
    fs.writeFileSync(path.join(root, "broken.json"), JSON.stringify({ noteId: "broken", title: 42, content: "x", updatedAt: "not-a-date" }));
    expect(journal.list()).toEqual([]);
  });
});
