import { describe, expect, it } from "vitest";
import { isLevelEnabled, parseLogLevel, resolveLogLevels } from "./logLevels.js";

/**
 * 分级口径：开发全开 debug；正式 file/renderer = info、console 关；环境变量可现场覆盖。
 * 这些默认值直接决定"出问题时日志里有没有东西"，所以锁死。
 */

describe("日志分级", () => {
  it("开发环境：file/console/renderer 全开 debug", () => {
    expect(resolveLogLevels({ isPackaged: false })).toEqual({ file: "debug", console: "debug", renderer: "debug" });
  });

  it("正式环境：file/renderer = info，console 关闭", () => {
    expect(resolveLogLevels({ isPackaged: true })).toEqual({ file: "info", console: false, renderer: "info" });
  });

  it("LAKE_LOG_LEVEL 覆盖 file + renderer（现场排障不必改代码）", () => {
    expect(resolveLogLevels({ isPackaged: true, envLevel: "debug" })).toEqual({ file: "debug", console: false, renderer: "debug" });
    expect(resolveLogLevels({ isPackaged: true, envLevel: "warn" })).toEqual({ file: "warn", console: false, renderer: "warn" });
  });

  it("LAKE_LOG_CONSOLE=1 强制打开主进程 console（正式环境也生效）", () => {
    expect(resolveLogLevels({ isPackaged: true, envConsole: "1" }).console).toBe("debug");
    expect(resolveLogLevels({ isPackaged: false, envConsole: "0" }).console).toBe(false);
  });

  it("非法 level 忽略（回到默认值）", () => {
    expect(parseLogLevel("loud")).toBeNull();
    expect(parseLogLevel(" WARN ")).toBe("warn");
    expect(resolveLogLevels({ isPackaged: true, envLevel: "loud" }).file).toBe("info");
  });

  it("阈值判定：error < warn < info < debug", () => {
    expect(isLevelEnabled("error", "error")).toBe(true);
    expect(isLevelEnabled("error", "warn")).toBe(false);
    expect(isLevelEnabled("info", "warn")).toBe(true);
    expect(isLevelEnabled("info", "debug")).toBe(false);
    expect(isLevelEnabled("debug", "debug")).toBe(true);
  });
});
