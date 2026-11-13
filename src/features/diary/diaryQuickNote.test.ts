import { describe, expect, it } from "vitest";
import { diaryToQuickNoteNotice } from "./diaryQuickNote";

describe("日记→小记完成提示（261113 移动语义）", () => {
  it("本篇带了媒体：基础文案含「含图片/附件」", () => {
    const text = diaryToQuickNoteNotice({ movedMediaCount: 2, removedHistoryCount: 0 });
    expect(text).toContain("已转为小记（含图片/附件）");
    expect(text).not.toContain("未搬运");
  });

  it("本篇没有媒体：不说「含图片/附件」（文案与事实一致）", () => {
    const text = diaryToQuickNoteNotice({ movedMediaCount: 0, removedHistoryCount: 0 });
    expect(text).toBe("已转为小记；原日记已移出日记本，无副本、不可恢复");
    expect(text).not.toContain("图片");
  });

  it("明确说明无副本、不可恢复（旧「回收站可恢复」口径已作废）", () => {
    const text = diaryToQuickNoteNotice({ movedMediaCount: 1 });
    expect(text).toContain("无副本、不可恢复");
    expect(text).not.toContain("回收站");
    expect(text).not.toContain("未搬运");
  });

  it("删除了原文档历史快照时明说（小记没有历史快照）", () => {
    const text = diaryToQuickNoteNotice({ movedMediaCount: 0, removedHistoryCount: 3 });
    expect(text).toContain("原文档历史快照已删除");
    expect(diaryToQuickNoteNotice({ movedMediaCount: 0, removedHistoryCount: 0 })).not.toContain("历史");
  });
});
