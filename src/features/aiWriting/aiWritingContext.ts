/**
 * AI 写作 · 多文档上下文读取（注入式，纯逻辑可单测）。
 *
 * 读到什么：
 * - 文档（note）：优先 Markdown 缓存（readNoteCaches），没有再用正文派生纯文本；
 * - 小记（quick-note）：纯文本镜像（content.text）。
 * 读不到（被删 / 缺正文 / 权限）只跳过这一篇，不阻断本轮提问。
 */
import type { NoteKind } from "../../core/noteKind";
import { searchTextForKind } from "../../core/noteSearchText";
import type { AiWritingDocContext, AiWritingDocRef } from "../../core/aiWriting";

export interface AiWritingDocReader {
  readNoteCaches(id: string): Promise<{ markdown: string | null; plain: string | null }>;
  readNote(id: string): Promise<{ content: string; kind?: NoteKind | null }>;
  readQuickNote(id: string): Promise<{ content: { text: string } }>;
}

/** 单篇资料上限（与 core 的上下文预算相互独立：这里先防单篇异常长）。 */
const DOC_CHARS = 40_000;

function trimTo(text: string): string {
  const value = text.trim();
  if (value.length <= DOC_CHARS) return value;
  return value.slice(0, DOC_CHARS).trimEnd();
}

/** 按 ref 顺序读取资料正文；空内容 / 读取失败直接跳过（不抛错）。 */
export async function resolveAiWritingDocs(refs: readonly AiWritingDocRef[], reader: AiWritingDocReader): Promise<AiWritingDocContext[]> {
  const out: AiWritingDocContext[] = [];
  for (const ref of refs) {
    try {
      const text = ref.kind === "note" ? await readNoteText(ref.id, reader) : await readQuickNoteText(ref.id, reader);
      if (text) out.push({ title: ref.title, text });
    } catch {
      // 单篇失败（被删 / 缺正文）跳过：本轮资料少一篇，不影响提问。
    }
  }
  return out;
}

async function readNoteText(id: string, reader: AiWritingDocReader): Promise<string> {
  const caches = await reader.readNoteCaches(id);
  const cached = trimTo(caches.markdown || caches.plain || "");
  if (cached) return cached;
  const note = await reader.readNote(id);
  const plain = searchTextForKind(note.kind ?? "doc", note.content).plain ?? "";
  return trimTo(plain);
}

async function readQuickNoteText(id: string, reader: AiWritingDocReader): Promise<string> {
  const note = await reader.readQuickNote(id);
  return trimTo(note.content?.text ?? "");
}
