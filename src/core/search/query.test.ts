import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { buildMatchExpression, escapeLike } from "./query.js";

describe("buildMatchExpression", () => {
  it("单字 → 单短语", () => {
    expect(buildMatchExpression("编")).toBe('"编"');
  });
  it("多字连续 → 一个空格分隔短语（要求相邻）", () => {
    expect(buildMatchExpression("编辑器")).toBe('"编 辑 器"');
  });
  it("多词 → 多个短语 AND", () => {
    expect(buildMatchExpression("编辑 器")).toBe('"编 辑" "器"');
  });
  it("中英混合", () => {
    expect(buildMatchExpression("Lake编辑器")).toBe('"Lake 编 辑 器"');
  });
  it("单个拉丁词 → 前缀 *（Lak 命中 Lake）；单字符不前缀", () => {
    expect(buildMatchExpression("Lake")).toBe("Lake*");
    expect(buildMatchExpression("lak")).toBe("lak*");
    expect(buildMatchExpression("L")).toBe('"L"');
  });
  it("纯数字词也前缀", () => {
    expect(buildMatchExpression("2024")).toBe("2024*");
  });
  it("标点被当分隔符，不产生裸引号", () => {
    expect(buildMatchExpression('a"b')).toBe('"a b"');
    expect(buildMatchExpression('" OR "')).toBe('"OR"');
  });
  it("FTS5 保留字（大小写不敏感）不加前缀 *，改走引号短语", () => {
    // 旧的 `AND*` / `OR*` / `NOT*` 会被 FTS5 当操作符 ⇒ sqlite 报 near "AND": syntax error
    expect(buildMatchExpression("AND")).toBe('"AND"');
    expect(buildMatchExpression("OR")).toBe('"OR"');
    expect(buildMatchExpression("NOT")).toBe('"NOT"');
    expect(buildMatchExpression("NEAR")).toBe('"NEAR"');
    expect(buildMatchExpression("and")).toBe('"and"');
  });
  it("空/纯空白/纯符号 → null", () => {
    expect(buildMatchExpression("")).toBeNull();
    expect(buildMatchExpression("   ")).toBeNull();
    expect(buildMatchExpression("%_*")).toBeNull();
  });
});

describe("buildMatchExpression 在真实 FTS5 上可执行", () => {
  // 与生产同款分词器（unicode61）；用 better-sqlite3 直接跑一条 MATCH，钉住「生成器产出 = sqlite 能解析」
  const db = new Database(":memory:");
  db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(body, tokenize='unicode61');");
  db.prepare("INSERT INTO notes_fts(body) VALUES (?)").run("Lake editor and or not near the lake");
  afterAll(() => db.close());
  const matchCount = (query: string): number => {
    const expression = buildMatchExpression(query);
    if (!expression) return 0;
    return (db.prepare("SELECT count(*) AS n FROM notes_fts WHERE notes_fts MATCH ?").get(expression) as { n: number }).n;
  };

  it("AND / OR / NOT / NEAR（含小写）不再让 sqlite 报 syntax error", () => {
    for (const word of ["AND", "OR", "NOT", "NEAR", "and", "or", "not", "near"]) {
      expect(() => matchCount(word)).not.toThrow();
    }
    expect(() => matchCount("Lake AND editor")).not.toThrow();
    expect(() => matchCount("NOT Lake")).not.toThrow();
  });

  it("保留字按字面词命中，普通拉丁词仍走前缀", () => {
    expect(matchCount("AND")).toBe(1);
    expect(matchCount("OR")).toBe(1);
    expect(matchCount("NOT")).toBe(1);
    expect(matchCount("NEAR")).toBe(1);
    expect(matchCount("Lak")).toBe(1); // Lake* 前缀命中
    expect(matchCount("zzz")).toBe(0);
  });
});

describe("escapeLike", () => {
  it("转义 % _ 反斜杠", () => {
    expect(escapeLike("50%_x\\y")).toBe("50\\%\\_x\\\\y");
  });
});
