import { describe, expect, it } from "vitest";
import { syncWarningCopy, syncWarningRows, syncWarningSummary, syncWarningSummaryText, syncWarningTitle, SYNC_WARNING_COPY } from "./syncWarningText";
import type { SyncWarning, SyncWarningKind } from "./sharedTypes.js";

/**
 * 同步 warning 文案单一来源（261112 UI 审计 17 P1）：
 * ① 7 个 kind 全覆盖；② retryable=false 的三类不写「下次同步会重试」；③ 摘要/排序/标题回退稳定。
 */
const KINDS: SyncWarningKind[] = ["remote_incomplete", "asset_missing", "local_body_missing", "body_suspicious_external_change", "local_body_restored", "asset_kept_remote", "asset_invalid_name"];

describe("syncWarningText（同步 warning 文案单一来源）", () => {
  it("7 个 kind 全覆盖，label/hint 非空且不含中点", () => {
    expect(Object.keys(SYNC_WARNING_COPY).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      const copy = syncWarningCopy(kind);
      expect(copy.label.length, kind).toBeGreaterThan(0);
      expect(copy.hint.length, kind).toBeGreaterThan(0);
      expect(copy.hint).not.toContain("·");
      expect(copy.label).not.toContain("·");
    }
  });

  it("不可重试的三类不得出现「下次同步会重试」承诺", () => {
    const permanent: SyncWarningKind[] = ["local_body_missing", "body_suspicious_external_change", "asset_invalid_name"];
    for (const kind of permanent) {
      expect(syncWarningCopy(kind).retryable, kind).toBe(false);
      expect(syncWarningCopy(kind).hint, kind).not.toContain("下次同步会重试");
    }
    // 可重试类保留「下次同步会重试」（用户可据此等待）
    expect(syncWarningCopy("remote_incomplete").retryable).toBe(true);
    expect(syncWarningCopy("remote_incomplete").hint).toContain("重试");
  });

  it("摘要按「需处理 / 可重试」分组计数，摘要文案不写绝对化承诺", () => {
    const warnings: SyncWarning[] = [
      { kind: "local_body_missing", noteId: "n2", message: "x" },
      { kind: "remote_incomplete", noteId: "n1", title: "甲", message: "x" },
      { kind: "asset_invalid_name", filename: "a b.png", message: "x" },
      { kind: "asset_missing", noteId: "n3", title: "乙", message: "x" },
    ];
    const summary = syncWarningSummary(warnings);
    expect(summary).toEqual({ total: 4, needsAction: 2, retryable: 2 });
    expect(syncWarningSummaryText(summary)).toBe("同步有 4 项被跳过（需处理 2，可重试 2）");
    expect(syncWarningSummaryText(syncWarningSummary([]))).toBe("");
    expect(syncWarningSummaryText({ total: 1, needsAction: 1, retryable: 0 })).toBe("同步有 1 项被跳过（需处理 1）");
    expect(syncWarningSummaryText({ total: 2, needsAction: 0, retryable: 2 })).toBe("同步有 2 项被跳过（可重试 2）");
  });

  it("列表排序：需处理在前、可重试在后，组内保序", () => {
    const warnings: SyncWarning[] = [
      { kind: "remote_incomplete", noteId: "r1", message: "" },
      { kind: "local_body_missing", noteId: "p1", message: "" },
      { kind: "asset_missing", noteId: "r2", message: "" },
      { kind: "asset_invalid_name", filename: "bad.png", message: "" },
    ];
    expect(syncWarningRows(warnings).map((w) => w.noteId ?? w.filename)).toEqual(["p1", "bad.png", "r1", "r2"]);
  });

  it("行标题回退：title > filename > id 截断 > 未知条目", () => {
    expect(syncWarningTitle({ kind: "remote_incomplete", title: " 甲 ", noteId: "n1", message: "" })).toBe("甲");
    expect(syncWarningTitle({ kind: "asset_missing", filename: "图.png", noteId: "n1", message: "" })).toBe("图.png");
    expect(syncWarningTitle({ kind: "remote_incomplete", noteId: "0123456789abcdef", message: "" })).toBe("文档 01234567…");
    expect(syncWarningTitle({ kind: "remote_incomplete", message: "" })).toBe("未知条目");
  });
});
