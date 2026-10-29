// @vitest-environment jsdom
/**
 * DT-04 桌面行为护栏试点（jsdom + 真实 render）：锁住 MultiTabEditor 的**宿主层**行为 ——
 *   ① 5 种 kind 的分支（doc / usheet / bitable / board / ink）；
 *   ② 每个分支都被 EditorErrorBoundary 包住（单标签崩不连累其他标签）；
 *   ③ 懒加载未就绪时的 Suspense 文案；
 *   ④ onCapture 按 noteId 注册 / 卸载时注销（宿主契约词表见 editorHost.ts）。
 *
 * 边界（为什么这样 mock）：不挂 Lake 内核、不挂 Univer / Drawnix —— 重编辑器与 EditorTab 全部换成
 * 极简桩件，只验证"谁被渲染、包了几层边界、回调怎么转发"。真内核行为由既有 node 用例与设备级走查覆盖。
 *
 * 为什么手写 createRoot + act：仓内没有 @testing-library/react，试点不为此引入新依赖。
 */
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorCaptureHandler } from "../../core/editorCapture";
import type { OpenTab } from "../../desktop/desktopTypes";
import type { LakeEditorInstance } from "./lakeRuntime";
import { useSavePipelineGlue } from "../../hooks/useSavePipelineGlue";
import { MultiTabEditor, type TabInfo } from "./MultiTabEditor";

/** mock 桩件的 props：只有宿主层真正关心的两个（其余 props 忽略）。 */
interface HostStubProps {
  noteId?: string;
  onCapture?: EditorCaptureHandler;
}

const harness = vi.hoisted(() => ({
  /** "会在渲染期抛错"的开关：用来验证错误边界只隔离该标签。 */
  boardThrow: false,
  docThrow: false,
  /** doc 宿主内**子组件**持续抛错：验证边界接住的是子树里的错误，关掉后「重试」能重建子树。 */
  docChildThrow: false,
  /** ink 模块的加载门：先挂起以验证 Suspense 文案，测试里再放行。 */
  releaseInk: undefined as undefined | (() => void),
  inkReady: undefined as undefined | Promise<void>,
}));
harness.inkReady = new Promise<void>((resolve) => { harness.releaseInk = resolve; });

/** doc 分支（真实 EditorTab 会挂 Lake 内核，这里只留可断言的桩；错误来自宿主内**子树**而非宿主本身）。 */
vi.mock("./EditorTab", async () => {
  const React = await import("react");
  const DocChild = () => {
    if (harness.docChildThrow) throw new Error("doc child boom");
    return React.createElement("div", { "data-testid": "doc-child" });
  };
  const EditorTab = (props: HostStubProps) => {
    if (harness.docThrow) throw new Error("doc render boom");
    return React.createElement(
      "div",
      { "data-testid": "host-doc", "data-note-id": props.noteId },
      React.createElement(DocChild),
    );
  };
  return { EditorTab };
});

/** 四个懒加载重编辑器：都在挂载时注册 capture、卸载时注销（与真实实现同一契约）。 */
vi.mock("../usheet/UniverSheetEditor", async () => {
  const React = await import("react");
  const UniverSheetEditor = (props: HostStubProps) => {
    React.useEffect(() => {
      props.onCapture?.(() => "usheet:body");
      return () => props.onCapture?.(null);
    }, []);
    return React.createElement("div", { "data-testid": "host-usheet", "data-note-id": props.noteId });
  };
  return { UniverSheetEditor };
});

vi.mock("../bitable/BitableEditor", async () => {
  const React = await import("react");
  const BitableEditor = (props: HostStubProps) => {
    React.useEffect(() => {
      props.onCapture?.(() => "bitable:body");
      return () => props.onCapture?.(null);
    }, []);
    return React.createElement("div", { "data-testid": "host-bitable", "data-note-id": props.noteId });
  };
  return { BitableEditor };
});

vi.mock("../board/BoardEditor", async () => {
  const React = await import("react");
  const BoardEditor = (props: HostStubProps) => {
    if (harness.boardThrow) throw new Error("board render boom");
    React.useEffect(() => {
      props.onCapture?.(() => "board:body");
      return () => props.onCapture?.(null);
    }, []);
    return React.createElement("div", { "data-testid": "host-board", "data-note-id": props.noteId });
  };
  return { BoardEditor };
});

vi.mock("../ink/DesktopInkPad", async () => {
  const React = await import("react");
  await harness.inkReady;
  const DesktopInkPad = (props: HostStubProps) => {
    React.useEffect(() => {
      props.onCapture?.(() => "ink:body");
      return () => props.onCapture?.(null);
    }, []);
    return React.createElement("div", { "data-testid": "host-ink" });
  };
  return { DesktopInkPad };
});

const ALL_TABS: TabInfo[] = [
  { noteId: "doc-1", title: "文档", content: "" },
  { noteId: "sheet-1", title: "表格", content: "", kind: "usheet" },
  { noteId: "bitable-1", title: "多维表", content: "", kind: "bitable" },
  { noteId: "board-1", title: "画板", content: "", kind: "board" },
  { noteId: "ink-1", title: "手写", content: "", kind: "ink" },
];

let errors: unknown[] = [];

beforeAll(() => {
  // React 18 的 act 环境标记（没有 testing-library 时需手动打开，否则 act 不 flush effect）。
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 试点不依赖任何原生能力：给一个最小桥，任何误用 window.lakeNative 的新代码都不会因此偷偷通过。
  (window as unknown as { lakeNative: Record<string, unknown> }).lakeNative = { assetPort: 19876 };
  // jsdom 未实现的两个布局 API（MultiTabEditor 的滚动定位 / FLIP 动画会调到）。
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (typeof Element.prototype.animate !== "function") {
    Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() })) as unknown as Element["animate"];
  }
  // 故意让桩件抛错来验证错误边界时，React dev 会经合成的 error 事件上报 ⇒ jsdom 虚拟控制台
  // 会额外打一份堆栈。错误已被边界接住（真实失败仍由断言给出），这里只关掉这份噪音。
  window.addEventListener("error", (event) => event.preventDefault());
});

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
});

afterEach(() => {
  vi.restoreAllMocks();
  harness.boardThrow = false;
  harness.docThrow = false;
  harness.docChildThrow = false;
});

async function flush(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error("等待超时：" + label);
}

interface MountedHost {
  container: HTMLElement;
  root: Root;
  unmount: () => Promise<void>;
}

async function mountHost(options: {
  tabs?: TabInfo[];
  activeNoteId?: string | null;
  onEditorCapture?: (noteId: string, capture: (() => string | null) | null) => void;
} = {}): Promise<MountedHost> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MultiTabEditor
        tabs={options.tabs ?? ALL_TABS}
        activeNoteId={options.activeNoteId ?? "doc-1"}
        tocEnabled={false}
        outlineEnhance={false}
        onTabChange={() => undefined}
        onTabClose={() => undefined}
        onContentChange={() => undefined}
        onEditorCapture={options.onEditorCapture}
      />,
    );
  });
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

interface CaptureGlueProps {
  tabs: TabInfo[];
  activeNoteId: string;
  glueRef: { current: ReturnType<typeof useSavePipelineGlue> | null };
}

/** 把真实的 capture 注册表（useSavePipelineGlue）接到 MultiTabEditor 的 onEditorCapture 上。 */
function CaptureGlueHarness({ tabs, activeNoteId, glueRef }: CaptureGlueProps) {
  const openTabsRef = useRef<OpenTab[]>([]);
  const editorsRef = useRef<Map<string, LakeEditorInstance>>(new Map());
  const glue = useSavePipelineGlue({
    setNotes: () => undefined,
    setTreeNodes: () => undefined,
    setSync: () => undefined,
    setOpenTabs: () => undefined,
    setDraftEntries: () => undefined,
    setError: () => undefined,
    openTabsRef,
    editorsRef,
  });
  glueRef.current = glue;
  return (
    <MultiTabEditor
      tabs={tabs}
      activeNoteId={activeNoteId}
      tocEnabled={false}
      outlineEnhance={false}
      onTabChange={() => undefined}
      onTabClose={() => undefined}
      onContentChange={() => undefined}
      onEditorCapture={glue.handleCaptureReady}
    />
  );
}

describe("MultiTabEditor 宿主层（DT-04 试点）", () => {
  it("懒加载未就绪时显示 Suspense 文案，就绪后挂载 ink 宿主", async () => {
    // 必须排在其他用例之前：ink 模块的加载门只挂起一次（模块缓存），这里放行后续用例才能直接复用。
    const host = await mountHost({ tabs: [ALL_TABS[4]], activeNoteId: "ink-1" });
    try {
      expect(host.container.textContent).toContain("正在加载编辑器…");
      await act(async () => {
        harness.releaseInk?.();
        await harness.inkReady;
      });
      await waitFor(() => host.container.querySelector('[data-testid="host-ink"]') != null, "ink 宿主挂载");
    } finally {
      await host.unmount();
    }
  });

  it("5 种 kind 各自渲染对应宿主分支", async () => {
    const host = await mountHost();
    try {
      await waitFor(
        () => ["doc", "usheet", "bitable", "board", "ink"].every((k) => host.container.querySelector('[data-testid="host-' + k + '"]') != null),
        "5 种宿主分支都挂载",
      );
      expect(host.container.querySelectorAll("[data-note-id]").length).toBeGreaterThanOrEqual(4);
      expect(host.container.textContent).not.toContain("正在加载编辑器…");
    } finally {
      await host.unmount();
    }
  });

  it("单个编辑器渲染抛错只隔离该标签（错误边界兜住 board）", async () => {
    harness.boardThrow = true;
    const host = await mountHost({ tabs: [ALL_TABS[1], ALL_TABS[3]], activeNoteId: "sheet-1" });
    try {
      await waitFor(() => (host.container.textContent ?? "").includes("该类型编辑器渲染出错"), "board 降级文案");
      // 同一次渲染里的表格标签不受影响。
      expect(host.container.querySelector('[data-testid="host-usheet"]')).not.toBeNull();
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await host.unmount();
    }
  });

  it("doc 分支同样被错误边界包裹（DT-01）", async () => {
    harness.docThrow = true;
    const host = await mountHost({ tabs: [ALL_TABS[0], ALL_TABS[2]], activeNoteId: "doc-1" });
    try {
      await waitFor(() => (host.container.textContent ?? "").includes("该类型编辑器渲染出错"), "doc 降级文案");
      expect(host.container.querySelector('[data-testid="host-bitable"]')).not.toBeNull();
    } finally {
      await host.unmount();
    }
  });

  it("capture 注册 / 注销按 noteId 转发到宿主", async () => {
    const calls: Array<{ noteId: string; capture: (() => string | null) | null }> = [];
    const host = await mountHost({
      tabs: [ALL_TABS[1], ALL_TABS[2], ALL_TABS[3]],
      activeNoteId: "sheet-1",
      onEditorCapture: (noteId, capture) => { calls.push({ noteId, capture }); },
    });
    try {
      await waitFor(() => calls.length >= 3, "三种编辑器的 capture 注册");
      expect(calls.map((c) => c.noteId).sort()).toEqual(["bitable-1", "board-1", "sheet-1"]);
      for (const call of calls) expect(typeof call.capture).toBe("function");
      await host.unmount();
      await flush();
      const unregistered = calls.filter((c) => c.capture === null).map((c) => c.noteId);
      expect(unregistered.sort()).toEqual(["bitable-1", "board-1", "sheet-1"]);
    } catch (error) {
      // 失败路径也要卸载，避免 root 泄漏到后续用例。
      await host.unmount();
      throw error;
    }
  });

  it("doc 宿主内子组件抛错被 EditorErrorBoundary 接住，且「重试」重建子树（DT-01/DT-04）", async () => {
    // 关键差异：错误来自 doc 宿主**内部子树**（真实内核崩溃的形态），不是 MultiTabEditor 的直接子组件。
    // 修前红：没有边界时错误穿透到 React 根，整个标签面板被卸载（其余标签的未落盘编辑一起丢）。
    harness.docChildThrow = true;
    const host = await mountHost({ tabs: [ALL_TABS[0], ALL_TABS[2]], activeNoteId: "doc-1" });
    try {
      await waitFor(() => (host.container.textContent ?? "").includes("该类型编辑器渲染出错"), "doc 子树抛错降级");
      // 崩溃的 doc 子树已被边界整体摘掉（不是白屏/半渲染），其他标签照常挂载。
      expect(host.container.querySelector('[data-testid="host-doc"]')).toBeNull();
      expect(host.container.querySelector('[data-testid="doc-child"]')).toBeNull();
      expect(host.container.querySelector('[data-testid="host-bitable"]')).not.toBeNull();
      const retry = Array.from(host.container.querySelectorAll("button")).find((button) => button.textContent === "重试");
      expect(retry, "错误边界必须给出可执行的重试").toBeTruthy();
      // 故障解除后再点重试：验证的是真实重建（generation 变化），不是自动恢复。
      harness.docChildThrow = false;
      await act(async () => { retry?.click(); });
      // 重试 = 换 generation 重建子树（EditorErrorBoundary.retry），不是"切标签自愈"。
      await waitFor(() => host.container.querySelector('[data-testid="doc-child"]') != null, "重试后 doc 子树重建");
      expect(host.container.textContent).not.toContain("该类型编辑器渲染出错");
    } finally {
      await host.unmount();
    }
  });

  it("capture 注册落到真实注册表（useSavePipelineGlue）：关闭标签即注销，其余标签保留", async () => {
    // 真实 capture 注册表 = useSavePipelineGlue.capturesRef；宿主通过 onEditorCapture 转发，
    // keep-alive 下切标签不卸载 ⇒ 注册保留，只有标签被关闭/淘汰（宿主卸载）才注销。
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const glueRef: { current: ReturnType<typeof useSavePipelineGlue> | null } = { current: null };
    const render = async (tabs: TabInfo[], activeNoteId: string): Promise<void> => {
      await act(async () => {
        root.render(<CaptureGlueHarness tabs={tabs} activeNoteId={activeNoteId} glueRef={glueRef} />);
      });
    };
    try {
      await render([ALL_TABS[1], ALL_TABS[2], ALL_TABS[3]], "sheet-1");
      await waitFor(() => glueRef.current?.handleCaptureContent("sheet-1") === "usheet:body", "usheet capture 注册");
      expect(glueRef.current?.handleCaptureContent("bitable-1")).toBe("bitable:body");
      expect(glueRef.current?.handleCaptureContent("board-1")).toBe("board:body");
      // doc 走 Lake 实例兜底、不注册 capture（这里没有实例 ⇒ undefined）。
      expect(glueRef.current?.handleCaptureContent("doc-1")).toBeUndefined();
      // 关闭 sheet-1 标签：宿主卸载 ⇒ capture 注销（不再返回正文），其余标签不受影响。
      await render([ALL_TABS[2], ALL_TABS[3]], "board-1");
      await flush();
      expect(glueRef.current?.handleCaptureContent("sheet-1")).toBeUndefined();
      expect(glueRef.current?.handleCaptureContent("bitable-1")).toBe("bitable:body");
      expect(glueRef.current?.handleCaptureContent("board-1")).toBe("board:body");
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
    }
  });
});
