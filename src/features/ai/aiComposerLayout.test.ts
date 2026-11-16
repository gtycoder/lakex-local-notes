import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AI 助手输入条的版式护栏（261116 用户裁决）。
 *
 * 背景：8a8ff43c 把输入区改成「DeepSeek 式大卡片」（两行：文本 + 工具行，清除 × 在左下角）。
 * 用户 261116 裁决**恢复原样**：单行输入条（复用 kit 的 .ln-input）、默认一行自增高、清除 × 在输入条最右侧，
 * 生成/发送回到下方动作行。这里用源码断言钉住，避免下次重排时又回到大卡片。
 */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("AI 助手输入条版式（261116 定稿）", () => {
  const src = read("./AiAssistantDialog.tsx");

  it("输入条是 .ln-input 单行原语，默认一行（rows=1）且随内容自增高", () => {
    expect(src).toContain('className="ln-input ai-dialog__composer"');
    expect(src).toContain("rows={1}");
    expect(src).toContain("ai-dialog__field");
  });

  it("清除 × 是输入条里最后一个元素（最右侧），不在工具行里", () => {
    const composer = src.slice(src.indexOf('className="ln-input ai-dialog__composer"'));
    const clearAt = composer.indexOf("ln-input__clear ai-dialog__clear");
    const composerEnd = composer.indexOf("ai-dialog__actions");
    expect(clearAt).toBeGreaterThan(0);
    expect(clearAt).toBeLessThan(composerEnd); // 在输入条内部
    expect(composer.slice(clearAt + 40, composerEnd)).not.toContain("ai-dialog__composer-bar");
    expect(src).not.toContain("ai-dialog__composer-bar");
    expect(src).not.toContain("ai-dialog__composer-tools");
  });

  it("生成/发送/停止在下方动作行（与改造前一致），不在输入条内", () => {
    const actions = src.slice(src.indexOf('className="ln-dialog__actions ai-dialog__actions"'));
    expect(actions).toContain("生成");
    expect(actions.indexOf("生成")).toBeLessThan(actions.indexOf("关闭"));
  });

  it("附加当前文档全文是输入条外的独立行（不混排进输入条）", () => {
    const docAt = src.indexOf('className="ai-dialog__doc"');
    const composerAt = src.indexOf('className="ln-input ai-dialog__composer"');
    expect(docAt).toBeGreaterThan(0);
    expect(docAt).toBeLessThan(composerAt);
  });
});
