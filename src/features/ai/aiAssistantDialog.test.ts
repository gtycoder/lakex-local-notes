import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AI 助手弹窗定位护栏（261004）。
 *
 * 用户反复报「AI 弹窗盖住选区」；真实端（隔离 Electron + mock OpenAI）定位到根因是：
 * 贴选区的弹窗走了通用「下方放不下就翻上方」的定位，内容流式长高到 maxHeight 后翻到选区上方。
 * 这里用源码级护栏锁住修复的关键接线（完整几何由 topMenuPosition.test.ts 的纯函数用例覆盖）。
 */
const DIALOG = readFileSync(new URL("./AiAssistantDialog.tsx", import.meta.url), "utf8");
const TOOLBAR = readFileSync(new URL("../editor/selectionToolbar/SelectionToolbar.tsx", import.meta.url), "utf8");
const HOOK = readFileSync(new URL("../../hooks/usePopoverPosition.ts", import.meta.url), "utf8");

describe("AI 弹窗定位护栏（261004）", () => {
  it("关掉翻转：贴选区的弹窗只放选区下方", () => {
    expect(DIALOG).toContain("allowFlip: false");
    // 通用入口默认仍是允许翻转（右键菜单/单元格等要「至少完整可见」），不受本处影响
    expect(HOOK).toContain("allowFlip = true");
  });

  it("高度上限用 floor：round 会向上越界 ~1px，正好触发「下方放不下」的翻转", () => {
    expect(DIALOG).toContain("Math.floor(limitBottom - AI_DIALOG_MARGIN - topY)");
    expect(DIALOG).not.toMatch(/Math\.round\(limitBottom/);
  });

  it("补空间/清空间取可见挂载点，不取文档里第一个（keep-alive 下可能是隐藏实例）", () => {
    expect(DIALOG).toContain("visibleEditorMount()");
    // 打开时补空间（滚编辑区）已整条删除 —— 见下一条护栏
    expect(DIALOG).not.toContain("editorScroller(visibleEditorMount())");
  });

  it("弹窗只在打开时锚定一次，之后不再追滚动（消除快滚跳动）", () => {
    expect(TOOLBAR).toContain("aiAtRef.current = {");
    // measure() 里不再更新 aiAtRef（否则弹窗会晚一帧跟随 → 跳动）
    expect(TOOLBAR).not.toMatch(/Math\.max\(\.\.\.next\.map/);
    // 自绘选区层改用内容坐标：随正文一起滚、被滚动容器裁掉
    expect(TOOLBAR).toContain("wrap.scrollLeft");
  });

  it("打开面板**不滚动编辑区**（用户 261004：选区绝不能跳），高度以编辑区可视高封顶", () => {
    // 早期会在打开时向下滚编辑区补空间 —— 实测一帧内跳最多 807px，用户明确说体感很差，已整条删除
    expect(TOOLBAR).not.toContain("reserveAiDialogSpace");
    expect(DIALOG).not.toContain("reserveAiDialogSpace");
    expect(DIALOG).not.toContain("AI_DIALOG_MIN_HEIGHT");
    // 内容上限 = 手动拖拽上限 = 编辑区可视高
    expect(DIALOG).toContain("const resizeMax = Math.max(AI_DIALOG_RESIZE_MIN");
    expect(DIALOG).not.toContain("surfaceElRef"); // 261004 曾按面板真实高度二次推编辑区，已按用户要求收敛掉
  });

  it("AI 浮窗渲染进编辑区滚动容器、用内容坐标定位（随正文滚）且**高度封顶**", () => {
    expect(DIALOG).toContain("contentGeom");
    expect(DIALOG).toContain("container={scroller}");
    expect(DIALOG).toContain('position: "absolute"');
    // 高度上限 = 编辑区可视高 ⇒ 超出交面板内滚动（不再按选区下方可用高封顶）
    expect(DIALOG).toContain("Math.floor(wr.height - 2 * AI_DIALOG_MARGIN)");
    // 浮动工具栏入口把它传进滚动容器
    expect(TOOLBAR).toMatch(/scroller=\{container\.querySelector<HTMLElement>\("\.ne-editor-wrap"\)\}/);
  });

  it("右下角拖拽把手：只改高度（宽度不动）、有最小/上限、**不记忆**（打开即恢复自适应）", () => {
    expect(DIALOG).toContain("ai-dialog__grip");
    expect(DIALOG).toContain("startResize");
    expect(DIALOG).toContain("AI_DIALOG_RESIZE_MIN");
    // 手动拖拽用独立硬上限 resizeMax（编辑区可视高），不受内容自适应上限 capHeight 限制
    expect(DIALOG).toContain("resizeMax");
    expect(DIALOG).toMatch(/height: appliedHeight/);
    // 打开时重置为默认自适应；不写 localStorage
    expect(DIALOG).toContain("setUserHeight(null)");
    expect(DIALOG).not.toContain("localStorage.setItem(AI_DIALOG_HEIGHT_KEY");
    expect(DIALOG).not.toContain("ai-dialog-height");
    // 宽度来自正文栏，不参与拖拽
    expect(DIALOG).not.toMatch(/startResize[\s\S]{0,400}setUserWidth/);
  });

  it("按钮不做特殊高亮：替换选区与其它按钮同级（用户 261004）", () => {
    expect(DIALOG).not.toContain("ln-btn--primary");
  });
});
