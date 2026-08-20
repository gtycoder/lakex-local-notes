import fs from "node:fs";
import path from "node:path";
import { isSafePathSegment } from "./storeUtils.js";

const MAX_DRAFT_BYTES = 32 * 1024 * 1024;

export interface DraftJournalEntry {
  noteId: string;
  title: string;
  content: string;
  updatedAt: string;
}

export class DraftJournal {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  write(entry: DraftJournalEntry): void {
    if (!isSafePathSegment(entry.noteId)) throw new Error("草稿文档 ID 无效");
    if (typeof entry.title !== "string" || entry.title.length > 500) throw new Error("草稿标题无效");
    if (Buffer.byteLength(entry.content, "utf8") > MAX_DRAFT_BYTES) throw new Error("草稿超过 32 MiB");
    const file = this.filePath(entry.noteId);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entry), "utf8");
    fs.renameSync(temp, file);
  }

  list(): DraftJournalEntry[] {
    let names: string[] = [];
    try { names = fs.readdirSync(this.root).filter((name) => name.endsWith(".json")); } catch { return []; }
    const entries: DraftJournalEntry[] = [];
    for (const name of names) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(this.root, name), "utf8")) as DraftJournalEntry;
        if (isSafePathSegment(parsed.noteId) && typeof parsed.content === "string" && typeof parsed.updatedAt === "string") entries.push(parsed);
      } catch { /* 损坏草稿不阻塞启动 */ }
    }
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  remove(noteId: string): void {
    if (!isSafePathSegment(noteId)) return;
    try { fs.rmSync(this.filePath(noteId), { force: true }); } catch { /* best effort */ }
  }

  private filePath(noteId: string): string {
    return path.join(this.root, `${noteId}.json`);
  }
}
