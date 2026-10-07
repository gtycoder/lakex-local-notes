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
const SHEET = read("../sheet/SheetEditor.tsx");
const BITABLE = read("../bitable/BitableEditor.tsx");
const BOARD = read("../board/BoardEditor.tsx");
const SPLITCSS = read("./splitView.css");
const TABSCSS = read("../../styles/app/tabs.css");
const CHROMECSS = read("../../styles/chrome.css");
const APP = read("../../App.tsx");
const TOPBAR = read("../../desktop/DesktopTopBar.tsx");
const STATE = read("../../hooks/useWorkspaceState.ts");

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
    // 已删除「点第三个标签替换分屏栏」；点其它标签 = 普通切换
    expect(APP).not.toContain("placeSplitTabs");
    expect(APP).not.toContain("替换焦点那一栏并保留分屏");
    expect(APP).toContain("onTabChange={handleTabChangeBase}");
    // 合并标签的 × = 取消分屏（两个标签都保留，不连带关闭）
    expect(APP).toContain("const closeSplit = useCallback(() => setSplitPair(null)");
    // 合并标签视觉的单一来源在 shell 层 chrome.css
    expect(CHROMECSS).toContain(".tab-split-tab .tab-split-tab__divider");
  });

  it("data-active 全局唯一（焦点栏），右栏靠 data-pane-visible 显示", () => {
    for (const host of [EDITORTAB, SHEET, BITABLE, BOARD]) {
      expect(host).toContain("data-active={(focused ?? visible) ? \"true\" : undefined}");
      expect(host).toContain("data-pane-visible={visible ? \"true\" : undefined}");
      expect(host).toContain("data-pane={pane ?? undefined}");
    }
    expect(TABSCSS).toContain(':not([data-active="true"]):not([data-pane-visible="true"])');
  });
});
