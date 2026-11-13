import { describe, expect, it } from "vitest";
import { blockingDirtyTabs } from "./unloadGuard.js";

const tab = (noteId: string, dirty: boolean, deleted = false) => ({ noteId, dirty, deleted });

describe("blockingDirtyTabs（退出闸判据）", () => {
  it("普通脏标签必须拦下（还有保存机会）", () => {
    expect(blockingDirtyTabs([tab("a", true)], () => false)).toHaveLength(1);
  });
  it("已进入回收站/已删除的标签不拦（保存永远会被拒）", () => {
    expect(blockingDirtyTabs([tab("a", true, true)], () => false)).toHaveLength(0);
  });
  it("保存已被拒绝（error）的标签不拦 —— 用户裁决：这类内容允许丢弃并正常退出", () => {
    expect(blockingDirtyTabs([tab("a", true)], (id) => id === "a")).toHaveLength(0);
  });
  it("不脏的标签本来就不拦；混合时只拦仍可保存的那几条", () => {
    const tabs = [tab("clean", false), tab("blocked", true, true), tab("failed", true), tab("bad", true)];
    const failed = new Set(["failed"]);
    expect(blockingDirtyTabs(tabs, (id) => failed.has(id)).map((t) => t.noteId)).toEqual(["bad"]);
  });
});
