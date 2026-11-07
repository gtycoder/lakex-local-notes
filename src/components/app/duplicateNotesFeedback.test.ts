
/** 「创建副本」结果 → 文案（261106）：成功/部分失败/整批未执行 + 失败 id 保留依据。 */
import { describe, expect, it } from "vitest";
import { DUPLICATE_NOTES_REASON_TEXT, duplicateNotesReasonText, duplicateNotesResultNotice } from "./duplicateNotesFeedback";
import { DUPLICATE_REASON_LABELS as MOBILE_DUPLICATE_REASON_LABELS } from "../../mobile/ui/duplicateNotesResult";
import { DUPLICATE_NOTES_REASONS } from "../../core/duplicateNotes";
import { DUPLICATE_REASON_LABELS } from "../../mobile/ui/duplicateNotesResult";
import type { DuplicateNotesResultShape } from "../../lib/types";

const result = (overrides: Partial<DuplicateNotesResultShape>): DuplicateNotesResultShape => ({
  ok: true, results: [], summary: { total: 0, done: 0, failed: 0 }, ...overrides,
});

describe("创建副本结果文案", () => {
  it("全部成功：只说条数（「已创建 N 个副本」）", () => {
    const notice = duplicateNotesResultNotice(result({
      results: [{ id: "n1", ok: true, newId: "c1" }, { id: "n2", ok: true, newId: "c2" }],
      summary: { total: 2, done: 2, failed: 0 },
    }));
    expect(notice).toEqual({ kind: "success", text: "已创建 2 个副本", failedIds: [] });
  });

  it("部分失败：显示「已创建 N 个副本，失败 M 项：原因」并给出失败 id（用于保留选中）", () => {
    const notice = duplicateNotesResultNotice(result({
      ok: false,
      results: [{ id: "n1", ok: true, newId: "c1" }, { id: "n2", ok: false, reason: "body-missing" }],
      summary: { total: 2, done: 1, failed: 1 },
    }));
    expect(notice.kind).toBe("partial");
    expect(notice.text).toBe("已创建 1 个副本，失败 1 项：1 项：正文文件缺失，无法复制");
    expect(notice.failedIds).toEqual(["n2"]);
  });

  it("同原因多条的失败摘要按原因归并（只列条数最多的 2 类）", () => {
    const notice = duplicateNotesResultNotice(result({
      ok: false,
      results: [
        { id: "n1", ok: false, reason: "already-trashed" },
        { id: "n2", ok: false, reason: "already-trashed" },
        { id: "n3", ok: false, reason: "unsupported" },
        { id: "n4", ok: false, reason: "failed" },
      ],
      summary: { total: 4, done: 0, failed: 4 },
    }));
    expect(notice.kind).toBe("error");
    expect(notice.text).toContain("未创建副本");
    expect(notice.text).toContain("2 项：笔记已在回收站里");
    expect(notice.text).not.toContain("创建副本失败"); // 只列前 2 类原因
  });

  it("整批未执行（请求级拒绝）：说「未创建副本：原因」，results 为空也能给原因", () => {
    const notice = duplicateNotesResultNotice(result({ ok: false, reason: "too-many-ids" }));
    expect(notice).toEqual({ kind: "error", text: "未创建副本：单次最多复制 500 篇，请分批处理", failedIds: [] });
  });

  it("reason 标签**单源**：桌面/移动端与 core 契约数组完全一致（新增 reason 只改 core 数组）", () => {
    expect([...DUPLICATE_NOTES_REASONS]).toHaveLength(10);
    expect(new Set(Object.keys(DUPLICATE_NOTES_REASON_TEXT))).toEqual(new Set(DUPLICATE_NOTES_REASONS));
    // 两端引用的是同一份 core 标签表（不是两份人工对齐的文案）
    expect(DUPLICATE_REASON_LABELS).toBe(DUPLICATE_NOTES_REASON_TEXT);
    for (const reason of DUPLICATE_NOTES_REASONS) expect(duplicateNotesReasonText(reason)).not.toBe("未知原因");
    expect(duplicateNotesReasonText(undefined)).toBe("未知原因");
  });
  it("两端 reason 文案共用 core 单一来源（桌面/移动 alias 同一对象）", () => {
    expect(MOBILE_DUPLICATE_REASON_LABELS).toBe(DUPLICATE_NOTES_REASON_TEXT);
  });

});