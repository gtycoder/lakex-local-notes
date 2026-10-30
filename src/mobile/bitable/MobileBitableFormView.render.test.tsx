import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobileBitableFormView } from "./MobileBitableFormView";
import { createBitableField, createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    { ...createBitableField("select", "类型", "f-type"), required: true, options: [{ id: "o1", name: "复盘", color: "green" }] },
    { ...createBitableField("text", "内容", "f-content"), required: true },
    createBitableField("attachment", "附件", "f-file"),
    createBitableField("image", "图片", "f-image"),
  ];
  const view = { ...createBitableView("form", "表单", "v-form"), formFieldIds: ["f-type", "f-content", "f-file", "f-image"], formTitle: "观点收集" };
  table.views = [view];
  table.records = [];
  table.activeViewId = view.id;
  return { table, view };
}

const render = () => {
  const { table, view } = fixture();
  return renderToStaticMarkup(createElement(MobileBitableFormView, {
    noteId: "n1", table, view, ctx: { tables: [table] }, onSubmit: async () => true,
  }));
};

describe("MobileBitableFormView（填写态）", () => {
  it("渲染字段/必填标记/选项 chips/提交条（无封面与重复标题）", () => {
    const html = render();
    expect(html).toContain("mbt-form-fields");
    expect(html).not.toContain("mbt-form-cover");
    expect(html).not.toContain("收集表");
    expect(html).toContain('aria-label="必填"');
    expect(html).toContain("mb-chip");
    expect(html).toContain(">提交<");
    expect(html).toContain("已提交 0 条");
  });

  it("附件/图片字段现在可上传（不再是「只能查看」的说明）", () => {
    const html = render();
    expect(html).toContain("上传附件");
    expect(html).toContain("上传图片");
    expect(html).not.toContain("移动端暂只能查看");
  });
});
