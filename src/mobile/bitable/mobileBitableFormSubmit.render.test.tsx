// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableViewer } from "./MobileBitableViewer";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const body = JSON.stringify({
  kind: "bitable", version: 1, activeTableId: "t1",
  tables: [{
    id: "t1", name: "表", activeViewId: "v-form",
    views: [{ id: "v-form", name: "表单", type: "form", formFieldIds: ["f-type", "f-text"] }],
    fields: [
      { id: "f-type", name: "类型", type: "select", required: true, options: [{ id: "o1", name: "复盘", color: "green" }] },
      { id: "f-text", name: "内容", type: "text", required: true },
    ],
    records: [],
  }],
});

const fillAndSubmit = async (onPersistNow: (content: string) => Promise<void>) => {
  act(() => root.render(createElement(MobileBitableViewer, { noteId: "n1", content: body, onPersistNow })));
  act(() => {
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".mb-chip")].find((b) => b.textContent === "复盘");
    chip?.click();
    const area = host.querySelector<HTMLTextAreaElement>(".mbt-form-textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(area, "一条内容");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "提交")!;
  await act(async () => { submit.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return submit;
};

const recordsOf = (content: string) => (JSON.parse(content) as { tables: Array<{ records: unknown[] }> }).tables[0].records.length;

describe("只读表单提交（落盘失败不落界面、重试不重复插入）", () => {
  it("onPersistNow 失败：界面报错且不落 doc；再提交只插一条", async () => {
    const calls: string[] = [];
    const onPersistNow = vi.fn(async (content: string) => {
      calls.push(content);
      if (calls.length === 1) throw new Error("disk full");
    });
    const submit = await fillAndSubmit(onPersistNow);
    expect(calls.length).toBe(1);
    expect(host.textContent).toContain("提交失败，请重试");
    // 草稿保留（不需要重新填），再点一次应成功且仍是 1 条记录
    await act(async () => { submit.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(calls.length).toBe(2);
    expect(recordsOf(calls[0])).toBe(1);
    expect(recordsOf(calls[1])).toBe(1);
    expect(host.textContent).not.toContain("提交失败，请重试");
  });
});
