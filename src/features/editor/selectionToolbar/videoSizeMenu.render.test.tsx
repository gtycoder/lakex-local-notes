// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 视频「宽度」弹层（261119 用户第三轮点单：「视频的工具栏弹窗做的不好，都有现成的图片宽高的样板了，
 * 照着做就行了」）的 render 护栏。**样板 = 图片工具条「宽高」弹窗**（SelectionToolbar renderImage 的
 * imgsize 分支，.selection-toolbar__cardpop 白面板：「宽 [236] 高 [514]」一行 + 25/50/75/100 预设档条）。
 * 视频弹窗 = 该面板的**宽度单列变体**（「宽 [值] %」一行 + 同一预设档条）。钉四件事：
 * ① 与 imgsize 面板几何对拍：同一表面类（.selection-toolbar__cardpop）/ 同一输入类
 *    （.selection-toolbar__inputrow > .ne-card-toolbar-input）/ 同一预设条类（.ln-segment.selection-toolbar__scale
 *    + .ln-segment__item），类栈逐字对拍 —— 两者都渲染共享样板组件 MediaSizePop（组件级单一来源，不再漂）；
 * ② 形态 = 样板：无「应用」按钮、无可见说明脚注（语义提示改挂输入框 title，全局拦截器转 .ln-tip）；
 * ③ 功能断言：Enter 提交（IME 判据，与 imgsize 同一份提交代码）/ 预设点选即应用并收起 / Esc 关闭（文档级）/
 *    范围钳制（__videoWidth 10–100，normalizeVideoWidth 单一来源）；
 * ④ 防漂：上一轮 CardMenu 形态专属件已清（无 CardMenu/KButton/ln-menu；kernelUiAtoms.KButton 已撤）。
 */
import { MediaSizePop } from "./MediaSizePop";
import { VideoSizeMenu } from "./VideoSizeMenu";
import { normalizeVideoWidth } from "../videoCardOps";

// jsdom 环境下 import.meta.url 不是 file: scheme ⇒ 按仓库根解析（vitest root = 仓库根）。
const ROOT = process.cwd();
const CSS = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/selectionToolbar.css"), "utf8");
const KIT_CSS = readFileSync(path.resolve(ROOT, "src/styles/kit.css"), "utf8");
const ANTD_CSS = readFileSync(path.resolve(ROOT, "vendor/lakex-doc-react/src/assets/antd.css"), "utf8");
const POP_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/MediaSizePop.tsx"), "utf8");
const VIDEO_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/VideoSizeMenu.tsx"), "utf8");
const TOOLBAR_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/SelectionToolbar.tsx"), "utf8");
const HOOK_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/useSelectionToolbar.ts"), "utf8");
const ATOMS_SRC = readFileSync(path.resolve(ROOT, "src/features/editor/selectionToolbar/kernelUiAtoms.tsx"), "utf8");

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

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const refs: { refHost: HTMLDivElement; refRoot: ReturnType<typeof createRoot> }[] = [];
const onDraftChange = vi.fn();
const onApplyWidth = vi.fn();
const onApplyPreset = vi.fn();

/** 被测件 = 视频宽度弹窗（宽度单列变体）。 */
function renderMenu(widthPercent = 100, draft = "100") {
  act(() => root.render(createElement(VideoSizeMenu, {
    widthPercent, draft, onDraftChange, onApplyWidth, onApplyPreset,
    style: { left: 12, top: 34 }, surfaceRef: () => {},
  })));
}
/** 参照物 = **样板本体**：图片「宽高」弹窗（imgsize 的宽+高两列字段配置，用户例值 236/514）。 */
function renderImgsizeReference(): HTMLDivElement {
  const refHost = document.createElement("div");
  document.body.append(refHost);
  const refRoot = createRoot(refHost);
  act(() => refRoot.render(createElement(MediaSizePop, {
    menu: "imgsize",
    fields: [
      { label: "宽", value: "236", onChange: () => {}, onSubmit: () => {}, min: 16 },
      { label: "高", value: "514", onChange: () => {}, onSubmit: () => {}, min: 16 },
    ],
    presets: [25, 50, 75, 100],
    scalePct: 100,
    onScale: () => {},
  })));
  refs.push({ refHost, refRoot });
  return refHost;
}

/**
 * 调用方语义复刻 SelectionToolbar.renderVideo 的提交链（apply = normalizeVideoWidth 钳制 + 收起）：
 * 供「预设应用收起 / Enter 收起 / 范围钳制」断言用；与真身的一致性由源码断言钉住（见 ④）。
 */
function Harness({ startDraft = "100" }: { startDraft?: string }) {
  const [menu, setMenu] = useState<string | null>("videosize");
  const [draft, setDraft] = useState(startDraft);
  const [width, setWidth] = useState(100);
  const apply = (patch: { widthPercent: number }) => { setWidth(normalizeVideoWidth(patch.widthPercent)); setMenu(null); };
  const applyWidth = () => { const value = Number(draft); if (Number.isFinite(value)) apply({ widthPercent: value }); };
  if (menu !== "videosize") return createElement("div", { "data-collapsed": "1", "data-width": String(width) });
  return createElement(VideoSizeMenu, {
    widthPercent: width, draft, onDraftChange: setDraft, onApplyWidth: applyWidth,
    onApplyPreset: (pct) => apply({ widthPercent: pct }), surfaceRef: () => {},
  });
}
function renderHarness(startDraft?: string) {
  act(() => root.render(createElement(Harness, { startDraft, key: startDraft ?? "default" })));
}

/** 交互都要包 act：harness 的状态（收起/宽度）在 act 内才同步落 DOM。 */
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function keydown(el: HTMLElement, key: string, ime?: "composing" | "keyCode229") {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (ime === "composing") Object.defineProperty(ev, "isComposing", { value: true });
  if (ime === "keyCode229") Object.defineProperty(ev, "keyCode", { value: 229 });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}
function click(el: HTMLElement) {
  act(() => { el.click(); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  for (const r of refs.splice(0)) { act(() => r.refRoot.unmount()); r.refHost.remove(); }
  act(() => root.unmount()); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

const pop = () => host.querySelector<HTMLElement>('.selection-toolbar__cardpop[data-menu="videosize"]')!;
const row = () => pop().querySelector<HTMLElement>(".selection-toolbar__inputrow")!;
const input = () => row().querySelector<HTMLInputElement>("input.ne-card-toolbar-input")!;
const scaleBar = () => pop().querySelector<HTMLElement>(".ln-segment.selection-toolbar__scale")!;
const items = () => [...pop().querySelectorAll<HTMLButtonElement>(".ln-segment__item")];

// ───────────── ① 与图片 imgsize 面板几何对拍（同一表面类 / 同一输入类 / 同一预设条类） ─────────────
describe("视频宽度弹窗 = 图片 imgsize 面板的宽度单列变体（261119 第三轮点单）", () => {
  it("同一表面类：.selection-toolbar__cardpop 类栈逐字对拍；浮层坐标由调用方实测传入，别无内联样式", () => {
    renderMenu();
    const refHost = renderImgsizeReference();
    const refPop = refHost.querySelector<HTMLElement>(".selection-toolbar__cardpop")!;
    expect(pop().className).toBe(refPop.className);
    expect(pop().className).toBe("selection-toolbar__cardpop");
    expect(pop().getAttribute("data-menu")).toBe("videosize");
    expect(refPop.getAttribute("data-menu")).toBe("imgsize");
    // 浮层坐标（placePopoverPosition + clampToEditorArea 实测结果）之外不得有内联样式
    expect(pop().querySelectorAll("[style]")).toHaveLength(0);
  });

  it("同一输入类：.selection-toolbar__inputrow > .ne-card-toolbar-input + .ne-card-toolbar-input-title 逐字对拍", () => {
    renderMenu();
    const refHost = renderImgsizeReference();
    const refRow = refHost.querySelector<HTMLElement>(".selection-toolbar__inputrow")!;
    expect(row().className).toBe(refRow.className);
    expect(row().className).toBe("selection-toolbar__inputrow");
    const refInputs = [...refRow.querySelectorAll<HTMLInputElement>("input")];
    expect(input().className).toBe(refInputs[0].className);
    expect(input().className).toBe("ne-card-toolbar-input");
    // 标签用同一内核类（图片「宽」「高」、视频「宽」「%」）
    expect([...row().querySelectorAll(".ne-card-toolbar-input-title")].map((el) => el.textContent)).toEqual(["宽", "%"]);
    expect([...refRow.querySelectorAll(".ne-card-toolbar-input-title")].map((el) => el.textContent)).toEqual(["宽", "高"]);
  });

  it("同一预设条类：.ln-segment.selection-toolbar__scale + .ln-segment__item（选中态类同款）", () => {
    renderMenu();
    const refHost = renderImgsizeReference();
    const refBar = refHost.querySelector<HTMLElement>(".ln-segment.selection-toolbar__scale")!;
    expect(scaleBar().className).toBe(refBar.className);
    expect(scaleBar().className).toBe("ln-segment selection-toolbar__scale");
    expect(items().map((el) => el.textContent)).toEqual(["25%", "50%", "75%", "100%"]);
    const refItems = [...refBar.querySelectorAll<HTMLButtonElement>(".ln-segment__item")];
    expect(items().map((el) => el.className)).toEqual(refItems.map((el) => el.className));
    expect(items()[3].className).toContain("is-active");   // 100% = 当前生效值
    expect(items()[0].className).not.toContain("is-active");
    click(items()[2]);
    expect(onApplyPreset).toHaveBeenCalledWith(75);
  });

  it("几何单一来源 = 共享 CSS 规则（cardpop / inputrow / ln-segment 逐项钉值 = 样板同款）", () => {
    // 表面：12px 内距 / gap 10 / 1px 边 / 圆角 / 阴影（白面板，与图片宽高弹窗同一条规则）
    const popBody = exactBodies(CSS, ".selection-toolbar__cardpop").join("\n");
    expect(popBody).toContain("padding: 12px");
    expect(popBody).toContain("gap: 10px");
    expect(popBody).toContain("border: 1px solid var(--lake-border-2)");
    expect(popBody).toContain("border-radius: var(--lake-radius-md)");
    expect(popBody).toContain("background: var(--lake-bg-raised)");
    expect(popBody).toContain("box-shadow: var(--lake-shadow-popover)");
    // 输入：96×30 / 0 8px 内距 / 1px 边 / 小圆角 / small 字号
    const inputBody = exactBodies(CSS, ".selection-toolbar__inputrow .ne-card-toolbar-input").join("\n");
    expect(inputBody).toContain("width: 96px");
    expect(inputBody).toContain("height: 30px");
    expect(inputBody).toContain("padding: 0 8px");
    expect(inputBody).toContain("border: 1px solid var(--lake-border-2)");
    expect(inputBody).toContain("border-radius: var(--lake-radius-sm)");
    expect(inputBody).toContain("font-size: var(--lake-font-size-small)");
    expect(exactBodies(CSS, ".selection-toolbar__scale").join("\n")).toContain("align-self: flex-start");
    // 预设档条：kit.css 分段控件规格（27+3 轨道 / 段高 27 / 0 10px 内距 / small 字号）
    const segBody = exactBodies(KIT_CSS, ".ln-segment").join("\n");
    expect(segBody).toContain("min-height: calc(var(--lake-ctl-h) + 3px)");
    expect(segBody).toContain("padding: 1.5px");
    expect(segBody).toContain("border-radius: var(--lake-ctl-rad)");
    expect(segBody).toContain("background: var(--lake-bg-sunken)");
    const itemBody = exactBodies(KIT_CSS, ".ln-segment__item").join("\n");
    expect(itemBody).toContain("min-height: var(--lake-ctl-h)");
    expect(itemBody).toContain("padding: 0 10px");
    expect(itemBody).toContain("border: 0");
    expect(itemBody).toContain("border-radius: var(--lake-ctl-rad-sm)");
    expect(itemBody).toContain("font-size: var(--lake-font-size-small)");
  });

  it("视频侧零专属 CSS / 零专属类（几何不会再漂：只走共享规则）", () => {
    renderMenu();
    // selectionToolbar.css 不再有视频弹窗专属规则（上一轮的 __videorow / __video-note 已清；
    // [data-kind="video"] 外壳规则是图片/视频浮栏共用的定位壳，与弹窗无关，不在本钉范围）
    const selectors = rulesOf(CSS).map((r) => r.selector);
    expect(selectors.filter((s) => /videorow|video-note|videosize/i.test(s))).toEqual([]);
    // VideoSizeMenu 自己不写任何 className（全部经 MediaSizePop 共享类）
    const videoCode = VIDEO_SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(videoCode).not.toContain("className");
  });
});

// ───────────────────────── ② 形态 = 样板（无应用按钮 / 无可见脚注） ─────────────────────────
describe("形态与样板一致（一行输入 + 预设档条）", () => {
  it("内容 = 「宽 [值] %」一行 + 25/50/75/100 预设条；没有「应用」按钮", () => {
    renderMenu();
    expect(row().querySelectorAll("input")).toHaveLength(1);
    expect(input().type).toBe("number");
    expect(input().value).toBe("100");
    // 只有 4 个预设按钮，无提交按钮
    expect(pop().querySelectorAll("button")).toHaveLength(4);
    expect(pop().textContent).not.toContain("应用");
  });

  it("语义提示改挂输入框 title（全局拦截器转 .ln-tip）；可见说明脚注已删、信息不丢", () => {
    renderMenu();
    expect(input().getAttribute("title")).toBe("100% 表示铺满正文栏（非视频原始像素），也可拖动视频左右边缘");
    expect(input().getAttribute("aria-label")).toBe("正文宽度百分比");
    // 样板没有可见说明脚注 ⇒ 视频也没有（提示只在 title）
    expect(pop().querySelector(".selection-toolbar__video-note")).toBeNull();
    expect(pop().textContent).not.toContain("100% 表示铺满正文栏");
  });
});

// ─────────────────────────── ③ 功能断言（提交 / 收起 / Esc / 钳制） ───────────────────────────
describe("行为语义（与图片宽高弹窗同一份提交代码）", () => {
  it("输入改值只回传草稿；Enter 提交（imgsize 同款：Enter + IME 判据，MediaSizePop 收口）", () => {
    renderMenu();
    typeInto(input(), "60");
    expect(onDraftChange).toHaveBeenCalledWith("60");
    expect(onApplyWidth).not.toHaveBeenCalled();
    const ev = keydown(input(), "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(onApplyWidth).toHaveBeenCalledTimes(1);
  });

  it("IME 组合期的 Enter 不提交（isComposing / keyCode 229 都不触发）", () => {
    renderMenu();
    keydown(input(), "Enter", "composing");
    keydown(input(), "Enter", "keyCode229");
    expect(onApplyWidth).not.toHaveBeenCalled();
    // 判据单一来源 = core/ime.ts（MediaSizePop 引用，不自带实现）
    expect(POP_SRC).toContain('from "../../../core/ime"');
    expect(POP_SRC).not.toMatch(/function\s+isImeConfirming/);
    expect(VIDEO_SRC).not.toContain("isImeConfirming");
  });

  it("25/50/75/100 点选即应用并收起（SelectionToolbar.apply → setMenu(null) 语义）", () => {
    renderHarness();
    click(items()[2]);
    const collapsed = host.querySelector<HTMLElement>("[data-collapsed]");
    expect(collapsed).not.toBeNull();
    expect(collapsed!.getAttribute("data-width")).toBe("75");
  });

  it("Enter 提交并收起（草稿 60 → 应用 60）", () => {
    renderHarness();
    typeInto(input(), "60");
    keydown(input(), "Enter");
    const collapsed = host.querySelector<HTMLElement>("[data-collapsed]");
    expect(collapsed).not.toBeNull();
    expect(collapsed!.getAttribute("data-width")).toBe("60");
  });

  it("Esc 关闭：弹窗不拦截、不误提交（收起交给 useSelectionToolbar 文档级 keydown）", () => {
    renderMenu();
    const docSpy = vi.fn();
    document.addEventListener("keydown", docSpy);
    const ev = keydown(input(), "Escape");
    document.removeEventListener("keydown", docSpy);
    expect(onApplyWidth).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(docSpy).toHaveBeenCalledTimes(1);   // 冒泡到文档级 = 浮栏随目标一起收起
    expect(HOOK_SRC).toContain('if (event.key !== "Escape") return;');
    expect(HOOK_SRC).toContain("setTarget(null)");
  });

  it("范围钳制：__videoWidth 10–100（normalizeVideoWidth 单一来源；输入带 min/max/step）", () => {
    renderMenu();
    expect(input().min).toBe("10");
    expect(input().max).toBe("100");
    expect(input().step).toBe("1");
    // 组件不自钳（单一来源 = videoCardOps.normalizeVideoWidth）
    const videoCode = VIDEO_SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(videoCode).not.toMatch(/Math\.(min|max)/);
    expect(normalizeVideoWidth(5)).toBe(10);
    expect(normalizeVideoWidth(150)).toBe(100);
    // 提交链上的钳制（与 SelectionToolbar.applyWidth → writeVideoLayout 同语义）
    renderHarness("5");
    keydown(input(), "Enter");
    expect(host.querySelector<HTMLElement>("[data-collapsed]")!.getAttribute("data-width")).toBe("10");
    renderHarness("150");
    keydown(input(), "Enter");
    expect(host.querySelector<HTMLElement>("[data-collapsed]")!.getAttribute("data-width")).toBe("100");
  });
});

// ───────────────────────────── ④ 防漂（共享组件单一来源） ─────────────────────────────
describe("防漂：imgsize 与 videosize 共用 MediaSizePop", () => {
  it("样板分支与视频弹窗都渲染 MediaSizePop（组件级单一来源）", () => {
    expect(POP_SRC).toContain("export function MediaSizePop");
    expect(VIDEO_SRC).toContain('from "./MediaSizePop"');
    expect(VIDEO_SRC).toContain("<MediaSizePop");
    expect(VIDEO_SRC).toContain('menu="videosize"');
    expect(TOOLBAR_SRC).toContain('from "./MediaSizePop"');
    expect(TOOLBAR_SRC).toMatch(/<MediaSizePop[\s\S]{0,300}?menu="imgsize"/);
    expect(TOOLBAR_SRC).toContain("<VideoSizeMenu");
  });

  it("上一轮 CardMenu 形态专属件已清（无 CardMenu/KButton/ln-menu/对勾槽菜单）", () => {
    const videoCode = VIDEO_SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(videoCode).not.toMatch(/cardMenu|CardMenu|KButton|ln-menu|ln-btn|ant-dropdown|ne-card-toolbar-select/);
    expect(ATOMS_SRC).not.toContain("KButton");   // kernelUiAtoms.KButton 撤用法（文件保留其余原子件）
  });

  it("百分比数字 tabular-nums = 内核 antd base 自带（body），本面板不另写", () => {
    const body = exactBodies(ANTD_CSS, "body").join("\n");
    expect(body).toMatch(/font-variant:\s*tabular-nums/);
    expect(body).toMatch(/font-feature-settings:\s*["']tnum["']/);
    expect(rulesOf(CSS).map((r) => r.body).filter((b) => b.includes("font-variant"))).toEqual([]);
  });
});
