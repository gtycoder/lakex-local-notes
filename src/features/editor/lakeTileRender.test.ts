// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LakeEditorInstance } from "./lakeRuntime";
import { findRenderedNode, flushViewerTiles, scrollIntoViewByNodeId, setupViewerTocClickAssist } from "./lakeTileRender";

/**
 * 锁定态（Viewer）分帧渲染（tileRendering）配套（261111）。
 *
 * 这些行为没法在内核实例上单测（要真 Viewer），但**判断逻辑**必须钉住：
 * 收集期目标块没进 DOM 时要不要 flush、flush 什么时候停手、对齐用哪套几何、卸载会不会留监听。
 * 真机/隔离实例的走查结论见 docs/LAKEX-CONTRACT.md 与 HANDOFF。
 */

interface FakeTileController {
  tileRender: ReturnType<typeof vi.fn>;
  _currentTileIndex: number;
  _total: number;
  _tileSize: number;
}

function fakeViewer(params: { total: number; onRender?: (index: number) => void; advance?: boolean }): {
  editor: LakeEditorInstance;
  controller: FakeTileController;
} {
  const controller: FakeTileController = {
    tileRender: vi.fn(),
    _currentTileIndex: 0,
    _total: params.total,
    _tileSize: 30,
  };
  const advance = params.advance !== false;
  controller.tileRender.mockImplementation(() => {
    const index = controller._currentTileIndex;
    controller._currentTileIndex += advance ? 1 : 0;
    params.onRender?.(index);
  });
  const editor = { renderer: { _renderController: controller } } as unknown as LakeEditorInstance;
  return { editor, controller };
}

function fakeRect(top: number): () => DOMRect {
  return () => ({ top, bottom: top, left: 0, right: 0, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

describe("lakeTileRender — flushViewerTiles", () => {
  it("按 tileCount 把剩余分帧渲完，多一帧都不渲（260 块 = 9 帧）", () => {
    const { editor, controller } = fakeViewer({ total: 260 });
    expect(flushViewerTiles(editor)).toBe(true);
    expect(controller.tileRender).toHaveBeenCalledTimes(9);
    expect(controller._currentTileIndex).toBe(9);
  });

  it("已经铺完时一次都不调（幂等）", () => {
    const { editor, controller } = fakeViewer({ total: 60 });
    controller._currentTileIndex = 2;
    expect(flushViewerTiles(editor)).toBe(true);
    expect(controller.tileRender).not.toHaveBeenCalled();
  });

  it("拿不到控制权（编辑态 / direct / 私有字段改名）返回 false，不抛错", () => {
    expect(flushViewerTiles(null)).toBe(false);
    expect(flushViewerTiles({} as LakeEditorInstance)).toBe(false);
    expect(flushViewerTiles({ renderer: {} } as unknown as LakeEditorInstance)).toBe(false);
  });

  it("索引不推进（内核实现变化）时立刻停手，不把同一批块反复 init", () => {
    const { editor, controller } = fakeViewer({ total: 300, advance: false });
    expect(flushViewerTiles(editor)).toBe(false);
    expect(controller.tileRender).toHaveBeenCalledTimes(1);
  });

  it("tileRender 抛错时吞掉并返回 false（不能把大纲点击变成异常）", () => {
    const { editor, controller } = fakeViewer({ total: 300 });
    controller.tileRender.mockImplementation(() => {
      throw new Error("kernel boom");
    });
    expect(flushViewerTiles(editor)).toBe(false);
  });
});

describe("lakeTileRender — findRenderedNode", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("锁/解锁过渡期旧层（.is-outgoing）不算命中，只认当前挂载点", () => {
    const outgoing = document.createElement("div");
    outgoing.className = "lake-editor-mount is-outgoing";
    outgoing.innerHTML = '<h2 id="h1">旧层</h2>';
    const current = document.createElement("div");
    current.className = "lake-editor-mount";
    current.innerHTML = '<h2 id="h1">当前层</h2>';
    host.append(outgoing, current);
    expect(findRenderedNode(host, "h1")?.textContent).toBe("当前层");
  });

  it("锁/解锁过渡期旧层还没来得及打 is-outgoing 时，取最后 append 的新实例", () => {
    const oldLayer = document.createElement("div");
    oldLayer.className = "lake-editor-mount";
    oldLayer.innerHTML = '<h2 id="h1">上一态（编辑）</h2>';
    const newLayer = document.createElement("div");
    newLayer.className = "lake-editor-mount";
    newLayer.innerHTML = '<h2 id="h1">新实例（阅读）</h2>';
    host.append(oldLayer, newLayer);
    expect(findRenderedNode(host, "h1")?.textContent).toBe("新实例（阅读）");
  });

  it("只有旧层时返回 null（宁可等新实例，也不要按旧层几何滚）", () => {
    const outgoing = document.createElement("div");
    outgoing.className = "lake-editor-mount is-outgoing";
    outgoing.innerHTML = '<h2 id="h1">旧层</h2>';
    host.append(outgoing);
    expect(findRenderedNode(host, "h1")).toBeNull();
  });

  it("特殊字符 id 走 CSS.escape（不抛错）", () => {
    host.innerHTML = '<h2 id="a:b.c">x</h2>';
    expect(findRenderedNode(host, "a:b.c")?.textContent).toBe("x");
    expect(findRenderedNode(host, "")).toBeNull();
  });
});

describe("lakeTileRender — scrollIntoViewByNodeId", () => {
  let host: HTMLElement;
  let scroller: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.className = "lake-editor";
    document.body.appendChild(host);
    scroller = document.createElement("div");
    scroller.getBoundingClientRect = fakeRect(100) as unknown as () => DOMRect;
    host.appendChild(scroller);
    // jsdom 的 scrollTop 是普通可写属性
    scroller.scrollTop = 0;
  });

  afterEach(() => {
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("目标块已在 DOM：直接按几何对齐（顶部对齐滚动容器顶部）", () => {
    const el = document.createElement("h2");
    el.id = "h9";
    el.getBoundingClientRect = fakeRect(350) as unknown as () => DOMRect;
    scroller.appendChild(el);
    const cancel = scrollIntoViewByNodeId(host, scroller, "h9", null, { realignMs: 0 });
    expect(scroller.scrollTop).toBe(250);
    cancel();
  });

  it("收集期目标块还没进 DOM：先 flush 再对齐（不等帧）", () => {
    const { editor, controller } = fakeViewer({
      total: 300,
      onRender: (index) => {
        // 第 3 帧（第 90 块之后）才把目标标题挂进 DOM —— 模拟分帧渲染
        if (index === 2) {
          const el = document.createElement("h2");
          el.id = "hFar";
          el.getBoundingClientRect = fakeRect(900) as unknown as () => DOMRect;
          scroller.appendChild(el);
        }
      },
    });
    const cancel = scrollIntoViewByNodeId(host, scroller, "hFar", editor, { realignMs: 0 });
    expect(controller.tileRender).toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(800);
    cancel();
  });

  it("flush 不可用（非 tile 渲染）时逐帧等目标块出现，出现后对齐", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const cancel = scrollIntoViewByNodeId(host, scroller, "hLater", null, { realignMs: 0 });
    expect(frames.length).toBe(1);
    const el = document.createElement("h2");
    el.id = "hLater";
    el.getBoundingClientRect = fakeRect(400) as unknown as () => DOMRect;
    scroller.appendChild(el);
    const next = frames.shift();
    next?.(0);
    expect(scroller.scrollTop).toBe(300);
    cancel();
  });

  it("取消后不再继续等帧（卸载不留 rAF）", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const cancel = scrollIntoViewByNodeId(host, scroller, "hNever", null, { realignMs: 0 });
    cancel();
    const queued = frames.shift();
    queued?.(0);
    expect(frames.length).toBe(0);
  });

  it("对齐后补一次校正（卡片/图片落地会改版式）", () => {
    vi.useFakeTimers();
    const el = document.createElement("h2");
    el.id = "hDrift";
    el.getBoundingClientRect = fakeRect(200) as unknown as () => DOMRect;
    scroller.appendChild(el);
    const cancel = scrollIntoViewByNodeId(host, scroller, "hDrift", null, { realignMs: 140 });
    expect(scroller.scrollTop).toBe(100);
    // 版式变了：标题相对滚动容器下移 160（240-100+20…这里直接给绝对几何）
    el.getBoundingClientRect = fakeRect(260) as unknown as () => DOMRect;
    vi.advanceTimersByTime(140);
    // 对齐按「当前 scrollTop + (el.top - scroller.top)」增量累加：100 + (260 - 100)
    expect(scroller.scrollTop).toBe(260);
    cancel();
  });
});

describe("lakeTileRender — setupViewerTocClickAssist（原生大纲兜底）", () => {
  let host: HTMLElement;
  let scroller: HTMLElement;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    host = document.createElement("div");
    document.body.appendChild(host);
    scroller = document.createElement("div");
    scroller.getBoundingClientRect = fakeRect(0) as unknown as () => DOMRect;
    host.appendChild(scroller);
    scroller.scrollTop = 0;
  });

  afterEach(() => {
    host.remove();
    vi.unstubAllGlobals();
  });

  it("点阅读态大纲条目：延后一帧按 id 几何对齐（内核收集期找不到时由我们补）", () => {
    const sidebar = document.createElement("div");
    sidebar.className = "ne-viewer-toc-sidebar";
    const item = document.createElement("div");
    item.className = "ne-toc-item";
    item.dataset.id = "h5";
    const label = document.createElement("span");
    item.appendChild(label);
    sidebar.appendChild(item);
    host.appendChild(sidebar);
    const heading = document.createElement("h2");
    heading.id = "h5";
    heading.getBoundingClientRect = fakeRect(640) as unknown as () => DOMRect;
    scroller.appendChild(heading);

    const dispose = setupViewerTocClickAssist(host, null, () => scroller);
    label.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(frames.length).toBe(1);
    frames.shift()?.(0);
    expect(scroller.scrollTop).toBe(640);
    dispose();
  });

  it("点的是编辑态侧栏（.ne-toc-sidebar）/非条目：不接管", () => {
    const sidebar = document.createElement("div");
    sidebar.className = "ne-toc-sidebar";
    const item = document.createElement("div");
    item.className = "ne-toc-item";
    item.dataset.id = "h5";
    sidebar.appendChild(item);
    host.appendChild(sidebar);
    const dispose = setupViewerTocClickAssist(host, null, () => scroller);
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(frames.length).toBe(0);
    dispose();
  });

  it("分帧铺完（viewer ready）补发一次 scroll：让内核大纲 watcher 重算当前小节", () => {
    const listeners: Record<string, Array<() => void>> = {};
    const editor = {
      on: (event: string, fn: () => void) => {
        (listeners[event] ||= []).push(fn);
      },
      off: (event: string, fn: () => void) => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
      },
    } as unknown as LakeEditorInstance;
    let scrolls = 0;
    scroller.addEventListener("scroll", () => {
      scrolls += 1;
    });
    const dispose = setupViewerTocClickAssist(host, editor, () => scroller);
    expect(listeners.ready?.length).toBe(1);
    listeners.ready[0]();
    expect(scrolls).toBe(1);
    dispose();
    expect(listeners.ready?.length ?? 0).toBe(0);
  });

  it("清理后不再接管点击（卸载不留监听）", () => {
    const sidebar = document.createElement("div");
    sidebar.className = "ne-viewer-toc-sidebar";
    const item = document.createElement("div");
    item.className = "ne-toc-item";
    item.dataset.id = "h5";
    sidebar.appendChild(item);
    host.appendChild(sidebar);
    const dispose = setupViewerTocClickAssist(host, null, () => scroller);
    dispose();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(frames.length).toBe(0);
  });
});
