/**
 * 搜索范围（纯逻辑）护栏：范围定义、非法输入回落、说明文案、空态引导。
 * 语义必须与数据层 scoped 查询一致（改这里要同步 data/searchIndex + data/quickNotesSearch）。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_SCOPE,
  SEARCH_SCOPES,
  normalizeSearchScope,
  searchEmptyState,
  searchScopeHint,
  searchScopeLabel,
} from "./searchScope";

describe("搜索范围（纯逻辑）", () => {
  it("四档顺序 = 全部/标题/正文/标签；默认「全部」", () => {
    expect(SEARCH_SCOPES.map((option) => option.id)).toEqual(["all", "title", "body", "tags"]);
    expect(SEARCH_SCOPES.map((option) => option.label)).toEqual(["全部", "标题", "正文", "标签"]);
    expect(DEFAULT_SEARCH_SCOPE).toBe("all");
    expect(searchScopeLabel("tags")).toBe("标签");
  });

  it("非法输入一律回落「全部」（桥参数/旧存储/测试桩都不该把搜索打空）", () => {
    expect(normalizeSearchScope(undefined)).toBe("all");
    expect(normalizeSearchScope(null)).toBe("all");
    expect(normalizeSearchScope("")).toBe("all");
    expect(normalizeSearchScope("tag")).toBe("all");
    expect(normalizeSearchScope(3)).toBe("all");
    expect(normalizeSearchScope({ scope: "title" })).toBe("all");
    for (const option of SEARCH_SCOPES) expect(normalizeSearchScope(option.id)).toBe(option.id);
  });

  it("范围说明常驻可见（说明这一档到底搜什么）", () => {
    expect(searchScopeHint("all")).toContain("标题");
    expect(searchScopeHint("all")).toContain("标签");
    expect(searchScopeHint("title")).toBe("只搜文档标题");
    expect(searchScopeHint("body")).toContain("不含标题与标签");
    expect(searchScopeHint("tags")).toContain("标签名");
  });

  it("空态：搜索中/有结果不显示空态；空查询 = idle（不催用户）", () => {
    expect(searchEmptyState({ query: "项目", scope: "all", hasResults: false, searching: true })).toBeNull();
    expect(searchEmptyState({ query: "项目", scope: "all", hasResults: true })).toBeNull();
    const idle = searchEmptyState({ query: "  ", scope: "title", hasResults: false });
    expect(idle?.kind).toBe("idle");
    expect(idle?.message).toBe(searchScopeHint("title"));
    expect(idle?.action).toBeNull();
  });

  it("无结果引导：全部只提示换词；非全部给「放宽」动作，标签范围文案 = 清空标签筛选", () => {
    const all = searchEmptyState({ query: "项目", scope: "all", hasResults: false });
    expect(all?.kind).toBe("no-results");
    expect(all?.message).toContain("关键词");
    expect(all?.action).toBeNull();

    const body = searchEmptyState({ query: "项目", scope: "body", hasResults: false });
    expect(body?.message).toBe("当前范围（正文）没有匹配");
    expect(body?.action).toEqual({ label: "在全部范围搜索", nextScope: "all" });

    const title = searchEmptyState({ query: "项目", scope: "title", hasResults: false });
    expect(title?.action).toEqual({ label: "在全部范围搜索", nextScope: "all" });

    const tags = searchEmptyState({ query: "项目", scope: "tags", hasResults: false });
    expect(tags?.action).toEqual({ label: "清空标签筛选", nextScope: "all" });
  });
});
