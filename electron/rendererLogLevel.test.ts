import { describe, expect, it } from "vitest";
import { mapRendererConsoleLevel } from "./rendererLogLevel.js";

/**
 * 渲染层日志级别映射：错一级会让 error 静默降级成 info（或 debug 在正式环境被当 info 落盘）。
 * Electron 44 恒为新形状（event.level 字符串）；旧签名兜底已删（261125 核实）。
 */

describe("渲染层 console 级别映射", () => {
  it("Electron 33+ 字符串级别", () => {
    expect(mapRendererConsoleLevel({ level: "error" })).toBe("error");
    expect(mapRendererConsoleLevel({ level: "warning" })).toBe("warn");
    expect(mapRendererConsoleLevel({ level: "info" })).toBe("info");
    expect(mapRendererConsoleLevel({ level: "debug" })).toBe("debug");
    expect(mapRendererConsoleLevel({ level: "verbose" })).toBe("debug");
  });

  it("没有/非字符串 level 字段时按 info（宁可多记，不静默丢）", () => {
    expect(mapRendererConsoleLevel({})).toBe("info");
    expect(mapRendererConsoleLevel(null)).toBe("info");
    expect(mapRendererConsoleLevel({ level: 2 })).toBe("info");
  });

  it("未知字符串级别按 info（不丢日志）", () => {
    expect(mapRendererConsoleLevel({ level: "something-new" })).toBe("info");
  });
});
