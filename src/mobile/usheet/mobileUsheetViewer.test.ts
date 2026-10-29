/**
 * 移动端表格查看/编辑器（kind=usheet）挂载护栏（261025：原生公式栏 + 编辑态 dock）。
 *
 * jsdom + mock 掉 Univer 运行时（真 canvas 在模拟器实测）：只验「宿主这一层」的行为：
 * - 未活动过的 tab 不建实例；阅读态不挂编辑面、保留顶部行与阅读工具条；
 * - 编辑态 = 只读地址/值条（点一下进原生编辑）+ dock（插入/T/数据/视图/更多/撤销/重做/键盘）+ 面板；
 * - 双击单元格 → 启动内核原生编辑（set-cell-edit-visible）；原生 canvas 公式栏由内核 UI 插件渲染；
 * - 面板展开时一级按钮变 X、再点收起；面板占键盘区（DOM 顺序：dock 在面板上方）；
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
  fontSize: number[];
  insertSheet: number;
  /** 内核 CommandExecuted 回调（测试里手动触发，模拟选区/命令变化）。 */
  commandHandler?: (event: { id?: string }) => void;
  /** executeCommand 调用记录（「选中区域被盖住才最小滚动」的护栏）。 */
  commands: Array<{ id: string; params?: Record<string, unknown> }>;
  /** 测试可替换的内核 save() 快照（CORE-03：模拟真实改动 / 改回原样）。 */
  savedBook: Record<string, unknown> | null;
} = { created: 0, disposed: 0, editable: [], core: null, container: null, setValue: [], setFormula: [], fontSize: [], insertSheet: 0, commands: [], savedBook: null };

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
  setFontSize: (size: number) => { calls.fontSize.push(size); return range; },
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
          save: () => calls.savedBook ?? ({ id: "workbook", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: {} } } }),
        }),
        setTheme: () => undefined,
        getActiveWorkbook: () => workbook,
        addEvent: (_name: string, cb: (event: { id?: string }) => void) => { calls.commandHandler = cb; return { dispose: () => undefined }; },
        executeCommand: (id: string, params?: Record<string, unknown>) => { calls.commands.push({ id, params }); return true; },
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

async function mount(
  active: boolean,
  editing = false,
  content = BODY,
  onCapture?: (capture: (() => string | null) | null) => void,
  onChange: (next: string) => void = () => undefined,
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const { act } = await import("react");
  await act(async () => {
    root.render(createElement(MobileUsheetViewer, { noteId: "n1", content, active, editing, onChange, onCapture }));
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

  it("编辑态：只读地址/值条 + dock 一级按钮 + 撤销/重做 + 键盘", async () => {
    calls.created = 0; calls.editable.length = 0;
    const { root, host } = await mount(true, true);
    expect(calls.created).toBe(1);
    expect(calls.editable).toEqual([true]);
    const readBar = host.querySelector(".mb-usheet-fbar");
    expect(readBar?.querySelector(".mb-usheet-fbar__addr")?.textContent).toBe("A1");
    expect(readBar?.querySelector(".mb-usheet-fbar__value")?.textContent).toBe("季度预算");
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

  it("面板：点「文字格式」→ 按钮变 ✕ + 面板出现（dock 在面板上方）；再点收起", async () => {
    const { root, host } = await mount(true, true);
    await click(host, "文字格式");
    const dock = host.querySelector(".mb-usheet-dock")!;
    const panel = host.querySelector(".mb-usheet-panel");
    expect(panel).toBeTruthy();
    expect(dock.querySelector('button[aria-label="关闭文字格式"]')).toBeTruthy();
    // DOM 顺序：dock 在面板前面（面板占键盘区、工具条在它上方）
    expect(dock.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const label of ["加粗", "斜体", "下划线", "删除线", "清除格式", "水平对齐 左", "垂直对齐 上", "减小字号", "增大字号"]) {
      expect(panel!.querySelector('button[aria-label="' + label + '"]')).toBeTruthy();
    }
    expect(panel!.querySelector(".mb-usheet-fsize__value")?.textContent).toBe("14");
    // 8 个字体色 + 14 个填充色 = 22 个方块色板
    expect(panel!.querySelectorAll(".mb-usheet-ccolor").length).toBe(22);
    await click(host, "关闭文字格式");
    // 关闭后要么保持挂载（closingHold，等键盘盖住）且 data-open=0，要么已卸载（jsdom 无键盘）。
    const closingPanel = host.querySelector(".mb-usheet-panel");
    // 关闭过渡中：panel 仍挂载且带 data-closing=1（等键盘盖住才卸载，与文档 dock 同款）。
    expect(!closingPanel || closingPanel.getAttribute("data-closing") === "1" || closingPanel.getAttribute("data-open") === "0").toBe(true);
    root.unmount();
  });

  it("面板⇄键盘互斥（MOB-07）：开面板收原生编辑，关面板放回键盘", async () => {
    const { root, host } = await mount(true, true);
    calls.commands.length = 0;
    await click(host, "文字格式");
    // 面板吃键盘区：先关内核原生编辑（公式栏不得浮在面板上）。
    expect(calls.commands).toContainEqual({ id: "sheet.operation.set-cell-edit-visible", params: { visible: false, eventType: 3 } });
    // 表格不接管外壳高：--mb-app-h 只由文档编辑面写（表格自己的可视区用 --mb-usheet-kb-offset）。
    expect(document.documentElement.style.getPropertyValue("--mb-app-h")).toBe("");
    calls.commands.length = 0;
    // 关面板 = restore 档：放回键盘（与文档编辑面同一条路）。
    await click(host, "关闭文字格式");
    expect(calls.commands).toContainEqual({ id: "sheet.operation.set-cell-edit-visible", params: { visible: true, eventType: 3 } });
    root.unmount();
  });

  it("T 面板反显：当前格的背景色 / 字色 / 加粗在面板上标出来（含 rgb() 归一化）", async () => {
    const { root, host } = await mount(true, true);
    const { act } = await import("react");
    await click(host, "文字格式");
    const panel = host.querySelector(".mb-usheet-panel")!;
    // 默认格：无填充应处于选中态
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="背景填充 无填充"]')!.className).toContain("is-on");
    const original = range.getCellStyleData;
    range.getCellStyleData = () => ({ bl: 1, bg: { rgb: "rgb(229, 72, 77)" }, cl: { rgb: "#E5484D" } });
    try {
      await act(async () => { calls.commandHandler?.({ id: "sheet.command.set-style" }); });
    } finally {
      range.getCellStyleData = original;
    }
    const fillRed = panel.querySelector<HTMLButtonElement>('button[aria-label="背景填充 红"]')!;
    const fontRed = panel.querySelector<HTMLButtonElement>('button[aria-label="字体颜色 红色"]')!;
    const bold = panel.querySelector<HTMLButtonElement>('button[aria-label="加粗"]')!;
    expect(fillRed.className).toContain("is-on");
    expect(fillRed.getAttribute("aria-pressed")).toBe("true");
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="背景填充 无填充"]')!.className).not.toContain("is-on");
    expect(fontRed.className).toContain("is-on");
    expect(fontRed.getAttribute("aria-pressed")).toBe("true");
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    root.unmount();
  });

  it("字号步进：+ 按档位调大字号（14 → 15）；最小值时 − 置灰", async () => {
    const { root, host } = await mount(true, true);
    await click(host, "文字格式");
    const dec = host.querySelector<HTMLButtonElement>('.mb-usheet-panel button[aria-label="减小字号"]')!;
    expect(dec.disabled).toBe(true);
    calls.fontSize.length = 0;
    await click(host, "增大字号");
    expect(calls.fontSize).toEqual([15]);
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

  it("编辑态双击单元格 → 启动内核原生编辑（原生公式栏接管输入）", async () => {
    const { root, host } = await mount(true, true);
    const { act } = await import("react");
    const grid = host.querySelector(".mobile-usheet-root");
    expect(grid).toBeTruthy();
    const fire = async (x: number, y: number) => {
      await act(async () => {
        grid!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      });
    };
    calls.commands.length = 0;
    await fire(100, 200);
    await fire(102, 201);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
    expect(calls.commands).toContainEqual({ id: "sheet.operation.set-cell-edit-visible", params: { visible: true, eventType: 3 } });
    root.unmount();
  });

  it("非编辑态（原生栏未挂）显示只读地址/值条，点一下进入原生编辑", async () => {
    const { root, host } = await mount(true, true);
    const bar = host.querySelector<HTMLButtonElement>(".mb-usheet-fbar");
    expect(bar).toBeTruthy();
    expect(host.querySelector(".mb-usheet-fbar__addr")?.textContent).toBe("A1");
    expect(host.querySelector(".mb-usheet-fbar__value")?.textContent).toBe("季度预算");
    calls.commands.length = 0;
    await click(host, "编辑单元格");
    expect(calls.commands).toContainEqual({ id: "sheet.operation.set-cell-edit-visible", params: { visible: true, eventType: 3 } });
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

  it("坏正文：只读保护（横幅 + 编辑面不出现 + capture 恒 null），合法空正文仍可编辑", async () => {
    calls.created = 0; calls.editable.length = 0;
    let capture: (() => string | null) | null = null;
    const { root, host } = await mount(true, true, "{ 不是 JSON", (c) => { capture = c; });
    const banner = host.querySelector("[data-usheet-parse-error]");
    expect(banner?.getAttribute("role")).toBe("status");
    expect(banner?.textContent).toContain("无法解析");
    // 坏正文不挂可编辑形态：内核一次 setEditable(true) 都不能发生；编辑面（公式栏/dock）不出现。
    expect(calls.created).toBe(1);
    expect(calls.editable).not.toContain(true);
    expect(host.querySelector(".mb-usheet-fbar")).toBeNull();
    expect(host.querySelector(".mb-usheet-dock")).toBeNull();
    // 阅读条保留（只读查看），capture 恒 null ⇒ 任何保存路径都拿不到可写正文。
    expect(host.querySelector(".mb-usheet-readingbar")).toBeTruthy();
    expect(typeof capture).toBe("function");
    expect(capture!()).toBeNull();
    root.unmount();

    // 合法空正文 = 可编辑空表（不能把「空」误判成「坏」）。
    calls.created = 0; calls.editable.length = 0;
    const empty = await mount(true, true, "");
    expect(empty.host.querySelector("[data-usheet-parse-error]")).toBeNull();
    expect(calls.editable).toContain(true);
    empty.root.unmount();
  });

  it("CORE-03：无改动 capture 返回磁盘原文；改回原样不写盘；真实改动才 onChange", async () => {
    calls.created = 0; calls.editable.length = 0;
    calls.savedBook = {
      id: "workbook", sheetOrder: ["s1"],
      sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 5, columnCount: 3, cellData: { "0": { "0": { v: "季度预算" } } } } },
    };
    let capture: (() => string | null) | null = null;
    const changes: string[] = [];
    const { root, host } = await mount(true, true, BODY, (c) => { capture = c; }, (next) => { changes.push(next); });
    try {
      // 无改动：内核 save() 缺 defaultStyle 等字段（要靠 normalize 补），capture 仍返回磁盘原文。
      expect(capture!()).toBe(BODY);
      expect(changes).toEqual([]);
      // 内容输入判据与桌面同款：键盘/粘贴/dock 点击才允许把差异当编辑。
      host.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      const sheet = (calls.savedBook!.sheets as Record<string, { cellData: Record<string, Record<string, unknown>> }>).s1;
      sheet.cellData["0"]["0"] = { v: "已改" };
      const changed = capture!();
      expect(changed).not.toBe(BODY);
      expect(changed).toContain("已改");
      expect(changes.length).toBe(1);
      // 改回原样：与磁盘原文规范化后等价 ⇒ 返回磁盘原文，且不再通知外层。
      sheet.cellData["0"]["0"] = { v: "季度预算" };
      expect(capture!()).toBe(BODY);
      expect(changes.length).toBe(1);
    } finally {
      calls.savedBook = null;
      root.unmount();
    }
  });

  it("图片 source：资产 filename 走本机 AssetServer canonical URL；http/data 原样", () => {
    const url = usheetImageSrc("1712345678_ab12cd34.png", "n1");
    expect(url).toContain("/n1/1712345678_ab12cd34.png");
    expect(usheetImageSrc("https://example.com/a.png", "n1")).toBe("https://example.com/a.png");
    expect(usheetImageSrc("data:image/png;base64,AAAA", "n1")).toBe("data:image/png;base64,AAAA");
  });
});
