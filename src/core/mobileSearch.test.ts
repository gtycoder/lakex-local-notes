import { describe, expect, it } from "vitest";
import { buildLikePattern, buildSearchSql, escapeLike, toSearchResult } from "./mobileSearch.js";

describe("mobileSearch 移动端搜索 fallback（Phase 0B-5）", () => {
  describe("escapeLike", () => {
    it("转义 % _ \\", () => {
      expect(escapeLike("50%_x\\y")).toBe("50\\%\\_x\\\\y");
    });
    it("普通字符不动", () => { expect(escapeLike("笔记")).toBe("笔记"); });
  });

  describe("buildLikePattern", () => {
    it("非空 → %term%（含转义）", () => { expect(buildLikePattern(" 笔记 ")).toBe("%笔记%"); });
    it("含通配符 → 转义后模糊", () => { expect(buildLikePattern("50%")).toBe("%50\\%%"); });
    it("空/空白 → null", () => { expect(buildLikePattern("  ")).toBeNull(); });
  });

  describe("buildSearchSql", () => {
    it("参数化 + ESCAPE + trashed 过滤 + LIMIT 50", () => {
      const [sql, params] = buildSearchSql("%笔记%");
      expect(params).toEqual(["%笔记%", "%笔记%"]);
      expect(sql).toContain("ESCAPE");
      expect(sql).toContain("trashed_at IS NULL");
      expect(sql).toContain("LIMIT 50");
    });
  });

  describe("toSearchResult", () => {
    const row = { id: "n1", title: "标题", content: "x".repeat(200), updated_at: "u", parent_id: "nb", parent_title: "笔记本" };
    it("标题命中 → matchType=title，snippet=标题", () => {
      const r = toSearchResult(row, true);
      expect(r.matchType).toBe("title");
      expect(r.snippet).toBe("标题");
    });
    it("正文命中 → matchType=body，snippet 截断 120", () => {
      const r = toSearchResult(row, false);
      expect(r.matchType).toBe("body");
      expect(r.snippet.length).toBe(121); // 120 + …
    });
    it("父标题透传", () => { expect(toSearchResult(row, true).parentTitle).toBe("笔记本"); });
  });

  describe("ESCAPE 子句正确性（防 SQLite 'must be a single character' 报错）", () => {
    it("buildSearchSql 的 ESCAPE 是单反斜杠字符（TS '\\' → 运行时 1 字符）", () => {
      const [sql] = buildSearchSql("%50%%");
      const esc = sql.match(/ESCAPE '([^']*)'/);
      expect(esc).not.toBeNull();
      expect(esc![1].length).toBe(1); // SQLite 要求 ESCAPE 单字符
      expect(esc![1]).toBe("\\");
    });
    it("escapeLike 转义 % 后模式含反斜杠前缀（配合 ESCAPE 匹配字面 %）", () => {
      expect(buildLikePattern("50%")).toContain("\\%");
    });
  });
});
