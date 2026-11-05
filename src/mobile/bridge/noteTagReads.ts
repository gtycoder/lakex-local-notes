/**
 * 文档标签只读读模型（261105 P1；P2-D 修）：noteId → tagIds（本机 tag_links position 顺序）。
 *
 * 为什么**不做成 bridge 方法**：bridge 是 `window.lakeNative` 契约面，每个方法都要在
 * core/maintenancePolicy 登记互斥域（护栏 maintenancePolicyCoverage / contractSurface）。
 * 这里只是移动端 UI 的只读取数（不取锁、不出网、不写库），用独立模块避免扩大窗口契约；
 * 与 native/cachePort 同口径（移动端内部数据入口，不是跨端契约）。
 *
 * 分批：单批 2000 篇（别把 2 万条塞进一次桥往返），**读全优先**；只有超过全库量级上限
 * （NOTE_TAG_READ_MAX）才截断，并通过 truncated 让调用方给可见提示（不再静默丢标签）。
 *
 * 名称解析由调用方用 bridge.listQuickNoteTags()（目录单一来源）完成；
 * 目录里没有的 id 由展示层过滤并提示。
 */
import { ensureDb } from "./context";
import { listNoteTagIdsForNotes } from "../data/noteTagLinksRepository";

/** 单次读批大小：限制单条 SQL 的变量数与桥报文体积（repo 内部还会再按 400 批）。 */
export const NOTE_TAG_READ_BATCH = 2000;
/** 单次读取的硬上限（全库量级）：超过才截断并提示（2 万文档 = 目标量级）。 */
export const NOTE_TAG_READ_MAX = 20_000;

export interface NoteTagReadResult {
  /** noteId → tagIds（本机顺序）。 */
  byNoteId: Record<string, string[]>;
  /** true = 请求篇数超过 NOTE_TAG_READ_MAX，只读了前 MAX 篇（调用方必须提示）。 */
  truncated: boolean;
  /** 去重后的请求篇数 / 实际读取篇数（诊断与提示文案用）。 */
  requested: number;
  loaded: number;
}

export async function loadNoteTagIdsForNotes(noteIds: readonly string[]): Promise<NoteTagReadResult> {
  const unique = Array.isArray(noteIds)
    ? [...new Set(noteIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const requested = unique.length;
  if (requested === 0) return { byNoteId: {}, truncated: false, requested: 0, loaded: 0 };
  const capped = unique.slice(0, NOTE_TAG_READ_MAX);
  const d = await ensureDb();
  const byNoteId: Record<string, string[]> = {};
  for (let i = 0; i < capped.length; i += NOTE_TAG_READ_BATCH) {
    const part = capped.slice(i, i + NOTE_TAG_READ_BATCH);
    const map = await listNoteTagIdsForNotes(d, part);
    for (const [noteId, tagIds] of map) byNoteId[noteId] = tagIds;
  }
  return { byNoteId, truncated: capped.length < requested, requested, loaded: capped.length };
}
