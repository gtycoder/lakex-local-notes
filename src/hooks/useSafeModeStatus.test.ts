/**
 * Batch4-D 判据矩阵：会话是否落盘的唯一决策函数（安全模式/判定未到一律 skip）。
 */
import { describe, expect, it } from "vitest";
import { tabSessionWriteDecision } from "./useSafeModeStatus";

describe("tabSessionWriteDecision（会话写入门）", () => {
  it("安全模式 ⇒ skip（不写不清，保留用户原会话）", () => {
    expect(tabSessionWriteDecision("active", false)).toBe("skip");
    expect(tabSessionWriteDecision("active", true)).toBe("skip");
    expect(tabSessionWriteDecision("active", undefined)).toBe("skip");
  });

  it("判据未到达（unknown）⇒ skip（宁可晚一条，也不冒覆盖风险）", () => {
    expect(tabSessionWriteDecision("unknown", false)).toBe("skip");
    expect(tabSessionWriteDecision("unknown", true)).toBe("skip");
  });

  it("正常模式 ⇒ 原语义：默认 write，开启「退出时关闭全部标签」则 clear", () => {
    expect(tabSessionWriteDecision("inactive", false)).toBe("write");
    expect(tabSessionWriteDecision("inactive", undefined)).toBe("write");
    expect(tabSessionWriteDecision("inactive", true)).toBe("clear");
  });
});
