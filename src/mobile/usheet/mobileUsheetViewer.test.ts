/**
 * 移动端表格查看/编辑器（kind=usheet）挂载护栏。
 *
 * jsdom + mock 掉 Univer 运行时（真 canvas 在桌面/模拟器实测）：只验「宿主这一层」的行为：
 * - 未活动过的 tab 不建实例（隐藏态量成 0 尺寸，canvas 引擎渲不出来）；
 * - 阅读态 `setEditable(false)`；编辑态 `setEditable(true)`，通过 capture 读取最新正文；
 * - 不挂桌面工具条/公式栏；
 * - 喂给内核的是正文里的 workbook（usheet 正文绝不交给 Lake 编辑器）；
 * - 图片 source 走本机 AssetServer canonical URL。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// React 18 的 act 环境标记（否则每个 act 都会打 "not configured to support act" 警告）
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const calls: {
  created: number; disposed: number; editable: boolean[]; core: Record<string, unknown> | null; container: string | null;
  /** 内核撤销栈状态（IUndoRedoService 的替身）：dock 两枚按钮按它置灰。 */
  history: { undos: number; redos: number };
} = { created: 0, disposed: 0, editable: [], core: null, container: null, history: { undos: 0, redos: 0 } };

vi.mock("@univerjs/presets", () => ({
  LocaleType: { ZH_CN: "zh-CN" },
  // 组件从 presets 转发处拿注入令牌（真实内核里它来自 @univerjs/core）；测试只要是一个稳定对象即可
  IUndoRedoService: { name: "IUndoRedoService" },
  mergeLocales: (...m: unknown[]) => Object.assign({}, ...m),
  defaultTheme: { primary: {}, gray: {}, blue: {}, red: {}, green: {}, orange: {} },
  createUniver: (options: Record<string, unknown>) => {
    calls.created += 1;
    const workbook = {
      getId: () => "workbook",
      getSheets: () => [] as unknown[],
      getActiveSheet: () => null,
      getActiveRange: () => null,
      undo: () => undefined,
      redo: () => undefined,
    };
    return {
      univer: {
        dispose: () => { calls.disposed += 1; },
        // 注入器只回我们关心的那一个服务；令牌是 mock 里的稳定对象
        __getInjector: () => ({ get: () => ({ getUndoRedoStatus: () => ({ ...calls.history }) }) }),
      },
      univerAPI: {
        createWorkbook: () => ({
          setEditable: (v: boolean) => { calls.editable.push(v); },
          save: () => ({ id: "workbook", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: {} } } }),
        }),
        setTheme: () => undefined,
        getActiveWorkbook: () => workbook,
        addEvent: () => ({ dispose: () => undefined }),
        Event: { CommandExecuted: "command-executed" },
      },
    };
    void options;
  },
}));
vi.mock("./mobileUniverPreset", () => ({
  createMobileSheetsCorePreset: (cfg: Record<string, unknown>) => { calls.core = cfg; calls.container = String(cfg.container); return { plugins: [] }; },
  createMobileSheetsDrawingPreset: () => ({ plugins: [] }),
}));
vi.mock("@univerjs/preset-sheets-core/locales/zh-CN", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-drawing/locales/zh-CN", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-core/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-drawing/lib/index.css", () => ({}));

import { MobileUsheetViewer, usheetImageSrc } from "./MobileUsheetViewer";

const BODY = JSON.stringify({
  kind: "usheet", version: 1,
  workbook: { id: "workbook", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: { "0": { "0": { v: "季度预算" } } } } } },
});

// jsdom 里容器恒为 0 尺寸 ⇒ 组件会等高度。给个假高度让挂载路径可走；
// rAF 同步执行，避免"等高度"的 setState 落在 act 之外（只影响测试，不动组件语义）。
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 320 });
window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as typeof window.requestAnimationFrame;

async function mount(active: boolean, editing = false, opts: { onChange?: (c: string) => void; onCapture?: (c: (() => string | null) | null) => void } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const { act } = await import("react");
  await act(async () => {
    root.render(createElement(MobileUsheetViewer, {
      noteId: "n1", content: BODY, active, editing,
      onChange: opts.onChange ?? (() => undefined),
      onCapture: opts.onCapture,
    }));
  });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return { root, host };
}

describe("移动端表格查看/编辑器", () => {
  it("未活动的 tab 不建 Univer 实例", async () => {
    calls.created = 0; calls.editable.length = 0;
    const { root } = await mount(false);
    expect(calls.created).toBe(0);
    root.unmount();
  });

  it("阅读态挂载：无 dock、保留 21px 公式栏与一条轻工具条、容器 id 正确", async () => {
    calls.created = 0; calls.editable.length = 0; calls.core = null;
    const { root, host } = await mount(true);
    const core = (calls.core ?? {}) as Record<string, unknown>;
    expect(calls.created).toBe(1);
    expect(calls.editable).toEqual([false]);            // 阅读态 setEditable(false)
    expect(core.toolbar).toBe(false);                   // 不挂内核工具条
    expect(core.formulaBar).toBe(true);                 // 公式栏注册仍在（由我们自绘）
    expect(calls.container).toBe("mobile-usheet-n1");
    const shell = host.querySelector(".mobile-usheet");
    expect(shell).toBeTruthy();
    expect(shell?.hasAttribute("data-prevent-swipe")).toBe(true);
    expect(host.querySelector(".ush-formula")).toBeTruthy();       // 顶部薄公式栏常驻
    expect(host.querySelector(".ush-reading-bar")).toBeTruthy();   // 阅读态轻工具条（261020 定稿）
    expect(host.querySelector(".ush-dock")).toBeNull();            // 阅读态没有 dock
    expect(host.querySelector(".ush-footer")).toBeNull();          // 页签/缩放只在编辑态
    root.unmount();
  });

  it("编辑态挂载：dock 八项 + 公式栏 + 页签/缩放栏；setEditable(true) 且注册同步 capture", async () => {
    calls.created = 0; calls.editable.length = 0;
    let capture: (() => string | null) | null = null;
    const { root, host } = await mount(true, true, { onCapture: (c) => { capture = c; } });
    expect(calls.created).toBe(1);
    expect(calls.editable).toEqual([true]);
    expect(typeof capture).toBe("function");
    const dock = host.querySelector(".ush-dock");
    expect(dock).toBeTruthy();
    expect(dock?.getAttribute("aria-label")).toBe("表格工具");
    for (const label of ["插入", "文字格式", "加粗", "数字格式", "更多", "撤销", "重做", "展开键盘"]) {
      expect(dock?.querySelector('button[aria-label="' + label + '"]')).toBeTruthy();
    }
    // 撤销/重做留在主条；数字格式按钮显示当前格式文字（默认「常规」）
    expect(dock?.textContent).toContain("常规");
    expect(host.querySelector(".ush-formula")).toBeTruthy();
    expect(host.querySelector(".ush-footer")).toBeTruthy();
    expect(host.querySelector(".ush-reading-bar")).toBeNull();
    root.unmount();
  });

  it("二级面板：文字格式 / 数字格式 / 插入 / 更多 从底部 dock 展开（不是顶部下拉卡）", async () => {
    const { root, host } = await mount(true, true);
    const { act } = await import("react");
    const clickDock = async (label: string) => {
      const btn = host.querySelector<HTMLButtonElement>('.ush-dock button[aria-label="' + label + '"]');
      expect(btn, label).toBeTruthy();
      await act(async () => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    };
    await clickDock("文字格式");
    let text = host.textContent ?? "";
    expect(text).toContain("字号");
    // 字色 / 底色两行不写标签（用户 261020：与文档 Aa 面板一致，去掉这两处说明）
    expect(text).not.toContain("文字颜色");
    expect(text).not.toContain("背景色");
    expect(host.querySelectorAll(".ush-panel .med-f-a").length).toBeGreaterThan(1);
    expect(host.querySelectorAll(".ush-panel .med-f-sw").length).toBeGreaterThan(1);
    // 行内标记与清除格式是图标钮：可访问名走 aria-label（与文档 Aa 面板同一套 lucide 图标）
    for (const label of ["加粗", "斜体", "下划线", "删除线", "清除文字格式"]) {
      expect(host.querySelector('.ush-panel button[aria-label="' + label + '"]'), label).toBeTruthy();
    }
    // 面板外壳按文档口径：**定高**（= 捕获的键盘区高度；无键盘时用 floor 280）+ 内容在内部滚动
    const panelEl = host.querySelector(".ush-panel") as HTMLElement;
    expect(panelEl.style.height).toBe("280px");
    expect(panelEl.querySelector(".ush-panel__inner")).toBeTruthy();
    // 展开的类别键变 ×（文档 dock 同款）：Aa 文字消失，再点一次 = 关面板并放回键盘
    expect(host.querySelector('.ush-dock button[aria-label="文字格式"]')?.textContent ?? "").not.toContain("Aa");
    // 逐行同序：行内标记 → 对齐 → 字色 → 底色 → **字号（最底，与文档 Aa 面板一致）**
    const rows = [...host.querySelectorAll(".ush-panel .med-f-row")];
    expect(rows.at(-1)?.querySelector(".med-f-sizes"), "字号必须是最底部那一行").toBeTruthy();
    expect(rows.at(-1)?.querySelectorAll(".med-f-btn").length).toBe(9);
    await clickDock("文字格式");            // 再点一次 = ×（收起）：**内容先留着**（键盘从面板上方滑上来）
    const closingPanel = host.querySelector(".ush-panel");
    expect(closingPanel).toBeTruthy();
    expect(closingPanel?.getAttribute("data-closing")).toBe("1");
    expect(host.querySelector('.ush-dock button[aria-label="文字格式"]')?.getAttribute("aria-pressed")).toBe("false");
    await clickDock("数字格式");
    text = host.textContent ?? "";
    for (const label of ["常规", "文本", "百分比", "货币（¥）", "日期时间", "小数位"]) expect(text).toContain(label);
    await clickDock("数字格式");
    await clickDock("插入");
    text = host.textContent ?? "";
    for (const label of ["在上方插入行", "在下方插入行", "在左侧插入列", "在右侧插入列", "合并选中单元格"]) expect(text).toContain(label);
    await clickDock("插入");
    await clickDock("更多");
    text = host.textContent ?? "";
    for (const label of ["冻结窗格", "冻结至当前行", "冻结至当前列", "取消冻结", "行高", "自动行高", "列宽", "常用公式", "求和 SUM"]) expect(text).toContain(label);
    root.unmount();
  });

  it("收起过渡：restore 档内容先留着；键盘不来 1.8s 后滑出、2.5s 兜底卸载", async () => {
    const { root, host } = await mount(true, true);
    const { act } = await import("react");
    const btn = host.querySelector<HTMLButtonElement>('.ush-dock button[aria-label="文字格式"]');
    await act(async () => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.querySelector(".ush-panel")).toBeTruthy();       // 展开
    await act(async () => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.querySelector(".ush-panel")?.getAttribute("data-open")).toBe("1");   // 收起过渡：内容保持
    // 用真实计时（计时器在点击那一步就已排上，事后再开 fake timers 抓不到）
    await act(async () => { await new Promise((r) => setTimeout(r, 1900)); });   // 1800ms 兜底放行滑出
    expect(host.querySelector(".ush-panel")?.getAttribute("data-open")).toBe("0");
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });    // 2500ms 兜底卸载
    expect(host.querySelector(".ush-panel")).toBeNull();
    root.unmount();
  });

  it("撤销/重做按钮跟随内核撤销栈：空栈置灰，有历史才亮（不假装能撤销）", async () => {
    calls.history = { undos: 0, redos: 0 };
    const a = await mount(true, true);
    const undoA = a.host.querySelector<HTMLButtonElement>('.ush-dock button[aria-label="撤销"]');
    const redoA = a.host.querySelector<HTMLButtonElement>('.ush-dock button[aria-label="重做"]');
    expect(undoA?.disabled).toBe(true);
    expect(redoA?.disabled).toBe(true);
    a.root.unmount();

    calls.history = { undos: 2, redos: 1 };
    const b = await mount(true, true);
    expect(b.host.querySelector<HTMLButtonElement>('.ush-dock button[aria-label="撤销"]')?.disabled).toBe(false);
    expect(b.host.querySelector<HTMLButtonElement>('.ush-dock button[aria-label="重做"]')?.disabled).toBe(false);
    b.root.unmount();
  });

  it("图片 source：资产 filename 走本机 AssetServer canonical URL；http/data 原样", () => {
    const url = usheetImageSrc("1712345678_ab12cd34.png", "n1");
    expect(url).toContain("/n1/1712345678_ab12cd34.png");
    expect(usheetImageSrc("https://example.com/a.png", "n1")).toBe("https://example.com/a.png");
    expect(usheetImageSrc("data:image/png;base64,AAAA", "n1")).toBe("data:image/png;base64,AAAA");
  });
});
