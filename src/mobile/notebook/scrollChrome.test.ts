import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHROME_HIDE_DELTA, CHROME_SHOW_DELTA, CHROME_TOP_PX, chromeAfterScroll } from "./scrollChrome";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WS = read("./NotebookWorkspace.tsx");
const APP = read("../MobileApp.tsx");
const CSS = read("../mobile.css");

describe("阅读时顶栏/底栏自动收起（261019，对齐思源）", () => {
  it("判据：顶部展开、向下累计到阈值收起、向上更灵敏、反向清零", () => {
    const atTop = chromeAfterScroll({ hidden: true, acc: 0 }, 0, -40);
    expect(atTop).toEqual({ hidden: false, acc: 0 });

    let s = chromeAfterScroll({ hidden: false, acc: 0 }, 100, CHROME_TOP_PX - 10);
    expect(s.hidden).toBe(false);
    s = chromeAfterScroll(s, 120, CHROME_HIDE_DELTA - (CHROME_TOP_PX - 10));
    expect(s.hidden).toBe(true);
    // 收起后继续向下滚保持收起
    expect(chromeAfterScroll(s, 200, 40)).toEqual({ hidden: true, acc: 0 });
    // 向上累计到 SHOW 才展开
    expect(chromeAfterScroll({ hidden: true, acc: 0 }, 180, -(CHROME_SHOW_DELTA - 1)).hidden).toBe(true);
    expect(chromeAfterScroll({ hidden: true, acc: 0 }, 160, -CHROME_SHOW_DELTA)).toEqual({ hidden: false, acc: 0 });
    // 未收起时向上滚不累计
    expect(chromeAfterScroll({ hidden: false, acc: 10 }, 300, -5)).toEqual({ hidden: false, acc: 0 });
  });

  it("工作区接线：只认 mobile-doc-body、编辑态不参与、开浮层复位、顶栏/胶囊同一判据", () => {
    expect(WS).toContain('chromeAfterScroll(cur, top, dy)');
    expect(WS).toContain('classList?.contains("mobile-doc-body")');
    expect(WS).toMatch(/meta\.kind !== "doc" \|\| meta\.editing/);
    expect(WS).toContain("mobile-topbar--auto-hidden");
    expect(WS).toMatch(/active\?\.editing \|\| chromeHiddenNow/);
    // 打开任意浮层 → 导航必须回来
    expect(WS).toMatch(/sidebarOpen \|\| outlineOpen \|\| tabsOpen \|\| notebookSwitchOpen\) showChrome\(\)/);
  });

  it("CSS：顶栏高度过渡收起 + reduced-motion 关闭", () => {
    expect(CSS).toMatch(/\.mobile-topbar--auto-hidden\s*\{[^}]*height:\s*0/);
    expect(CSS).toMatch(/\.mobile-topbar\s*\{[^}]*transition:\s*height var\(--mobile-duration-panel\)/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,1200}\.mobile-topbar\s*\{\s*transition:\s*none/);
  });

  it("转场骨架 + 正文淡入：工作区首次挂载与异步读回都先画骨架", () => {
    expect(APP).toContain("mobile-route-skeleton");
    expect(APP).not.toContain("加载中…");
    expect(WS).toContain("mb-doc-skeleton");
    expect(WS).toContain("doc-pane--fresh");
    expect(CSS).toMatch(/\.doc-pane--fresh \.mobile-doc-body\s*\{\s*animation:\s*mb-doc-fade/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,1200}\.doc-pane--fresh \.mobile-doc-body\s*\{\s*animation:\s*none/);
  });
});
