// @vitest-environment jsdom
/**
 * F-E（261119 移动端平滑度审计）渲染契约：表格 / 多维表 / 手写板**首开**（分包还没到达）时，
 * Suspense 兜底必须是**同构骨架**（NotePaneSkeleton），不再是「正在加载…」文字空态——
 * 文字空态 → 查看器 = 整页换构（页面高度 / 顶部元素位置全变，审计 F-E 症状）；
 * 骨架 → 查看器 = 同槽原地填充（结构同构、尺寸同源，几何对拍见 notePaneSkeleton.geometry.test.ts）。
 *
 * 断言口径：
 *  · 三个 kind 的兜底各是自己的骨架变体（bitable 头部两行 / usheet 顶条 / ink 满幅纸面）；
 *  · 骨架**同步立即出现**（不包 DelayedLoading：空 300ms → 骨架 → 查看器才是三段换构）；
 *  · 骨架落在查看器同一个 .doc-pane.active 槽位里（同槽 = 换构时顶部几何不动）；
 *  · NotePaneHost 不再出现任何「正在加载」文字空态。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 永不 resolve 的分包组件：把 Suspense 兜底**钉在屏幕上**，直接对兜底 DOM 断言。 */
const suspendForever = vi.hoisted(() => () => {
  throw new Promise(() => {});
});

vi.mock("../editor/DocumentEditor", () => ({ DocumentEditor: () => <div data-testid="doc-editor" /> }));
vi.mock("../board/MobileBoardViewer", () => ({ MobileBoardViewer: () => <div data-testid="board" /> }));
vi.mock("../bitable/MobileBitableViewer", () => ({ MobileBitableViewer: suspendForever }));
vi.mock("../usheet/MobileUsheetViewer", () => ({ MobileUsheetViewer: suspendForever }));
vi.mock("../ink/MobileInkPad", () => ({ MobileInkPad: suspendForever }));

import { NotePaneHost } from "./NotePaneHost";
import type { NotebookTab } from "./useNotebookTabs";

// jsdom 环境下 import.meta.url 不是 file: scheme ⇒ 用仓库根相对路径读源码。
const PANE_SOURCE = readFileSync(path.join(process.cwd(), "src/mobile/notebook/NotePaneHost.tsx"), "utf8");

const tab = (id: string, overrides: Partial<NotebookTab> = {}): NotebookTab => ({
  id,
  title: id,
  content: "",
  editing: true,
  loaded: true,
  lastAccessedAt: 1,
  kind: "doc",
  ...overrides,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderTabs(tabs: NotebookTab[]): void {
  act(() => {
    root.render(
      <NotePaneHost
        tabs={tabs}
        active={tabs[0] ?? null}
        activeId={tabs[0]?.id ?? null}
        freshId={null}
        mountedIds={new Set(tabs.map((t) => t.id))}
        findOpen={false}
        onBodyChange={() => {}}
        onPersistBitableNow={async () => {}}
        onCapture={() => {}}
        onEditorInstance={() => {}}
        onFullscreenChange={() => {}}
        onCloseFind={() => {}}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("F-E 重依赖正文首开的同构骨架兜底", () => {
  it.each([
    ["bitable", "正在打开多维表"],
    ["usheet", "正在打开表格"],
    ["ink", "正在打开手写板"],
  ] as const)("%s：兜底 = 骨架（同步出现、无文字空态）", (kind, label) => {
    renderTabs([tab("n-" + kind, { kind })]);
    const skel = host.querySelector(".mb-pane-skel");
    // 同步出现 = 没包 DelayedLoading（包了会先渲染 null 300ms）。
    expect(skel).not.toBeNull();
    expect(skel!.className).toContain("mb-pane-skel--" + kind);
    expect(skel!.getAttribute("role")).toBe("status");
    expect(skel!.getAttribute("aria-busy")).toBe("true");
    expect(skel!.getAttribute("aria-label")).toBe(label);
    // 文字空态必须绝迹（旧实现 = <EmptyState>正在加载…</EmptyState>）。
    expect(host.textContent ?? "").not.toContain("正在加载");
    // 同槽：骨架与查看器占同一个 pane 槽位（.doc-pane.active），换构不动顶部几何。
    expect(host.querySelector(".doc-pane.active .mb-pane-skel")).toBe(skel);
  });

  it("同构结构：bitable = 头部两行 + 网格行框；usheet = 顶条 + 行框；ink = 满幅纸面", () => {
    renderTabs([tab("n-b", { kind: "bitable" })]);
    expect(host.querySelectorAll(".mb-pane-skel--bitable .mb-pane-skel__head .mb-pane-skel__bar")).toHaveLength(2);
    expect(host.querySelectorAll(".mb-pane-skel--bitable .mb-pane-skel__bar--row1")).toHaveLength(1);
    expect(host.querySelectorAll(".mb-pane-skel--bitable .mb-pane-skel__bar--row2")).toHaveLength(1);
    expect(host.querySelectorAll(".mb-pane-skel--bitable .mb-pane-skel__row").length).toBeGreaterThan(0);
    // 头部同样声明 topChrome 契约（nested ⇒ 与真实 .mbt-header 一致，不重复消费安全区）。
    expect(host.querySelector(".mb-pane-skel--bitable .mb-pane-skel__head")?.getAttribute("data-edge")).toBe("nested");

    renderTabs([tab("n-u", { kind: "usheet" })]);
    expect(host.querySelectorAll(".mb-pane-skel--usheet .mb-pane-skel__head .mb-pane-skel__bar")).toHaveLength(1);
    expect(host.querySelectorAll(".mb-pane-skel--usheet .mb-pane-skel__bar--tab")).toHaveLength(1);
    expect(host.querySelectorAll(".mb-pane-skel--usheet .mb-pane-skel__row").length).toBeGreaterThan(0);

    renderTabs([tab("n-i", { kind: "ink" })]);
    expect(host.querySelectorAll(".mb-pane-skel--ink .mb-pane-skel__paper")).toHaveLength(1);
    // 手写板导航是 overlay 不占布局 ⇒ 骨架没有头部行。
    expect(host.querySelectorAll(".mb-pane-skel--ink .mb-pane-skel__head")).toHaveLength(0);
  });

  it("兜底仍是骨架而非文字空态（源级锁：NotePaneHost 不再写「正在加载」）", () => {
    expect(PANE_SOURCE).not.toContain("正在加载");
    expect(PANE_SOURCE).toContain('<NotePaneSkeleton kind="ink" />');
    expect(PANE_SOURCE).toContain('<NotePaneSkeleton kind="bitable" />');
    expect(PANE_SOURCE).toContain('<NotePaneSkeleton kind="usheet" />');
  });
});
