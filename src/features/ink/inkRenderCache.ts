/**
 * 手写板静态笔迹层：**笔迹 id → SVG 轮廓路径**缓存（P5）。
 *
 * 为什么需要：`renderedStrokes` 原来在 `page` 引用变化时（= 每落一笔 / 每擦一条 / 每次撤回）
 * 对**整页每条笔迹**重算 perfect-freehand 轮廓。实测 500 笔/页 ≈ 16.4ms、2000 笔 ≈ 63.7ms，
 * 密集批注页上每落一笔掉 1~4 帧。
 *
 * 为什么按 id 缓存是安全的：一条笔迹的采样点**提交后不再变化**（橡皮整条删除、撤回按页快照恢复、
 * 笔迹 id 永不复用），所以同一 id 的轮廓路径恒定；页切换时清空缓存（不同页的 id 空间不共享，
 * 也顺便把内存限制在「当前页笔迹数 × 单条路径」）。
 */
import type { InkPage } from "../../core/inkDoc.js";
import { strokeToSvgPath } from "./inkGeometry.js";

export interface RenderedStrokePath {
  id: string;
  d: string;
  color: string;
  highlighter: boolean;
}

export interface StrokePathCache {
  /** 缓存所属页 id；换页即整体清空（渲染成本只付一次页切换）。 */
  pageId: string | null;
  paths: Map<string, RenderedStrokePath>;
}

export function createStrokePathCache(): StrokePathCache {
  return { pageId: null, paths: new Map() };
}

/**
 * 当前页的静态笔迹路径（按 id 命中缓存，只对新笔迹跑 perfect-freehand）。
 * 同时按当前页的 id 集合裁剪缓存，防止长文档/反复撤回把缓存撑大。
 */
export function renderedStrokesForPage(page: InkPage, state: StrokePathCache): RenderedStrokePath[] {
  if (state.pageId !== page.id) {
    state.pageId = page.id;
    state.paths.clear();
  }
  const out: RenderedStrokePath[] = new Array(page.strokes.length);
  const live = new Set<string>();
  for (let index = 0; index < page.strokes.length; index += 1) {
    const stroke = page.strokes[index];
    live.add(stroke.id);
    let path = state.paths.get(stroke.id);
    if (!path) {
      path = {
        id: stroke.id,
        d: strokeToSvgPath(stroke, true),
        color: stroke.color,
        highlighter: stroke.tool === "highlighter",
      };
      state.paths.set(stroke.id, path);
    }
    out[index] = path;
  }
  if (state.paths.size > live.size) {
    for (const id of state.paths.keys()) if (!live.has(id)) state.paths.delete(id);
  }
  return out;
}
