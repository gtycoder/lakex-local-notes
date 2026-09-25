import { describe, expect, it } from "vitest";
import { buildSnippet } from "./snippet.js";

describe("buildSnippet", () => {
  it("命中处标 <mark>", () => {
    expect(buildSnippet("欢迎使用Lake编辑器性能测试", "编辑器")).toContain("<mark>编辑器</mark>");
  });
  it("HTML 转义，不注入", () => {
    const s = buildSnippet("正文 <script>alert(1)</script> 编辑器", "编辑器");
    expect(s).not.toContain("<script>");
    expect(s).toContain("&lt;script&gt;");
    expect(s).toContain("<mark>编辑器</mark>");
  });
  it("img/onerror 被转义成文本（W-10 护栏）", () => {
    const s = buildSnippet("<img src=x onerror=alert(1)> 编辑器", "编辑器");
    expect(s).not.toContain("<img");
    expect(s).toContain("&lt;img");
  });
  it("& 转义", () => {
    expect(buildSnippet("A&B 编辑器", "编辑器")).toContain("A&amp;B");
  });
  it("引号也转义（防属性上下文 XSS）", () => {
    const s = buildSnippet(`a"b'c 编辑器`, "编辑器");
    expect(s).toContain("&quot;");
    expect(s).toContain("&#39;");
    expect(s).not.toContain(`a"b'c`);
  });
  it("多词都标", () => {
    const s = buildSnippet("编辑 和 器 都出现", "编辑 器");
    expect((s.match(/<mark>/g) || []).length).toBe(2);
  });
  it("无命中 → 头部摘要且不标", () => {
    expect(buildSnippet("完全不相关的内容", "编辑器")).not.toContain("<mark>");
  });
  it("空正文 → 空", () => {
    expect(buildSnippet("", "x")).toBe("");
  });
  it("截断处加省略号", () => {
    const long = "甲".repeat(200) + "编辑器" + "乙".repeat(200);
    const s = buildSnippet(long, "编辑器");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });
});
