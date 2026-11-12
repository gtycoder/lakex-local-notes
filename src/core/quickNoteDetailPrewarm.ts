/**
 * 小记列表「首屏正文预热」判据（261112）。
 *
 * 为什么需要：列表投影（DT-05）**不带正文**，卡片首帧只能画 `previewText` 纯文本，
 * 而正文是按 id + IntersectionObserver 懒读的 —— 观察者回调**必然晚于首帧**，
 * 于是用户看到「先无标题/加粗的浅色文字，下一帧才变成富预览」的闪屏（261112 用户报
 * 「小记第一打开会有一个闪屏，第一帧颜色很浅、没渲染标题和加粗」）。
 *
 * 修法：把**首屏条数内**的正文在 `setItems` 之前并发读回（与卡片 onNeedDetail 共用同一个
 * detailCache），首帧即富预览。上限刻意取小（屏幕实际能放下的卡片数），避免把
 * 大正文（实测有 660KB／条的小记）一次性搬进 IPC。
 *
 * 单一来源 = 本文件；`QuickNotesWorkspace` 只调用 `quickNotePrewarmIds()`。
 */

/** 首屏预热条数上限：按「一屏能看到的卡片数」取，不是虚拟窗口阈值（24）。 */
export const QUICK_NOTE_DETAIL_PREWARM_LIMIT = 8;

export interface QuickNotePrewarmCandidate {
  id: string;
  contentHash: string;
}

/**
 * 需要预热的 id（保序、去重、限条数）：
 * - 已有缓存且 `contentHash` 相同 ⇒ 跳过（同步/他端改动后 hash 会变 ⇒ 自然重新预热）；
 * - 只取前 `limit` 条（首屏）。
 */
export function quickNotePrewarmIds(
  items: readonly QuickNotePrewarmCandidate[],
  cachedHashes: ReadonlyMap<string, string>,
  limit: number = QUICK_NOTE_DETAIL_PREWARM_LIMIT,
): string[] {
  if (limit <= 0) return [];
  const ids: string[] = [];
  for (const item of items) {
    if (ids.length >= limit) break;
    if (cachedHashes.get(item.id) === item.contentHash) continue;
    ids.push(item.id);
  }
  return ids;
}
