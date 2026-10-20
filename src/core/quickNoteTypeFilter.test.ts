import { describe, expect, it } from "vitest";
import {
  QUICK_NOTE_TYPE_OPTIONS,
  countQuickNotesByType,
  filterQuickNotesByType,
  quickNoteMatchesType,
  type QuickNoteTypeFilter,
} from "./quickNoteTypeFilter";

interface Note {
  id: string;
  images: { mimeType: string }[];
}

const assetsOf = (note: Note) => note.images;
const notes: Note[] = [
  { id: "text", images: [] },
  { id: "image", images: [{ mimeType: "image/png" }] },
  { id: "file", images: [{ mimeType: "application/pdf" }] },
  { id: "mixed", images: [{ mimeType: "image/jpeg" }, { mimeType: "video/mp4" }] },
];

describe("小记类型筛选（小记 / 图片 / 附件）", () => {
  it("菜单顺序与语雀一致，且不放入本产品没有数据的死选项", () => {
    expect(QUICK_NOTE_TYPE_OPTIONS.map((option) => option.id)).toEqual(["all", "image", "attachment"]);
    expect(QUICK_NOTE_TYPE_OPTIONS.map((option) => option.label)).toEqual(["小记", "图片", "附件"]);
  });

  it("all = 全部（默认），image 只看图片资源，attachment 只看非图片资源", () => {
    expect(filterQuickNotesByType(notes, "all", assetsOf).map((note) => note.id)).toEqual(["text", "image", "file", "mixed"]);
    expect(filterQuickNotesByType(notes, "image", assetsOf).map((note) => note.id)).toEqual(["image", "mixed"]);
    expect(filterQuickNotesByType(notes, "attachment", assetsOf).map((note) => note.id)).toEqual(["file", "mixed"]);
  });

  it("分类只看 mime 白名单，不看文件名；图片/附件可以重叠", () => {
    expect(quickNoteMatchesType({ id: "x", images: [{ mimeType: "image/svg+xml" }] }, "image", assetsOf)).toBe(false);
    expect(quickNoteMatchesType({ id: "x", images: [{ mimeType: "image/webp" }] }, "image", assetsOf)).toBe(true);
    expect(quickNoteMatchesType({ id: "x", images: [{ mimeType: "application/zip" }] }, "attachment", assetsOf)).toBe(true);
    expect(quickNoteMatchesType({ id: "x", images: [{ mimeType: "application/zip" }] }, "image", assetsOf)).toBe(false);
  });

  it("缺省 assetsOf 时按 content.images 取值（工作区直接传 item）", () => {
    const docs = [{ id: "a", content: { images: [{ mimeType: "image/png" }] } }, { id: "b", content: { images: [] } }];
    expect(filterQuickNotesByType(docs, "image").map((doc) => doc.id)).toEqual(["a"]);
  });

  it("计数覆盖三种类型，image/attachment 可重叠", () => {
    expect(countQuickNotesByType(notes, assetsOf)).toEqual({ all: 4, image: 2, attachment: 2 });
  });

  it("筛选结果保持原顺序（排序/置顶由工作区负责）", () => {
    const ids: QuickNoteTypeFilter[] = ["all", "image", "attachment"];
    for (const filter of ids) {
      const result = filterQuickNotesByType(notes, filter, assetsOf).map((note) => note.id);
      expect(result).toEqual([...result].sort((a, b) => notes.findIndex((n) => n.id === a) - notes.findIndex((n) => n.id === b)));
    }
  });
});
