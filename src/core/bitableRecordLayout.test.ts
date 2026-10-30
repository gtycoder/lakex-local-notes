import { describe, expect, it } from "vitest";
import {
  defaultCardFieldIds,
  normalizeRecordLayoutPrefs,
  resolveRecordLayout,
  withRecordLayoutPrefs,
} from "./bitableRecordLayout";
import { createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable } from "./bitableDoc";

function tableWithFields() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    createBitableField("text", "类型", "f-type"),
    createBitableField("select", "内容", "f-content"),
    createBitableField("attachment", "附件", "f-file"),
    createBitableField("date", "日期", "f-date"),
  ];
  table.views = [createBitableView("grid", "内容", "v-grid")];
  table.activeViewId = "v-grid";
  table.records = [createBitableRecord("r1")];
  return { table, view: table.views[0] };
}

describe("resolveRecordLayout（表格视图的记录展示方式）", () => {
  it("缺省 = 表格 / 1 列 / 无封面，主标题 = 主字段，正文行 = 其余可见字段", () => {
    const { table, view } = tableWithFields();
    const layout = resolveRecordLayout(table, view, {});
    expect(layout.mode).toBe("table");
    expect(layout.columns).toBe(1);
    expect(layout.cover).toBe(false);
    expect(layout.titleField?.id).toBe("f-type");
    expect(layout.subtitleField).toBeNull();
    expect(layout.fields.map((f) => f.id)).toEqual(["f-content", "f-file", "f-date"]);
    // 封面字段 = 正文行里第一个附件/图片字段
    expect(layout.coverField?.id).toBe("f-file");
  });

  it("卡片配置生效：列数 / 封面 / 主副标题 / 展示字段顺序都按配置", () => {
    const { table, view } = tableWithFields();
    const layout = resolveRecordLayout(table, view, {
      mode: "card",
      columns: 2,
      cover: true,
      titleFieldId: "f-content",
      subtitleFieldId: "f-date",
      fieldIds: ["f-file", "f-date", "f-content"],
    });
    expect(layout.mode).toBe("card");
    expect(layout.columns).toBe(2);
    expect(layout.cover).toBe(true);
    expect(layout.titleField?.id).toBe("f-content");
    expect(layout.subtitleField?.id).toBe("f-date");
    // 主/副标题从正文行里排除，配置顺序保留
    expect(layout.fields.map((f) => f.id)).toEqual(["f-file"]);
  });

  it("显式 fieldIds: [] = 用户把展示字段全关了（不回落成全量）", () => {
    const { table, view } = tableWithFields();
    const layout = resolveRecordLayout(table, view, { mode: "card", fieldIds: [] });
    expect(layout.fields).toEqual([]);
    expect(layout.titleField?.id).toBe("f-type");
    // undefined 才是「未配置」→ 用默认展示字段
    expect(resolveRecordLayout(table, view, { mode: "card" }).fields.length).toBeGreaterThan(0);
  });

  it("脏配置回落：字段被删 / 主副标题同字段 / 全失效时回默认", () => {
    const { table, view } = tableWithFields();
    const layout = resolveRecordLayout(table, view, { titleFieldId: "gone", subtitleFieldId: "f-type", fieldIds: ["gone", "gone2"] });
    expect(layout.titleField?.id).toBe("f-type"); // 主字段
    expect(layout.subtitleField).toBeNull(); // 与主标题同字段 ⇒ 不显示
    expect(layout.fields.map((f) => f.id)).toEqual(["f-content", "f-file", "f-date"]); // 配置全失效 ⇒ 默认
  });

  it("只展示可见字段：视图隐藏的字段不会进正文行", () => {
    const { table, view } = tableWithFields();
    const hidden = { ...view, hiddenFieldIds: ["f-content"] };
    expect(resolveRecordLayout(table, hidden, {}).fields.map((f) => f.id)).toEqual(["f-file", "f-date"]);
    expect(defaultCardFieldIds(table, hidden, "f-type")).toEqual(["f-file", "f-date"]);
  });
});

describe("normalizeRecordLayoutPrefs / withRecordLayoutPrefs", () => {
  it("归一：未知值丢弃、列数只认 1/2、字段 id 去空与去重", () => {
    expect(normalizeRecordLayoutPrefs(null)).toEqual({});
    expect(normalizeRecordLayoutPrefs({ mode: "kanban", columns: 3, cover: "yes", fieldIds: ["a", "", "a", 3] }))
      .toEqual({ fieldIds: ["a"] });
    expect(normalizeRecordLayoutPrefs({ mode: "card", columns: 2, cover: true, titleFieldId: "f", subtitleFieldId: "" }))
      .toEqual({ mode: "card", columns: 2, cover: true, titleFieldId: "f" });
  });

  it("合并修改：非法列数兜底 1，空 id 删键", () => {
    const prefs = withRecordLayoutPrefs({ mode: "card", columns: 2 }, { columns: 9 as unknown as 1, titleFieldId: "" });
    expect(prefs.mode).toBe("card");
    expect(prefs.columns).toBe(1);
    expect("titleFieldId" in prefs).toBe(false);
  });
});
