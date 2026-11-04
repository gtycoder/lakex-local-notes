import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHROME_HIDE_DELTA, CHROME_SHOW_DELTA, CHROME_TOP_PX, chromeAfterScroll } from "./scrollChrome";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WS = read("./NotebookWorkspace.tsx");
/** 261103 P10-①：chrome/滚动/手势逻辑拆到 useWorkspaceChrome.ts。 */
const CHROME = read("./useWorkspaceChrome.ts");
/** 261103 P9-5b：文档层 pane 列表 + 骨架拆到 NotePaneHost.tsx。 */
const PANE = read("./NotePaneHost.tsx");
/** 261103 P4：胶囊拆成 WorkspaceCapsule.tsx ⇒ 相关静态断言改读组件源码。 */
const CAPSULE = read("./WorkspaceCapsule.tsx");
/** 261103 P9：顶栏拆成 WorkspaceTopBar.tsx。 */
const TOPBAR = read("./WorkspaceTopBar.tsx");
const APP = read("../MobileApp.tsx");
const CSS = read("../mobile.css");
/** 261103 二轮：编辑态胶囊的层序对手 = 底部 dock（z-index 在 editor-dock.css）。 */
const DOCK = read("../editor/editor-dock.css");

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
    expect(CHROME).toContain('chromeAfterScroll(cur, top, dy)');
    expect(CHROME).toContain('classList?.contains("mobile-doc-body")');
    expect(CHROME).toMatch(/meta\.kind !== "doc" \|\| meta\.editing/);
    expect(TOPBAR).toContain("mobile-topbar--auto-hidden");
    expect(WS).toContain("chromeHidden={chromeHiddenNow}");
    // 261103 二轮：文档编辑态**常显**胶囊（抬到 dock 上方），但键盘弹起时隐藏、二级面板展开时被 dock 层级盖住；
    // 表格/多维表/画板/手写板编辑态仍隐藏。顶栏自动收起判据不变。
    expect(CHROME).toContain('const capsuleInEdit = !!active?.editing && (active?.kind ?? "doc") === "doc";');
    expect(CHROME).toContain("const { keyboardOpen } = useKeyboard();");
    // 261104：判据抽到 capsuleVisibility 纯函数 + 面板阶段**冻结**可见性（面板开合会顺带切 IME，旧判据会在过渡里抖一次 → 胶囊滑入/滑出闪）。
    expect(CHROME).toContain("const baseHidden = baseCapsuleHidden({");
    expect(CHROME).toContain("frozenHiddenRef.current = baseHidden");
    expect(CHROME).toContain("const capsuleHidden = capsuleHiddenFor({");
    expect(CHROME).toContain("frozenHidden: frozenHiddenRef.current");
    // 编辑态胶囊显隐瞬时（无过渡）：否则残余键盘路径仍会滑入/滑出。
    expect(CSS).toMatch(/\.mobile-bottom-bar--above-dock\s*\{[^}]*transition:\s*none/);
    expect(WS).toContain("aboveDock={capsuleInEdit}");
    expect(CAPSULE).toContain("mobile-bottom-bar--above-dock");
    // 层序：胶囊 above-dock = 2，dock 容器 = 4 ⇒ 二级面板展开时盖住胶囊（反向就是"胶囊浮在色板上"）。
    expect(CSS).toMatch(/\.mobile-bottom-bar--above-dock\s*\{[^}]*z-index:\s*2/);
    expect(DOCK).toMatch(/\.mobile-editor-dock\s*\{[^}]*z-index:\s*4/);
    // 打开任意浮层 → 导航必须回来
    expect(CHROME).toMatch(/sidebarOpen \|\| outlineOpen \|\| tabsOpen \|\| notebookSwitchOpen\) showChrome\(\)/);
  });

  it("CSS：顶栏高度过渡收起 + reduced-motion 关闭", () => {
    expect(CSS).toMatch(/\.mobile-topbar--auto-hidden\s*\{[^}]*height:\s*0/);
    expect(CSS).toMatch(/\.mobile-topbar\s*\{[^}]*transition:\s*height var\(--mobile-duration-panel\)/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,1200}\.mobile-topbar\s*\{\s*transition:\s*none/);
  });

  it("转场骨架 + 正文淡入：工作区首次挂载与异步读回都先画骨架", () => {
    expect(APP).toContain("mobile-route-skeleton");
    expect(APP).not.toContain("加载中…");
    expect(PANE).toContain("mb-doc-skeleton");
    expect(PANE).toContain("doc-pane--fresh");
    expect(CSS).toMatch(/\.doc-pane--fresh \.mobile-doc-body\s*\{\s*animation:\s*mb-doc-fade/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,1200}\.doc-pane--fresh \.mobile-doc-body\s*\{\s*animation:\s*none/);
  });
});
