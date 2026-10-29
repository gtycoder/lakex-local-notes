import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_TRANSITION_MS, routeTransitionMs } from "./useRouteTransition";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const APP = read("../MobileApp.tsx").replace(/\/\*\*[\s\S]*?\*\//g, "");
const CSS = read("../mobile.css");
/** 去注释版：断言"某条规则里没有某声明"时必须排除注释（修复说明里会引用同样的名字）。 */
const CSS_RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const HOOK = read("./useRouteTransition.ts").replace(/\/\*\*[\s\S]*?\*\//g, "");

describe("路由转场（261019，对齐语雀 push）", () => {
  it("时长单一来源 = 250ms（= --mobile-duration-panel），reduced-motion 下 0", () => {
    expect(ROUTE_TRANSITION_MS).toBe(250);
    expect(routeTransitionMs(false)).toBe(250);
    expect(routeTransitionMs(true)).toBe(0);
  });

  it("MobileApp 走状态机 hook：两层 + 首页常驻 + 返回统一 close", () => {
    expect(APP).toContain("useRouteTransition(route.kind");
    expect(APP).toContain("mobile-route-stage");
    expect(APP).toContain("mobile-route-layer--home");
    expect(APP).toContain("mobile-route-layer--workspace");
    expect(APP).toMatch(/onBack=\{closeWorkspace\}/);
    expect(APP).toMatch(/onBackFromNotebook: requestWorkspaceBack/);
    // 首页不再"按路由条件渲染"（常驻 = 页栈语义，返回时滚动/数据都在）
    expect(APP).not.toMatch(/route\.kind === "home" && \(\s*<HomePage/);
  });

  it("hook：挂载后下一帧才播放入场；出场播完才卸载；非活动层 inert", () => {
    expect(HOOK).toContain("setOpen(true)");
    expect(HOOK).toContain("setAnimating(true)");
    expect(HOOK).toMatch(/routeTransitionMs\(prefersReducedMotion\(\)\)/);
    expect(HOOK).toContain("setMounted(false)");
    expect(HOOK).toMatch(/toggleAttribute\("inert"/);
    expect(HOOK).toContain("aria-hidden");
  });

  it("入场播完撤掉 transform + will-change 只限转场期间（fixed 包含块回到视口）", () => {
    expect(HOOK).toContain("setSettled(true)");
    expect(HOOK).toContain("setSettled(false)");
    expect(HOOK).toMatch(/routeTransitionMs\(prefersReducedMotion\(\)\) \+ 50/);
    expect(APP).toContain('wsSettled ? " is-settled" : ""');
    expect(CSS).toMatch(/\.mobile-route-stage\.is-open \.mobile-route-layer--workspace\.is-settled \{\s*transform:\s*none;/);
    // 261020：layer 上**不得**常驻 will-change:transform —— 它自己就会把 fixed 包含块改成 layer 盒，
    // 小记写作卡的「Aa / ＋」二级面板会被钉在 --mb-app-h 下沿（上移一个键盘高、下方空一片）。
    // 取 base 规则本体（行首 .mobile-route-layer { … }），不能只看选择器后缀 —— .is-animating 那条也以它结尾。
    const layerBaseRule = CSS_RULES.match(/(?:^|\n)\.mobile-route-layer \{([^}]*)\}/)?.[1] ?? "";
    expect(layerBaseRule).toContain("transition:");
    expect(layerBaseRule).not.toContain("will-change");
    expect(CSS).toMatch(/\.mobile-route-stage\.is-animating \.mobile-route-layer \{\s*will-change:\s*transform;/);
    expect(HOOK).toContain("setAnimating(true)");
    expect(HOOK).toContain("setAnimating(false)");
    expect(APP).toContain('routeAnimating ? " is-animating" : ""');
  });

  it("CSS：新页 100%→0、旧页 25% 视差、250ms 令牌、reduced-motion 关闭", () => {
    expect(CSS).toMatch(/\.mobile-route-stage\s*\{[^}]*overflow:\s*hidden/);
    expect(CSS).toMatch(/\.mobile-route-layer\s*\{[^}]*transition:\s*transform var\(--mobile-duration-panel\)/);
    expect(CSS).toMatch(/\.mobile-route-layer--workspace\s*\{[^}]*transform:\s*translateX\(100%\)/);
    // 工作区层必须不透明（否则首页常驻层会从表格/多维表的透明容器里透出来，261019 实测）
    expect(CSS).toMatch(/\.mobile-route-layer--workspace\s*\{[^}]*background:\s*var\(--lake-bg-canvas\)/);
    // 转场层必须按自身边界裁切：工作区的 off-canvas 抽屉是 fixed + translateX(±100%)，layer 位移时
    // 会"探进"视口（261019 用户报"从常用进入/退出闪一下"的根因，实测 push 到 x=58 时文档树可见）
    expect(CSS).toMatch(/\.mobile-route-layer\s*\{[^}]*overflow:\s*hidden/);
    expect(CSS).toMatch(/\.mobile-route-stage\.is-open \.mobile-route-layer--home\s*\{\s*transform:\s*translateX\(-25%\)/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,160}\.mobile-route-layer\s*\{\s*transition:\s*none/);
  });
});
