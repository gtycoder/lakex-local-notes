import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AI 写作输入卡版式护栏（261116 用户裁决）。
 *
 * 造型：一张大圆角卡片 = 上方无边框自增高输入 + 底部一行控制；
 * 左 = 药丸（深度思考开关【默认开、可关】 / 提示词 / 请选择文档【只在文档推理模式】），
 * 右 = 添加附件（261116 Phase 1：**可点击**，从已选资料文档的图片里选）+ 圆形发送（生成中同格变停止）。
 *
 * 尺寸**有意比 AI 助手大**（AI 写作 = 纯对话；AI 助手 = 资料修改的轻对话，紧凑卡 max 120）——
 * 两端不合并，见 AiComposer.tsx 头注释。药丸已收进 kit 原语 .ln-pill，本文件不再自养三态。
 *
 * 写法对照 src/features/ai/aiComposerLayout.test.ts（AI 助手那条）：同一套「源码断言」把形状钉住，
 * 避免下次重排又漂回「两行控件 + 文字按钮」。
 */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("AI 写作输入卡版式（261116 用户裁决）", () => {
  const src = read("./AiComposer.tsx");
  const css = read("./aiWriting.css");
  const composerStart = src.indexOf('className="aiw-composer"');
  const composer = composerStart >= 0 ? src.slice(composerStart, src.indexOf("<AiPromptLibrary", composerStart)) : "";
  const cssStart = css.indexOf("/* ---------------- 输入卡");
  const cssBlock = cssStart >= 0 ? css.slice(cssStart, css.indexOf("---------------- 提示词库", cssStart)) : "";

  it("单张卡片：大圆角令牌 + 0.5px 边 + 卡片阴影 + 更大内距（纯对话卡）", () => {
    expect(composerStart).toBeGreaterThan(0);
    expect(cssBlock).toContain("--lake-chat-radius-composer");
    expect(cssBlock).toContain("border: 0.5px solid var(--lake-ctl-border)");
    expect(cssBlock).toContain("--lake-shadow-card");
    expect(cssBlock).toContain("padding: var(--lake-space-lg) var(--lake-space-xl)");
  });

  it("输入 = 一张无边框 textarea（rows=1），field-sizing 自增高；min 96px / max 240px（比 AI 助手大）", () => {
    expect(composer).toContain('className="aiw-composer__input"');
    expect(composer).toContain("rows={1}");
    expect(composer).not.toMatch(/\.scrollHeight/);
    expect(cssBlock).toContain("field-sizing: content");
    expect(cssBlock).toContain("min-height: 96px");
    expect(cssBlock).toContain("max-height: 240px");
    const inputRule = cssBlock.slice(cssBlock.indexOf(".aiw-composer__input {"));
    expect(inputRule.slice(0, 320)).toContain("border: 0");
  });

  it("底部只有一行：左 pills / 右 发送（同一行，不再有第二行控制区）", () => {
    expect(composer.match(/aiw-composer__bar/g)?.length).toBe(1);
    expect(composer).toContain('className="aiw-composer__tools"');
    expect(composer).toContain('className="aiw-composer__send"');
  });

  it("左侧药丸走 kit 原语 .ln-pill（本文件不再自养 .aiw-pill 三态）", () => {
    expect(composer).toContain("ln-pill");
    expect(composer).not.toContain("aiw-pill");
    expect(cssBlock).not.toContain(".aiw-pill");
    expect(composer).toContain('aria-pressed={thinking}');
    expect(composer).toContain("深度思考");
    expect(composer).toContain("提示词");
    expect(composer).toContain("请选择文档");
  });

  it("「请选择文档」只在文档推理（docs）模式出现", () => {
    // 源码判据：该药丸在 {mode === "docs" && ( ... )} 内
    const docsPill = composer.indexOf("请选择文档");
    expect(docsPill).toBeGreaterThan(0);
    expect(composer.slice(0, docsPill)).toContain('mode === "docs"');
  });

  it("添加附件入口按模式判据：对话写作=菜单（文档资产图片/本机文件），多文档=只开所选文档选图器", () => {
    expect(composer).toContain('className={"aiw-attach"');
    expect(composer).toContain('aria-label="添加附件"');
    // 入口行为读 capability 表，不靠零散 if
    expect(composer).toContain("caps.localFiles");
    expect(composer).toContain("attachMenuAnchor");
    expect(src).toContain("从文档里选附件");
    expect(src).toContain("从电脑选择文件");
    expect(src).toContain("onPickLocalFiles");
    expect(src).toContain("<AiImagePicker");
    expect(src).toContain("onBackToDocs={caps.localFiles");
    expect(src).toContain("onAdd={onAddAttachments}");
    expect(cssBlock).toContain(".aiw-attach:disabled");
    expect(cssBlock).toContain(".aiw-attach.is-on");
  });

  it("对话写作不显示任何文档 chip/药丸（纯对话判据 = caps.docs）", () => {
    expect(composer).toContain("caps.docs && docRefs.length > 0");
    // 「请选择文档」/「已选 N 篇」药丸在 mode === "docs" 分支内
    expect(composer.indexOf('mode === "docs"')).toBeGreaterThan(0);
    expect(composer).toContain("caps.localFiles ?");
  });

  it("右侧圆形发送：32px 主色；生成中**同格**变停止（红底），不再有文字「发送」按钮", () => {
    expect(composer).toContain("aiw-send-circle");
    expect(composer).toContain("aiw-send-circle--stop");
    expect(composer).toContain('aria-label="停止生成"');
    expect(composer).not.toContain(">发送<");
    expect(cssBlock).toContain("width: 32px");
    expect(cssBlock).toContain("height: 32px");
    expect(cssBlock).toContain("background: var(--lake-accent)");
    expect(cssBlock).toContain("background: var(--lake-status-error)");
    expect(cssBlock).toContain(".aiw-send-circle:disabled");
  });

  it("全部令牌化：输入卡样式区 0 个颜色字面量、无 1px 实边", () => {
    expect(cssBlock).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(cssBlock).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(cssBlock).not.toMatch(/border:\s*1px/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
