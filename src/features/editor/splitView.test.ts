/**
 * 文档分屏护栏（261008）。方案已定稿：**左右两栏、最多两个、不同文档、临时不持久化**。
 *
 * 这里锁的是容易回归的语义（真机拖拽/焦点由 CDP 验收覆盖）：
 * · 只有两栏（splitPair = { left, right }），不复用成多栏/嵌套；
 * · 两栏必须是不同文档（分屏入口排除当前标签）；同一文档仍然只能开一次；
 * · 分屏是临时状态：不写 localStorage、不进 settings；
 * · 分隔条复用唯一实现 SplitHandle（不再写第二套）；
 * · data-active 仍全局唯一（焦点栏），右栏靠 data-pane-visible 显示。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MULTITAB = read("./MultiTabEditor.tsx");
const EDITORTAB = read("./EditorTab.tsx");
const USHEET = read("../usheet/UniverSheetEditor.tsx");
const BITABLE = read("../bitable/BitableEditor.tsx");
const BOARD = read("../board/BoardEditor.tsx");
const SPLITCSS = read("./splitView.css");
const TABSCSS = read("../../styles/app/tabs.css");
const CHROMECSS = read("../../styles/chrome.css");
const APP = read("../../App.tsx");
const TOPBAR = read("../../desktop/DesktopTopBar.tsx");
const STATE = read("../../hooks/useWorkspaceState.ts");
const TABORDER = read("./tabOrder.ts");

describe("文档分屏（左右两栏、不同文档、临时）", () => {
  it("只有两栏：splitPair 结构固定为 { left, right }，没有多栏/嵌套", () => {
    expect(STATE).toContain("useState<{ left: string; right: string } | null>(null)");
    expect(MULTITAB).toMatch(/splitPair?: { left: string; right: string } | null;/);
    expect(SPLITCSS).toContain(".tab-panels.is-split");
    expect(SPLITCSS).toMatch(/grid-template-columns: minmax\(0, var\(--split-left, 1fr\)\) minmax\(0, 1fr\)/);
  });

  it("不同文档：入口排除当前标签，且同一对左右不能相同（同文档仍只能开一次）", () => {
    expect(TOPBAR).toContain("openTabs.filter((t) => t.noteId !== activeNoteId)");
    expect(APP).toMatch(/if \(!activeNoteId \|\| noteId === activeNoteId\) return;/);
    expect(APP).toContain("splitPair.left === splitPair.right");
  });

  it("临时不持久化：分屏状态不写 localStorage / 不进 settings", () => {
    expect(MULTITAB).not.toContain("lake-notes-v3.split");
    expect(SPLITCSS).not.toContain("localStorage");
    expect(STATE).not.toMatch(/splitPair[\s\S]{0,120}localStorage/);
  });

  it("分隔条复用唯一实现 SplitHandle（不再写第二套交互）", () => {
    expect(MULTITAB).toContain("<SplitHandle");
    expect(MULTITAB).toContain("onCommit={(next) => setSplitLeft(next)}");
  });

  it("右栏右上角只有 2 个选项：取消分屏 / 左右互换", () => {
    expect(MULTITAB).toContain("tab-split-controls");
    expect(MULTITAB).toContain("取消分屏");
    expect(MULTITAB).toContain("左右互换");
    expect(MULTITAB).not.toContain("切换到垂直");
  });

  it("复合的分屏标签右键 = 分屏专属菜单（取消分屏 / 左右互换），不混入单页语义（261014 用户点单）", () => {
    // 合并标签自己带 onContextMenu，并打上 split 标记
    const groupAt = MULTITAB.indexOf('data-split-group="true"');
    const ctxAt = MULTITAB.indexOf("onContextMenu={(event) => {", groupAt);
    expect(groupAt).toBeGreaterThan(-1);
    expect(ctxAt, "合并标签自己带 onContextMenu（右键分屏菜单）").toBeGreaterThan(groupAt);
    expect(MULTITAB).toContain("split: true");
    // 菜单在 split 模式下只给两项（取消分屏 / 左右互换），直接 return、不落到单页那套
    expect(MULTITAB).toMatch(/if \(split\) \{\s*return \(/);
    expect(MULTITAB).toMatch(/split\.onExit\(\)[\s\S]{0,200}取消分屏/);
    expect(MULTITAB).toMatch(/split\.onSwap\(\)[\s\S]{0,200}左右互换/);
    // 两个动作都接在 App 既有回调上（不新造一套分屏开关）
    expect(MULTITAB).toContain("onExitSplit?.()");
    expect(MULTITAB).toContain("onSwapSplit?.()");
  });

  it("分屏在标签栏 = 一个合并标签（Edge 式）：点它进分屏、点其它标签不替换", () => {
    // 合并标签：一个 tab-item，两段标题 + 分隔线 + 分组图标 + **一个** ×
    expect(MULTITAB).toContain("tab-split-tab");
    expect(MULTITAB).toContain("data-split-group");
    expect(MULTITAB).toContain("tab-split-tab__divider");
    expect(MULTITAB).toContain("onActivateSplit");
    expect(MULTITAB).toContain("onCloseSplit");
    // 只有分屏组**激活**（焦点在组内）才显示两栏 / 分隔条 / 浮动工具条
    expect(MULTITAB).toMatch(/const splitActive = useMemo\(/);
    expect(MULTITAB).toContain('className={`tab-panels${splitActive ? " is-split" : ""}`}');
    // 两半各自带自己文档的图标（261012 用户点单：右半此前丢图标）
    expect(MULTITAB).toContain('{splitLeftTab?.icon && <span className="tab-custom-icon"');
    expect(MULTITAB).toContain('{splitRightTab?.icon && <span className="tab-custom-icon"');
    // 已删除「点第三个标签替换分屏栏」；点其它标签 = 普通切换
    expect(APP).not.toContain("placeSplitTabs");
    expect(APP).not.toContain("替换焦点那一栏并保留分屏");
    expect(APP).toContain("onTabChange={handleTabChangeBase}");
    // 合并标签的 × = 取消分屏（两个标签都保留，不连带关闭）
    expect(APP).toContain("const closeSplit = useCallback(() => setSplitPair(null)");
    // 合并标签视觉的单一来源在 shell 层 chrome.css
    expect(CHROMECSS).toContain(".tab-split-tab .tab-split-tab__divider");
  });

  it("分屏期间标签仍可拖拽排序：合并标签代表整组，两页整块落回同一槽位（261012）", () => {
    // 旧实现是 beginTabDrag 里 splitPair 早退 ⇒ 分屏后完全不能拖；现在放开，并把「槽位 → 真实顺序」交给纯函数
    expect(MULTITAB).toContain("if (event.button !== 0 || !onTabsReorder) return;");
    expect(MULTITAB).toContain("data-note-id={splitFirstNote ?? undefined}");
    expect(MULTITAB).toContain("expandTabSlots(nextSlots, splitFirstNote, groupMembers)");
    expect(MULTITAB).toContain("onPointerDown={(event) => { if (splitFirstNote) beginTabDrag(event, splitFirstNote); }}");
    expect(TABORDER).toContain("export function expandTabSlots");
  });

  it("data-active 全局唯一（焦点栏），右栏靠 data-pane-visible 显示", () => {
    for (const host of [EDITORTAB, USHEET, BITABLE, BOARD]) {
      expect(host).toContain("data-active={(focused ?? visible) ? \"true\" : undefined}");
      expect(host).toContain("data-pane-visible={visible ? \"true\" : undefined}");
      expect(host).toContain("data-pane={pane ?? undefined}");
    }
    expect(TABSCSS).toContain(':not([data-active="true"]):not([data-pane-visible="true"])');
  });
});
