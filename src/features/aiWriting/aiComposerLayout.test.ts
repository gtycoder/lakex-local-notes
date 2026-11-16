import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AI 写作输入卡版式护栏（261116 用户裁决 = 对齐 AI 助手 261116 定稿 / chat-demo）。
 *
 * 造型：一张大圆角卡片 = 上方无边框自增高输入 + 底部一行控制；
 * 左 = 药丸（深度思考开关【默认开、可关】 / 提示词 / 请选择文档），
 * 右 = 添加附件（**占位 disabled**，等 ATTACHMENTS-PLAN 的 Phase 1）+ 圆形发送（生成中同格变停止）。
 *
 * 写法对照 src/features/ai/aiComposerLayout.test.ts（AI 助手那条）：同一套「源码断言」把形状钉住，
 * 避免下次重排又漂回「两行控件 + 文字按钮」。
 */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("AI 写作输入卡版式（261116 chat-demo 定稿）", () => {
  const src = read("./AiComposer.tsx");
  const css = read("./aiWriting.css");
  const composerStart = src.indexOf('className="aiw-composer"');
  const composer = composerStart >= 0 ? src.slice(composerStart, src.indexOf("<AiPromptLibrary", composerStart)) : "";
  const cssStart = css.indexOf("/* ---------------- 输入卡");
  const cssBlock = cssStart >= 0 ? css.slice(cssStart, css.indexOf("---------------- 提示词库", cssStart)) : "";

  it("单张卡片：大圆角令牌 + 0.5px 边 + 卡片阴影", () => {
    expect(composerStart).toBeGreaterThan(0);
    expect(cssBlock).toContain("--lake-chat-radius-composer");
    expect(cssBlock).toContain("border: 0.5px solid var(--lake-ctl-border)");
    expect(cssBlock).toContain("--lake-shadow-card");
  });

  it("输入 = 一张无边框 textarea（rows=1），用 field-sizing 自增高 + max 160px（不再 JS 量高度）", () => {
    expect(composer).toContain('className="aiw-composer__input"');
    expect(composer).toContain("rows={1}");
    // 自增高走 CSS；代码里不再读 .scrollHeight（注释里提到不算）
    expect(composer).not.toMatch(/\.scrollHeight/);
    expect(cssBlock).toContain("field-sizing: content");
    expect(cssBlock).toContain("max-height: 160px");
    // 输入自身无边框（边只由卡片给）
    const inputRule = cssBlock.slice(cssBlock.indexOf(".aiw-composer__input {"));
    expect(inputRule.slice(0, 320)).toContain("border: 0");
  });

  it("底部只有一行：左 pills / 右 发送（同一行，不再有第二行控制区）", () => {
    expect(composer.match(/aiw-composer__bar/g)?.length).toBe(1);
    expect(composer).toContain('className="aiw-composer__tools"');
    expect(composer).toContain('className="aiw-composer__send"');
  });

  it("左侧药丸：深度思考（aria-pressed 可关）+ 提示词 + 请选择文档", () => {
    expect(composer).toContain("aiw-pill");
    expect(composer).toContain('aria-pressed={thinking}');
    expect(composer).toContain("深度思考");
    expect(composer).toContain("提示词");
    expect(composer).toContain("请选择文档");
    expect(cssBlock).toContain(".aiw-pill.is-on");
  });

  it("添加附件 = 占位 disabled（aria-label + title 说明下一批接入），不伪造可用", () => {
    expect(composer).toContain('className="aiw-attach"');
    expect(composer).toContain('aria-label="添加附件"');
    expect(composer).toContain("下一批接入");
    const attachTag = composer.slice(composer.indexOf('className="aiw-attach"'), composer.indexOf("</button>", composer.indexOf('className="aiw-attach"')));
    expect(attachTag).toContain("disabled");
    expect(cssBlock).toContain(".aiw-attach:disabled");
    expect(cssBlock).toContain("--lake-disabled-opacity");
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
    // disabled 45% 透明走单一令牌
    expect(cssBlock).toContain(".aiw-send-circle:disabled");
  });

  it("全部令牌化：输入卡样式区 0 个颜色字面量、无 1px 实边", () => {
    expect(cssBlock).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(cssBlock).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(cssBlock).not.toMatch(/border:\s*1px/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
