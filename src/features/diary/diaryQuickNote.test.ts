import { describe, expect, it } from "vitest";
import { diaryToQuickNoteNotice } from "./diaryQuickNote";

describe("日记→小记完成提示（261112 task-92；task-105 按实际搬运）", () => {
  it("本篇带了媒体：基础文案含「含图片/附件」+ 回收站可恢复", () => {
    const text = diaryToQuickNoteNotice({ carriedMediaCount: 2 });
    expect(text).toContain("已转为小记（含图片/附件）");
    expect(text).toContain("日记已移入回收站，可恢复");
    expect(text).not.toContain("未搬运");
  });

  it("本篇没有媒体：不说「含图片/附件」（文案与事实一致）", () => {
    const text = diaryToQuickNoteNotice({ carriedMediaCount: 0 });
    expect(text).toBe("已转为小记；日记已移入回收站，可恢复");
    expect(text).not.toContain("图片");
  });

  it("卡片零剥离（261113）：提示不再有「未搬运」分支（droppedKinds 字段恒空）", () => {
    const text = diaryToQuickNoteNotice({ carriedMediaCount: 1 });
    expect(text).toBe("已转为小记（含图片/附件）；日记已移入回收站，可恢复");
    expect(text).not.toContain("未搬运");
    expect(text).not.toContain("画板");
  });
});
