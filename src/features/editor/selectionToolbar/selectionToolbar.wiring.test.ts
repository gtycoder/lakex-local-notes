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
const AI_SEL = readFileSync(new URL("./aiModelSelection.ts", import.meta.url), "utf8");
// AI 结果落库的两个操作抽成共用模块（浮栏 + 块句柄菜单同源，261005）
const OPS = readFileSync(new URL("./aiResultOps.ts", import.meta.url), "utf8");

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

describe("AI 回写「插入到选区后」护栏（261005）", () => {
  it("只把 AI 结果用 insertAtPosition 插到选区末块之后，绝不重建原选区", () => {
    // 浮栏只负责把捕获的模型选区交给共用实现（块句柄菜单同源）
    expect(SRC).toContain("applyAiInsertAfter(editor, container, aiModelRangeRef.current, text)");
    expect(OPS).toContain("positionAfterModelRange(");
    expect(OPS).toContain('"insertAtPosition"');
    // 旧实现：原文(纯文本) + AI 整体 insertAtSelection 替换 ⇒ 列表/标题块结构被 markdown 重解析丢失
    expect(SRC).not.toContain('"insertAtSelection", "text/markdown", data');
    expect(SRC).not.toContain("const original = aiSelectionRef.current");
  });

  it("落点按模型父子关系算（内核 DOM「某元素之后」映射少 1，不能用）", () => {
    expect(AI_SEL).toContain("positionAfterModelRange");
    expect(AI_SEL).toContain("_parent");
    expect(AI_SEL).toContain("_children");
  });

  it("applyModelRange 走 kernel.execCommand（editor 层拿模型节点会抛且被静默吞掉）", () => {
    expect(AI_SEL).toMatch(/const target = kernel && typeof kernel\.execCommand === "function" \? kernel : ed/);
  });

  it("插入用「分隔线 + AI 生成提示」标记（不再用引用）；替换原样插入、不加标记", () => {
    expect(OPS).toContain("buildAiInsertMarkdown(text)");
    expect(SRC).not.toContain("toQuoteMarkdown");
    expect(OPS).toContain('"insertAtSelection", "text/markdown", text');
    // 插入后仍自动选中，且跳过前置的「AI 生成」提示段（用户 261005：AI 正文首次插入要保持选中）
    expect(OPS).toContain("selectNewBlocks(container, before, true)");
    // 浮栏的替换也走共用实现（含打开前的 DOM 选区兜底）
    expect(SRC).toContain("applyAiReplace(editor, container, aiModelRangeRef.current, text, aiRangeRef.current)");
  });

  it("多模态：选区含图自动带图；图片浮栏有「AI」入口；面板收到 attachments", () => {
    // 文字 AI 入口：开面板前收集选区里的图片（不用手动附图）
    expect(SRC).toContain("collectSelectionImageRefs(aiRangeRef.current)");
    // 图片浮栏入口：单张图片作为上下文
    expect(SRC).toContain("openAiForImage");
    expect(SRC).toContain("imageCardAssetRef");
    expect(SRC).toMatch(/tip="AI"[^\n]*openAiForImage/);
    // 面板拿到图片上下文
    expect(SRC).toContain("attachments={aiAttachmentsRef.current}");
    // 关面板清上下文（下次顶栏/文字入口不带旧图）
    expect(SRC).toContain("aiAttachmentsRef.current = []");
    // 图片浮栏的 AI 入口放**最后**（与文字浮栏「分隔线 + AI 收尾」一致）：源码顺序上「另存为」在它前面
    expect(SRC.indexOf('tip="另存为"')).toBeLessThan(SRC.indexOf('tip="AI"'));
    // 图片弹层必须在 .ne-card-toolbar **外面**：内核给它设了 transform（实测 offsetParent=ne-card-toolbar），
    // position:fixed 会相对工具栏定位 ⇒ 坐标再加一次偏移（260930「弹窗歪到最左」的根因）。
    const toolbarStart = SRC.indexOf('className="ne-card-toolbar"');
    const firstPopover = SRC.indexOf("selection-toolbar__cardpop");
    expect(toolbarStart).toBeGreaterThanOrEqual(0);
    expect(SRC.slice(toolbarStart, firstPopover)).toContain("</div>");
    // 图片浮栏只留图标（261005）：文字标签与 -has-title 全部退掉，名称靠 hover tip
    for (const label of ["宽高", "描述", "样式", "边距"]) expect(SRC).not.toContain("<span>" + label + "</span>");
    expect(SRC).not.toContain("ne-card-toolbar-dropdown-item-has-title");
    expect(SRC).not.toContain("ne-card-toolbar-select-item-has-title");
    expect(SRC).not.toContain("ne-card-toolbar-item-has-title");
    // 图片选中时 Cmd/Ctrl+X = 剪切：copy 到剪贴板 + **单卡**删除
    // （绝不能用块级删除 —— 会把同一个块里的其它图片/文字一起删掉）
    expect(SRC).toContain("deleteCardNative(cardEl, cardId, editor)");
    // 覆盖所有卡片类型：任意 ne-card 都记「最近点过的卡」，图片 target 优先
    expect(SRC).toContain("el.closest(\"ne-card\")");
    expect(SRC).toContain("activeCardRef.current");
    expect(SRC).toContain('document.execCommand("copy")');
    expect(SRC).not.toMatch(/deleteBlockByRange\s*\(/);   // 注释里可以提到，但不能真的调用
    expect(SRC).not.toContain("topLevelBlockOf");
  });
});
