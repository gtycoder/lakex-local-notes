// @vitest-environment jsdom
/** 「AI 写作助手」插入卡（261107）：斜杠项/卡片元数据/插入面板接线护栏。 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_ASSISTANT_CARD_NAME,
  AI_ASSISTANT_ICON_ID,
  AI_ASSISTANT_MAIN_SEARCH,
  AI_ASSISTANT_SLASH_ITEM,
  AiAssistantIconSymbol,
  aiAssistantCardConfig,
  withAiAssistantSlashItem,
} from "./aiAssistantCard";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("AI 写作助手卡：注册形状", () => {
  it("卡名/斜杠项/主搜索词稳定（改了就面板无项或旧正文不渲染）", () => {
    expect(AI_ASSISTANT_CARD_NAME).toBe("lake-ai-assistant");
    expect(AI_ASSISTANT_SLASH_ITEM).toBe("custom-lake-ai-assistant");
    expect(AI_ASSISTANT_MAIN_SEARCH).toBe("/ai");
    expect(aiAssistantCardConfig.name).toBe(AI_ASSISTANT_CARD_NAME);
    expect(aiAssistantCardConfig.slash.label).toBe("AI 助手");
    expect(aiAssistantCardConfig.slash.description).toContain("写作助手");
  });

  it("图标组件渲染 symbol（内核 sprite 约定）", () => {
    const html = renderToStaticMarkup(AiAssistantIconSymbol());
    expect(html).toContain('<symbol id="' + AI_ASSISTANT_ICON_ID + '"');
  });

  it("斜杠项注入「小工具」分组；幂等且不动其它组", () => {
    const groups = [
      { title: "小工具", name: "tool", items: ["custom-lake-note-ref"] },
      { title: "其它", name: "other", items: ["x"] },
    ];
    const once = withAiAssistantSlashItem(groups);
    expect((once[0] as { items: string[] }).items).toContain(AI_ASSISTANT_SLASH_ITEM);
    expect((once[1] as { items: string[] }).items).toEqual(["x"]);
    const twice = withAiAssistantSlashItem(once);
    expect((twice[0] as { items: string[] }).items.filter((item) => item === AI_ASSISTANT_SLASH_ITEM)).toHaveLength(1);
  });

  it("单一插入入口：卡片只声明 cursor 输出；文案在请求模型里；占位卡无可见 UI", () => {
    const card = read("./aiAssistantCard.tsx");
    expect(card).toContain('outputs: ["cursor"]');
    expect(card).not.toContain('"after"');
    const request = read("../ai/aiAssistantRequest.ts");
    expect(request).toContain("插入到光标处");
    expect(request).toContain("替换选区");
  });


  it("接线护栏：lakeRuntime 注册卡，并把斜杠项加进 general + table 两个面板", () => {
    const runtime = read("./lakeRuntime.ts");
    expect(runtime).toMatch(/registerAiAssistantCard\(mergedOptions\)/);
    expect((runtime.match(/withAiAssistantSlashItem\(/g) || [])).toHaveLength(2);
    expect(runtime).toMatch(/cardSelect:\s*\{[\s\S]*general:[\s\S]*withAiAssistantSlashItem\(/);
    expect(runtime).toMatch(/table:[\s\S]*withAiAssistantSlashItem\(/);
  });
});