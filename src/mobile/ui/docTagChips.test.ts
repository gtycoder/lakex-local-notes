/** 文档标签只读展示模型（纯函数）：顺序 = 本机视图，目录缺失只计数。 */
import { describe, expect, it } from "vitest";
import { collectDocTagFilterOptions, filterDocsByTag, resolveDocTagChips } from "./docTagChips";

const DIR = [
  { id: "t_work", name: "工作" },
  { id: "t_idea", name: "灵感" },
  { id: "t_life", name: "生活" },
];

describe("resolveDocTagChips（单篇只读 chips）", () => {
  it("按传入顺序（= 本机 tag_links.position）解析；去重", () => {
    expect(resolveDocTagChips(["t_idea", "t_work", "t_idea"], DIR)).toEqual({
      chips: [{ id: "t_idea", name: "灵感" }, { id: "t_work", name: "工作" }],
      unresolved: 0,
    });
  });

  it("目录里没有的 id 不渲染，只计数（降级提示用）", () => {
    const view = resolveDocTagChips(["t_work", "t_gone", "t_gone2"], DIR);
    expect(view.chips).toEqual([{ id: "t_work", name: "工作" }]);
    expect(view.unresolved).toBe(2);
  });

  it("无标签/空目录 ⇒ 空 chips（UI 据此不显示区块）", () => {
    expect(resolveDocTagChips([], DIR)).toEqual({ chips: [], unresolved: 0 });
    expect(resolveDocTagChips(["t_work"], [])).toEqual({ chips: [], unresolved: 1 });
  });
});

describe("collectDocTagFilterOptions（列表筛选标签）", () => {
  const DOCS = [
    { id: "n1", tagIds: ["t_idea", "t_work"] },
    { id: "n2", tagIds: ["t_work"] },
    { id: "n3", tagIds: [] },
    { id: "n4", tagIds: ["t_gone"] },
  ];

  it("只列被文档使用的标签，顺序 = 目录顺序（设备本地），带使用计数", () => {
    expect(collectDocTagFilterOptions(DOCS, DIR)).toEqual({
      chips: [
        { id: "t_work", name: "工作", count: 2 },
        { id: "t_idea", name: "灵感", count: 1 },
      ],
      unresolvedTags: 1,
    });
  });

  it("没有文档用标签 ⇒ 空 chips（不渲染筛选条）；目录缺失的标签计进 unresolvedTags", () => {
    expect(collectDocTagFilterOptions([{ id: "n1", tagIds: [] }], DIR)).toEqual({ chips: [], unresolvedTags: 0 });
    expect(collectDocTagFilterOptions([{ id: "n1", tagIds: ["t_x", "t_x"] }], DIR).unresolvedTags).toBe(1);
  });
});

describe("filterDocsByTag", () => {
  const DOCS = [{ id: "n1" }, { id: "n2" }, { id: "n3" }];
  const MAP = { n1: ["t_work"], n2: ["t_idea"], n3: [] };

  it("null = 全部（返回副本，不暴露入参引用）", () => {
    const out = filterDocsByTag(DOCS, MAP, null);
    expect(out).toEqual(DOCS);
    expect(out).not.toBe(DOCS);
  });

  it("按标签过滤；没有标签数据的文档不匹配", () => {
    expect(filterDocsByTag(DOCS, MAP, "t_work").map((d) => d.id)).toEqual(["n1"]);
    expect(filterDocsByTag(DOCS, MAP, "t_missing")).toEqual([]);
  });
});
