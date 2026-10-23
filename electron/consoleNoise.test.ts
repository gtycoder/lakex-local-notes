import { describe, expect, it } from "vitest";
import { ConsoleNoiseFilter, formatCspSummary, isCspViolationNotice } from "./consoleNoise.js";

/**
 * 粘贴整页网页时 CSP 会为每张远程图打一条通知（值得买实测 103 条）⇒ 折叠成一行汇总。
 * 这里只测折叠语义与**顺序**（非 CSP 消息必须排在汇总之后），不测文案排版细节。
 */

const imageNotice = (url: string) =>
  "Loading the image '" + url + "' violates the following Content Security Policy directive: \"img-src 'self' data: blob: http://127.0.0.1:*\". The action has been blocked.";

function makeFilter() {
  const lines: string[] = [];
  const timers: Array<{ fire: () => void; cleared: boolean }> = [];
  const filter = new ConsoleNoiseFilter({
    emit: (line) => lines.push(line),
    flushDelayMs: 2000,
    setTimer: (fn) => {
      const entry = { fire: fn, cleared: false };
      timers.push(entry);
      return entry;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  return { lines, timers, filter };
}

describe("CSP 噪音折叠", () => {
  it("识别 CSP 拦截通知，不误伤普通日志", () => {
    expect(isCspViolationNotice(imageNotice("https://a.zdmimg.com/x.jpg"))).toBe(true);
    expect(isCspViolationNotice("Uncaught Error: boom")).toBe(false);
    expect(isCspViolationNotice("[perf] 资源上传 3 次")).toBe(false);
  });

  it("逐条通知不落盘，等窗口结束只吐一行汇总（条数 + 示例 URL）", () => {
    const { lines, timers, filter } = makeFilter();
    expect(filter.observe(imageNotice("https://a.zdmimg.com/1.jpg"))).toBe(true);
    expect(filter.observe(imageNotice("https://a.zdmimg.com/2.jpg"))).toBe(true);
    expect(filter.observe(imageNotice("https://a.zdmimg.com/3.jpg"))).toBe(true);
    expect(lines).toEqual([]);
    // 每次 observe 会重排计时器：只有最后一个是活的
    expect(timers.length).toBe(3);
    expect(timers[0].cleared).toBe(true);
    expect(timers[2].cleared).toBe(false);
    timers[2].fire();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("折叠 3 条 CSP 拦截通知");
    expect(lines[0]).toContain("图片 3 张");
    expect(lines[0]).toContain("https://a.zdmimg.com/1.jpg");
  });

  it("非 CSP 消息放行，且先吐汇总再放行（日志顺序不能乱）", () => {
    const { lines, filter } = makeFilter();
    filter.observe(imageNotice("https://a.zdmimg.com/a.jpg"));
    expect(filter.observe("Uncaught Error: boom")).toBe(false);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("折叠 1 条");
  });

  it("没有待发内容时 flush 是空操作", () => {
    const { lines, filter } = makeFilter();
    filter.flush();
    expect(lines).toEqual([]);
  });

  it("非图片类 CSP 通知也计入条数（不虚构示例）", () => {
    const { lines, timers, filter } = makeFilter();
    filter.observe("Refused to load the script 'https://x/a.js' because it violates the following Content Security Policy directive: script-src");
    timers[0].fire();
    expect(lines[0]).toContain("折叠 1 条");
    expect(lines[0]).toContain("图片 0 张");
    expect(lines[0]).not.toContain("示例");
  });

  it("汇总文案给出落点解释（不是内容丢失）", () => {
    const text = formatCspSummary(2, 2, "https://a.zdmimg.com/z.jpg");
    expect(text).toContain("主进程受控下载落地");
  });
});
