import { describe, expect, it } from "vitest";
import {
  DIARY_FOLDER_SPACE, diaryEntries, diaryGroupTitles, diaryNotebookId, diaryNotebooks,
  folderSpaceForWire, formatDiaryDateKey, groupDiaryEntries, isDiaryGroupTitle, normalizeFolderSpace,
  parseDiaryDateKey, planDiaryOpen, recentDiaryDays, withoutDiaryNotebook,
  type DiaryTreeNode,
} from "./diary.js";

const node = (over: Partial<DiaryTreeNode> & { id: string; title: string }): DiaryTreeNode => ({
  parentId: null, nodeType: "note", updatedAt: "", sortOrder: 0, ...over,
});

const notebook = (id = "nb-diary", over: Partial<DiaryTreeNode> = {}): DiaryTreeNode =>
  node({ id, title: "日记", nodeType: "notebook", space: DIARY_FOLDER_SPACE, ...over });

describe("formatDiaryDateKey", () => {
  it("用本地日期，不经过 UTC（23:30 不许滑到第二天）", () => {
    const late = new Date(2026, 10, 9, 23, 30, 0);
    expect(formatDiaryDateKey(late)).toBe("2026-11-09");
    const early = new Date(2026, 10, 9, 0, 5, 0);
    expect(formatDiaryDateKey(early)).toBe("2026-11-09");
  });

  it("月日补零", () => {
    expect(formatDiaryDateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(formatDiaryDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("parseDiaryDateKey", () => {
  it("接受严格 YYYY-MM-DD", () => {
    expect(parseDiaryDateKey("2026-11-09")).toBe("2026-11-09");
    expect(parseDiaryDateKey("  2026-11-09  ")).toBe("2026-11-09");
  });

  it("拒绝不补零 / 非法日期 / 其它形状", () => {
    expect(parseDiaryDateKey("2026-2-9")).toBeNull();
    expect(parseDiaryDateKey("2026-13-01")).toBeNull();
    expect(parseDiaryDateKey("2026-02-30")).toBeNull();
    expect(parseDiaryDateKey("2026-00-10")).toBeNull();
    expect(parseDiaryDateKey("2026/11/09")).toBeNull();
    expect(parseDiaryDateKey("十一月九日")).toBeNull();
    expect(parseDiaryDateKey("")).toBeNull();
    expect(parseDiaryDateKey("2026-11-09 补记")).toBeNull();
  });

  it("闰年按真实日历判定", () => {
    expect(parseDiaryDateKey("2024-02-29")).toBe("2024-02-29");
    expect(parseDiaryDateKey("2026-02-29")).toBeNull();
  });
});

describe("分组标题", () => {
  it("月补零，与多维表日期值域一致", () => {
    expect(diaryGroupTitles("2026-01-05")).toEqual({ year: "2026", month: "01" });
    expect(diaryGroupTitles("2026-11-09")).toEqual({ year: "2026", month: "11" });
  });

  it("只认我们自动建的形状", () => {
    expect(isDiaryGroupTitle("2026", "year")).toBe(true);
    expect(isDiaryGroupTitle("26", "year")).toBe(false);
    expect(isDiaryGroupTitle("11", "month")).toBe(true);
    expect(isDiaryGroupTitle("十一月", "month")).toBe(false);
  });
});

describe("wire 标记", () => {
  it("读：未知值一律当非日记（向前兼容）", () => {
    expect(normalizeFolderSpace("diary")).toBe("diary");
    expect(normalizeFolderSpace(null)).toBeNull();
    expect(normalizeFolderSpace(undefined)).toBeNull();
    expect(normalizeFolderSpace("album")).toBeNull();
    expect(normalizeFolderSpace(1)).toBeNull();
  });

  it("写：必须显式写，非日记写 null（不许静默省略）", () => {
    expect(folderSpaceForWire("diary")).toBe("diary");
    expect(folderSpaceForWire(null)).toBeNull();
    expect(folderSpaceForWire(undefined)).toBeNull();
    expect(folderSpaceForWire("")).toBeNull();
    // 关键：返回 null 而不是 undefined ⇒ 序列化后字段存在
    const wire = JSON.stringify({ space: folderSpaceForWire(undefined) });
    expect(wire).toBe('{"space":null}');
  });
});

describe("日记笔记本识别", () => {
  it("多个日记本按 sortOrder 稳定取第一个", () => {
    const nodes = [notebook("nb-b", { sortOrder: 2 }), notebook("nb-a", { sortOrder: 1 })];
    expect(diaryNotebookId(nodes)).toBe("nb-a");
    expect(diaryNotebooks(nodes).map((n) => n.id)).toEqual(["nb-a", "nb-b"]);
  });

  it("普通笔记本不算日记本", () => {
    const nodes = [node({ id: "nb1", title: "工作", nodeType: "notebook" })];
    expect(diaryNotebookId(nodes)).toBeNull();
  });

  it("文档空间过滤掉日记本（含其子树）", () => {
    const nodes = [notebook(), node({ id: "n1", title: "2026-11-09", parentId: "nb-diary" }), node({ id: "nb2", title: "工作", nodeType: "notebook" })];
    expect(withoutDiaryNotebook(nodes).map((n) => n.id)).toEqual(["n1", "nb2"]);
    expect(withoutDiaryNotebook([node({ id: "nb2", title: "工作", nodeType: "notebook" })])).toHaveLength(1);
  });
});

describe("diaryEntries", () => {
  const nodes: DiaryTreeNode[] = [
    notebook(),
    node({ id: "y26", title: "2026", nodeType: "group", parentId: "nb-diary", sortOrder: 1 }),
    node({ id: "m11", title: "11", nodeType: "group", parentId: "y26", sortOrder: 11 }),
    node({ id: "m10", title: "10", nodeType: "group", parentId: "y26", sortOrder: 10 }),
    node({ id: "d1109", title: "2026-11-09", parentId: "m11", updatedAt: "2026-11-09T10:00:00Z" }),
    node({ id: "d1108", title: "2026-11-08", parentId: "m11", updatedAt: "2026-11-08T10:00:00Z" }),
    node({ id: "d1001", title: "2026-10-01", parentId: "m10", updatedAt: "2026-10-01T10:00:00Z" }),
    // 标题被改过 ⇒ 不再是日记条目
    node({ id: "x", title: "十一月的感想", parentId: "m11" }),
    // 普通笔记本下的同名标题不该混进来
    node({ id: "other", title: "2026-11-07", parentId: "nb-work" }),
    node({ id: "nb-work", title: "工作", nodeType: "notebook" }),
  ];

  it("只认日记本内、标题可解析的文档，按日期倒序", () => {
    const entries = diaryEntries(nodes, "nb-diary");
    expect(entries.map((e) => e.dateKey)).toEqual(["2026-11-09", "2026-11-08", "2026-10-01"]);
    expect(entries[0]).toMatchObject({ noteId: "d1109", year: "2026", month: "11" });
  });

  it("没有日记本时为空", () => {
    expect(diaryEntries(nodes, null)).toEqual([]);
    expect(diaryEntries(nodes, "nb-missing")).toEqual([]);
  });

  it("年/月两级分组用于时间线", () => {
    const years = groupDiaryEntries(diaryEntries(nodes, "nb-diary"));
    expect(years.map((y) => y.year)).toEqual(["2026"]);
    expect(years[0].count).toBe(3);
    expect(years[0].months.map((m) => m.month)).toEqual(["11", "10"]);
    expect(years[0].months[0].entries).toHaveLength(2);
  });
});

describe("planDiaryOpen（幂等）", () => {
  it("没有日记本 ⇒ 先建笔记本", () => {
    const plan = planDiaryOpen([], "2026-11-09");
    expect(plan.notebookId).toBeNull();
    expect(plan.groupsToCreate).toEqual([]);
    expect(plan.existingNoteId).toBeNull();
  });

  it("有本无分组 ⇒ 年、月两级依次建，parent 链正确", () => {
    const plan = planDiaryOpen([notebook()], "2026-11-09");
    expect(plan.groupsToCreate).toEqual([
      { parentId: "nb-diary", title: "2026", nodeType: "group" },
      { parentId: "nb-diary", title: "11", nodeType: "group" },
    ]);
    expect(plan.existingNoteId).toBeNull();
  });

  it("年存在月缺失 ⇒ 只补月", () => {
    const nodes = [notebook(), node({ id: "y26", title: "2026", nodeType: "group", parentId: "nb-diary" })];
    const plan = planDiaryOpen(nodes, "2026-11-09");
    expect(plan.groupsToCreate).toEqual([{ parentId: "y26", title: "11", nodeType: "group" }]);
  });

  it("分组齐全、当天没有 ⇒ 需要建文档", () => {
    const nodes = [notebook(), node({ id: "y26", title: "2026", nodeType: "group", parentId: "nb-diary" }), node({ id: "m11", title: "11", nodeType: "group", parentId: "y26" })];
    const plan = planDiaryOpen(nodes, "2026-11-09");
    expect(plan.groupsToCreate).toEqual([]);
    expect(plan.existingNoteId).toBeNull();
    expect(plan.noteParentId).toBe("m11");
  });

  it("当天已有 ⇒ 只打开，不再建任何东西（连点两次也只开一篇）", () => {
    const nodes = [
      notebook(), node({ id: "y26", title: "2026", nodeType: "group", parentId: "nb-diary" }),
      node({ id: "m11", title: "11", nodeType: "group", parentId: "y26" }),
      node({ id: "d1109", title: "2026-11-09", parentId: "m11" }),
    ];
    const plan = planDiaryOpen(nodes, "2026-11-09");
    expect(plan.existingNoteId).toBe("d1109");
    expect(plan.groupsToCreate).toEqual([]);
  });

  it("重复文档只取最新，其余进告警清单（不自动删）", () => {
    const nodes = [
      notebook(), node({ id: "y26", title: "2026", nodeType: "group", parentId: "nb-diary" }),
      node({ id: "m11", title: "11", nodeType: "group", parentId: "y26" }),
      node({ id: "old", title: "2026-11-09", parentId: "m11", updatedAt: "2026-11-09T01:00:00Z" }),
      node({ id: "new", title: "2026-11-09", parentId: "m11", updatedAt: "2026-11-09T09:00:00Z" }),
    ];
    const plan = planDiaryOpen(nodes, "2026-11-09");
    expect(plan.existingNoteId).toBe("new");
    expect(plan.duplicateNoteIds).toEqual(["old"]);
  });
});

describe("recentDiaryDays", () => {
  it("给最近 N 天标出写了没有（只用于空态，不做缺天提醒）", () => {
    const entries = diaryEntries([notebook(), node({ id: "d", title: "2026-11-08", parentId: "nb-diary" })], "nb-diary");
    const days = recentDiaryDays(entries, "2026-11-09", 3);
    expect(days.map((d) => d.dateKey)).toEqual(["2026-11-09", "2026-11-08", "2026-11-07"]);
    expect(days.map((d) => d.wrote)).toEqual([false, true, false]);
  });
});
