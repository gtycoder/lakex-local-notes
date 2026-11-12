/**
 * 保存拦截文案与桌面逐字对齐（261112 task-56 N5）。
 *
 * 判据（审计 16-mobile-lifecycle N5）：移动端 purged 文案缺「不可恢复」；用户被拦时不知道不可复原。
 * 这里做**文案 parity 源码断言**：两端的核心句子必须一致（只允许桌面追加「: noteId」这类上下文后缀）。
 * 注：文案单一来源仍是各自模块（跨进程无共享字符串常量），因此用断言守漂移而不是硬共享常量。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const MOBILE = read("src/mobile/bridge/notes.ts");
const DESKTOP = read("electron/noteContentRepository.ts");

const PHRASES = [
  "笔记已在回收站或已被删除，保存被拒绝；请先显式恢复",
  "笔记已被彻底删除（不可恢复），保存被拒绝；已删除条目不可复原",
];

describe("保存拦截文案两端一致（task-56 N5）", () => {
  it("trashed 与 purged 两句核心文案在两端都存在（逐字）", () => {
    for (const phrase of PHRASES) {
      expect(MOBILE).toContain(phrase);
      expect(DESKTOP).toContain(phrase);
    }
  });

  it("移动端 purged 文案必须带「不可恢复」（不得退回旧短语）", () => {
    expect(MOBILE).not.toContain('"笔记已被彻底删除，保存被拒绝"');
    expect(MOBILE).toContain("（不可恢复）");
  });
});
