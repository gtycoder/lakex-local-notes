/**
 * 正文读写（文档 / 小记 / 历史快照 / 草稿）—— 移动端唯一入口。
 *
 * 路径规则来自 core 单一来源（src/core/noteBodyPaths.ts）；物理落盘由 native BodyStore 完成。
 * 这里只做「kind/id → 路径 → 读写」的薄封装，不解析正文内容。
 */
import {
  draftJournalRelativePath,
  noteBodyCandidatePaths,
  noteBodyRelativePath,
  quickNoteBodyRelativePath,
} from "../../core/noteBodyPaths.js";
import type { NoteKind } from "../../core/noteKind.js";
import { getBodyStore } from "../native/bodyStore";

/** 文档正文相对路径（getNoteInfo 展示 / 诊断用）。 */
export function noteBodyPath(kind: NoteKind, id: string): string {
  return noteBodyRelativePath(kind, id);
}

export async function readNoteBody(kind: NoteKind, id: string): Promise<string | null> {
  return getBodyStore().readText(noteBodyRelativePath(kind, id));
}

export async function writeNoteBody(kind: NoteKind, id: string, content: string): Promise<number> {
  return getBodyStore().writeText(noteBodyRelativePath(kind, id), content);
}

/** 批量写正文（261026 首拉提速）：原生平台一次桥调用写完一批，非原生逐篇写。返回总字节数。 */
export async function writeNoteBodiesBatch(
  items: Array<{ kind: NoteKind; id: string; content: string }>,
  opts?: { durable?: boolean },
): Promise<number> {
  if (items.length === 0) return 0;
  const store = getBodyStore();
  if (store.writeTextMany) {
    return await store.writeTextMany(items.map((i) => ({ path: noteBodyRelativePath(i.kind, i.id), text: i.content })), opts);
  }
  let bytes = 0;
  for (const i of items) bytes += await store.writeText(noteBodyRelativePath(i.kind, i.id), i.content);
  return bytes;
}

/** 批量读正文（261026 续传提速）：原生平台一次桥读一批；非原生逐篇读。 */
export async function readNoteBodiesBatch(items: Array<{ kind: NoteKind; id: string }>): Promise<Array<string | null>> {
  if (items.length === 0) return [];
  const store = getBodyStore();
  const paths = items.map((i) => noteBodyRelativePath(i.kind, i.id));
  if (store.readTextMany) return await store.readTextMany(paths);
  return await Promise.all(paths.map((p) => store.readText(p)));
}

/** 批量 stat 小记正文（261026 续传提速）。 */
export async function statQuickNoteBodiesBatch(ids: string[]): Promise<Array<{ exists: boolean; size: number }>> {
  if (ids.length === 0) return [];
  const store = getBodyStore();
  const paths = ids.map((id) => quickNoteBodyRelativePath(id));
  if (store.statTextMany) return await store.statTextMany(paths);
  return await Promise.all(paths.map((p) => store.stat(p)));
}

/** 批量 stat 正文（261026 续传提速）：hash 一致时只 stat，不读内容；非原生逐篇 stat。 */
export async function statNoteBodiesBatch(items: Array<{ kind: NoteKind; id: string }>): Promise<Array<{ exists: boolean; size: number }>> {
  if (items.length === 0) return [];
  const store = getBodyStore();
  const paths = items.map((i) => noteBodyRelativePath(i.kind, i.id));
  if (store.statTextMany) return await store.statTextMany(paths);
  return await Promise.all(paths.map((p) => store.stat(p)));
}

// ---- 同步下载 staging（261027）----
// 远端正文先把写到 staging/<id>.body（此时还不知道 doc_kind），saveState 时再原子 rename 到
// notes/<id>.lake / usheets/... 等最终路径。避免 JS 里攒 2k 篇正文导致真机 OOM。

export function stagingBodyPath(id: string): string { return "staging/" + id + ".body"; }

export async function writeBodyStaging(id: string, content: string): Promise<number> {
  return getBodyStore().writeText(stagingBodyPath(id), content);
}

export async function readBodyStaging(id: string): Promise<Uint8Array | null> {
  const text = await getBodyStore().readText(stagingBodyPath(id));
  return text == null ? null : new TextEncoder().encode(text);
}

export async function readBodyStagingMany(ids: string[]): Promise<Array<Uint8Array | null>> {
  const store = getBodyStore();
  const texts = store.readTextMany
    ? await store.readTextMany(ids.map((id) => stagingBodyPath(id)))
    : await Promise.all(ids.map((id) => store.readText(stagingBodyPath(id))));
  return texts.map((text) => (text == null ? null : new TextEncoder().encode(text)));
}

export async function statBodyStagingMany(ids: string[]): Promise<Array<{ exists: boolean; size: number }>> {
  const store = getBodyStore();
  return store.statTextMany
    ? await store.statTextMany(ids.map((id) => stagingBodyPath(id)))
    : await Promise.all(ids.map((id) => store.stat(stagingBodyPath(id))));
}

export async function removeBodyStaging(id: string): Promise<void> {
  await getBodyStore().remove(stagingBodyPath(id));
}

/** 把 staging 正文原子 rename 到最终路径（有原生 moveMany 时一次桥；否则读-写-删回退）。 */
export async function moveStagedBodyFiles(items: Array<{ kind: NoteKind; id: string }>): Promise<void> {
  if (items.length === 0) return;
  const store = getBodyStore();
  const pairs = items.map((i) => ({ from: stagingBodyPath(i.id), to: noteBodyRelativePath(i.kind, i.id) }));
  if (store.moveTextMany) {
    const moved = await store.moveTextMany(pairs);
    if (moved !== pairs.length) throw new Error("staging 正文移动不完整: " + moved + "/" + pairs.length);
    return;
  }
  for (const pair of pairs) {
    const text = await store.readText(pair.from);
    if (text == null) throw new Error("staging 正文缺失: " + pair.from);
    await store.writeText(pair.to, text);
    await store.remove(pair.from);
  }
}

/** 清理 staging 残留（崩溃后、或上一轮中断留下的；幂等）。 */
export async function clearStagingBodies(): Promise<void> {
  const store = getBodyStore();
  if (store.clearStaging) await store.clearStaging();
}

/** 删除同一 id 的全部候选正文（彻底删除 / kind 变更后残留；不存在静默）。 */
export async function deleteNoteBodies(id: string): Promise<void> {
  const store = getBodyStore();
  for (const relative of noteBodyCandidatePaths(id)) {
    await store.remove(relative);
  }
}

// ---- 小记 ----

export async function readQuickNoteBody(id: string): Promise<string | null> {
  return getBodyStore().readText(quickNoteBodyRelativePath(id));
}

export async function writeQuickNoteBody(id: string, serialized: string): Promise<number> {
  return getBodyStore().writeText(quickNoteBodyRelativePath(id), serialized);
}

export async function deleteQuickNoteBody(id: string): Promise<void> {
  await getBodyStore().remove(quickNoteBodyRelativePath(id));
}

// ---- 历史快照（gzip 文件；文件名由 historyRepository 生成） ----

export async function readHistorySnapshot(filePath: string): Promise<string | null> {
  return getBodyStore().readSnapshot(filePath);
}

export async function writeHistorySnapshot(filePath: string, content: string): Promise<number> {
  return getBodyStore().writeSnapshot(filePath, content);
}

export async function deleteHistorySnapshot(filePath: string): Promise<void> {
  await getBodyStore().remove(filePath);
}

// ---- 草稿日志（与桌面 draft-journal 同构） ----

export async function readDraftJournal(id: string): Promise<string | null> {
  return getBodyStore().readText(draftJournalRelativePath(id));
}

export async function writeDraftJournal(id: string, json: string): Promise<void> {
  await getBodyStore().writeText(draftJournalRelativePath(id), json);
}

export async function deleteDraftJournal(id: string): Promise<void> {
  await getBodyStore().remove(draftJournalRelativePath(id));
}
