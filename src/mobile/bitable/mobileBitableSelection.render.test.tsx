// @vitest-environment jsdom
/**
 * P1-4（c）批量选择记录（261117）：长按行进多选 —— 参照 quickNoteSelection 的交互语义，
 * 复用选择原语（mb-sel-topbar / SelectionCheckbox / SelectionActionBar）与 ui/selection 状态机。
 *
 * 钉的行为：
 * - 长按行进入（带首行）+ 抬手补发的 click 吞掉（不误开记录面板）；选择态点行 = 切换勾选；
 * - 顶栏 取消/已选 N/全选（全不选）；动作条 = 「删除 N 条」（记录无回收站 ⇒ 没有移入回收站）；
 * - 删除确认弹窗照单条 deleteRecord 的文案口径（不能撤销）；成功后退出多选；
 * - 返回键先退多选；只读态长按不进多选（删除 = 正文写入，「打开 = 只读」）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableField, type BitableTable } from "../../core/bitableDoc";
import { consumeBack } from "../ui/backStack";
import { MobileBitableViewer } from "./MobileBitableViewer";

const mocks = vi.hoisted(() => ({
  confirmMobile: vi.fn(async (_options?: { title?: string; body?: string; confirmText?: string; danger?: boolean }) => true),
  showToast: vi.fn(),
}));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-01-01T00:00:00.000Z";
const field = createBitableField("text", "标题", "fld_a");
const table: BitableTable = {
  id: "tbl_a", name: "任务表", activeViewId: "vew_a",
  views: [{ id: "vew_a", name: "表格视图", type: "grid", rowHeight: "low" }],
  fields: [field],
  records: ["写交接", "对方案", "定排期"].map((text, index) => ({
    id: "rec_" + (index + 1), createdAt: ts, updatedAt: ts, values: { fld_a: text },
  })),
};
const bodyOf = (value: BitableTable) => JSON.stringify({ kind: "bitable", version: 1, activeTableId: value.id, tables: [value] });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.confirmMobile.mockReset();
  mocks.confirmMobile.mockResolvedValue(true);
  mocks.showToast.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const renderViewer = (props: Record<string, unknown>) => act(() => {
  root.render(createElement(MobileBitableViewer, { noteId: "n-sel", content: bodyOf(table), ...props }));
});
const rows = () => [...host.querySelectorAll<HTMLElement>('tr[role="row"]')];
const longPress = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: [{ clientX: 10, clientY: 10 }], configurable: true });
    el.dispatchEvent(start);
    await new Promise((resolve) => setTimeout(resolve, 400));
    el.dispatchEvent(new Event("touchend", { bubbles: true }));
    // 真实浏览器抬手后会补发一次 click —— 交互约定是把这一次吞掉（由调用方断言不误动作）。
    el.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const click = async (el: Element | null | undefined): Promise<void> => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const topBar = (): HTMLElement | null => host.querySelector('[role="toolbar"][aria-label="多选操作"]');
const topButtons = (): HTMLButtonElement[] => [...(topBar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
const actionBar = (): HTMLElement | null => host.querySelector('[role="group"][aria-label="批量操作"]');
const actionButton = (label: string): HTMLButtonElement | undefined =>
  [...(actionBar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => (b.textContent ?? "").trim() === label);
const checkboxes = () => host.querySelectorAll("[data-selection-checkbox]");
const addRowBtn = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === "新建记录");

describe("MobileBitableViewer（批量选择记录）", () => {
  it("长按行进入多选：顶栏 + 复选框 + 「删除 N 条」；补发的 click 被吞（不开记录面板）；新建记录行让位", async () => {
    renderViewer({ editing: true, onChange: vi.fn() });
    expect(checkboxes()).toHaveLength(0);
    expect(addRowBtn()).toBeTruthy();

    await longPress(rows()[0]);
    expect(topBar()).not.toBeNull();
    expect(topBar()!.textContent).toContain("已选 1");
    expect(checkboxes()).toHaveLength(3);
    expect(actionButton("删除 1 条")).toBeTruthy();
    expect(addRowBtn()).toBeUndefined();   // 多选态隐藏「新建记录」（与首页多选隐藏 Dock/＋同语义）

    // 抬手补发的 click 被吞掉（longPress 已模拟）：不打开记录面板、也不取消刚选中的行
    expect(topBar()!.textContent).toContain("已选 1");
    expect(host.textContent).not.toContain("编辑记录");
  });

  it("选择态点行 = 切换勾选；全选/全不选；取消恢复常规头部", async () => {
    renderViewer({ editing: true, onChange: vi.fn() });
    await longPress(rows()[0]);
    await click(rows()[1]);
    expect(topBar()!.textContent).toContain("已选 2");
    await click(rows()[1]);
    expect(topBar()!.textContent).toContain("已选 1");

    expect(topButtons().map((b) => b.textContent?.trim())).toEqual(["取消", "全选"]);
    await click(topButtons()[1]);
    expect(topBar()!.textContent).toContain("已选 3");
    expect(topButtons()[1].textContent?.trim()).toBe("全不选");
    await click(topButtons()[1]);
    expect(topBar()!.textContent).toContain("已选 0");

    await click(topButtons()[0]);
    expect(topBar()).toBeNull();
    expect(host.querySelector(".mbt-header")).not.toBeNull();
    expect(addRowBtn()).toBeTruthy();
  });

  it("多选态与常规头部同槽换装（261119 F-D）：进入/退出多选头部都留在 DOM、槽不换高（网格不位移）", async () => {
    renderViewer({ editing: true, onChange: vi.fn() });
    expect(host.querySelector(".mbt-headslot")).not.toBeNull();
    expect(host.querySelector(".mbt-headslot.is-selecting")).toBeNull();
    await longPress(rows()[0]);
    // 头部保留在 DOM（同槽定高，visibility 换装）⇒ 两元素不再互换导致网格上跳 ≈50px
    expect(host.querySelector(".mbt-headslot.is-selecting")).not.toBeNull();
    expect(host.querySelector(".mbt-header")).not.toBeNull();
    // 多选栏 = 槽内覆盖层，edge=nested（嵌在工作区内不重复消费顶部安全区）
    const selBar = host.querySelector(".mbt-headslot__sel .mb-sel-topbar");
    expect(selBar).not.toBeNull();
    expect(selBar!.getAttribute("data-edge")).toBe("nested");
    await click(topButtons()[0]);
    expect(host.querySelector(".mbt-headslot.is-selecting")).toBeNull();
    expect(host.querySelector(".mbt-headslot__sel")).toBeNull();
    expect(host.querySelector(".mbt-header")).not.toBeNull();
  });

  it("删除 N 条：确认弹窗照 deleteRecord 文案口径（不能撤销）→ 删记录并退出多选", async () => {
    const onChange = vi.fn();
    renderViewer({ editing: true, onChange });
    await longPress(rows()[0]);
    await click(rows()[1]);
    await click(actionButton("删除 2 条"));

    const options = mocks.confirmMobile.mock.calls[0]?.[0];
    expect(options?.title).toBe("删除 2 条记录？");
    expect(options?.body).toBe("所选 2 条记录及其全部字段值会被删除（不能撤销）。");
    expect(options?.confirmText).toBe("删除");
    expect(options?.danger).toBe(true);

    const body = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
    expect(body.tables[0].records.map((record) => record.id)).toEqual(["rec_3"]);
    expect(topBar()).toBeNull();                       // 成功后退出选择
    expect(mocks.showToast).toHaveBeenCalledWith("已删除 2 条记录");
    expect(actionBar()).toBeNull();
  });

  it("确认取消 ⇒ 不删、保留选择；没选任何行 ⇒ 提示先选择", async () => {
    const onChange = vi.fn();
    mocks.confirmMobile.mockResolvedValueOnce(false);
    renderViewer({ editing: true, onChange });
    await longPress(rows()[0]);
    await click(rows()[1]);
    await click(actionButton("删除 2 条"));
    expect(onChange).not.toHaveBeenCalled();
    expect(topBar()!.textContent).toContain("已选 2");

    // 把已选两行点掉（已选 0）⇒ 点删除只提示，不弹确认框
    await click(rows()[0]);
    await click(rows()[1]);
    expect(topBar()!.textContent).toContain("已选 0");
    mocks.confirmMobile.mockClear();
    await click(actionButton("删除 0 条"));
    expect(mocks.confirmMobile).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("请先选择记录");
  });

  it("返回键：选择态先退多选（不退工作区）；只读态长按不进多选", async () => {
    renderViewer({ editing: true, onChange: vi.fn() });
    await longPress(rows()[0]);
    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(topBar()).toBeNull();

    // 只读态：长按行不进多选（删除是正文写入，「打开 = 只读」）
    renderViewer({});
    await longPress(rows()[0]);
    expect(topBar()).toBeNull();
    expect(checkboxes()).toHaveLength(0);
  });
});
