import { describe, expect, it } from "vitest";
import { createRendererLog, type RendererLogSink } from "./log.js";

/**
 * 渲染层日志分级：debug 只在开发环境输出；info/warn/error 正式环境必须留；
 * perf 走 info（正式环境也要能统计耗时）。
 */

function makeLog(debugEnabled: boolean) {
  const lines: Array<{ level: string; message: string }> = [];
  const sink: RendererLogSink = {
    debug: (message) => lines.push({ level: "debug", message }),
    info: (message) => lines.push({ level: "info", message }),
    warn: (message) => lines.push({ level: "warn", message }),
    error: (message) => lines.push({ level: "error", message }),
  };
  return { lines, log: createRendererLog({ debugEnabled, sink }) };
}

describe("渲染层日志", () => {
  it("开发环境 debug 输出；正式环境 debug 静默（不产生日志行）", () => {
    const dev = makeLog(true);
    dev.log.debug("paste", "解析开始", { bytes: 10 });
    expect(dev.lines.length).toBe(1);
    expect(dev.lines[0].level).toBe("debug");
    expect(dev.lines[0].message).toBe("[paste] 解析开始 bytes=10");

    const prod = makeLog(false);
    prod.log.debug("paste", "解析开始", { bytes: 10 });
    expect(prod.lines.length).toBe(0);
  });

  it("info / warn / error 在正式环境照常输出", () => {
    const prod = makeLog(false);
    prod.log.info("boot", "renderer ready");
    prod.log.warn("sync", "网络抖动", { retry: 1 });
    prod.log.error("editor", "保存失败", new Error("disk full"), { noteId: "n1" });
    expect(prod.lines.map((l) => l.level)).toEqual(["info", "warn", "error"]);
    expect(prod.lines[2].message).toContain("Error: disk full");
    expect(prod.lines[2].message).toContain("noteId=n1");
  });

  it("perf 走 info 级、且是标准 [perf] 行（正式环境可统计）", () => {
    const prod = makeLog(false);
    prod.log.perf("paste.html", 45.6, { bytes: 391361, getData: 13, guard: "pass" });
    expect(prod.lines.length).toBe(1);
    expect(prod.lines[0].level).toBe("info");
    expect(prod.lines[0].message).toBe("[perf] paste.html 46ms bytes=391361 getData=13 guard=pass");
  });

  it("error 传字符串/未知对象也不会丢", () => {
    const prod = makeLog(false);
    prod.log.error("window", "未捕获异常", "boom");
    prod.log.error("window", "未处理拒绝", { code: 1 });
    expect(prod.lines[0].message).toContain("error=boom");
    // 非 Error 对象先 JSON 化；含引号/空格的值按字段规则再整体加引号（可回溯原文）
    expect(prod.lines[1].message).toContain("error=");
    expect(prod.lines[1].message).toContain("code");
  });
});
