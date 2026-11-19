// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 视频「宽度」弹层（261119 用户终裁：「视频宽度弹窗还是使用内核风格吧，就和图片的风格保持一致就行了」）
 * 的 render 护栏。钉三件事：
 * ① 表面 / 预设行必须复用**卡工具条内核家族**（CardMenu / CardMenuItem 的 .ne-card-toolbar-select-menu*
 *    类栈，与 renderImage 的图片二级菜单同一组件，cardMenu.tsx 单一来源）——不得自带 ln-menu / ln-input /
 *    ln-btn / ln-segment（该弹窗属卡工具条内核家族表面，例外于 ln-* 单一来源）；
 * ② 几何对拍：与参照物逐项一致 —— 参照 = 同组件渲染的 renderImage 菜单 DOM + vendored lakex-doc.css 的
 *    内核规格（圆角 5 / 行高 30 / 标签 14px / 对勾槽 30px）+ 图片弹窗同型输入（30px 高 / 1px 边）；
 * ③ 功能不变（宽度输入 + Enter/「应用」提交 + 25/50/75/100 预设档点选即应用 + 一句说明文案 + Tab 可达）。
 */
// 内核原子件（kernelUiAtoms）模块求值即 import 闭源内核包（jsdom 下撞 window.matchMedia）⇒ 桩掉。
// 桩的 DOM 镜像内核真身：KIcon → .ne-icon 图标；KButton = antd Button（FrameworkUiLib.Button）→
// `button.ant-btn`（内核链接弹层「确定」同款，见 bundle dv 组件 / kernelUiAtoms.KButton）。
vi.mock("./kernelUiAtoms", async () => {
  const { createElement: h } = await import("react");
  return {
    KIcon: ({ type }: { type: string }) => h("span", { className: "ne-icon", "data-icon": type }),
    KButton: ({ onClick, children }: { onClick?: () => void; children?: ReactNode }) =>
      h("button", { type: "button", className: "ant-btn", onClick }, h("span", null, children as never)),
  };
});

import { CardMenu, CardMenuItem } from "./cardMenu";
import { VideoSizeMenu } from "./VideoSizeMenu";

// jsdom 环境下 import.meta.url 不是 file: scheme ⇒ 按仓库根解析（vitest root = 仓库根）。
const ROOT = process.cwd();
const CSS = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/selectionToolbar.css"), "utf8");
const KERNEL_CSS = readFileSync(path.resolve(ROOT, "vendor/lakex-doc-react/src/assets/lakex-doc.css"), "utf8");
const ANTD_CSS = readFileSync(path.resolve(ROOT, "vendor/lakex-doc-react/src/assets/antd.css"), "utf8");
const VIDEO_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/VideoSizeMenu.tsx"), "utf8");
const TOOLBAR_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/SelectionToolbar.tsx"), "utf8");

/** 极简规则扫描：先剥注释（注释里出现大括号会切碎规则），再取叶子规则的 { selector, body }（@media 外壳自然跳过）。 */
function rulesOf(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}
/** 选择器**恰好**等于 selector 的规则声明体（可多条：内核源文件有成对重复块）。 */
function exactBodies(css: string, selector: string): string[] {
  return rulesOf(css).filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector)).map((r) => r.body);
}
/** 选择器**包含** fragment 的规则声明体。 */
function containingBodies(css: string, fragment: string): string[] {
  return rulesOf(css).filter((r) => r.selector.includes(fragment)).map((r) => r.body);
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onDraftChange = vi.fn();
const onApplyWidth = vi.fn();
const onApplyPreset = vi.fn();
function renderMenu(widthPercent = 100, draft = "100") {
  act(() => root.render(createElement(VideoSizeMenu, {
    widthPercent, draft, onDraftChange, onApplyWidth, onApplyPreset,
    style: { left: 12, top: 34 }, surfaceRef: () => {},
  })));
}
/** 参照物 = renderImage 的图片二级菜单（同一对 CardMenu / CardMenuItem 组件的另一处调用）。 */
function renderReference(): { refHost: HTMLDivElement; refRoot: ReturnType<typeof createRoot> } {
  const refHost = document.createElement("div");
  document.body.append(refHost);
  const refRoot = createRoot(refHost);
  act(() => refRoot.render(createElement(CardMenu, {
    menu: "imgalign",
    surfaceRef: () => {},
    children: [
      createElement(CardMenuItem, { key: "center", label: "居中对齐", icon: "editor-alignmentCenter", selected: true, onClick: () => {} }),
      createElement(CardMenuItem, { key: "right", label: "右对齐", icon: "editor-alignmentRight", onClick: () => {} }),
    ],
  })));
  return { refHost, refRoot };
}
const refs: { refHost: HTMLDivElement; refRoot: ReturnType<typeof createRoot> }[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renderMenu();
});
afterEach(() => {
  for (const r of refs.splice(0)) { act(() => r.refRoot.unmount()); r.refHost.remove(); }
  act(() => root.unmount()); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

const menu = () => host.querySelector<HTMLElement>('.selection-toolbar__kmenu[data-menu="videosize"]')!;
const surfaceUl = () => menu().querySelector<HTMLUListElement>("ul.ant-dropdown-menu")!;
const presetItems = () => [...surfaceUl().querySelectorAll<HTMLLIElement>("li.ant-dropdown-menu-item")];

// ───────────────────────────── ① 表面 / 行 = CardMenu 家族 ─────────────────────────────
describe("视频宽度弹层 = 卡工具条内核家族（261119 终裁）", () => {
  it("表面复用 CardMenu 类栈（参照 = renderImage 图片二级菜单同组件），不得自带 ln-menu / 卡片白面板", () => {
    const { refHost, refRoot } = renderReference();
    refs.push({ refHost, refRoot });
    const refUl = refHost.querySelector<HTMLUListElement>("ul.ant-dropdown-menu")!;
    // 表面类栈逐字对拍（含 .ne-card-toolbar-select-menu 与 ant-dropdown-menu* 全套）
    expect(surfaceUl().className).toBe(refUl.className);
    expect(surfaceUl().className).toContain("ne-card-toolbar-select-menu");
    expect(menu().className).toBe(refHost.querySelector(".selection-toolbar__kmenu")!.className);
    expect(menu().getAttribute("data-menu")).toBe("videosize");
    // 例外于 ln-* 单一来源的口径 = **不引入** ln-* 原语；也不是图片「宽高/链接/边距」的白卡面板
    expect(menu().querySelector('[class*="ln-"]')).toBeNull();
    expect(menu().className).not.toContain("ln-menu");
    expect(menu().classList.contains("selection-toolbar__cardpop")).toBe(false);
    // 浮层坐标由调用方实测传入（placePopoverPosition），除此之外不得有内联样式
    expect(menu().querySelectorAll("[style]")).toHaveLength(0);
  });

  it("预设档 = CardMenuItem 同款（类栈 / 对勾槽 / 选中态逐项对拍）", () => {
    const { refHost, refRoot } = renderReference();
    refs.push({ refHost, refRoot });
    const items = presetItems();
    expect(items.map((el) => el.querySelector(".ne-card-toolbar-select-item-label")!.textContent)).toEqual(["25%", "50%", "75%", "100%"]);
    const refItems = [...refHost.querySelectorAll<HTMLLIElement>("li.ant-dropdown-menu-item")];
    // 选中 / 未选中两种形态的类栈与参照物逐字一致（选中 = ant-dropdown-menu-item-selected 翻对勾）
    const selected = items.filter((el) => el.classList.contains("ant-dropdown-menu-item-selected"));
    expect(selected).toHaveLength(1);
    expect(selected[0].querySelector(".ne-card-toolbar-select-item-label")!.textContent).toBe("100%");
    expect(selected[0].className).toBe(refItems[0].className);
    expect(items[0].className).toBe(refItems[1].className);
    // 对勾槽结构与参照物一致：.ne-card-toolbar-check-icon 常驻（opacity 由内核 CSS 控制，几何不动）
    for (const el of items) {
      const check = el.querySelector(".ne-card-toolbar-check-icon")!;
      expect(check).not.toBeNull();
      expect(check.innerHTML).toBe(refItems[0].querySelector(".ne-card-toolbar-check-icon")!.innerHTML);
      expect(el.querySelector(".ne-card-toolbar-select-item-content > .ne-card-toolbar-select-item-label")).not.toBeNull();
    }
    // 交互保留：aria-pressed + 点选即应用
    expect(selected[0].getAttribute("aria-pressed")).toBe("true");
    expect(items[0].getAttribute("aria-pressed")).toBe("false");
    items[2].click();
    expect(onApplyPreset).toHaveBeenCalledWith(75);
  });

  it("几何对拍：内核 lakex-doc.css 规格（圆角 5 / 行高 30 / 标签 14px / 对勾槽 30px）且本文件不覆盖家族几何", () => {
    // 表面：5px 圆角、无 hairline（阴影来自同族 .ant-dropdown-menu，非自造）
    const surfaceBodies = exactBodies(KERNEL_CSS, ".ne-card-toolbar-select-menu");
    expect(surfaceBodies.length).toBeGreaterThan(0);
    expect(surfaceBodies.join("\n")).toContain("border-radius: 5px");
    expect(surfaceBodies.join("\n")).not.toMatch(/border\s*:/);
    expect(surfaceBodies.join("\n")).not.toContain("box-shadow");
    // 行：30px 行高 + 30px 对勾槽的内容列（30px 左 / 20px 右）
    const itemBodies = containingBodies(KERNEL_CSS, ".ne-card-toolbar-select-menu-item").join("\n");
    expect(itemBodies).toContain("line-height: 30px");
    expect(itemBodies).toContain("padding: 10px 20px 10px 30px");
    expect(containingBodies(KERNEL_CSS, ".ne-card-toolbar-select-item-label").join("\n")).toContain("font-size: 14px");
    const checkBodies = containingBodies(KERNEL_CSS, ".ne-card-toolbar-check-icon").join("\n");
    expect(checkBodies).toContain("width: 30px");
    expect(checkBodies).toContain("opacity: 0");
    expect(containingBodies(KERNEL_CSS, "ant-dropdown-menu-item-selected .ne-card-toolbar-check-icon").join("\n")).toContain("opacity: 1");
    // 本文件零家族几何覆盖：不给 .ne-card-toolbar-select* 写任何规则（单一来源 = vendored 内核 CSS）
    expect(rulesOf(CSS).map((r) => r.selector).filter((s) => s.includes(".ne-card-toolbar-select"))).toEqual([]);
  });

  it("输入行 = 图片弹窗同型 .ne-card-toolbar-input（30px 高 / 1px 边）+ 内核 input-title 标签", () => {
    const input = menu().querySelector<HTMLInputElement>("input.ne-card-toolbar-input")!;
    expect(input).not.toBeNull();
    expect(input.closest(".selection-toolbar__inputrow")).not.toBeNull();
    expect([...menu().querySelectorAll(".ne-card-toolbar-input-title")].map((el) => el.textContent)).toEqual(["宽度", "%"]);
    expect(input.type).toBe("number");
    expect(input.min).toBe("10");
    expect(input.max).toBe("100");
    expect(input.value).toBe("100");
    expect(input.getAttribute("aria-label")).toBe("正文宽度百分比");
    // 与图片「宽高」弹窗同一条共享规则（改造前该弹窗的输入样式）：30px 高 / 1px 边
    const inputRule = exactBodies(CSS, ".selection-toolbar__inputrow .ne-card-toolbar-input").join("\n");
    expect(inputRule).toContain("height: 30px");
    expect(inputRule).toMatch(/border: 1px solid/);
    // 输入改值只回传草稿，不直接落库；Enter = 提交（IME 组合期不提交，见 imeEnterWiring 护栏）
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "60");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith("60");
    expect(onApplyWidth).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onApplyWidth).toHaveBeenCalledTimes(1);
  });

  it("「应用」= 卡工具条家族按钮（KButton / button.ant-btn，链接弹层「确定」同款），不引入 ln-btn", () => {
    const apply = menu().querySelector<HTMLButtonElement>("button.ant-btn")!;
    expect(apply).not.toBeNull();
    expect(apply.textContent).toMatch(/^应\s*用$/);
    expect(apply.className).not.toContain("ln-");
    // 源码层（剥掉注释）：本弹层不出现任何 ln-* 原语（ln-btn / ln-input / ln-menu / ln-segment）
    const videoCode = VIDEO_SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(videoCode).not.toMatch(/\bln-(btn|input|menu|segment)/);
    apply.click();
    expect(onApplyWidth).toHaveBeenCalledTimes(1);
  });

  it("键盘可达（Tab）+ 说明文案 = 菜单底部一句 12px 脚注", () => {
    // 输入 + 应用 + 4 预设档全部可聚焦（input/button 原生；菜单项 focusable = tabIndex 0）
    const focusables = [menu().querySelector("input")!, menu().querySelector("button")!, ...presetItems()];
    expect(focusables).toHaveLength(6);
    for (const el of presetItems()) expect(el.tabIndex).toBe(0);
    // 菜单项 Enter / Space 激活（li 不是原生 button，组件内补齐）
    presetItems()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onApplyPreset).toHaveBeenCalledWith(50);
    presetItems()[3].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onApplyPreset).toHaveBeenCalledWith(100);
    const note = menu().querySelector(".selection-toolbar__video-note")!;
    expect(note.textContent).toBe("100% 表示铺满正文栏（非视频原始像素），也可直接拖动视频左右边缘。");
  });
});

// ───────────────────────────── ② 几何断言（CSS 单一来源） ─────────────────────────────
describe("视频宽度弹层几何断言（CSS 单一来源）", () => {
  it("业务排版类只写排版：表面视觉（边/影/圆角/底色）零声明，全由内核菜单家族提供", () => {
    for (const selector of ["selection-toolbar__videorow", "selection-toolbar__video-note"]) {
      const body = exactBodies(CSS, "." + selector).join("\n");
      expect(body, selector).not.toMatch(/border|box-shadow|border-radius|background/);
    }
  });

  it("说明文案 = 12px 档（--lake-font-size-tiny）辅助文字", () => {
    const body = exactBodies(CSS, ".selection-toolbar__video-note").join("\n");
    expect(body).toContain("font-size: var(--lake-font-size-tiny)");
    expect(body).toContain("color: var(--lake-text-3)");
  });

  it("百分比数字 tabular-nums = 内核 antd base 自带（body），本家族不再另写", () => {
    const body = exactBodies(ANTD_CSS, "body").join("\n");
    expect(body).toMatch(/font-variant:\s*tabular-nums/);
    expect(body).toMatch(/font-feature-settings:\s*["']tnum["']/);
    expect(rulesOf(CSS).map((r) => r.body).filter((b) => b.includes("font-variant"))).toEqual([]);
  });

  it("卡工具条家族单一来源：renderImage 与 VideoSizeMenu 共用 cardMenu.tsx 的 CardMenu / CardMenuItem", () => {
    expect(VIDEO_SRC).toContain('from "./cardMenu"');
    expect(TOOLBAR_SRC).toContain('from "./cardMenu"');
    expect(TOOLBAR_SRC).toContain("<CardMenu");
    // 组件拆分保留（render 护栏的挂点）
    expect(VIDEO_SRC).toContain("export function VideoSizeMenu");
  });
});
