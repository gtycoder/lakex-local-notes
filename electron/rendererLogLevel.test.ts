import { describe, expect, it } from "vitest";
import { mapRendererConsoleLevel } from "./rendererLogLevel.js";

/**
 * 渲染层日志级别映射：错一级会让 error 静默降级成 info（或 debug 在正式环境被当 info 落盘），
 * 所以新旧两种 Electron 签名都要锁。
 */

describe("渲染层 console 级别映射", () => {
  it("Electron 33+ 字符串级别", () => {
    expect(mapRendererConsoleLevel({ level: "error" })).toBe("error");
    expect(mapRendererConsoleLevel({ level: "warning" })).toBe("warn");
    expect(mapRendererConsoleLevel({ level: "info" })).toBe("info");
    expect(mapRendererConsoleLevel({ level: "debug" })).toBe("debug");
    expect(mapRendererConsoleLevel({ level: "verbose" })).toBe("debug");
  });

  it("旧式数值级别（0 verbose / 1 info / 2 warning / 3 error）", () => {
    expect(mapRendererConsoleLevel({ level: 0 })).toBe("debug");
    expect(mapRendererConsoleLevel({ level: 1 })).toBe("info");
    expect(mapRendererConsoleLevel({ level: 2 })).toBe("warn");
    expect(mapRendererConsoleLevel({ level: 3 })).toBe("error");
  });

  it("完全没有 level 字段时按 info（宁可多记，不静默丢）", () => {
    expect(mapRendererConsoleLevel({})).toBe("info");
    expect(mapRendererConsoleLevel(null)).toBe("info");
    expect(mapRendererConsoleLevel({}, [1, "msg"])).toBe("info");
  });

  it("未知字符串级别按 info（不丢日志）", () => {
    expect(mapRendererConsoleLevel({ level: "something-new" })).toBe("info");
  });
});
