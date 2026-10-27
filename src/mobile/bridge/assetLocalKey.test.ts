import { describe, expect, it } from "vitest";
import { assetLocalKey } from "./sync.js";

describe("本地资产键映射（261027）", () => {
  it("文档：{id}/{file}（落盘 note-assets/{id}/{file}）", () => {
    expect(assetLocalKey("lake", "n1", "a.png")).toBe("n1/a.png");
  });

  it("小记：quick-notes/{id}/{file}（落盘 quick-notes/assets/{id}/{file}）", () => {
    expect(assetLocalKey("quickNotes", "q1", "b.png")).toBe("quick-notes/q1/b.png");
  });
});
