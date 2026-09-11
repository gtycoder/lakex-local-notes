import { describe, expect, it } from "vitest";
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
    expect(buildMatchExpression('" OR "')).toBe("OR*");
  });
  it("空/纯空白/纯符号 → null", () => {
    expect(buildMatchExpression("")).toBeNull();
    expect(buildMatchExpression("   ")).toBeNull();
    expect(buildMatchExpression("%_*")).toBeNull();
  });
});

describe("escapeLike", () => {
  it("转义 % _ 反斜杠", () => {
    expect(escapeLike("50%_x\\y")).toBe("50\\%\\_x\\\\y");
  });
});
