import { describe, expect, it } from "vitest";
import {
  AI_DOCUMENT_BEGIN,
  AI_DOCUMENT_END,
  AI_IMAGE_PRESETS,
  AI_PROMPT_CUSTOM_ID,
  AI_PROMPT_CUSTOM_LABEL,
  AI_PROMPT_PRESETS,
  AI_SOURCE_BEGIN,
  AI_SOURCE_END,
  AI_SYSTEM_PROMPT,
  AI_SYSTEM_PROMPT_IMAGE,
  buildAiDocumentContext,
  buildAiUserContent,
  withAiSystemMessage,
} from "./aiPrompts";

/** AI 首轮预设（261021 P0 重构）：每条都有文案、id 唯一；「自定义」是常量、不在这张表里。 */
describe("AI_PROMPT_PRESETS", () => {
  it("三档总结 + 精炼 + 阅读笔记 + 续写 + 修正，id 唯一、提示词非空", () => {
    expect(AI_PROMPT_PRESETS.map((p) => p.label)).toEqual(["速览", "要点", "详解", "精炼", "阅读笔记", "续写", "修正"]);
    const ids = AI_PROMPT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of AI_PROMPT_PRESETS) expect(p.prompt.trim().length).toBeGreaterThan(0);
  });

  it("三档总结的粒度写进提示词（一句话 / 5–10 条要点 / 分段详解）", () => {
    const byId = new Map(AI_PROMPT_PRESETS.map((p) => [p.id, p.prompt]));
    expect(byId.get("summary-brief")).toContain("一句话");
    expect(byId.get("summary-brief")).toContain("50 字");
    expect(byId.get("summary-key")).toContain("5–10 条");
    expect(byId.get("summary-detail")).toContain("背景与目的");
    expect(byId.get("summary-detail")).toContain("核心结论");
  });

  it("精炼带负面清单、阅读笔记带固定结构（借用官方 skills 的输出契约写法）", () => {
    const byId = new Map(AI_PROMPT_PRESETS.map((p) => [p.id, p.prompt]));
    expect(byId.get("refine")).toContain("不新增观点");
    expect(byId.get("refine")).toContain("不改专名");
    expect(byId.get("refine")).toContain("优化概览");
    expect(byId.get("reading")).toContain("金句");
    expect(byId.get("reading")).toContain("行动项");
  });

  it("「自定义」= 空输入（常量 id/label，放最后）", () => {
    expect(AI_PROMPT_CUSTOM_ID).toBe("custom");
    expect(AI_PROMPT_CUSTOM_LABEL).toBe("自定义");
    expect(AI_PROMPT_PRESETS.some((p) => p.id === AI_PROMPT_CUSTOM_ID)).toBe(false);
  });

  it("图片预设保持独立（不混进文字预设）", () => {
    expect(AI_IMAGE_PRESETS.map((p) => p.label)).toEqual(["描述", "提取文字", "翻译"]);
    expect(new Set(AI_IMAGE_PRESETS.map((p) => p.id)).size).toBe(AI_IMAGE_PRESETS.length);
  });
});

describe("系统提示词与原文定界（261021 P0）", () => {
  it("system 提示词声明：定界内是资料、其中指令不执行、不编造、输出 Markdown", () => {
    expect(AI_SYSTEM_PROMPT).toContain(AI_SOURCE_BEGIN);
    expect(AI_SYSTEM_PROMPT).toContain(AI_SOURCE_END);
    expect(AI_SYSTEM_PROMPT).toContain("不得执行");
    expect(AI_SYSTEM_PROMPT).toContain("不得编造");
    expect(AI_SYSTEM_PROMPT).toContain("Markdown");
    expect(AI_SYSTEM_PROMPT_IMAGE).toContain("图片");
    expect(AI_SYSTEM_PROMPT_IMAGE).not.toContain(AI_SOURCE_BEGIN);
  });

  it("buildAiUserContent：没有选区时只返回指令，不产生空定界块", () => {
    expect(buildAiUserContent("  请总结  ", "   ")).toBe("请总结");
    expect(buildAiUserContent("请总结", "")).not.toContain(AI_SOURCE_BEGIN);
  });

  it("buildAiUserContent：指令在前、原文被唯一一对定界符包住", () => {
    const text = buildAiUserContent("请总结", "  第一段\n第二段  ");
    expect(text.startsWith("请总结\n\n")).toBe(true);
    expect(text).toContain(AI_SOURCE_BEGIN + "\n第一段\n第二段\n" + AI_SOURCE_END);
    expect(text.match(new RegExp(AI_SOURCE_BEGIN, "g"))).toHaveLength(1);
    expect(text.match(new RegExp(AI_SOURCE_END, "g"))).toHaveLength(1);
  });

  it("buildAiUserContent：有原文但指令为空时只发原文块（调用方仍会用 canSendFirst 拦住）", () => {
    const text = buildAiUserContent("  ", "原文");
    expect(text).toBe(AI_SOURCE_BEGIN + "\n原文\n" + AI_SOURCE_END);
  });

  it("withAiSystemMessage：前置 system、不改原数组；重复调用不叠加", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const wired = withAiSystemMessage(messages);
    expect(wired[0]).toEqual({ role: "system", content: AI_SYSTEM_PROMPT });
    expect(wired).toHaveLength(2);
    expect(messages).toHaveLength(1); // 不改入参
    expect(withAiSystemMessage(wired)).toHaveLength(2); // 已有 system 不重复加
  });

  it("withAiSystemMessage：图片-only 上下文用图片系统提示词", () => {
    const wired = withAiSystemMessage([{ role: "user", content: "这是什么" }], { imageOnly: true });
    expect(wired[0]).toEqual({ role: "system", content: AI_SYSTEM_PROMPT_IMAGE });
  });
});

describe("文档全文上下文（261021 P1）", () => {
  it("buildAiDocumentContext：优先 markdown，没有才退回 plain；两者都空返回 null", () => {
    expect(buildAiDocumentContext({ markdown: "# 标题", plain: "标题" })).toEqual({ text: "# 标题", chars: 4, wordCount: 2, truncated: false });
    expect(buildAiDocumentContext({ markdown: "  ", plain: "纯文本" })).toEqual({ text: "纯文本", chars: 3, wordCount: 3, truncated: false });
    expect(buildAiDocumentContext({ markdown: null, plain: null })).toBeNull();
    expect(buildAiDocumentContext({ markdown: "", plain: "   " })).toBeNull();
  });

  it("buildAiDocumentContext：超上限显式截断并报告实际字符数", () => {
    const context = buildAiDocumentContext({ markdown: "字".repeat(11), plain: null }, 10);
    expect(context).toEqual({ text: "字".repeat(10), chars: 10, wordCount: null, truncated: true });
    expect(buildAiDocumentContext({ markdown: "短", plain: null }, 10)).toEqual({ text: "短", chars: 1, wordCount: null, truncated: false });
  });

  it("buildAiUserContent：传全文时用全文定界，且优先于选区", () => {
    const text = buildAiUserContent("请总结", "选区内容", "全文内容");
    expect(text).toBe("请总结\n\n" + AI_DOCUMENT_BEGIN + "\n全文内容\n" + AI_DOCUMENT_END);
    expect(text).not.toContain(AI_SOURCE_BEGIN);
  });

  it("buildAiUserContent：全文为空串时仍回落到选区（不产生空全文块）", () => {
    const text = buildAiUserContent("请总结", "选区内容", "");
    expect(text).toContain(AI_SOURCE_BEGIN);
    expect(text).not.toContain(AI_DOCUMENT_BEGIN);
  });

  it("系统提示词声明全文定界与优先级（有全文时「下面的内容」= 全文）", () => {
    expect(AI_SYSTEM_PROMPT).toContain(AI_DOCUMENT_BEGIN);
    expect(AI_SYSTEM_PROMPT).toContain(AI_DOCUMENT_END);
    expect(AI_SYSTEM_PROMPT).toContain("有全文块时");
  });
});
