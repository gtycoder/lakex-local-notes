import { describe, expect, it } from "vitest";
import { shouldSeedWelcomeQuickNote } from "./welcomeQuickNote";

describe("首启默认小记判据（Android）", () => {
  it("全新库（无小记、无文档、未种过）才创建", () => {
    expect(shouldSeedWelcomeQuickNote({ seeded: false, quickNoteCount: 0, noteCount: 0 })).toBe(true);
  });
  it("已经种过（用户删光了也不复活）", () => {
    expect(shouldSeedWelcomeQuickNote({ seeded: true, quickNoteCount: 0, noteCount: 0 })).toBe(false);
  });
  it("已有小记或已有文档的库不插入（老用户不被打扰）", () => {
    expect(shouldSeedWelcomeQuickNote({ seeded: false, quickNoteCount: 1, noteCount: 0 })).toBe(false);
    expect(shouldSeedWelcomeQuickNote({ seeded: false, quickNoteCount: 0, noteCount: 1 })).toBe(false);
  });
});
