import { describe, expect, it } from "vitest";
import {
  DISPLAY_ONLY_SHORTCUTS,
  RESERVED_CHORDS,
  SHELL_COMMANDS,
  chordMatches,
  codeOf,
  detectPlatform,
  formatChord,
  formatCommandKeys,
  matchShellCommand,
  parseChord,
} from "./registry";

describe("快捷键注册表（261114）", () => {
  it("键位不重复、不与保留键冲突、设置行 id 合法且唯一", () => {
    const chords = SHELL_COMMANDS.flatMap((command) => [...command.chords]);
    expect(new Set(chords).size).toBe(chords.length);
    for (const chord of chords) expect(RESERVED_CHORDS).not.toContain(chord);
    const ids = [
      ...SHELL_COMMANDS.map((command) => command.settingId),
      ...DISPLAY_ONLY_SHORTCUTS.map((row) => row.settingId),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^shortcut-[a-z0-9-]+$/);
  });

  it("mac：Mod 匹配 ⌘；其它平台匹配 Ctrl；多按/少按修饰键都不命中", () => {
    const event = { key: "w", code: "KeyW", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false };
    expect(chordMatches(event, "Mod+KeyW", "mac")).toBe(true);
    expect(chordMatches(event, "Mod+KeyW", "other")).toBe(false);
    expect(chordMatches({ ...event, shiftKey: true }, "Mod+KeyW", "mac")).toBe(false);
    expect(chordMatches({ ...event, altKey: true }, "Mod+KeyW", "mac")).toBe(false);
    // mac 上按 Ctrl 不等于 Mod
    expect(chordMatches({ key: "w", code: "KeyW", ctrlKey: true }, "Mod+KeyW", "mac")).toBe(false);
  });

  it("⇧] 用 code 匹配（美式键盘 key 是 '}'，按 key 会失配）", () => {
    expect(chordMatches({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }, "Mod+Shift+BracketRight", "mac")).toBe(true);
    // 合成事件没有 code 时按 key 反推
    expect(chordMatches({ key: "]", metaKey: true, shiftKey: true }, "Mod+Shift+BracketRight", "mac")).toBe(true);
    expect(codeOf({ key: "}", code: "BracketRight" })).toBe("BracketRight");
  });

  it("命令匹配：⌘P / ⌘K 都打开全局搜索；⌘W 关标签；F9 同步", () => {
    expect(matchShellCommand({ key: "p", code: "KeyP", metaKey: true }, "mac")).toBe("global-search");
    expect(matchShellCommand({ key: "k", code: "KeyK", metaKey: true }, "mac")).toBe("global-search");
    expect(matchShellCommand({ key: "w", code: "KeyW", metaKey: true }, "mac")).toBe("close-tab");
    expect(matchShellCommand({ key: "F9", code: "F9" }, "mac")).toBe("sync");
    // Windows/Linux：Ctrl 而不是 Meta
    expect(matchShellCommand({ key: "w", code: "KeyW", ctrlKey: true }, "other")).toBe("close-tab");
    expect(matchShellCommand({ key: "w", code: "KeyW", metaKey: true }, "other")).toBeNull();
  });

  it("第二批：⌃⇥ / ⌃⇧⇥ 切标签、⇧⌘G 锁文档、⌥H 历史", () => {
    expect(matchShellCommand({ key: "Tab", code: "Tab", ctrlKey: true }, "mac")).toBe("next-tab");
    expect(matchShellCommand({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true }, "mac")).toBe("prev-tab");
    expect(matchShellCommand({ key: "Tab", code: "Tab", ctrlKey: true }, "other")).toBe("next-tab");
    expect(matchShellCommand({ key: "h", code: "KeyH", altKey: true }, "mac")).toBe("history");
    expect(matchShellCommand({ key: "g", code: "KeyG", metaKey: true, shiftKey: true }, "mac")).toBe("lock-doc");
    const next = SHELL_COMMANDS.find((command) => command.id === "next-tab")!;
    expect(formatCommandKeys(next, "mac")).toBe("⇧⌘] / ⌃⇥");
    expect(formatChord("Mod+Shift+KeyG", "mac")).toBe("⇧⌘G");
    expect(formatChord("Alt+KeyH", "mac")).toBe("⌥H");
  });

  it("未注册组合返回 null（不抢内核/系统键）", () => {
    expect(matchShellCommand({ key: "s", code: "KeyS", metaKey: true }, "mac")).toBeNull();
    expect(matchShellCommand({ key: "f", code: "KeyF", metaKey: true }, "mac")).toBeNull();
    expect(matchShellCommand({ key: "1", code: "Digit1", metaKey: true }, "mac")).toBeNull();
  });

  it("显示文案：mac 用符号、其它平台用 Ctrl+；首个键位为主键位", () => {
    expect(formatChord("Mod+KeyP", "mac")).toBe("⌘P");
    expect(formatChord("Mod+Shift+BracketRight", "mac")).toBe("⇧⌘]");
    expect(formatChord("Mod+Shift+BracketRight", "other")).toBe("Ctrl+Shift+]");
    expect(formatChord("F9", "mac")).toBe("F9");
    const search = SHELL_COMMANDS.find((command) => command.id === "global-search")!;
    expect(formatCommandKeys(search, "mac")).toBe("⌘P / ⌘K");
  });

  it("parseChord 结构正确、缺主键要报错", () => {
    expect(parseChord("Mod+Shift+BracketRight")).toEqual({ code: "BracketRight", mod: true, ctrl: false, shift: true, alt: false });
    expect(() => parseChord("Mod+Shift")).toThrow(/缺少主键/);
  });

  it("平台判定：macOS 系 -> mac，其它 -> other", () => {
    expect(detectPlatform("MacIntel")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("mac");
    expect(detectPlatform("Win32")).toBe("other");
    expect(detectPlatform("Linux x86_64")).toBe("other");
  });
});
