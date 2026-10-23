import { describe, expect, it } from "vitest";
import { answerTitle, buildChatMessages, capTurns, corpusBlockOf, lakeBodyFromText, suggestions, takeCorpus, AI_CORPUS_MAX_CHARS, AI_HISTORY_MAX_TURNS } from "./aiSession";

const doc = (id: string, title: string, n: number) => ({ id, title, text: "字".repeat(n) });

describe("资料预算（顺序收录 + 段落边界 + 绝不静默）", () => {
  it("按顺序收录，超预算的文档标记截断", () => {
    const budget = takeCorpus([doc("a", "A", 40_000), doc("b", "B", 40_000)]);
    expect(budget.used).toBeLessThanOrEqual(AI_CORPUS_MAX_CHARS);
    expect(budget.takes[0].truncated).toBe(false);
    expect(budget.takes[1].truncated).toBe(true);
    expect(budget.truncated).toBe(true);
  });

  it("空文档/太短文档标记 excluded，且不计入 used", () => {
    const budget = takeCorpus([doc("a", "A", 10), doc("b", "B", 500)]);
    expect(budget.takes[0].excluded).toBe(true);
    expect(budget.used).toBe(500);
  });

  it("资料块只包含被收录的文档，且同样入参字节相同", () => {
    const budget = takeCorpus([doc("a", "A", 500), doc("b", "B", 120_000)]);
    const block = corpusBlockOf(budget);
    expect(block).toContain("《A》");
    expect(block).toContain("《B》");
    expect(block).toBe(corpusBlockOf(takeCorpus([doc("a", "A", 500), doc("b", "B", 120_000)])));
  });

  it("空资料 ⇒ 空块", () => {
    expect(corpusBlockOf(takeCorpus([]))).toBe("");
  });
});

describe("请求装配（固定前缀 + 追加尾部）", () => {
  it("有资料：system → 资料块 → 历史 → 本轮问题", () => {
    const messages = buildChatMessages({
      system: "SYS",
      corpusBlock: "CORPUS",
      history: [{ role: "user", text: "Q1" }, { role: "assistant", text: "A1" }],
      question: "Q2",
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "user", "assistant", "user"]);
    expect(messages[1].content).toBe("CORPUS");
    expect(messages[messages.length - 1].content).toBe("Q2");
  });

  it("无资料：不注入资料消息", () => {
    const messages = buildChatMessages({ system: "SYS", corpusBlock: "", history: [], question: "Q1" });
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("历史只保留最近 12 轮", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", text: "t" + i }));
    expect(capTurns(history)).toHaveLength(AI_HISTORY_MAX_TURNS * 2);
  });
});

describe("文案辅助", () => {
  it("标题取问句前 30 字并折叠空白", () => {
    expect(answerTitle("  对比\n这两篇  ")).toBe("对比 这两篇");
    expect(answerTitle("")).toBe("AI 回答");
  });
  it("建议 chips 随资料切换", () => {
    expect(suggestions(false, 0)).toContain("写一段周报");
    expect(suggestions(true, 3)).toContain("总结这 3 篇");
  });
});

describe("落成 Lake 正文", () => {
  it("每行一个段落，文本转义，空行丢弃", () => {
    let n = 0;
    const body = lakeBodyFromText("第一段\n\n第二段 <b>", () => "id" + ++n);
    expect(body.match(/<p /g)).toHaveLength(2);
    expect(body).toContain("第二段 &lt;b&gt;");
    expect(body).not.toContain("\n");
  });
});
