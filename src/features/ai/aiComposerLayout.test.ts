import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AI 助手输入卡的版式护栏（261116 用户裁决，第三稿 = 对齐 chat-demo）。
 *
 * 造型：**紧凑卡**（radius-md 10 / 内距 6/8/4 / textarea max 120）= 上方输入（无边框、随内容自增高）
 * + 底部一行控制：左 = 深度思考开关（可关）+ 清除，右 = 圆形发送（生成中同格变停止）。
 * **AI 助手不做附件**（附件是 AI 写作空间的需求）；与 AI 写作大卡有意不同，见 aiWriting/aiComposerLayout.test。
 * 历史：8a8ff43c 曾改「两行大卡片」，261116 先恢复单行输入条，随后按 chat-demo 定稿为本卡片；
 * 这里用源码断言钉住当前形状，避免下次重排又漂走。
 */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("AI 助手输入卡版式（261116 chat-demo 定稿）", () => {
  const src = read("./AiAssistantDialog.tsx");
  const composerStart = src.indexOf('className="ai-dialog__composer ai-dialog__composer--chat"');
  const composer = composerStart >= 0 ? src.slice(composerStart, src.indexOf("ai-dialog__actions", composerStart)) : "";

  it("输入卡是单张卡片，内含自增高 textarea（rows=1）", () => {
    expect(composerStart).toBeGreaterThan(0);
    expect(composer).toContain('className="ai-dialog__field"');
    expect(composer).toContain("rows={1}");
  });

  it("底部一行：左侧深度思考开关（aria-pressed 可关）+ 右侧圆形发送", () => {
    expect(composer).toContain("ai-dialog__composer-tools");
    expect(composer).toContain("ln-pill");
    expect(composer).toContain('aria-pressed={thinking}');
    expect(composer).toContain("深度思考");
    expect(composer).toContain("ai-dialog__send-circle");
  });

  it("紧凑卡几何：radius-md 10 + textarea max 120（与 AI 写作大卡有意不同）", () => {
    const css = read("./aiDialogParts.css");
    expect(css).toMatch(/\.ai-dialog__composer \{[^}]*border-radius: var\(--lake-radius-md\)/);
    expect(css).toMatch(/\.ai-dialog__composer \.ai-dialog__field \{[^}]*max-height: 120px/);
  });

  it("发送/停止已回到输入卡内，不再挂在动作行", () => {
    expect(composer).toContain("停止生成");
    const actions = src.slice(src.indexOf('className="ln-dialog__actions ai-dialog__actions"'));
    expect(actions).toContain("关闭");
    expect(actions).not.toContain(">生成<");
    expect(actions).not.toContain(">发送<");
  });

  it("AI 助手不做附件（261116 用户裁决：附件是 AI 写作空间的需求，这里不放入口）", () => {
    expect(src).not.toContain("ai-dialog__attach");
    expect(src).not.toContain("添加附件");
  });

  it("附加当前文档全文仍是输入卡外的独立行（不混排进卡片）", () => {
    const docAt = src.indexOf('className="ai-dialog__doc"');
    expect(docAt).toBeGreaterThan(0);
    expect(docAt).toBeLessThan(composerStart);
  });
});
