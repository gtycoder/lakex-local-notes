// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBitableField,
  createBitableView,
  createDefaultBitableTable,
  type BitableField,
  type BitableTable,
  type BitableView,
} from "../../core/bitableDoc.js";
import { MobileBitableFormView } from "./MobileBitableFormView";
import {
  clearMobileFormDraft,
  mobileFormDraftKey,
  mobileFormDraftSignature,
  readMobileFormDraft,
  writeMobileFormDraft,
} from "./mobileBitableFormDraft";

const DRAFT_KEY = "lakex-local-notes-mobile.bitable-form-draft.n1.v-form";

function fieldsFixture(): BitableField[] {
  return [
    createBitableField("text", "内容", "f-text"),
    createBitableField("number", "数量", "f-num"),
  ];
}

function formFixture(overrides: { fields?: BitableField[]; formFieldIds?: string[]; viewId?: string } = {}) {
  const table: BitableTable = createDefaultBitableTable("收集表");
  table.fields = overrides.fields ?? fieldsFixture();
  const view: BitableView = {
    ...createBitableView("form", "表单", overrides.viewId ?? "v-form"),
    formFieldIds: overrides.formFieldIds ?? ["f-text", "f-num"],
  };
  table.views = [view];
  table.activeViewId = view.id;
  table.records = [];
  return { table, view };
}

function seedDraft(signature: string, values: Record<string, unknown>, key = DRAFT_KEY) {
  localStorage.setItem(key, JSON.stringify({ signature, values }));
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderForm = (props: { table: BitableTable; view: BitableView; onSubmit?: (draft: Record<string, unknown>) => Promise<boolean> }) => {
  act(() => root.render(createElement(MobileBitableFormView, {
    noteId: "n1",
    table: props.table,
    view: props.view,
    ctx: { tables: [props.table] },
    onSubmit: props.onSubmit ?? (async () => true),
  })));
};

function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const textarea = () => host.querySelector<HTMLTextAreaElement>(".mbt-form-textarea")!;
const numberInput = () => host.querySelector<HTMLInputElement>('input[aria-label="数量"]')!;
const submitButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "提交")!;
const storedDraft = (key = DRAFT_KEY) => JSON.parse(localStorage.getItem(key) ?? "null") as { signature: string; values: Record<string, unknown> } | null;

describe("表单填写草稿：设备本地存储（mobileBitableFormDraft）", () => {
  it("写入：用户输入即落 localStorage（key = noteId + viewId，带题目指纹）", () => {
    const { table, view } = formFixture();
    renderForm({ table, view });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull(); // 没动过不落草稿
    typeInto(textarea(), "半句话");
    // 键名风格与 mobileBitableViewPrefs 同族：lakex-local-notes-mobile.bitable-form-draft.<noteId>.<viewId>
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    const stored = storedDraft()!;
    expect(stored.signature).toBe(mobileFormDraftSignature(fieldsFixture()));
    expect(stored.values["f-text"]).toBe("半句话");
  });

  it("恢复：打开表单回填未提交草稿，且不抢焦点", () => {
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话", "f-num": "3" });
    const { table, view } = formFixture();
    renderForm({ table, view });
    expect(textarea().value).toBe("半句话");
    expect(numberInput().value).toBe("3");
    // 恢复只回填值、不做任何 focus()：键盘/焦点稳定
    expect(document.activeElement).toBe(document.body);
  });

  it("清空：提交成功后删草稿（界面回到默认值）", async () => {
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话", "f-num": "3" });
    const onSubmit = vi.fn(async (_draft: Record<string, unknown>) => true);
    const { table, view } = formFixture();
    renderForm({ table, view, onSubmit });
    await act(async () => {
      submitButton().click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]["f-text"]).toBe("半句话");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(textarea().value).toBe("");
  });

  it("提交失败保留草稿（不静默丢弃）", async () => {
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话" });
    const onSubmit = vi.fn(async () => false);
    const { table, view } = formFixture();
    renderForm({ table, view, onSubmit });
    await act(async () => {
      submitButton().click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textarea().value).toBe("半句话");
    expect(storedDraft()?.values["f-text"]).toBe("半句话");
  });

  it("丢弃：字段类型变 ⇒ 旧草稿不回填且被删除（宁可丢草稿不给错值）", () => {
    // 落盘时「数量」是 number；现在同一字段 id 变成 progress（指纹不匹配）
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话", "f-num": "3" });
    const { table, view } = formFixture({
      fields: [createBitableField("text", "内容", "f-text"), createBitableField("progress", "数量", "f-num")],
    });
    renderForm({ table, view });
    expect(textarea().value).toBe("");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("丢弃：formFieldIds 变 ⇒ 旧草稿不回填且被删除", () => {
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话", "f-num": "3" });
    const { table, view } = formFixture({ formFieldIds: ["f-text"] });
    renderForm({ table, view });
    expect(textarea().value).toBe("");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(host.querySelector('input[aria-label="数量"]')).toBeNull();
  });

  it("key = noteId + viewId：同一实例切到别的表单视图，草稿互不串", () => {
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话" });
    const { table, view } = formFixture();
    renderForm({ table, view });
    expect(textarea().value).toBe("半句话");
    // 切到另一个表单视图（同字段集合）：不带上一份草稿，也不覆盖它的存储
    const other = { ...view, id: "v-form-2" };
    renderForm({ table, view: other });
    expect(textarea().value).toBe("");
    expect(localStorage.getItem(mobileFormDraftKey("n1", "v-form-2"))).toBeNull();
    expect(storedDraft()?.values["f-text"]).toBe("半句话");
    // 切回来仍能恢复
    renderForm({ table, view });
    expect(textarea().value).toBe("半句话");
  });

  it("切换后继续输入只写新视图自己的 key", () => {
    const { table, view } = formFixture();
    const other = { ...view, id: "v-form-2" };
    renderForm({ table, view: other });
    typeInto(textarea(), "另一份");
    expect(storedDraft(mobileFormDraftKey("n1", "v-form-2"))?.values["f-text"]).toBe("另一份");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("mobileBitableFormDraft 存储层", () => {
  const fields = fieldsFixture();

  it("写读回环 + clear 幂等", () => {
    writeMobileFormDraft("n1", "v-form", fields, { "f-text": "半句话" });
    expect(readMobileFormDraft("n1", "v-form", fields)).toEqual({ "f-text": "半句话" });
    clearMobileFormDraft("n1", "v-form");
    clearMobileFormDraft("n1", "v-form");
    expect(readMobileFormDraft("n1", "v-form", fields)).toBeNull();
  });

  it("坏 JSON / 坏形状：读回落 null 且删键", () => {
    localStorage.setItem(DRAFT_KEY, "{不是 JSON");
    expect(readMobileFormDraft("n1", "v-form", fields)).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ signature: "f-text:text|f-num:number", values: null }));
    expect(readMobileFormDraft("n1", "v-form", fields)).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("指纹不匹配：读回落 null 且删键（旧草稿弃用）", () => {
    seedDraft("f-text:text|f-num:number", { "f-text": "半句话" });
    expect(readMobileFormDraft("n1", "v-form", [createBitableField("text", "内容", "f-text")])).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
