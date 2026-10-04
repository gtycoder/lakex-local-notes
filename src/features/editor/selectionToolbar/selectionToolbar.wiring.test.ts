import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 浮动选区工具栏定位护栏（261004）。
 *
 * 最终方案：浮栏宿主挂进编辑区**滚动容器** .ne-editor-wrap（position:relative + overflow:auto），
 * 用**内容坐标**绝对定位 ⇒ 随正文一起滚（合成器同步，实测 selTop-toolbarTop 摆动 0px）+
 * 被滚动容器裁切（滚到顶界以上从固定工具栏下沿滑出）。几何由 selectionToolbarModel.test.ts 覆盖，这里锁接线。
 */
const SRC = readFileSync(new URL("./SelectionToolbar.tsx", import.meta.url), "utf8");
const MODEL = readFileSync(new URL("./selectionToolbarModel.ts", import.meta.url), "utf8");
const HOOK = readFileSync(new URL("./useSelectionToolbar.ts", import.meta.url), "utf8");
const MOUNT = readFileSync(new URL("./mountSelectionToolbar.ts", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./selectionToolbar.css", import.meta.url), "utf8");

describe("浮动工具栏定位护栏（261004）", () => {
  it("顶界（内核固定工具栏）取**本编辑器自己的**容器，不全局猜可见实例", () => {
    expect(SRC).toContain("chromeToolbarOf(container)");
    expect(SRC).not.toContain("visibleChromeToolbar");
    // 261005：不得用几何（height>0）在全局 .ne-ui-toolbar 里挑「可见的那个」——
    // 隐藏方式一旦换成保留布局就会静默拿错（详见 features/editor/activeEditor.ts）。
    expect(SRC).not.toMatch(/document\.querySelectorAll[^\n]*ne-ui-toolbar/);
  });

  it("宿主要挂在编辑区滚动容器里（随正文滚、被滚出裁切）", () => {
    expect(MOUNT).toContain(".ne-editor-wrap");
    expect(SRC).toContain(".ne-editor-wrap");
  });

  it("用内容坐标定位（scrollTop/scrollLeft）；不再靠 clip-path 或 scroll 重定位", () => {
    expect(SRC).toContain("wrap.scrollTop");
    expect(SRC).toContain("wrap.scrollLeft");
    expect(SRC).not.toContain("clipPath");
    expect(SRC).not.toMatch(/addEventListener\("scroll", placeToolbarNow/);
  });

  it("定位命令式写 style（不经 React state，避免晚一帧）", () => {
    expect(SRC).toContain("placeToolbarNow");
    expect(SRC).not.toContain("setPos(");
    expect(HOOK).toContain("targetRef");
  });

  it("浮栏始终贴在选区上方：只算上方档，不翻到下方；下方档默认仍夹顶界", () => {
    expect(MODEL).toContain("!allowBelow");
    expect(SRC).toMatch(/computeToolbarPosition\([\s\S]*?TOOLBAR_MARGIN,\s*false\)/);
    expect(MODEL).toContain("Math.max(topLimit, belowTop)");
  });

  it("不做「选区不可见就收起」的显隐切换（避免闪烁）", () => {
    expect(HOOK).not.toContain("editorVisibleBand");
    expect(HOOK).not.toContain("rectInVisibleBand");
  });

  it("AI 原选区高亮：自绘层用内容坐标 + absolute，几何走单一来源 lineBoxRects()", () => {
    expect(CSS).toMatch(/\.selection-toolbar__aisel \{ position: absolute;/);
    expect(SRC).toContain("lineBoxRects(");
    expect(SRC).toContain("sameRects(");
    // 不用 CSS Custom Highlight API：::highlight() 只画字形盒，撑不到行盒高度（用户 261004 实测）
    expect(SRC).not.toContain("setAiHighlight");
    expect(CSS).not.toContain("::highlight(");
    // 内容坐标：随正文滚、不在 scroll 里重算（避免跳动）
    expect(SRC).toContain("wrap.scrollTop");
    expect(SRC).not.toMatch(/addEventListener\("scroll", measure/);
    // 逐文本节点取矩形：块盒（整块满宽）会让列表/标题变成一大条背景
    expect(SRC).toContain("createTreeWalker");
    // 列表标志内核不渲染 ⇒ 排除；行尾补空格宽与内核对齐
    expect(SRC).toContain("ne-oli-i, ne-uli-i, .ne-list-symbol");
    expect(SRC).toContain("spaceWidthOf");
  });
});
