// @vitest-environment jsdom
/**
 * DT-09 行为护栏：桌面顶栏左侧 4 份 → **1 个渲染点**。
 *
 * 锁四件事：
 *  ① 四个空间复用**同一个**顶栏元素（App 里只构造一份）；DOM 仍是 4 份、外壳构成与内容不变
 *     （keep-alive 下 3 份是隐藏副本），因此几何/外观不会因为合并而变化；
 *  ② 只有「活动空间那一份」接管 App 的共享 ref（`wsMenuWrapRef` / `syncBtnRef` ——
 *     工作空间菜单定位、外点判定、同步 toast 锚点全靠它；挂到隐藏副本会量到 0 尺寸）；
 *  ③ 只有活动副本可见：切空间即收起旧副本的同步浮窗（等价于旧代码的 `visible={desktopWorkspace === x}`）；
 *  ④ 棘轮：App.tsx 里不许再出现第 2 个 `<DesktopTopBarLeading>`，四个空间各声明一个槽位。
 *
 * 边界：只验证「谁可见 / 谁的 ref / 渲染了哪份内容」这些合并点；四态真机几何（1315/1060/760）
 * 由 Lead 跑 `check-stylesnap` 并重烤基线，不在本用例范围（也不为此引入快照依赖）。
 */
import { readFileSync } from "node:fs";
import { act, type ReactNode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SyncPendingSummary, SyncStatus } from "../lib/types";
import { DesktopTopBarLeading } from "./DesktopTopBar";
import type { DesktopWorkspace } from "./desktopTypes";
import { DesktopWorkspaceSlotProvider, topBarLeadingSlotView } from "./desktopWorkspaceSlot";

const nativeMock = vi.hoisted(() => ({
  getSyncStatus: vi.fn(async () => ({ lastResult: null })),
}));
vi.mock("../lib/native", () => ({ native: nativeMock }));

const SLOTS: DesktopWorkspace[] = ["library", "quick-notes", "trash", "resources"];
const SPACE_LABEL: Record<DesktopWorkspace, string> = {
  library: "资料库",
  "quick-notes": "小记",
  trash: "回收站",
  resources: "资源",
};
const SYNC: SyncStatus = { phase: "idle", message: "", lastSyncedAt: null, pendingChanges: 0 };
const PENDING: SyncPendingSummary = {
  documents: 0, folders: 0, resources: 0, quickNotes: 0, total: 0, generatedAt: "2026-10-28T00:00:00.000Z",
};
const noop = () => undefined;

interface LeadingRefs {
  ws: RefObject<HTMLDivElement>;
  sync: RefObject<HTMLButtonElement>;
}

/** 顶栏左侧的全部 props（与 App 传参同形）；共享 ref 两种状态下都传，由组件按槽位决定是否接管。 */
function topBarProps(active: DesktopWorkspace, refs: LeadingRefs) {
  return {
    desktopWorkspace: active,
    wsMenuWrapRef: refs.ws,
    syncBtnRef: refs.sync,
    sync: SYNC,
    pendingSummary: PENDING,
    cloudEnabled: false,
    cloudConfigured: false,
    conflictSnapshots: [] as Array<{ noteId: string; title: string }>,
    onToggleWorkspaceMenu: noop,
    onSync: noop,
    onOpenSettings: noop,
    onOpenHistory: noop,
    onOpenNote: noop,
  };
}

/** 与 App 同构：四个 keep-alive 工作空间视图，各自顶栏槽位包一层槽位 provider，复用同一个顶栏元素。 */
function Shell({ active, leading }: { active: DesktopWorkspace; leading: ReactNode }) {
  return (
    <div className="app-shell">
      {SLOTS.map((slot) => (
        <div key={slot} className={"workspace-view" + (slot === active ? "" : " workspace-view--hidden")} data-slot={slot}>
          <header className="tab-bar desktop-only" aria-label="顶栏">
            <div className="tabbar-leading">
              <DesktopWorkspaceSlotProvider workspace={slot}>{leading}</DesktopWorkspaceSlotProvider>
            </div>
          </header>
        </div>
      ))}
    </div>
  );
}

interface MountedShell {
  container: HTMLElement;
  refs: LeadingRefs;
  render: (active: DesktopWorkspace) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mountShell(): Promise<MountedShell> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const refs: LeadingRefs = { ws: { current: null }, sync: { current: null } };
  const render = async (active: DesktopWorkspace): Promise<void> => {
    // 与 App 一致：每轮只构造**一个**顶栏元素，四处复用。
    const leading = <DesktopTopBarLeading {...topBarProps(active, refs)} />;
    await act(async () => {
      root.render(<Shell active={active} leading={leading} />);
    });
  };
  return {
    container,
    refs,
    render,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function slotOf(container: HTMLElement, workspace: DesktopWorkspace): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="' + workspace + '"]');
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 没有 ResizeObserver：浮窗定位（usePopoverPosition）在挂载表面时用它监听尺寸变化。
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("桌面顶栏左侧 4→1（DT-09）", () => {
  it("槽位映射：只有活动空间那一份可见并接管共享 ref", () => {
    // 没有槽位上下文（独立渲染/测试）= 唯一副本。
    expect(topBarLeadingSlotView("library", null)).toEqual({ visible: true, sharedRefs: true });
    for (const active of SLOTS) {
      for (const slot of SLOTS) {
        expect(topBarLeadingSlotView(active, slot)).toEqual({ visible: slot === active, sharedRefs: slot === active });
      }
    }
  });

  it("单一渲染点复用四项：DOM 仍是四份顶栏，四份内容都跟活动空间走（外观等价）", async () => {
    const host = await mountShell();
    try {
      for (const active of SLOTS) {
        await host.render(active);
        const label = SPACE_LABEL[active];
        expect(host.container.querySelectorAll(".toolbar__menu-wrap").length, "四份顶栏：" + active).toBe(4);
        expect(host.container.querySelectorAll("[data-sync-status-button]").length, "四份同步按钮：" + active).toBe(4);
        // 四份顺序 = 四个空间视图顺序（共用同一元素不会串位/缺份），内容都等于活动空间。
        expect(SLOTS.map((slot) => slotOf(host.container, slot)?.querySelector(".toolbar__text")?.textContent)).toEqual([label, label, label, label]);
        // 图标/标题/aria 与改造前一致（不做视觉改版）。
        const titles = [...host.container.querySelectorAll(".toolbar__workspace")].map((el) => el.getAttribute("title"));
        expect(new Set(titles)).toEqual(new Set(["空间：" + label]));
        const labels = [...host.container.querySelectorAll(".toolbar__workspace")].map((el) => el.getAttribute("aria-label"));
        expect(new Set(labels)).toEqual(new Set(["切换空间"]));
      }
    } finally {
      await host.unmount();
    }
  });

  it("共享 ref 只挂到活动空间那一份（菜单定位 / 外点判定 / 同步 toast 锚点）", async () => {
    const host = await mountShell();
    try {
      for (const active of SLOTS) {
        await host.render(active);
        const activeSlot = slotOf(host.container, active);
        expect(activeSlot, "活动槽位必须存在：" + active).not.toBeNull();
        expect(host.refs.ws.current, "活动槽位的顶栏菜单锚点：" + active).not.toBeNull();
        expect(activeSlot!.contains(host.refs.ws.current)).toBe(true);
        expect(host.refs.sync.current, "活动槽位的同步按钮锚点：" + active).not.toBeNull();
        expect(activeSlot!.contains(host.refs.sync.current)).toBe(true);
        for (const other of SLOTS.filter((slot) => slot !== active)) {
          const wrapped = slotOf(host.container, other)?.querySelector(".toolbar__menu-wrap");
          expect(wrapped, "隐藏副本不得接管共享 ref：" + other).not.toBe(host.refs.ws.current);
        }
      }
    } finally {
      await host.unmount();
    }
  });

  it("切空间即收起旧副本的同步浮窗（非活动副本 visible=false，与旧条件渲染等价）", async () => {
    const host = await mountShell();
    try {
      await host.render("library");
      // 未配置云同步 ⇒ 点按钮展开「仅本地」浮窗（旧代码里只有活动副本允许展开）。
      await act(async () => { host.refs.sync.current?.click(); });
      expect(document.body.textContent).toContain("数据仅保存在本机");
      await host.render("trash");
      expect(document.body.textContent).not.toContain("数据仅保存在本机");
      expect(host.container.querySelectorAll(".toolbar__menu-wrap").length).toBe(4);
    } finally {
      await host.unmount();
    }
  });

  it("棘轮：App.tsx 只剩一个 DesktopTopBarLeading 渲染点，四个空间各声明一个槽位", () => {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
    const app = read("../App.tsx");
    expect(app.match(/<DesktopTopBarLeading\b/g)?.length ?? 0).toBe(1);
    const declarations = [app, read("./DesktopLibrary.tsx"), read("./DesktopQuickNotes.tsx")]
      .map((src) => src.match(/<DesktopWorkspaceSlotProvider\b/g)?.length ?? 0)
      .reduce((total, count) => total + count, 0);
    expect(declarations, "四个空间各一个槽位声明").toBe(4);
    // 槽位与空间必须一一对应（错了会让「可见的那份」和「接管 ref 的那份」分家）。
    expect(app.match(/<DesktopWorkspaceSlotProvider workspace="trash"/g)?.length ?? 0).toBe(1);
    expect(app.match(/<DesktopWorkspaceSlotProvider workspace="resources"/g)?.length ?? 0).toBe(1);
    expect(read("./DesktopLibrary.tsx")).toContain('<DesktopWorkspaceSlotProvider workspace="library">{topbarLeading}</DesktopWorkspaceSlotProvider>');
    expect(read("./DesktopQuickNotes.tsx")).toContain('<DesktopWorkspaceSlotProvider workspace="quick-notes">{topbarLeading}</DesktopWorkspaceSlotProvider>');
  });
});
