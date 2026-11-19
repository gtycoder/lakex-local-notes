// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeIconPicker } from "./NodeIconPicker";

/**
 * 目录节点图标/表情选择器。
 * 顶部「表情符号｜图标」两页页签走 kit 的 .ln-tabs__item（墨线形态，261110 有意收口、未丢样式）；
 * 表情/插画选择格（__emoji / .node-icon-cell）是登记过的**面板专属网格例外**（格高由栅格决定，
 * 硬降成 27px 图标钮会把表情与插画挤扁）。
 * 底部表情分组跳转行是**面板自有等分小页签**（261119 找回丢失样式）：261020 定稿 .node-icon-picker__tab
 * （等分 9 格 + hover 底 + 选中加粗）→ 261107 收口把 TSX 类名改成 __type-tab 而 CSS 规则留在原名
 * （99829213）⇒ 规则成孤儿 → 261110 把孤儿规则当「死类」删除、整行迁 kit .ln-tabs__item
 * （padding: 0 / flex: 0 0 auto / 缝 2px）⇒ 挤成一团、等分与三态全丢（用户 261119 报障）。
 * 下面把「等分 + 27px 行高档位 + 三态」与「样式类不离散」钉成护栏。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let anchor: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  anchor = document.createElement("button");
  document.body.append(anchor);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); anchor.remove(); vi.unstubAllGlobals(); });

const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

describe("NodeIconPicker（261110 第二批）", () => {
  it("顶部两页签 = ln-tabs__item（不再有 node-icon-picker__type-tab）", () => {
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "notebook", value: null, onPick: vi.fn(), onClose: vi.fn() })));
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('.node-icon-picker__types [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["表情符号", "图标"]);
    for (const tab of tabs) {
      expect(tab.className).toContain("ln-tabs__item");
      expect(classesOf(tab).every((name) => name.startsWith("ln-") || name.startsWith("is-"))).toBe(true);
    }
    expect(document.body.querySelector(".node-icon-picker__type-tab")).toBeNull();
    // 移除钮已是 ln-btn--ghost（第一批）
    const remove = [...document.body.querySelectorAll<HTMLButtonElement>(".node-icon-picker__types button")].find((b) => (b.textContent ?? "").includes("移除"))!;
    expect(remove.className).toContain("ln-btn--ghost");
  });

  it("切到「图标」页：插画格是登记例外（node-icon-cell），点击回灌图标值", () => {
    const onPick = vi.fn();
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "notebook", value: null, onPick, onClose: vi.fn() })));
    const iconTab = [...document.body.querySelectorAll<HTMLButtonElement>('.node-icon-picker__types [role="tab"]')].find((b) => (b.textContent ?? "") === "图标")!;
    act(() => iconTab.click());
    const cells = [...document.body.querySelectorAll<HTMLButtonElement>(".node-icon-cell")];
    expect(cells.length).toBeGreaterThan(0);
    act(() => cells[0]!.click());
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("文档类型（note）= 只有表情，不渲染页签", () => {
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "note", value: null, onPick: vi.fn(), onClose: vi.fn() })));
    expect(document.body.querySelector(".node-icon-picker__types")).toBeNull();
    expect(document.body.querySelector(".node-icon-picker__head")).not.toBeNull();
  });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const nodeIconCss = readFileSync(path.resolve(HERE, "../ui/nodeIcon.css"), "utf8");
const themesBaseCss = readFileSync(path.resolve(HERE, "../../styles/themes/base.css"), "utf8");
const pickerTsx = readFileSync(path.resolve(HERE, "./NodeIconPicker.tsx"), "utf8");
const glyphTsx = readFileSync(path.resolve(HERE, "../ui/NodeIconGlyph.tsx"), "utf8");

/** 类名对账先剥 CSS 注释：注释里保留着 __type-tab 等旧类名沿革，不能当「在用」或「有定义」。 */
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 结构钩子：无本面板视觉规格（几何由 kit / 语义由 DOM 承担），只做结构与测试选择器。
 * 新增必须写明理由；其余 node-icon-* 类一律必须在 nodeIcon.css 里有定义。
 */
const HOOK_CLASSES = new Set([
  "node-icon-picker__types", // 顶部页签行容器：几何由 kit .ln-tabs 提供，测试选择器依赖它
  "node-icon-picker__group", // 分组包裹层（label + grid 的 key 载体），无视觉规格
]);

describe("NodeIconPicker 底部分类页签行（261119 找回丢失样式）", () => {
  it("等分 9 格 + 27px 行高档位 + hover/选中/焦点三态（几何与命中区规格）", () => {
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "note", value: null, onPick: vi.fn(), onClose: vi.fn() })));
    const row = document.body.querySelector(".node-icon-picker__tabs");
    expect(row?.getAttribute("role")).toBe("tablist");
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('.node-icon-picker__tabs [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["最近", "表情", "人物", "自然", "食物", "旅行", "活动", "物品", "符号"]);
    for (const tab of tabs) {
      // 面板自有等分小页签；不能是 kit 墨线页签（261110 的整行迁移就是挤成一团的来源）
      expect(classesOf(tab)).toContain("node-icon-picker__tab");
      expect(classesOf(tab)).not.toContain("ln-tabs__item");
    }
    // jsdom 无布局 ⇒ 几何/命中区钉 CSS 规格 + 令牌实值：
    //   等分格宽 =（面板 418 − 2×8 footer 内距 − 8×2 缝）/ 9 ≈ 43px；命中高 = --lake-ctl-h（27px 行高档位）
    //   ⇒ 单格命中 ≈ 43×27 ≥ WCAG 2.5.8 的 24×24（桌面弹层不追 44 触控档；移动端自有 mb-emoji-* 一族覆盖 44）。
    const css = stripCssComments(nodeIconCss);
    const rule = css.match(/\.node-icon-picker__tab\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/flex:\s*1 1 0/); // 等分：9 格均分整行，不是「文字宽 + 缝 2px」的挤团
    expect(rule).toMatch(/height:\s*var\(--lake-ctl-h\)/);
    expect(rule).toMatch(/padding:\s*0 var\(--lake-space-xxs\)/); // 格内留白（padding: 0 是挤的另一半）
    expect(themesBaseCss).toMatch(/--lake-ctl-h:\s*27px/);
    expect(css).toContain(".node-icon-picker__tab:hover");
    expect(css).toContain(".node-icon-picker__tab.is-active");
    expect(css).toContain(".node-icon-picker__tab:focus-visible");
  });

  it("点分类页签 → is-active / aria-selected 翻转且唯一", () => {
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "note", value: null, onPick: vi.fn(), onClose: vi.fn() })));
    const tab = [...document.body.querySelectorAll<HTMLButtonElement>('.node-icon-picker__tabs [role="tab"]')].find((t) => t.textContent === "自然")!;
    expect(tab.getAttribute("aria-selected")).toBe("false");
    act(() => tab.click());
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.className).toContain("is-active");
    expect(document.body.querySelectorAll('.node-icon-picker__tabs [role="tab"].is-active').length).toBe(1);
  });

  it("样式类不离散：面板用类与 nodeIcon.css 双向对得上（防再次收口失联）", () => {
    // 99829213 型事故 = TSX 改类名、CSS 规则留在原名 ⇒ 规则孤儿、样式静默丢失（261110 进一步误删）。
    // 两个方向一起钉：① nodeIcon.css 里的 node-icon-* 类必须有人用；② 用到的 node-icon-* 类必须有定义。
    const cssClasses = new Set([...stripCssComments(nodeIconCss).matchAll(/\.node-icon[a-z0-9_-]*/g)].map((m) => m[0].slice(1)));
    const usedClasses = new Set([...(pickerTsx + glyphTsx).matchAll(/node-icon[a-z0-9_-]*/g)].map((m) => m[0]));
    for (const cls of cssClasses) expect([...usedClasses], `nodeIcon.css 的 .${cls} 已无人使用（收口改名失联？）`).toContain(cls);
    for (const cls of usedClasses) {
      if (HOOK_CLASSES.has(cls)) continue;
      expect([...cssClasses], `面板用的 ${cls} 在 nodeIcon.css 没有定义（样式失联？）`).toContain(cls);
    }
  });
});
