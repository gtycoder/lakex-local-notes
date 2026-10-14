// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { BitableViewportCell } from "./BitableViewportCell";
const counter = vi.hoisted(() => ({ renders: 0 }));
vi.mock("./bitableCells", () => ({
  CellEditor: ({
    value,
    onChange,
  }: {
    value: unknown;
    onChange: (value: unknown) => void;
  }) => {
    counter.renders++;
    return createElement("input", {
      value: String(value),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(e.target.value),
    });
  },
  AttachmentCell: () => null,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const base = {
  field: { id: "f", name: "number", type: "number" as const },
  value: 1,
  recordId: "r",
  tableId: "t",
  readOnly: false,
  noteId: "n",
  selected: "",
  duplicate: false,
  maxWidth: "180px",
  onSelect: vi.fn(),
  onOver: vi.fn(),
  onChange: vi.fn(),
  onAddOption: vi.fn(),
  uploadFiles: async () => [],
  appendAttachments: vi.fn(),
  openAsset: vi.fn(),
  openImages: vi.fn(),
  generateCell: async () => {},
  cancelCell: vi.fn(),
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  counter.renders = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function render(over: Partial<typeof base> = {}) {
  act(() =>
    root.render(
      createElement(
        "table",
        {},
        createElement(
          "tbody",
          {},
          createElement(
            "tr",
            {},
            createElement(BitableViewportCell, { ...base, ...over }),
          ),
        ),
      ),
    ),
  );
}
describe("window-local cell memo", () => {
  it("same state does not re-create control on unrelated parent update", () => {
    render();
    render();
    expect(counter.renders).toBe(1);
  });
  it("value and selection both remain reactive", () => {
    render();
    render({ value: 2, selected: " cell-selected" });
    expect(host.querySelector("input")!.value).toBe("2");
    expect(host.querySelector("td")!.className).toContain("cell-selected");
  });
  it("new handler is called, never a stale closed-over value", () => {
    const old = vi.fn(),
      next = vi.fn();
    render({ onChange: old });
    render({ onChange: next });
    act(() => {
      const el = host.querySelector("input")!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, "3");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith("r", "f", "3");
  });
  it("row/field identity change updates handler targets", () => {
    const change = vi.fn();
    render({ onChange: change });
    render({
      recordId: "r2",
      field: { ...base.field, id: "f2" },
      onChange: change,
    });
    act(() => {
      const el = host.querySelector("input")!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, "4");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(change).toHaveBeenCalledWith("r2", "f2", "4");
  });
});
