/**
 * task-4（261117）：Univer 表格（usheet）键盘遮挡排查收口护栏。
 *
 * 排查结论（详见交任务报告）：单元格编辑与公式栏输入 = 固定 chrome + --mb-usheet-kb-offset 避让（261013/261023 机制）；
 * 查找条 = vendor 自带 keyboardLayout 键盘避让 + adjustResize 天然安全。发现并修掉的遮挡：**公式栏实高 48px
 * （vendor .\!univer-h-12 = 3rem !important）vs 我们 44px 预留 ⇒ 固定栏盖住画布底部 4px**（活动格/光标贴底被裁）。
 * 本文件把「预留口径 == vendor 实高」「键盘避让接线」「活动格露出」钉进 vitest，供后续回归与 Univer 升级。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const CHROME = read("src/mobile/usheet/usheet-chrome.css");
const VIEWER = read("src/mobile/usheet/MobileUsheetViewer.tsx");
const MOBILE_CSS = read("src/mobile/mobile.css");
const VENDOR_CORE_CSS = read("node_modules/@univerjs/preset-sheets-core/lib/index.css");
const VENDOR_FIND_JS = read("node_modules/@univerjs/find-replace/lib/es/index.js");

/** vendor 公式栏实高：.\!univer-h-12 = N rem（!important，压不过我们普通声明）。 */
function vendorFormulaBarHeightPx(): number | null {
  const match = /\.\\!univer-h-12\s*\{\s*height:\s*(\d+(?:\.\d+)?)rem\s*!important/.exec(VENDOR_CORE_CSS);
  return match ? Number(match[1]) * 16 : null;
}

describe("usheet 键盘几何口径（261117 排查修复）", () => {
  it("公式栏实际高度由 vendor 的 3rem !important 决定（普通声明压不过 ⇒ 我们不再声明 height）", () => {
    const vendorPx = vendorFormulaBarHeightPx();
    expect(vendorPx, "vendor 原生公式栏高度档变了：重核 usheet-chrome.css 的预留口径").toBe(48);
    const inner = /\.mobile-usheet \[data-u-comp="mobile-formula-bar"\] \[data-u-comp="formula-bar"\]\s*\{([^}]*)\}/.exec(CHROME);
    expect(inner, "原生公式栏样式块丢了").toBeTruthy();
    expect(inner![1], "别再给 [data-u-comp=formula-bar] 声明 height：vendor !important 必胜，写了也是死规则").not.toMatch(/height\s*:/);
  });

  it("画布预留（chrome-spacer）与只读条（fbar）的公式栏口径 == vendor 实高（固定栏不盖画布）", () => {
    const vendorPx = vendorFormulaBarHeightPx();
    const spacer = /\.mb-usheet-chrome-spacer[^}]*var\(--mb-usheet-formula-h,\s*(\d+)px\)/.exec(CHROME);
    const fbar = /\.mb-usheet-fbar\s*\{[^}]*height:\s*var\(--mb-usheet-formula-h,\s*(\d+)px\)/.exec(CHROME);
    expect(spacer, "chrome-spacer 的公式栏预留口径").toBeTruthy();
    expect(fbar, "只读条高度口径").toBeTruthy();
    expect(Number(spacer![1])).toBe(vendorPx!);
    expect(Number(fbar![1]), "只读条与原生栏同高：进/出编辑不跳").toBe(vendorPx!);
  });

  it("预留还要把 dock 高算上（spacer = kb-offset + 公式栏 + dock）", () => {
    expect(CHROME).toMatch(/\.mb-usheet-chrome-spacer[^}]*height: calc\(var\(--mb-usheet-kb-offset, 0px\) \+ var\(--mb-usheet-formula-h, \d+px\) \+ var\(--mb-usheet-dock-h, \d+px\)\)/);
  });
});

describe("键盘避让接线（261013 机制不许散架）", () => {
  it("原生公式栏 / 只读条 / dock 都锚 --mb-usheet-kb-offset（键盘弹起随视口抬到键盘上方）", () => {
    for (const selector of [
      String.raw`\.mobile-usheet \[data-u-comp="mobile-formula-bar"\]`,
      String.raw`\.mb-usheet-fbar`,
      String.raw`\.mb-usheet-dock`,
    ]) {
      const block = new RegExp(selector + "\\s*\\{[^}]*bottom:").exec(CHROME);
      expect(block, selector + " 底边锚定丢了").toBeTruthy();
    }
    expect(CHROME).toMatch(/bottom: calc\(var\(--mb-usheet-kb-offset, 0px\) \+ var\(--mb-usheet-dock-h, 52px\)\)/);
  });

  it("MobileUsheetViewer 每帧用实时 innerHeight 写 --mb-usheet-kb-offset（面板⇄键盘过渡不闪）", () => {
    expect(VIEWER).toContain('setProperty("--mb-usheet-kb-offset"');
    expect(VIEWER).toContain("dockKbOffset(");
  });

  it("键盘/面板几何变化后：内核根高回 100% + 活动格 scroll-to-cell 露出（选中格不留在键盘后）", () => {
    expect(VIEWER).toContain('wrapper.style.height = "100%"');
    expect(VIEWER).toContain('"sheet.command.scroll-to-cell"');
    expect(VIEWER, "露出活动格必须跟随键盘几何变化").toMatch(/\[ready, kbOffset, keyboardOpen, innerHeight, ensureActiveCellVisible\]/);
  });

  it("单元格编辑入口走原生公式栏（双击拦截内核 in-cell 编辑器），输入面唯一", () => {
    expect(VIEWER, "双击单元格 = 聚焦公式栏输入面").toContain("openNativeEditor");
    expect(VIEWER, "第二下 pointerdown 必须拦掉内核 in-cell 编辑器").toMatch(/event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*openNativeEditor\(\);/);
  });
});

describe("查找条（Univer find-replace 移动条）键盘避让", () => {
  it("vendor 查找条自带 keyboardLayout 键盘避让（bottom 随键盘抬）；footer 隐藏规则放行它", () => {
    expect(VENDOR_FIND_JS).toContain("mobile-find-replace-bar");
    expect(VENDOR_FIND_JS, "vendor 查找条按 keyboardLayout.bottom 避让键盘 —— 升级后若消失需重核设备复核点").toMatch(/keyboardLayout/);
    expect(MOBILE_CSS).toContain(':has([data-u-comp="mobile-find-replace-bar"])');
  });
});
