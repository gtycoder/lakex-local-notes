/**
 * 文档属性共享模块的护栏（C1-7，261016）。
 *
 * 三件事：① 清单的标签与顺序钉死（写死字面量，不复用实现）；② 两个格式化口径的边界钉死；
 * ③ **源码级**：两端组件不得再自己写一份清单/格式化（否则"两端显示口径漂移"会重新长回来）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NoteInfo } from "../lib/types.js";
import { SYNC_STATE_LABEL, formatNoteInfoSize, formatNoteInfoTime, noteInfoRows } from "./noteInfo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 用本地时间构造，避免测试依赖运行机器的时区。 */
const localIso = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();

const info = (patch: Partial<NoteInfo> = {}): NoteInfo => ({
  createdAt: localIso(2026, 10, 16, 9, 2),
  updatedAt: localIso(2026, 10, 15, 8, 1),
  wordCount: 12,
  charCount: 34,
  sizeBytes: 2048,
  syncState: "synced",
  isConflict: false,
  isLocked: false,
  ...patch,
} as unknown as NoteInfo);

describe("文档属性共享清单（C1-7）", () => {
  it("清单标签与顺序钉死（两端同一份）", () => {
    expect(noteInfoRows(info()).map(([k]) => k)).toEqual(["创建", "更新", "字数", "大小", "状态"]);
  });

  it("取值按口径拼装（字数双计、状态叠加标记）", () => {
    const rows = Object.fromEntries(noteInfoRows(info()));
    expect(rows["创建"]).toBe("2026-10-16 09:02");
    expect(rows["更新"]).toBe("2026-10-15 08:01");
    expect(rows["字数"]).toBe("12 字 · 34 字符");
    expect(rows["大小"]).toBe("2.0 KB");
    expect(rows["状态"]).toBe("已同步");
  });

  it("状态：冲突与锁定以 · 叠加，未知状态原样回显", () => {
    const status = (patch: Partial<NoteInfo>) => Object.fromEntries(noteInfoRows(info(patch)))["状态"];
    expect(status({ isConflict: true })).toBe("已同步 · 有冲突副本");
    expect(status({ isLocked: true })).toBe("已同步 · 已锁定");
    expect(status({ isConflict: true, isLocked: true })).toBe("已同步 · 有冲突副本 · 已锁定");
    expect(status({ syncState: "weird" })).toBe("weird");
    expect(SYNC_STATE_LABEL.local).toBe("未同步");
    expect(SYNC_STATE_LABEL.conflict).toBe("冲突");
  });

  it("时间口径：空 → 破折号；非法值原样回显；本地时区格式化", () => {
    expect(formatNoteInfoTime(null)).toBe("—");
    expect(formatNoteInfoTime("not-a-date")).toBe("not-a-date");
    expect(formatNoteInfoTime(localIso(2026, 1, 2, 3, 4))).toBe("2026-01-02 03:04");
  });

  it("体积口径：B 档不带小数、其余 1 位；非正值与 NaN → 0 B（**与 lib/formatBytes* 不同口径**）", () => {
    expect(formatNoteInfoSize(0)).toBe("0 B");
    expect(formatNoteInfoSize(-1)).toBe("0 B");
    expect(formatNoteInfoSize(Number.NaN)).toBe("0 B");
    expect(formatNoteInfoSize(512)).toBe("512 B");
    expect(formatNoteInfoSize(1024)).toBe("1.0 KB");
    expect(formatNoteInfoSize(200 * 1024)).toBe("200.0 KB");
    expect(formatNoteInfoSize(1024 ** 3)).toBe("1.0 GB");
  });

  it("两端组件都从 core 取清单，且不得再自己写一份（源码级护栏）", () => {
    for (const rel of ["src/components/NoteInfoDialog.tsx", "src/mobile/ui/NoteInfoSheet.tsx"]) {
      const src = read(rel);
      expect(/from "\.\.(\/\.\.)?\/core\/noteInfo\.js"/.test(src), rel + " 必须从 core/noteInfo 取清单").toBe(true);
      expect(/noteInfoRows\(/.test(src), rel + " 必须调用 noteInfoRows").toBe(true);
      expect(/function fmtTime\(|function fmtSize\(|SYNC_LABEL/.test(src), rel + " 不得再自己实现格式化/状态文案").toBe(false);
      expect(/\["创建"/.test(src), rel + " 不得再内联属性清单（改 core/noteInfo.ts）").toBe(false);
    }
  });
});
