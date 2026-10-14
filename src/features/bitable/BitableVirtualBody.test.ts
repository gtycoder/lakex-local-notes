// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BitableVirtualBody } from "./BitableVirtualBody";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const items = Array.from({ length: 5000 }, (_, i) => ({
  id: "r" + i,
  text: String(i),
}));
const getKey = (row: (typeof items)[number]) => row.id;
const estimateSize = () => 36;
const renderRow = (row: (typeof items)[number]) =>
  createElement(
    "tr",
    { "data-row": row.id },
    createElement("td", {}, createElement("input", { defaultValue: row.text })),
  );
const ro = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", ro);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.className === "bt-grid-wrap" ? 600 : 36;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function render(visible = true) {
  act(() =>
    root.render(
      createElement(
        "div",
        { className: "bt-grid-wrap" },
        createElement(
          "table",
          {},
          createElement(BitableVirtualBody<(typeof items)[number]>, {
            items,
            getKey,
            estimateSize,
            renderRow,
            columns: 1,
            totalRecords: 5000,
            visible,
            handleRef: null,
          }),
        ),
      ),
    ),
  );
}
describe("Windowed tbody data/viewport contract", () => {
  it("repeated windows release row components instead of accumulating offscreen controls", () => {
    let live = 0;
    function CountingCell({ text }: { text: string }) {
      useEffect(() => {
        live++;
        return () => {
          live--;
        };
      }, []);
      return createElement("input", { value: text, readOnly: true });
    }
    const trackedRow = (row: (typeof items)[number]) =>
      createElement(
        "tr",
        { "data-row": row.id },
        createElement(
          "td",
          {},
          createElement(CountingCell, { text: row.text }),
        ),
      );
    act(() =>
      root.render(
        createElement(
          "div",
          { className: "bt-grid-wrap" },
          createElement(
            "table",
            {},
            createElement(BitableVirtualBody<(typeof items)[number]>, {
              items,
              getKey,
              estimateSize,
              renderRow: trackedRow,
              columns: 1,
              totalRecords: 5000,
              visible: true,
              handleRef: null,
            }),
          ),
        ),
      ),
    );
    const wrap = host.querySelector<HTMLElement>(".bt-grid-wrap")!;
    for (let i = 0; i < 25; i++) {
      act(() => {
        wrap.scrollTop = ((i * 173) % 4900) * 36;
        wrap.dispatchEvent(new Event("scroll"));
      });
      expect(live).toBeGreaterThan(0);
      expect(live).toBeLessThan(40);
    }
    act(() => root.render(null));
    expect(live).toBe(0);
  });

  it("includes the real 34px add-record footer in the offscreen extent", () => {
    act(() => root.render(createElement("div", { className: "bt-grid-wrap" },
      createElement("table", {}, createElement(BitableVirtualBody<(typeof items)[number]>, {
        items, getKey, estimateSize, renderRow, columns: 1, totalRecords: 5000,
        visible: true, handleRef: null,
        trailing: createElement("tr", { className: "bt-add-row" }, createElement("td", {}, "+")),
      }))))) ;
    const mountedHeight = host.querySelectorAll("tr[data-row]").length * 36;
    const spacerHeight = [...host.querySelectorAll<HTMLTableCellElement>(".bt-virtual-spacer td")]
      .reduce((sum, cell) => sum + Number.parseFloat(cell.style.height), 0);
    expect(host.querySelector(".bt-add-row")).toBeNull();
    expect(mountedHeight + spacerHeight).toBe(5000 * 36 + 34);
  });

  it("value-only edits and fresh add rows refresh without retaining stale cached cells", () => {
    const controlledRow = (row: (typeof items)[number]) => createElement("tr", { "data-row": row.id },
      createElement("td", {}, createElement("input", { value: row.text, readOnly: true })));
    const renderValues = (rows: typeof items, label: string) => act(() => root.render(
      createElement("div", { className: "bt-grid-wrap" }, createElement("table", {},
        createElement(BitableVirtualBody<(typeof items)[number]>, {
          items: rows, getKey, estimateSize, renderRow: controlledRow, columns: 1, totalRecords: 5000,
          visible: true, handleRef: null, leading: createElement("tr", { "data-leading": true }, createElement("td", {}, label)),
        })))));
    renderValues(items, "before");
    const edited = items.map((row, index) => index === 0 ? { ...row, text: "更新值" } : row);
    renderValues(edited, "after");
    expect(host.querySelector<HTMLInputElement>('[data-row="r0"] input')!.value).toBe("更新值");
    expect(host.querySelector("tr[data-leading]")!.textContent).toBe("after");
    expect(host.querySelectorAll("tr[data-row]").length).toBeLessThan(40);
  });

  it("keeps full dataset identity while only mounting a bounded window", () => {
    render();
    const rows = host.querySelectorAll("tr[data-row]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(40);
    expect(host.querySelector("tbody")?.dataset.recordCount).toBe("5000");
    expect(host.querySelector('[data-row="r4999"]')).toBeNull();
  });
  it("retains only one editing row when scrolling to the last record", () => {
    render();
    const first = host.querySelector<HTMLInputElement>(
      '[data-row="r0"] input',
    )!;
    act(() => first.focus());
    const wrap = host.querySelector<HTMLElement>(".bt-grid-wrap")!;
    act(() => {
      wrap.scrollTop = 5000 * 36 - 600;
      wrap.dispatchEvent(new Event("scroll"));
    });
    expect(host.querySelector('[data-row="r0"] input')).toBe(first);
    expect(host.querySelectorAll("tr[data-row]").length).toBeLessThan(50);
    expect(host.querySelector('[data-row="r4999"]')).not.toBeNull();
  });
  it("unmounts hidden grid rows and remounts on visibility, without changing data count", () => {
    render();
    render(false);
    expect(host.querySelectorAll("tr[data-row]")).toHaveLength(0);
    render(true);
    expect(host.querySelectorAll("tr[data-row]").length).toBeGreaterThan(0);
    expect(items).toHaveLength(5000);
  });
});
