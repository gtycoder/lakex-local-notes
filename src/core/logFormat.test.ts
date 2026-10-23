import { describe, expect, it } from "vitest";
import { describeError, errorFields, formatLogFields, joinConsoleArgs, perfMessage } from "./logFormat.js";

/**
 * 日志行格式是**可排查性**的基础（能被 grep、能被事后聚合），所以单独锁住。
 */

describe("日志字段格式化", () => {
  it("字段串：undefined/null 跳过，布尔与数字规范化", () => {
    expect(formatLogFields({ a: 1, b: undefined, c: null, d: true, e: false })).toBe(" a=1 d=true e=false");
  });

  it("含空格/引号/等号的值加引号，长值截断", () => {
    expect(formatLogFields({ msg: "hello world" })).toBe(' msg="hello world"');
    expect(formatLogFields({ msg: 'say "hi"' })).toBe(' msg="say \\"hi\\""');
    const long = "x".repeat(300);
    const out = formatLogFields({ long });
    expect(out.length).toBeLessThan(230);
    expect(out.endsWith("…")).toBe(true);
  });

  it("小数四舍五入（耗时统计不抖亚毫秒）", () => {
    expect(formatLogFields({ ms: 12.6 })).toBe(" ms=13");
  });

  it("[perf] 行：label + 整数毫秒 + 字段", () => {
    expect(perfMessage("note.save", 12.4, { chars: 3456 })).toBe("[perf] note.save 12ms chars=3456");
    expect(perfMessage("boot.ready", 0)).toBe("[perf] boot.ready 0ms");
    expect(perfMessage("paste.html", Number.NaN)).toBe("[perf] paste.html 0ms");
  });
});

describe("主进程 console 参数拼接", () => {
  it("字符串原样、Error 转 Name: message、对象 JSON 化、超长截断", () => {
    expect(joinConsoleArgs(["[sync] 自动同步失败:"]).trim()).toBe("[sync] 自动同步失败:");
    expect(joinConsoleArgs(["失败:", new Error("boom")])).toBe("失败: Error: boom");
    expect(joinConsoleArgs([{ code: 7 }])).toBe('{"code":7}');
    const long = joinConsoleArgs(["x".repeat(5000)]);
    expect(long.length).toBeLessThan(4100);
    expect(long.endsWith("…")).toBe(true);
    expect(joinConsoleArgs([])).toBe("");
  });
});

describe("错误格式化", () => {
  it("Error → Name: message；非 Error 保底转字符串", () => {
    expect(describeError(new TypeError("boom"))).toBe("TypeError: boom");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ code: 7 })).toBe('{"code":7}');
  });

  it("errorFields 带前 3 帧调用栈（不含正文）", () => {
    const fields = errorFields(new Error("boom"));
    expect(fields.error).toBe("Error: boom");
    expect(String(fields.stack)).toContain("at ");
  });
});
