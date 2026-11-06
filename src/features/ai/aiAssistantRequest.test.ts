import { describe, expect, it } from "vitest";
import {
  aiAttachments,
  aiDocumentNoteId,
  aiOutputLabel,
  aiSelectionText,
  type AiAssistantContext,
} from "./aiAssistantRequest";

const selection = (over: Partial<Extract<AiAssistantContext, { kind: "selection" }>> = {}): AiAssistantContext => ({
  kind: "selection",
  text: "原文",
  range: null,
  ...over,
});

describe("AI 请求模型：上下文/输出语义", () => {
  it("选区上下文：文字/图片可读取；不允许全文", () => {
    expect(aiSelectionText(selection())).toBe("原文");
    const attachments = [{ noteId: "n1", filename: "a.png" }];
    expect(aiAttachments(selection({ attachments }))).toEqual(attachments);
    expect(aiDocumentNoteId(selection())).toBeUndefined();
  });

  it("无上下文：默认不允许全文；显式 allowDocument 才给 noteId", () => {
    expect(aiSelectionText({ kind: "none" })).toBe("");
    expect(aiAttachments({ kind: "none" })).toBeUndefined();
    expect(aiDocumentNoteId({ kind: "none" })).toBeUndefined();
    expect(aiDocumentNoteId({ kind: "none", allowDocument: { noteId: "n1" } })).toBe("n1");
  });

  it("输出文案：after / 有选区替换 / 无选区插入光标", () => {
    expect(aiOutputLabel(selection(), "after")).toBe("插入到选区后");
    expect(aiOutputLabel(selection(), "cursor")).toBe("替换选区");
    expect(aiOutputLabel({ kind: "none" }, "cursor")).toBe("插入到光标处");
    expect(aiOutputLabel(selection({ text: "  " }), "cursor")).toBe("插入到光标处");
  });
});
