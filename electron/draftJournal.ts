import fs from "node:fs";
import path from "node:path";
import { isSafePathSegment } from "../src/core/storeUtils.js";

const MAX_DRAFT_BYTES = 32 * 1024 * 1024;

export interface DraftJournalEntry {
  noteId: string;
  title: string;
  content: string;
  updatedAt: string;
}

function isValidUpdatedAt(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

export function isValidDraftJournalEntry(value: unknown): value is DraftJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<DraftJournalEntry>;
  if (typeof entry.noteId !== "string" || typeof entry.title !== "string" || typeof entry.content !== "string") return false;
  return isSafePathSegment(entry.noteId)
    && typeof entry.title === "string"
    && entry.title.length <= 500
    && typeof entry.content === "string"
    && Buffer.byteLength(entry.content, "utf8") <= MAX_DRAFT_BYTES
    && isValidUpdatedAt(entry.updatedAt);
}

/** 草稿日志目录（workspace root 下固定子目录）。main.ts 装配与 Store 的「资源保护集」查询共用此口径。 */
export function draftJournalDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "draft-journal");
}

/** 只读读取某文档草稿（不存在/损坏/非法 ID → null）；不建目录、不写盘。
 * 用途：把「未保存编辑」引用的资源纳入保护集——粘贴图片会立即落盘并登记孤儿，正文要等防抖保存
 * 才引用它，这段窗口里崩溃/保存失败后重启，历史清理会把草稿里的图物理删掉（审计 260918 D3/F6）。 */
export function readDraftEntry(journalDir: string, noteId: string): DraftJournalEntry | null {
  if (!isSafePathSegment(noteId)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(journalDir, `${noteId}.json`), "utf8"));
    return isValidDraftJournalEntry(parsed) ? parsed : null;
  } catch { return null; }
}

export class DraftJournal {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  write(entry: DraftJournalEntry): void {
    if (!isSafePathSegment(entry.noteId)) throw new Error("草稿文档 ID 无效");
    if (typeof entry.title !== "string" || entry.title.length > 500) throw new Error("草稿标题无效");
    if (typeof entry.content !== "string" || Buffer.byteLength(entry.content, "utf8") > MAX_DRAFT_BYTES) throw new Error("草稿超过 32 MiB");
    if (!isValidUpdatedAt(entry.updatedAt)) throw new Error("草稿时间无效");
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
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.root, name), "utf8"));
        if (isValidDraftJournalEntry(parsed)) entries.push(parsed);
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
