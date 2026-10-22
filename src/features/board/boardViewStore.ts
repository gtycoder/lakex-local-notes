/**
 * 画板视图位置（平移滚动量 + 缩放）的**本机记忆**（260926）。
 *
 * 用户口径：*"移动到一个位置之后就永久记忆，无论什么时候进来就都是这个位置"* —— 于是 260916
 * 「不记忆视口」的取舍被推翻，改成**记住**；但**不进正文、不进 S3**：
 * - 写正文 = pan/zoom 每次都保存 + 上传（260916 用户报过的坑），且视口会跨端串味
 *   （移动端查看器本来靠「没有视口就 fit 内容」避免打开一片空白）；
 * - 所以按 `docs/STORAGE-LAYERS.md` 的 **L3「纯本机 UI 状态」** 档次落在 localStorage
 *   （与 `local-lakex-notes-v3.sidebar-width` / `dialog-states` / `board-recent-shapes` 同档）。
 *
 * 实测（260926）这个 plait 版本的**平移 = 滚动画布容器**：手形工具拖拽只改
 * `.viewport-container` 的 `scrollLeft/scrollTop`，`board.viewport` 不变（所以内核的
 * `onViewportPersist` 对平移根本不触发，只有缩放会）。⇒ 位置记忆的主体是滚动量，两样都记：
 * - `scroll`：画布容器的滚动量（平移位置，宿主观测容器得到）；
 * - `viewport`：plait 的 `{x,y,zoom}`（缩放等，走内核被动回调）。
 */
import type { BoardViewport } from "../../core/boardDoc.js";

export interface BoardViewScroll {
  left: number;
  top: number;
}

export interface BoardView {
  viewport: BoardViewport | null;
  scroll: BoardViewScroll | null;
}

const KEY = "local-lakex-notes-v3.board-views";
/** 上限纯属兜底（正常远小于标签上限），避免长开窗口无界增长；超出按最近使用淘汰。 */
const LIMIT = 200;

interface StoredBoardView {
  viewport?: BoardViewport;
  scroll?: BoardViewScroll;
  /** 最近一次写入时间：仅用于 LRU 淘汰。 */
  at: number;
}

type StoredMap = Record<string, StoredBoardView>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // 隐私模式/被禁用时忽略：视图位置记不住而已，不影响画板本身
    return null;
  }
}

function readAll(): StoredMap {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(map));
  } catch {
    // 配额/被禁用：忽略（位置记不住不是功能故障）
  }
}

/**
 * 取某文档记下的视图（没有 = null，由调用方回落到正文里的视口 / 默认视口）。
 * 同步读取：宿主要在**首帧之前**拿它决定初始视口与滚动位置（否则会"先默认再跳"）。
 */
export function readBoardView(noteId: string): BoardView | null {
  const found = readAll()[noteId];
  if (!found) return null;
  return {
    viewport: found.viewport ? { ...found.viewport } : null,
    scroll: found.scroll ? { ...found.scroll } : null,
  };
}

/** 记下某文档的视图（按字段合并：平移只更新 scroll，缩放只更新 viewport）。 */
export function writeBoardView(noteId: string, patch: Partial<BoardView>): void {
  const all = readAll();
  const prev = all[noteId];
  const viewport = patch.viewport === undefined
    ? prev?.viewport
    : patch.viewport === null
      ? undefined
      : { x: patch.viewport.x, y: patch.viewport.y, zoom: patch.viewport.zoom };
  const scroll = patch.scroll === undefined
    ? prev?.scroll
    : patch.scroll === null
      ? undefined
      : { left: patch.scroll.left, top: patch.scroll.top };
  const next: StoredBoardView = { at: Date.now() };
  if (viewport) next.viewport = viewport;
  if (scroll) next.scroll = scroll;
  all[noteId] = next;
  const keys = Object.keys(all);
  if (keys.length > LIMIT) {
    keys
      .sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0))
      .slice(0, keys.length - LIMIT)
      .forEach((stale) => { delete all[stale]; });
  }
  writeAll(all);
}

/** 仅测试用：清空本机记忆。 */
export function resetBoardViews(): void {
  storage()?.removeItem(KEY);
}
