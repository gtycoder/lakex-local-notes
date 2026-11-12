import { describe, expect, it } from "vitest";
import { diaryToQuickNoteNotice } from "./diaryQuickNote";

describe("日记→小记完成提示（261112 task-92）", () => {
  it("全部搬运：基础文案含「含图片/附件」「回收站可恢复」", () => {
    const text = diaryToQuickNoteNotice([]);
    expect(text).toContain("已转为小记（含图片/附件）");
    expect(text).toContain("日记已移入回收站，可恢复");
    expect(text).not.toContain("未搬运");
  });

  it("有未搬运类型：用中文名明说并去重（未知类型原样露出）", () => {
    const text = diaryToQuickNoteNotice(["board", "toc", "board", "weird"]);
    expect(text).toContain("画板");
    expect(text).toContain("大纲");
    expect(text).toContain("weird");
    expect(text).toContain("未搬运");
    expect(text.match(/画板/g) ?? []).toHaveLength(1);
    expect(text).toContain("日记原稿仍在回收站，可恢复");
  });
});
