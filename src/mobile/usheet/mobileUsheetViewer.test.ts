/**
 * 移动端表格查看/编辑器（kind=usheet）挂载护栏（261023 v5：顶部行 + 公式栏 + 编辑态 dock）。
 *
 * jsdom + mock 掉 Univer 运行时（真 canvas 在模拟器实测）：只验「宿主这一层」的行为：
 * - 未活动过的 tab 不建实例；阅读态不挂编辑面、保留顶部行与阅读工具条；
 * - 编辑态 = 公式栏（地址/值/提交）+ dock（插入/T/数据/视图/更多/撤销/重做/键盘）+ 面板；
 * - 面板展开时一级按钮变 X、再点收起；面板占键盘区（DOM 顺序：dock 在面板上方）；
 * - 公式栏提交写回活动单元格（数字/文本/公式三条分支）；
 * - 顶部行含高亮当前行列开关（纯本机视图）；
 * - 图片 source 走本机 AssetServer canonical URL。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const calls: {
  created: number;
  disposed: number;
  editable: boolean[];
  core: Record<string, unknown> | null;
  container: string | null;
  setValue: Array<unknown>;
  setFormula: string[];
  insertSheet: number;
} = { created: 0, disposed: 0, editable: [], core: null, container: null, setValue: [], setFormula: [], insertSheet: 0 };

const range = {
  getCellStyleData: () => ({ bl: 0 }),
  getHorizontalAlignment: () => "general",
  getVerticalAlignment: () => "general",
  getFontSize: () => 14,
  getNumberFormat: () => "",
  getRow: () => 0,
  getColumn: () => 0,
  getValue: () => "季度预算",
  setValue: (value: unknown) => { calls.setValue.push(value); },
  setFormula: (value: string) => { calls.setFormula.push(value); },
  setFontWeight: () => range,
  setFontStyle: () => range,
  setFontLine: () => range,
  setFontColor: () => range,
  setBackgroundColor: () => range,
  setFontSize: () => range,
  setHorizontalAlignment: () => range,
  setVerticalAlignment: () => range,
  clearFormat: () => range,
  merge: () => range,
  getLastRow: () => 0,
  getLastColumn: () => 0,
};

const sheet = {
  getSheetId: () => "s1",
  getSheetName: () => "Sheet1",
  getMaxRows: () => 20,
  getMaxColumns: () => 10,
  getRange: () => range,
  insertRowsBefore: () => undefined,
  insertRowsAfter: () => undefined,
  insertColumnsBefore: () => undefined,
  insertColumnsAfter: () => undefined,
  deleteRow: () => undefined,
  deleteColumn: () => undefined,
  setFrozenRows: () => undefined,
  setFrozenColumns: () => undefined,
};

const workbook = {
  getId: () => "book",
  getSheets: () => [sheet],
  getActiveSheet: () => sheet,
  getActiveRange: () => range,
  undo: () => undefined,
  redo: () => undefined,
  insertSheet: () => { calls.insertSheet += 1; return { getSheetId: () => "s2", getSheetName: () => "Sheet2" }; },
};

vi.mock("@univerjs/presets", () => ({
  LocaleType: { ZH_CN: "zh-CN" },
  mergeLocales: (...m: unknown[]) => Object.assign({}, ...m),
  defaultTheme: { primary: {}, gray: {}, blue: {}, red: {}, green: {}, orange: {} },
  createUniver: () => {
    calls.created += 1;
    return {
      univer: { dispose: () => { calls.disposed += 1; }, __getInjector: () => ({ get: () => null }) },
      univerAPI: {
        createWorkbook: () => ({
          setEditable: (v: boolean) => { calls.editable.push(v); },
          save: () => ({ id: "workbook", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: {} } } }),
        }),
        setTheme: () => undefined,
        getActiveWorkbook: () => workbook,
        addEvent: () => ({ dispose: () => undefined }),
        executeCommand: () => true,
        getSheets: () => [sheet],
        Event: { CommandExecuted: "command-executed" },
      },
    };
  },
}));
vi.mock("./mobileUniverPreset", () => ({
  createMobileSheetsCorePreset: (cfg: Record<string, unknown>) => { calls.core = cfg; calls.container = String(cfg.container); return { plugins: [] }; },
  createMobileSheetsDrawingPreset: () => ({ plugins: [] }),
  createMobileSheetsHyperLinkPreset: () => ({ plugins: [] }),
}));
vi.mock("@univerjs/preset-sheets-core/locales/zh-CN", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-drawing/locales/zh-CN", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-hyper-link/locales/zh-CN", () => ({ default: {} }));
vi.mock("@univerjs/sheets-crosshair-highlight/locale/zh-CN", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-hyper-link/lib/index.css", () => ({}));
vi.mock("@univerjs/sheets-crosshair-highlight/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-core/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-drawing/lib/index.css", () => ({}));
vi.mock("../hooks/useKeyboard", () => ({ useKeyboard: () => ({ base: 842, innerHeight: 530, offset: 0, height: 312, keyboardOpen: true }) }));

import { MobileUsheetViewer, usheetImageSrc } from "./MobileUsheetViewer";

const BODY = JSON.stringify({
  kind: "usheet", version: 1,
  workbook: { id: "workbook", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: { "0": { "0": { v: "季度预算" } } } } } },
});

Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 320 });
window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as typeof window.requestAnimationFrame;

async function mount(active: boolean, editing = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const { act } = await import("react");
  await act(async () => {
    root.render(createElement(MobileUsheetViewer, { noteId: "n1", content: BODY, active, editing, onChange: () => undefined }));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { root, host };
}

const click = async (host: HTMLElement, label: string) => {
  const { act } = await import("react");
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  expect(button).toBeTruthy();
  await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("移动端表格查看/编辑器（dock v5）", () => {
  it("未活动的 tab 不建 Univer 实例", async () => {
    calls.created = 0; calls.editable.length = 0;
    const { root } = await mount(false);
    expect(calls.created).toBe(0);
    root.unmount();
  });

  it("阅读态：顶部行 + 阅读工具条在，编辑面（公式栏/dock）不在；内核公式栏不挂", async () => {
    calls.created = 0; calls.editable.length = 0; calls.core = null;
    const { root, host } = await mount(true);
    const core = (calls.core ?? {}) as Record<string, unknown>;
    expect(calls.created).toBe(1);
    expect(calls.editable).toEqual([false]);
    expect(core.toolbar).toBe(false);
    expect(core.formulaBar).toBe(false);
    expect(calls.container).toBe("mobile-usheet-n1");
    expect(host.querySelector(".mb-usheet-topbar")).toBeTruthy();
    expect(host.querySelector(".mb-usheet-readingbar")).toBeTruthy();
    expect(host.querySelector(".mb-usheet-formula")).toBeNull();
    expect(host.querySelector(".mb-usheet-dock")).toBeNull();
    expect(host.querySelector(".mb-usheet-panel")).toBeNull();
    root.unmount();
  });

  it("编辑态：公式栏显示地址与值；dock 一级按钮 + 撤销/重做 + 键盘", async () => {
    calls.created = 0; calls.editable.length = 0;
    const { root, host } = await mount(true, true);
    expect(calls.created).toBe(1);
    expect(calls.editable).toEqual([true]);
    const formula = host.querySelector(".mb-usheet-formula");
    expect(formula).toBeTruthy();
    expect(formula!.querySelector(".mb-usheet-formula__addr")?.textContent).toBe("A1");
    expect(formula!.querySelector('button[aria-label="确认输入"]')).toBeTruthy();
    expect(formula!.querySelector<HTMLInputElement>(".mb-usheet-formula__input")?.value).toBe("季度预算");
    const dock = host.querySelector(".mb-usheet-dock");
    expect(dock).toBeTruthy();
    expect(dock!.getAttribute("aria-label")).toBe("表格工具");
    for (const label of ["插入", "文字格式", "数据", "视图", "更多", "撤销", "重做"]) {
      expect(dock!.querySelector('button[aria-label="' + label + '"]')).toBeTruthy();
    }
    // 键盘键两态：jsdom 里没有真键盘（keyboardOpen=false）⇒ 显示「展开键盘」。
    expect(dock!.querySelector("button.mb-usheet-dock__kb")).toBeTruthy();
    expect(host.querySelector(".mb-usheet-readingbar")).toBeNull();
    root.unmount();
  });

  it("公式栏提交：文本 / 数字 / 公式三条分支写回活动单元格", async () => {
    const { root, host } = await mount(true, true);
    const { act } = await import("react");
    const input = host.querySelector<HTMLInputElement>(".mb-usheet-formula__input")!;
    const type = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    };
    calls.setValue.length = 0; calls.setFormula.length = 0;
    await type("完成");
    await type("42");
    await type("=SUM(A1:A2)");
    expect(calls.setValue).toEqual(["完成", 42]);
    expect(calls.setFormula).toEqual(["=SUM(A1:A2)"]);
    root.unmount();
  });

  it("面板：点「文字格式」→ 按钮变 ✕ + 面板出现（dock 在面板上方）；再点收起", async () => {
    const { root, host } = await mount(true, true);
    await click(host, "文字格式");
    const dock = host.querySelector(".mb-usheet-dock")!;
    const panel = host.querySelector(".mb-usheet-panel");
    expect(panel).toBeTruthy();
    expect(dock.querySelector('button[aria-label="关闭文字格式"]')).toBeTruthy();
    // DOM 顺序：dock 在面板前面（面板占键盘区、工具条在它上方）
    expect(dock.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const label of ["加粗", "斜体", "下划线", "删除线", "水平对齐 左", "垂直对齐 上", "字号 16"]) {
      expect(panel!.querySelector('button[aria-label="' + label + '"]')).toBeTruthy();
    }
    expect(panel!.querySelectorAll(".mb-usheet-swatch").length).toBe(14);
    await click(host, "关闭文字格式");
    expect(host.querySelector(".mb-usheet-panel")).toBeNull();
    root.unmount();
  });

  it("插入面板：4 连块 + 7 个白块；没有公式", async () => {
    const { root, host } = await mount(true, true);
    await click(host, "插入");
    const panel = host.querySelector(".mb-usheet-panel")!;
    expect(panel.querySelectorAll(".mb-usheet-inserter__btn").length).toBe(4);
    expect(panel.querySelectorAll(".mb-usheet-tile").length).toBe(7);
    for (const label of ["在上方插入行", "在下方插入行", "在左侧插入列", "在右侧插入列", "单元格图片", "链接", "日期", "批注"]) {
      expect(panel.querySelector('button[aria-label="' + label + '"]')).toBeTruthy();
    }
    expect(panel.querySelector('button[aria-label="公式"]')).toBeNull();
    root.unmount();
  });

  it("数据 / 视图 / 更多面板：占位置灰；更多可下钻数字格式", async () => {
    const { root, host } = await mount(true, true);
    await click(host, "数据");
    let panel = host.querySelector(".mb-usheet-panel")!;
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="数据验证（下拉列表）"]')?.disabled).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="分列"]')?.disabled).toBe(true);
    await click(host, "视图");
    panel = host.querySelector(".mb-usheet-panel")!;
    expect(panel.querySelector('button[aria-label="冻结行列"]')).toBeTruthy();
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="表单视图"]')?.disabled).toBe(true);
    await click(host, "更多");
    panel = host.querySelector(".mb-usheet-panel")!;
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="条件格式"]')?.disabled).toBe(true);
    await click(host, "数字格式");
    panel = host.querySelector(".mb-usheet-panel")!;
    expect(panel.querySelector(".mb-usheet-back")?.textContent).toContain("数字格式");
    expect(panel.textContent).toContain("数字");
    root.unmount();
  });

  it("顶部 ＋ = 新建工作表（走 facade insertSheet 并切过去）", async () => {
    const { root, host } = await mount(true, true);
    calls.insertSheet = 0;
    await click(host, "新建工作表");
    expect(calls.insertSheet).toBe(1);
    // 新页签命名沿用 SheetN（不与已有 Sheet1 的「工作表N」混用）。
    root.unmount();
  });

  it("顶部行：高亮当前行列是纯本机视图开关（aria-pressed 切换）", async () => {
    const { root, host } = await mount(true);
    const toggle = host.querySelector<HTMLButtonElement>('.mb-usheet-topbar button[aria-label="高亮当前行列"]');
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");
    await click(host, "高亮当前行列");
    expect(host.querySelector<HTMLButtonElement>('.mb-usheet-topbar button[aria-label="高亮当前行列"]')!.getAttribute("aria-pressed")).toBe("true");
    root.unmount();
  });

  it("图片 source：资产 filename 走本机 AssetServer canonical URL；http/data 原样", () => {
    const url = usheetImageSrc("1712345678_ab12cd34.png", "n1");
    expect(url).toContain("/n1/1712345678_ab12cd34.png");
    expect(usheetImageSrc("https://example.com/a.png", "n1")).toBe("https://example.com/a.png");
    expect(usheetImageSrc("data:image/png;base64,AAAA", "n1")).toBe("data:image/png;base64,AAAA");
  });
});
