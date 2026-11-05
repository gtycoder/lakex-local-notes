/**
 * 文档标签只读读模型（261105 P1）：noteId → tagIds（本机 tag_links position 顺序）。
 *
 * 为什么**不做成 bridge 方法**：bridge 是 `window.lakeNative` 契约面，每个方法都要在
 * core/maintenancePolicy 登记互斥域（护栏 maintenancePolicyCoverage / contractSurface）。
 * 这里只是移动端 UI 的只读取数（不取锁、不出网、不写库），用独立模块避免扩大窗口契约；
 * 与 native/cachePort 同口径（移动端内部数据入口，不是跨端契约）。
 *
 * 名称解析由调用方用 bridge.listQuickNoteTags()（目录单一来源）完成；
 * 目录里没有的 id 由展示层过滤并提示。
 */
import { ensureDb } from "./context";
import { listNoteTagIdsForNotes } from "../data/noteTagLinksRepository";

/** 一次最多 2000 篇：避免把整个 2 万文档库塞进一次桥往返（超出由调用方分批）。 */
const MAX_NOTES = 2000;

export async function loadNoteTagIdsForNotes(noteIds: readonly string[]): Promise<Record<string, string[]>> {
  const ids = Array.isArray(noteIds)
    ? [...new Set(noteIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, MAX_NOTES)
    : [];
  if (ids.length === 0) return {};
  const d = await ensureDb();
  const map = await listNoteTagIdsForNotes(d, ids);
  return Object.fromEntries(map);
}
