// @vitest-environment jsdom
/**
 * 「打开缺正文小记」提示（261104 B-lite）：
 *  ① 不再是静默 no-op —— 第一次点弹一条明确提示；
 *  ② **同一篇每会话只提示一次**（连点不刷屏），不同小记各自提示；
 *  ③ 文案走统一来源（指向设置 → 资源管理，不用中点）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MISSING_QUICK_NOTE_OPEN_HINT } from "../data/missingBodyMessages";
import { notifyMissingQuickNoteOnce, resetMissingQuickNoteNoticesForTest } from "./missingQuickNoteNotice";

beforeEach(() => {
  resetMissingQuickNoteNoticesForTest();
});

describe("缺正文小记的打开提示", () => {
  it("首次打开提示一次，错误样式；文案指向资源管理", () => {
    const toast = vi.fn();
    expect(notifyMissingQuickNoteOnce("q1", toast)).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(MISSING_QUICK_NOTE_OPEN_HINT, { type: "error" });
    const [text] = toast.mock.calls[0];
    expect(String(text)).toContain("设置 → 资源管理");
    expect(String(text)).not.toContain("·");
  });

  it("同一篇每会话只提示一次（连点不刷屏）", () => {
    const toast = vi.fn();
    notifyMissingQuickNoteOnce("q1", toast);
    expect(notifyMissingQuickNoteOnce("q1", toast)).toBe(false);
    expect(notifyMissingQuickNoteOnce("q1", toast)).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("不同小记各自提示（去重按 id，不是全局一门闸）", () => {
    const toast = vi.fn();
    notifyMissingQuickNoteOnce("q1", toast);
    notifyMissingQuickNoteOnce("q2", toast);
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
