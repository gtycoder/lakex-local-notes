// @vitest-environment jsdom
/**
 * 移动端表格「表单视图」只读覆盖层（261104）渲染护栏。
 *
 * 数据整形（表头/数据区）是纯函数；组件只验逐行展示、上一行/下一行游标与关闭。
 * 只读契约：组件不接收修改回调（宿主也不会写正文）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  MobileSheetFormView,
  buildSheetFormRows,
  sheetCellText,
  sheetColumnLabel,
  type SheetFormRow,
} from "./MobileSheetFormView";

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function mount(props: Partial<{ open: boolean; rows: SheetFormRow[]; sheetName: string; onClose: () => void }> = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const merged = {
    open: true,
    rows: [] as SheetFormRow[],
    onClose: () => undefined,
    ...props,
  };
  await act(async () => { root.render(<MobileSheetFormView {...merged} />); });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const ROWS = buildSheetFormRows([
  ["姓名", "金额", "备注"],
  ["张三", 100, ""],
  ["", "", ""],
  ["李四", 200, "已付"],
]);

describe("移动端表格表单视图（只读逐行）", () => {
  it("数据整形：表头做字段名、空行跳过、空值保留字段", () => {
    expect(ROWS).toHaveLength(2);
    expect(ROWS[0]).toEqual({
      index: 2,
      fields: [
        { label: "姓名", value: "张三" },
        { label: "金额", value: "100" },
        { label: "备注", value: "" },
      ],
    });
    expect(ROWS[1].index).toBe(4);
    expect(ROWS[1].fields[2]).toEqual({ label: "备注", value: "已付" });
  });

  it("数据整形：无表头的列回退成列号；整表无数据返回空数组", () => {
    const rows = buildSheetFormRows([["姓名"], ["张三", "外部"]]);
    expect(rows[0].fields.map((field) => field.label)).toEqual(["姓名", "B"]);
    expect(buildSheetFormRows([["姓名", "金额"]]).length).toBe(0);
    expect(buildSheetFormRows([]).length).toBe(0);
    expect(sheetColumnLabel(0)).toBe("A");
    expect(sheetColumnLabel(25)).toBe("Z");
    expect(sheetColumnLabel(26)).toBe("AA");
    expect(sheetCellText(null)).toBe("");
    expect(sheetCellText(" 已付 ")).toBe("已付");
    expect(sheetCellText(true)).toBe("是");
    expect(sheetCellText(Number.NaN)).toBe("");
  });

  it("打开：逐行展示「字段名：值」，首行上一行禁用、末行下一行禁用", async () => {
    const view = await mount({ rows: ROWS, sheetName: "Sheet1" });
    const sheet = view.container.querySelector(".mb-usheet-form-sheet");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("表单视图");
    expect(sheet!.textContent).toContain("第 1 行，共 2 行");
    expect(sheet!.textContent).toContain("姓名");
    expect(sheet!.textContent).toContain("张三");
    expect(sheet!.textContent).toContain("—");
    const prev = sheet!.querySelector<HTMLButtonElement>('button[aria-label="上一行"]')!;
    const next = sheet!.querySelector<HTMLButtonElement>('button[aria-label="下一行"]')!;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    await view.unmount();
  });

  it("下一行/上一行只在本地移动游标（边界置灰，不产生副作用）", async () => {
    const onClose = vi.fn();
    const view = await mount({ rows: ROWS, onClose });
    let sheet = view.container.querySelector(".mb-usheet-form-sheet")!;
    await act(async () => { sheet.querySelector<HTMLButtonElement>('button[aria-label="下一行"]')!.click(); });
    sheet = view.container.querySelector(".mb-usheet-form-sheet")!;
    expect(sheet.textContent).toContain("第 2 行，共 2 行");
    expect(sheet.textContent).toContain("李四");
    expect(sheet.querySelector<HTMLButtonElement>('button[aria-label="下一行"]')!.disabled).toBe(true);
    await act(async () => { sheet.querySelector<HTMLButtonElement>('button[aria-label="上一行"]')!.click(); });
    sheet = view.container.querySelector(".mb-usheet-form-sheet")!;
    expect(sheet.textContent).toContain("张三");
    expect(onClose).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("没有数据行：给出空态文案，关闭仍可用", async () => {
    const onClose = vi.fn();
    const view = await mount({ rows: [], onClose });
    const sheet = view.container.querySelector(".mb-usheet-form-sheet")!;
    expect(sheet.textContent).toContain("当前工作表没有数据行");
    await act(async () => {
      sheet.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("关闭时不渲染任何浮层", async () => {
    const view = await mount({ open: false, rows: ROWS });
    expect(view.container.querySelector(".mb-sheet")).toBeNull();
    await view.unmount();
  });
});
