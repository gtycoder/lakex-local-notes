/**
 * 手写板性能护栏（P5）：把「随文档变大而线性恶化」的两条热路径钉住，防回退。
 *
 * 证据（261103 评审实测，Node 24 / mac arm64）：
 *  · 整页轮廓重算（perfect-freehand）：500 笔/页 ≈ 16.4ms、1000 笔 ≈ 36.5ms、2000 笔 ≈ 63.7ms；
 *  · 整篇序列化：300 页 × 10 笔/页（≈10.9 MiB）≈ 26.7ms。
 * 修法：笔迹 id → path 缓存（只算新笔画）、序列化移出热路径（只在保存/capture 时发生）。
 * 阈值按实测留余量（取 3 次最小值，避免并行跑测时的偶发抖动把门禁打红）。
 */
import { describe, expect, it } from "vitest";
import { inkToBody, type InkDoc, type InkPage } from "../../core/inkDoc.js";
import { createStrokePathCache, renderedStrokesForPage } from "./inkRenderCache.js";

function makeStroke(id: string, points: number, seed = 0) {
  const list = [];
  for (let index = 0; index < points; index += 1) {
    list.push({
      x: 120 + (index % 60) * 8 + Math.random(),
      y: 160 + Math.sin((index + seed) / 7) * 40,
      pressure: 0.5,
    });
  }
  return { id, tool: "pen" as const, color: "#262626", width: 2.5, points: list };
}

function makePage(id: string, strokeCount: number, points = 30): InkPage {
  const strokes = [];
  for (let index = 0; index < strokeCount; index += 1) strokes.push(makeStroke(id + "-s" + index, points, index));
  return { id, width: 794, height: 1123, background: "grid", strokes };
}

function makeDoc(pageCount: number, strokesPerPage: number): InkDoc {
  const pages: InkPage[] = [];
  for (let index = 0; index < pageCount; index += 1) pages.push(makePage("page-" + index, strokesPerPage));
  return { kind: "ink", version: 2, pages, activePageId: "page-0" } as InkDoc;
}

/** 取 3 次里的最小值（最接近真实热路径成本；并行测试的偶发抢占会被最小值过滤掉）。 */
function bestOf(runs: number, action: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    action();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("手写板热路径性能护栏（P5）", () => {
  it("500 笔页上新增一条笔迹 < 5ms（只算新笔画，不重算整页轮廓）", () => {
    const page = makePage("page-1", 500);
    const cache = createStrokePathCache();
    renderedStrokesForPage(page, cache); // 预热：首屏全量轮廓
    const next: InkPage = { ...page, strokes: [...page.strokes, makeStroke("new-stroke", 60, 999)] };
    const elapsed = bestOf(3, () => {
      const rendered = renderedStrokesForPage(next, cache);
      expect(rendered.length).toBe(501);
    });
    expect(elapsed).toBeLessThan(5);
  });

  it("300 页正文整篇序列化 < 35ms（保存路径可以付这个成本，热路径不能）", () => {
    // 夹具 = 300 页 × 10 笔 × 30 点（≈5.5 MiB；真实 PDF 批注的短笔画量级）。
    // 实测参考（261103，本机）：同一形状 60 点/笔（10.9 MiB）在 vitest 环境 39.6ms、裸 Node 26.7ms ——
    // 35ms 阈值按 30 点夹具留余量；门禁要抓的是「有人把序列化重新塞回每条笔迹的热路径」。
    const doc = makeDoc(300, 10);
    const size = inkToBody(doc).length;
    const elapsed = bestOf(5, () => { inkToBody(doc); });
    console.log("[inkPerf] 300 页正文 " + (size / 1024 / 1024).toFixed(2) + " MiB，序列化 " + elapsed.toFixed(1) + "ms");
    expect(elapsed).toBeLessThan(35);
  });

  it("页切换会重建当前页轮廓（缓存按页隔离，不会跨页串用）", () => {
    const first = makePage("page-1", 3);
    const second = makePage("page-2", 2);
    const cache = createStrokePathCache();
    expect(renderedStrokesForPage(first, cache)).toHaveLength(3);
    expect(renderedStrokesForPage(second, cache)).toHaveLength(2);
    expect(cache.pageId).toBe("page-2");
    expect(cache.paths.size).toBe(2);
  });
});
