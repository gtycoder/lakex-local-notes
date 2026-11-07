
/** 批量结果 → 文案（261106 task-81）：成功/部分失败/整批未执行 + 失败 id 保留依据。 */
import { describe, expect, it } from "vitest";
import { BATCH_NOTES_ACTION_TEXT, BATCH_NOTES_REASON_TEXT, batchNotesReasonText, batchNotesResultNotice } from "./batchNotesFeedback";
import type { BatchNotesResultShape } from "../../lib/types";

const result = (overrides: Partial<BatchNotesResultShape>): BatchNotesResultShape => ({
  ok: true, results: [], summary: { total: 0, done: 0, failed: 0 }, ...overrides,
});

describe("批量操作结果文案", () => {
  it("动作文案：trash 与普通右键一致，界面统一叫「删除」", () => {
    expect(BATCH_NOTES_ACTION_TEXT.trash).toBe("删除");
    expect(BATCH_NOTES_ACTION_TEXT.move).toBe("移动");
  });

  it("全部成功：只说条数", () => {
    const notice = batchNotesResultNotice(result({
      results: [{ id: "n1", ok: true }, { id: "n2", ok: true }],
      summary: { total: 2, done: 2, failed: 0 },
    }), "move");
    expect(notice).toEqual({ kind: "success", text: "已移动 2 项", failedIds: [] });
  });

  it("部分失败：显示「已… N 项，失败 M 项：原因」，并给出失败 id（用于保留选中）", () => {
    const notice = batchNotesResultNotice(result({
      ok: false,
      results: [{ id: "n1", ok: true }, { id: "n2", ok: false, reason: "parent-cycle" }],
      summary: { total: 2, done: 1, failed: 1 },
    }), "move");
    expect(notice.kind).toBe("partial");
    expect(notice.text).toContain("已移动 1 项，失败 1 项");
    expect(notice.text).toContain("不能移动到自己的子项里");
    expect(notice.failedIds).toEqual(["n2"]);
  });

  it("整批未执行：说「未…」+ 原因；请求级拒绝也能给原因", () => {
    const notice = batchNotesResultNotice(result({
      ok: false,
      results: [{ id: "n1", ok: false, reason: "already-trashed" }],
      summary: { total: 1, done: 0, failed: 1 },
      reason: "invalid-input",
    }), "trash");
    expect(notice.kind).toBe("error");
    expect(notice.text).toContain("未删除");
    expect(notice.text).toContain("已在回收站里");
    expect(notice.failedIds).toEqual(["n1"]);

    const noResults = batchNotesResultNotice(result({ ok: false, reason: "too-many-ids" }), "trash");
    expect(noResults.text).toContain("单次最多 500 项");
  });

  it("原因文案覆盖契约全部取值（新增 reason 必须同步这里）", () => {
    const reasons = Object.keys(BATCH_NOTES_REASON_TEXT) as Array<keyof typeof BATCH_NOTES_REASON_TEXT>;
    expect(reasons).toHaveLength(16);
    for (const reason of reasons) expect(batchNotesReasonText(reason)).not.toBe("未知原因");
    expect(batchNotesReasonText(undefined)).toBe("未知原因");
  });
});