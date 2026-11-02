// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTypingTarget, matchPadShortcut } from "./usePadShortcuts";

describe("平板快捷键判据（纯函数）", () => {
  it("⌘/Ctrl + K / F / N", () => {
    expect(matchPadShortcut({ key: "k", metaKey: true })).toBe("search");
    expect(matchPadShortcut({ key: "K", ctrlKey: true })).toBe("search");
    expect(matchPadShortcut({ key: "f", metaKey: true })).toBe("find");
    expect(matchPadShortcut({ key: "n", ctrlKey: true })).toBe("new-note");
  });

  it("裸 N 只在非输入态生效（编辑正文时打 n 不抢键）", () => {
    expect(matchPadShortcut({ key: "n", typing: false })).toBe("new-note");
    expect(matchPadShortcut({ key: "n", typing: true })).toBeNull();
  });

  it("Esc 与无关按键", () => {
    expect(matchPadShortcut({ key: "Escape" })).toBe("escape");
    expect(matchPadShortcut({ key: "a" })).toBeNull();
    expect(matchPadShortcut({ key: "k" })).toBeNull(); // 无修饰键的 k 不触发
  });

  it("isTypingTarget：输入框 / 内核编辑器 / 表格宿主都算输入态", () => {
    const input = document.createElement("input");
    const engine = document.createElement("div");
    engine.className = "ne-engine";
    const wrap = document.createElement("div");
    wrap.className = "lake-editor-mount";
    const inner = document.createElement("span");
    engine.append(inner);
    const outer = document.createElement("div");
    outer.append(engine);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(engine)).toBe(true);
    expect(isTypingTarget(inner)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
