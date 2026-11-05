// @vitest-environment jsdom
/**
 * 移动端崩溃环形缓冲（261105）：坏数据当空、上限裁剪、写入可读回。
 * 这是全局异常兜底/错误边界/诊断复制的单一存储，坏了会让排障直接失明。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CRASH_LOG_KEY,
  CRASH_LOG_MAX,
  appendCrashEntry,
  clearCrashLog,
  formatCrashEntries,
  parseCrashLog,
  readCrashLog,
  reportCrash,
} from "./crashLog";

const entry = (n: number) => ({ at: "2026-11-05T00:00:0" + n + ".000Z", scope: "window", message: "err-" + n });

beforeEach(() => clearCrashLog());

describe("crashLog 纯函数", () => {
  it("坏 JSON / 非数组 / 坏元素 ⇒ 空或逐条过滤（不抛）", () => {
    expect(parseCrashLog(null)).toEqual([]);
    expect(parseCrashLog("{bad")).toEqual([]);
    expect(parseCrashLog("{\"a\":1}")).toEqual([]);
    expect(parseCrashLog(JSON.stringify([{ at: "t", scope: "s", message: "m" }, { nope: 1 }, null, "x"]))).toEqual([
      { at: "t", scope: "s", message: "m" },
    ]);
  });

  it("环形缓冲只留最新 max 条", () => {
    let list: ReturnType<typeof appendCrashEntry> = [];
    for (let i = 0; i < CRASH_LOG_MAX + 5; i += 1) list = appendCrashEntry(list, entry(i));
    expect(list).toHaveLength(CRASH_LOG_MAX);
    expect(list[list.length - 1].message).toBe("err-" + (CRASH_LOG_MAX + 4));
  });

  it("超长 message/stack 会被裁剪（不把 localStorage 撑爆）", () => {
    reportCrash({ scope: "boundary:app", message: "x".repeat(2000), stack: "s".repeat(5000) });
    const [first] = readCrashLog();
    expect(first.message.length).toBeLessThan(600);
    expect(first.stack!.length).toBeLessThan(2100);
  });
});

describe("crashLog 存储", () => {
  it("reportCrash 落盘 + readCrashLog 读回（含 Error 堆栈）", () => {
    const error = new Error("boom");
    reportCrash({ scope: "window", message: error });
    const entries = readCrashLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scope: "window", message: "boom" });
    expect(entries[0].stack).toContain("crashLog.test");
    expect(readCrashLog(0)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(CRASH_LOG_KEY)!)).toHaveLength(1);
  });

  it("formatCrashEntries 拼人读文本；clearCrashLog 清空", () => {
    reportCrash({ scope: "native", message: "渲染进程中断", at: "2026-11-05T00:00:00.000Z" });
    const lines = formatCrashEntries(readCrashLog());
    expect(lines[0]).toContain("[native]");
    expect(lines[0]).toContain("渲染进程中断");
    clearCrashLog();
    expect(localStorage.getItem(CRASH_LOG_KEY)).toBeNull();
    expect(readCrashLog()).toEqual([]);
  });
});
