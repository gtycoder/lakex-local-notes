// @vitest-environment jsdom
/**
 * 移动端日记告警环形缓冲（261110 wave2）：坏数据当空、上限裁剪、写入可读回、敏感信息不落。
 * 这是「桌面 diaryStore 的 log 通道」在移动端的可见物 —— 坏了等于日记告警又变回不可见。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DIARY_WARN_LOG_KEY,
  DIARY_WARN_LOG_MAX,
  DIARY_WARNING_TEXT,
  appendDiaryWarning,
  clearDiaryWarnings,
  formatDiaryWarnings,
  normalizeDiaryWarning,
  parseDiaryWarnings,
  readDiaryWarnings,
  reportDiaryWarning,
} from "./diaryWarnLog";

const MULTI = "multiple-notebooks" as const;
const entry = (n: number) => ({ at: "2026-11-10T00:00:0" + n + ".000Z", code: MULTI, message: DIARY_WARNING_TEXT[MULTI] });

beforeEach(() => clearDiaryWarnings());

describe("diaryWarnLog 纯函数", () => {
  it("坏 JSON / 非数组 / 坏元素 / 未知 code ⇒ 空或逐条过滤（不抛）", () => {
    expect(parseDiaryWarnings(null)).toEqual([]);
    expect(parseDiaryWarnings("{bad")).toEqual([]);
    expect(parseDiaryWarnings("{\"a\":1}")).toEqual([]);
    const raw = JSON.stringify([
      { at: "t", code: MULTI, message: "ignored" },
      { at: "t", code: "not-a-code", message: "x" },
      { at: "", code: MULTI, message: "x" },
      { nope: 1 },
      null,
      "x",
    ]);
    expect(parseDiaryWarnings(raw)).toEqual([{ at: "t", code: MULTI, message: DIARY_WARNING_TEXT[MULTI] }]);
  });

  it("环形缓冲只留最近 max 条（默认 50）", () => {
    let list: ReturnType<typeof appendDiaryWarning> = [];
    for (let i = 0; i < DIARY_WARN_LOG_MAX + 7; i += 1) list = appendDiaryWarning(list, entry(i));
    expect(DIARY_WARN_LOG_MAX).toBe(50);
    expect(list).toHaveLength(DIARY_WARN_LOG_MAX);
    // 新的在后、旧的先被挤掉
    expect(list[list.length - 1].at).toBe("2026-11-10T00:00:0" + (DIARY_WARN_LOG_MAX + 6) + ".000Z");
    expect(list[0].at).not.toBe("2026-11-10T00:00:00.000Z");
  });

  it("message 只来自固定文案表：伪造/遗留的自由文本被丢弃（正文/Key 不落）", () => {
    const normalized = normalizeDiaryWarning({
      at: "2026-11-10T00:00:00.000Z",
      code: MULTI,
      message: "正文：今天的秘密 / Key=sk-live-LEAK",
      stack: "at secret",
    });
    expect(normalized).toEqual({ at: "2026-11-10T00:00:00.000Z", code: MULTI, message: DIARY_WARNING_TEXT[MULTI] });
  });
});

describe("diaryWarnLog 存储", () => {
  it("reportDiaryWarning 落盘 + read 读回；format 与 crashLog 同格式", () => {
    reportDiaryWarning(MULTI, "2026-11-10T00:00:00.000Z");
    const entries = readDiaryWarnings();
    expect(entries).toEqual([{ at: "2026-11-10T00:00:00.000Z", code: MULTI, message: DIARY_WARNING_TEXT[MULTI] }]);
    expect(formatDiaryWarnings(entries)[0]).toBe("[2026-11-10T00:00:00.000Z][diary:" + MULTI + "] " + DIARY_WARNING_TEXT[MULTI]);
    expect(readDiaryWarnings(0)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(DIARY_WARN_LOG_KEY)!)).toHaveLength(1);
  });

  it("只存 at/code/message 三个字段，原文不含正文/Key 字样", () => {
    reportDiaryWarning(MULTI);
    const raw = localStorage.getItem(DIARY_WARN_LOG_KEY)!;
    const [stored] = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(Object.keys(stored).sort()).toEqual(["at", "code", "message"]);
    expect(stored.message).toBe(DIARY_WARNING_TEXT[MULTI]);
    expect(raw).not.toContain("正文");
    expect(raw).not.toMatch(/secret|AKIA|sk-/i);
    clearDiaryWarnings();
    expect(localStorage.getItem(DIARY_WARN_LOG_KEY)).toBeNull();
    expect(readDiaryWarnings()).toEqual([]);
  });
});
