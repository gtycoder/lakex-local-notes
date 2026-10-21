import { describe, expect, it } from "vitest";
import { chooseColdStartNoteId } from "./coldStartNote.js";

const note = (id: string, kind: string | undefined, updatedAt: string) => ({ id, kind: kind as never, updatedAt });

describe("冷启动落点（261022：Lake 文档优先，其次多维表）", () => {
  it("上次打开的是 Lake 文档 ⇒ 直接落它（不看更新时间）", () => {
    const notes = [note("a", "doc", "2026-01-01"), note("b", "doc", "2026-02-01")];
    expect(chooseColdStartNoteId(notes, "a")).toBe("a");
  });

  it("上次打开的是表格 ⇒ 改落最近更新的 Lake 文档", () => {
    const notes = [note("sheet", "usheet", "2026-03-01"), note("d1", "doc", "2026-01-01"), note("d2", "doc", "2026-02-01")];
    expect(chooseColdStartNoteId(notes, "sheet")).toBe("d2");
  });

  it("没有 Lake 文档 ⇒ 落最近更新的多维表", () => {
    const notes = [note("b1", "bitable", "2026-01-01"), note("b2", "bitable", "2026-02-01"), note("s", "usheet", "2026-03-01")];
    expect(chooseColdStartNoteId(notes, "s")).toBe("b2");
  });

  it("只有表格/画板等 ⇒ 退回上次打开的（不能让用户找不到文档）", () => {
    const notes = [note("s1", "usheet", "2026-01-01"), note("s2", "usheet", "2026-02-01")];
    expect(chooseColdStartNoteId(notes, "s1")).toBe("s1");
    expect(chooseColdStartNoteId(notes, null)).toBe("s2");
  });

  it("空资料库 ⇒ null", () => {
    expect(chooseColdStartNoteId([], "x")).toBeNull();
  });
});
