/**
 * 移动端表格查看器（kind=usheet，只读）挂载护栏。
 *
 * jsdom + mock 掉 Univer 运行时（真 canvas 在桌面/模拟器实测）：只验「宿主这一层」的行为：
 * - 未活动过的 tab 不建实例（隐藏态量成 0 尺寸，canvas 引擎渲不出来）；
 * - 实例以 **只读** 挂载（`setEditable(false)`）、**不挂工具条/公式栏**、**不保存不写库**；
 * - 喂给内核的是正文里的 workbook（usheet 正文绝不交给 Lake 编辑器）；
 * - 图片 source 走本机 AssetServer canonical URL。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// React 18 的 act 环境标记（否则每个 act 都会打 "not configured to support act" 警告）
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const calls: { created: number; disposed: number; editable: boolean[]; core: Record<string, unknown> | null; container: string | null } =
  { created: 0, disposed: 0, editable: [], core: null, container: null };

vi.mock("@univerjs/presets", () => ({
  LocaleType: { ZH_CN: "zh-CN" },
  mergeLocales: (...m: unknown[]) => Object.assign({}, ...m),
  defaultTheme: { primary: {}, gray: {}, blue: {}, red: {}, green: {}, orange: {} },
  createUniver: (options: Record<string, unknown>) => {
    calls.created += 1;
    return {
      univer: { dispose: () => { calls.disposed += 1; }, __getInjector: () => ({ get: () => null }) },
      univerAPI: {
        createWorkbook: () => ({ setEditable: (v: boolean) => { calls.editable.push(v); } }),
        setTheme: () => undefined,
      },
    };
    void options;
  },
}));
vi.mock("@univerjs/preset-sheets-core", () => ({
  UniverSheetsCorePreset: (cfg: Record<string, unknown>) => { calls.core = cfg; calls.container = String(cfg.container); return { cfg }; },
}));
vi.mock("@univerjs/preset-sheets-drawing", () => ({ UniverSheetsDrawingPreset: () => ({}) }));
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

async function mount(active: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const { act } = await import("react");
  await act(async () => { root.render(createElement(MobileUsheetViewer, { noteId: "n1", content: BODY, active })); });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return { root, host };
}

describe("移动端表格查看器（只读）", () => {
  it("未活动的 tab 不建 Univer 实例", async () => {
    calls.created = 0; calls.editable.length = 0;
    const { root } = await mount(false);
    expect(calls.created).toBe(0);
    root.unmount();
  });

  it("活动 tab：只读挂载 + 不挂工具条/公式栏 + 容器 id 正确", async () => {
    calls.created = 0; calls.editable.length = 0; calls.core = null;
    const { root, host } = await mount(true);
    const core = (calls.core ?? {}) as Record<string, unknown>;
    expect(calls.created).toBe(1);
    expect(calls.editable).toEqual([false]);            // setEditable(false)：移动端只读
    expect(core.toolbar).toBe(false);                   // 不挂工具条
    expect(core.formulaBar).toBe(false);                // 不挂公式栏
    expect(calls.container).toBe("mobile-usheet-n1");
    expect(host.querySelector(".mobile-usheet")).toBeTruthy();
    root.unmount();
  });

  it("图片 source：资产 filename 走本机 AssetServer canonical URL；http/data 原样", () => {
    const url = usheetImageSrc("1712345678_ab12cd34.png", "n1");
    expect(url).toContain("/n1/1712345678_ab12cd34.png");
    expect(usheetImageSrc("https://example.com/a.png", "n1")).toBe("https://example.com/a.png");
    expect(usheetImageSrc("data:image/png;base64,AAAA", "n1")).toBe("data:image/png;base64,AAAA");
  });
});
