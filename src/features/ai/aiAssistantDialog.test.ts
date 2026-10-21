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
    expect(DIALOG).toContain("Math.min(Math.ceil(limitBottom - AI_DIALOG_MARGIN - topY), AI_DIALOG_MAX_HEIGHT)");
    expect(DIALOG).not.toMatch(/Math\.round\(limitBottom/);
  });

  it("文字栏几何取**显式**活动挂载点（容器优先，退回 data-active），不全局猜可见实例", () => {
    expect(DIALOG).toContain("container ?? activeEditorMount()");
    // 261005：不再用几何（rect.width>0）在全局 .lake-editor-mount 里挑「可见的那个」——
    // 隐藏方式一换成保留布局就会静默拿错（详见 features/editor/activeEditor.ts）
    expect(DIALOG).not.toContain("visibleEditorMount");
    expect(DIALOG).not.toMatch(/querySelectorAll[^\n]*lake-editor-mount/);
    // 打开时补空间（滚编辑区）已整条删除 —— 见下一条护栏
    expect(DIALOG).not.toContain("editorScroller(");
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
    // 261005：面板最高 = 配置整数（不再按比例算；全高太长）
    expect(DIALOG).toContain("AI_DIALOG_MAX_HEIGHT = 512");
    expect(DIALOG).not.toContain("surfaceElRef"); // 261004 曾按面板真实高度二次推编辑区，已按用户要求收敛掉
  });

  it("AI 浮窗渲染进编辑区滚动容器、用内容坐标定位（随正文滚）且**高度封顶**", () => {
    expect(DIALOG).toContain("contentGeom");
    expect(DIALOG).toContain("container={scroller}");
    expect(DIALOG).toContain('position: "absolute"');
    // 高度上限 = 编辑区可视高 ⇒ 超出交面板内滚动（不再按选区下方可用高封顶）
    expect(DIALOG).toContain("Math.min(Math.ceil(wr.height - 2 * AI_DIALOG_MARGIN), AI_DIALOG_MAX_HEIGHT)");
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
  it("对话式：每条 AI 回答各带两个复制按钮（纯文本 / Lake 格式，用户 261005）", () => {
    expect(DIALOG).toContain("copyMessage(t.text, i)");
    expect(DIALOG).toContain("void copyAsLake(t.text, i)");
    expect(DIALOG).toContain('"ln-iconbtn ln-iconbtn--compact"');
    expect(DIALOG).toContain("ai-dialog__copy-actions");
    expect(DIALOG).not.toContain("onClick={copy}");
  });


  it("AI 回答正文走可替换的渲染接口 AiMessageBody（当前接自研 MarkdownView；换 md 库只改这一处）", () => {
    expect(DIALOG).toContain("<AiMessageBody text={t.text} />");
    const BODY = readFileSync(new URL("./AiMessageBody.tsx", import.meta.url), "utf8");
    expect(BODY).toContain("return <MarkdownView source={text} />;");   // 当前接的是共用渲染器（换库只改这一处）
    expect(BODY).not.toContain("dangerouslySetInnerHTML");
  });


  it("复制后有反馈（对应按钮 is-selected + 勾，无新 CSS）", () => {
    expect(DIALOG).toContain("copied?.index === i");
    expect(DIALOG).toContain("is-selected");
    expect(DIALOG).toContain("<Check size={12} />");
  });


  it("首轮预设：仅「有选区 + 首轮」显示；点击只填词不发送；手动改字回自定义", () => {
    // 261005 多模态：预设数组改为按上下文选（有图无字 → 图片预设），gate 也放开了「有图片」
    expect(DIALOG).toContain("{presets.map((preset) => (");
    expect(DIALOG).toContain("turns.length === 0 && (selectionText.trim().length > 0 || hasImages)");
    expect(DIALOG).toContain("AI_PROMPT_PRESETS");
    expect(DIALOG).toContain("applyPreset(preset)");
    // applyPreset 只 setInstruction + 聚焦，绝不调 run()（发送必须由用户点按钮）
    const body = DIALOG.slice(DIALOG.indexOf("const applyPreset"), DIALOG.indexOf("const copyMessage"));
    expect(body).toContain("setInstruction(");
    expect(body).not.toContain("run(");
    // 手动改字退回自定义
    expect(DIALOG).toContain("setPresetId(AI_PROMPT_CUSTOM_ID)");
  });


  it("两个复制按钮：「复制文字」/「复制为 Lake」（即时 hover 说明，Lake 图标 = lake 文字徽标）", () => {
    expect(DIALOG).toContain('"复制文字"');
    expect(DIALOG).toContain('"复制为 Lake"');
    expect(DIALOG).toContain('className="ai-dialog__lake-badge"');
    expect(DIALOG).toContain("copyMarkdownAsLake(");
    // 261008：分屏下「从哪栏选就在哪栏回写」——容器（本面板所属编辑器）优先，退回 data-active。
    expect(DIALOG).toContain("editorInstanceAt(container ?? activeEditorMount())?.kernel");   // 无内核时 Lake 按钮禁用
    expect(DIALOG).not.toContain("Braces");   // 不再用代码块图标
    // 说明走自绘 .ln-tip 即时气泡（原生 title 有约 1s 延迟，用户 261005 要求实时出）
    expect(DIALOG).toContain("copyTip.show(");
    expect(DIALOG).toContain('className="ln-tip ai-dialog__tip"');
    expect(DIALOG).not.toContain("title={copied?.index");
  });

  it("多模态：attachments 作为 image 块随首轮发出；无文字选区时改出图片预设", () => {
    expect(DIALOG).toContain("attachments?: AiAssetRef[]");
    expect(DIALOG).toContain('...attachments!.map((asset) => ({ type: "image" as const, asset }))');
    expect(DIALOG).toContain("AI_IMAGE_PRESETS");
    expect(DIALOG).toContain("hasImages");
    // 预设 gate：有文字选区**或**有图片才出现（图片-only 用图片预设）
    expect(DIALOG).toContain("selectionText.trim().length > 0 || hasImages");
  });

  it("等待与流式输出有动态状态反馈，停止即隐藏；减少动态效果仍保留文字", () => {
    expect(DIALOG).toContain("streaming && !stopped");
    expect(DIALOG).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(DIALOG).toContain('t.text.trim() ? "正在生成…" : "正在等待回复…"');
    expect(DIALOG).toContain('<LoaderCircle className="spin" size={14} aria-hidden="true" />');
    expect(DIALOG).not.toContain('streaming ? "…"');
    const css = readFileSync(new URL("./aiDialogParts.css", import.meta.url), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".ai-dialog__progress .spin { animation: none; }");
  });

  it("生成中「生成/发送」原位变「停止」：走 ai_cancel，且是中性停止、不报红（用户 261008）", () => {
    // 中断入口必须落在发送键那一格（三个入口共用本面板 ⇒ 一处覆盖全部）
    expect(DIALOG).toContain("{busy ? (");
    expect(DIALOG).toContain("onClick={stop}>停止</button>");
    expect(DIALOG).toContain("void cancelAiChat(reqRef.current)");
    // 旧的「disabled 生成中… + 旁边一个次要停止」形态已收敛
    expect(DIALOG).not.toContain("生成中…");
    // 主动停止 ≠ 报错：走 stoppedRef 判据，给中性提示而不是 error
    expect(DIALOG).toContain("stoppedRef.current");
    expect(DIALOG).toContain("已停止生成，已生成的内容保留");
    expect(DIALOG).toContain("return last && last.role === \"assistant\" && !last.text ? prev.slice(0, -1) : prev;");
  });

});
/**
 * 261021 P0：提示词层收口（system + 原文定界）的接线护栏。
 * 纯函数行为见 aiPrompts.test.ts；这里只锁「弹窗确实走了单一来源、没有退回裸拼」。
 */
describe("AI 提示词接线（261021 P0）", () => {
  it("首轮内容走 buildAiUserContent，发送时前置 withAiSystemMessage（历史不存 system）", () => {
    expect(DIALOG).toContain("const firstPrompt = buildAiUserContent(instruction, selectionText, documentText);");
    expect(DIALOG).toContain("withAiSystemMessage(messages, { imageOnly })");
    expect(DIALOG).toContain("runAiChat(reqId, wireMessages, appendAssistant)");
    // 旧的「指令 + 两个换行 + 裸选区」已删除（防注入靠定界符 + 系统提示词）
    expect(DIALOG).not.toContain('instruction.trim() + "\\n\\n" + selectionText');
    expect(DIALOG).not.toContain("const firstPrompt = selectionText.trim() ?");
  });

  it("图片-only 仍走图片预设/图片系统提示词（imageOnly 判据只有一处）", () => {
    expect(DIALOG).toContain("const imageOnly = hasImages && !selectionText.trim() && !includeDocument;");
    expect(DIALOG).toContain("const presets = imageOnly ? AI_IMAGE_PRESETS : AI_PROMPT_PRESETS;");
  });
});

/**
 * 261021 P1：附加「当前文档全文」的接线护栏。
 * 数据/截断纯函数见 aiPrompts.test.ts；这里锁「按需读缓存、默认关、开聊后锁定、全文不回写」。
 */
describe("AI 文档全文上下文接线（261021 P1）", () => {
  it("noteId 从入口传入；开关默认关，点击才读本地缓存", () => {
    expect(DIALOG).toContain("noteId?: string;");
    expect(DIALOG).toContain("const [includeDocument, setIncludeDocument] = useState(false);");
    expect(DIALOG).toContain("native.readNoteCaches(noteId)");
    expect(DIALOG).toContain("buildAiDocumentContext(await native.readNoteCaches(noteId))");
    // 空缓存/读取失败都给可见原因，不静默降级
    expect(DIALOG).toContain("该文档还没有文本缓存，请先打开并保存一次");
    expect(DIALOG).toContain("读取文档缓存失败，本次不附加全文");
  });

  it("开聊后锁定上下文；全文结果不自动插入/替换选区", () => {
    expect(DIALOG).toContain("const docLocked = turns.length > 0;");
    expect(DIALOG).toContain("setConversationDocMode(includeDocument)");
    expect(DIALOG).toContain("lastOutput && onInsertAfter && !conversationDocMode");
    expect(DIALOG).toContain("lastOutput && onReplace && !conversationDocMode");
    expect(DIALOG).toContain("全文模式的结果不自动回写，请复制使用");
  });

  it("开关行复用 kit 的 .ln-switch，且带 aria-checked / 可见说明", () => {
    expect(DIALOG).toContain('className="ln-switch"');
    expect(DIALOG).toContain('role="switch"');
    expect(DIALOG).toContain('aria-checked={includeDocument}');
    expect(DIALOG).toContain("附加当前文档全文");
    expect(DIALOG).toContain("开启后，发送时会把已保存的整篇正文发给 AI 供应商");
    expect(DIALOG).toContain("docContext.truncated");
  });
});
