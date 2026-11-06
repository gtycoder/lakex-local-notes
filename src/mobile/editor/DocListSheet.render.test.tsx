// @vitest-environment jsdom
/**
 * 工作区「文档列表」按标签筛选（261105 P1，**只读/设备本地**）：
 * chips 只列当前列表里用到的标签（顺序 = 目录顺序）；点击过滤、再点取消；
 * 无标签文档不受影响；目录不可用降级为「不启用筛选 + 一句提示」，列表照常可切换。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  listQuickNoteTags: vi.fn(),
  batchNotes: vi.fn(),
  getHomeSnapshot: vi.fn(),
}));
const confirmMock = vi.hoisted(() => ({ confirmMobile: vi.fn(async (_options?: { title?: string; body?: string; confirmText?: string }) => true) }));
vi.mock("../ui/ConfirmDialog", () => confirmMock);
const tagReadsMock = vi.hoisted(() => ({ loadNoteTagIdsForNotes: vi.fn() }));
vi.mock("../bridge", () => ({ bridge: bridgeMock }));
vi.mock("../bridge/noteTagReads", () => tagReadsMock);
vi.mock("../ui/MobileSheet", () => ({
  MobileSheet: ({ children, footer }: { children: unknown; footer?: unknown }) => (
    <div data-testid="sheet">{children as never}{footer as never}</div>
  ),
}));
const toastMock = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../ui/toastBus", () => toastMock);

import { consumeBack } from "../ui/backStack";
import { DocListSheet } from "./DocListSheet";

const DIR = [{ id: "t_work", name: "工作" }, { id: "t_idea", name: "灵感" }];
const DOCS = [{ id: "n1", title: "周报" }, { id: "n2", title: "随笔" }, { id: "n3", title: "无标签" }];
const TAGS = { n1: ["t_work"], n2: ["t_idea", "t_work"], n3: [] };

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
const picked: string[] = [];

async function render(docs = DOCS): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<DocListSheet open documents={docs} activeId="n1" onPick={(id) => picked.push(id)} onClose={() => undefined} />);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const docTitles = (): string[] =>
  [...host.querySelectorAll(".med-doc-item-title")].map((el) => (el.textContent ?? "").trim());
const chipNames = (): string[] =>
  [...host.querySelectorAll(".qn-tag-filter-bar .qn-tag")].map((el) => (el.textContent ?? "").replace(/\d+$/, "").trim());
const clickChip = async (name: string): Promise<void> => {
  const chip = [...host.querySelectorAll(".qn-tag-filter-bar .qn-tag")]
    .find((el) => (el.textContent ?? "").trim().startsWith(name));
  expect(chip).toBeTruthy();
  await act(async () => { (chip as HTMLButtonElement).click(); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  picked.length = 0;
  tagReadsMock.loadNoteTagIdsForNotes.mockReset().mockResolvedValue({ byNoteId: TAGS, truncated: false, requested: 3, loaded: 3 });
  bridgeMock.listQuickNoteTags.mockReset().mockResolvedValue(DIR);
  bridgeMock.batchNotes.mockReset().mockResolvedValue({ ok: true, results: [{ id: "n1", ok: true }], summary: { total: 1, done: 1, failed: 0 } });
  bridgeMock.getHomeSnapshot.mockReset().mockResolvedValue({
    treeNodes: [
      { id: "nb1", title: "笔记本", parentId: null, nodeType: "notebook" },
      { id: "g1", title: "分组A", parentId: "nb1", nodeType: "group" },
    ],
    notes: [],
    quickNotes: { items: [], nextCursor: null },
  });
  confirmMock.confirmMobile.mockReset().mockResolvedValue(true);
  toastMock.showToast.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("DocListSheet 多选模式（261106 task-82）", () => {
  const rowByTitle = (title: string): HTMLButtonElement =>
    [...host.querySelectorAll<HTMLButtonElement>(".med-doc-item")]
      .find((el) => (el.textContent ?? "").includes(title))!;
  const enterByButton = async (): Promise<void> => {
    const entry = host.querySelector('[aria-label="选择文档"]') as HTMLButtonElement;
    expect(entry).toBeTruthy();
    await act(async () => { entry.click(); });
  };
  const topBarButtons = (): HTMLButtonElement[] =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"][aria-label="多选操作"] button')];

  it("入口：长按提示 + 「选择」按钮；进入后顶部栏 已选 0 / 取消 / 全选，行出现复选框", async () => {
    await render();
    expect(host.textContent).toContain("长按文档可多选");
    await enterByButton();
    const bar = host.querySelector('[role="toolbar"][aria-label="多选操作"]')!;
    expect(bar.textContent).toContain("已选 0");
    expect(topBarButtons().map((b) => b.textContent?.trim())).toEqual(["取消", "全选"]);
    expect(host.querySelectorAll("[data-selection-checkbox]").length).toBe(3);
  });

  it("长按行进入多选（带该行 id）；选择态点行 = 切换勾选；全选/全不选", async () => {
    await render();
    const row = rowByTitle("周报");
    await act(async () => {
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [{ clientX: 10, clientY: 10 }] });
      row.dispatchEvent(start);
      await new Promise((resolve) => setTimeout(resolve, 400));
      row.dispatchEvent(new Event("touchend", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("已选 1");
    expect(row.getAttribute("aria-pressed")).toBe("true");

    // 长按抬手后浏览器补发的那一次 click 被吞掉（不会把刚选中的行取消）
    await act(async () => { row.click(); await Promise.resolve(); });
    expect(host.textContent).toContain("已选 1");

    // 选择态下点另一行 = 加选（不切换文档）
    await act(async () => { rowByTitle("随笔").click(); await Promise.resolve(); });
    expect(host.textContent).toContain("已选 2");
    expect(picked).toEqual([]);

    // 全选 → 3；再点全不选 → 0（仍在选择模式）
    await act(async () => { topBarButtons()[1].click(); await Promise.resolve(); });
    expect(host.textContent).toContain("已选 3");
    await act(async () => { topBarButtons()[1].click(); await Promise.resolve(); });
    expect(host.textContent).toContain("已选 0");
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')).not.toBeNull();
  });

  it("底部操作条：移动 / 移入回收站 / 打标签（没有批量彻底删除）；未选时提示先选", async () => {
    await render();
    await enterByButton();
    const bar = host.querySelector('[role="group"][aria-label="批量操作"]')!;
    const labels = [...bar.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["移动", "移入回收站", "打标签"]);
    expect(labels.join("")).not.toContain("彻底");
    expect(labels.join("")).not.toContain("删除");
    await act(async () => { ([...bar.querySelectorAll("button")][1] as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(toastMock.showToast).toHaveBeenCalledWith("请先选择文档");
    expect(bridgeMock.batchNotes).not.toHaveBeenCalled();
  });

  it("移入回收站：二次确认后调 bridge.batchNotes(trash lake)，成功后行消失、退出选择", async () => {
    await render();
    await enterByButton();
    await act(async () => { rowByTitle("周报").click(); await Promise.resolve(); });
    const trashButton = [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="批量操作"] button')]
      .find((b) => (b.textContent ?? "").trim() === "移入回收站")!;
    await act(async () => { trashButton.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(confirmMock.confirmMobile).toHaveBeenCalled();
    const options = confirmMock.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string; confirmText?: string };
    expect(options.title).toContain("移入回收站");
    expect(options.confirmText).toBe("移入回收站");
    expect(bridgeMock.batchNotes).toHaveBeenCalledWith({ action: "trash", ids: ["n1"], space: "lake" });
    expect(docTitles()).not.toContain("周报");                       // 本地先隐藏
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')).toBeNull(); // 退出选择
    expect(toastMock.showToast).toHaveBeenCalledWith("已移入回收站 1 项");
  });

  it("打标签：弹选择器（搜索/多选），确认按钮显示影响条数，提交 tag-add", async () => {
    await render();
    await enterByButton();
    await act(async () => { rowByTitle("周报").click(); await Promise.resolve(); });
    const tagButton = [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="批量操作"] button')]
      .find((b) => (b.textContent ?? "").trim() === "打标签")!;
    await act(async () => { tagButton.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(bridgeMock.listQuickNoteTags).toHaveBeenCalled();
    const search = host.querySelector('input[aria-label="搜索标签"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    const tagRow = [...host.querySelectorAll<HTMLButtonElement>(".qn-tag-sheet__item")]
      .find((el) => (el.textContent ?? "").includes("工作"))!;
    await act(async () => { tagRow.click(); await Promise.resolve(); });
    const confirm = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")]
      .find((el) => (el.textContent ?? "").includes("确认"))!;
    expect(confirm.textContent).toContain("确认（1 条）");
    await act(async () => { confirm.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(bridgeMock.batchNotes).toHaveBeenCalledWith({ action: "tag-add", ids: ["n1"], space: "lake", tagIds: ["t_work"] });
  });

  const moveButton = (): HTMLButtonElement =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="批量操作"] button')]
      .find((b) => (b.textContent ?? "").trim() === "移动")!;
  const treeTarget = (title: string): HTMLButtonElement | null =>
    host.querySelector('[aria-label="移动到 ' + title + '"]') as HTMLButtonElement | null;
  const treeConfirm = (): HTMLButtonElement =>
    [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => (b.textContent ?? "").includes("移动到此处"))!;

  it("移动（目录树）：展开笔记本 → 选分组 → 「移动到此处」调 batchNotes(move parentId)，成功后退出选择", async () => {
    await render();
    await enterByButton();
    await act(async () => { rowByTitle("周报").click(); await Promise.resolve(); });
    await act(async () => { moveButton().click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(bridgeMock.getHomeSnapshot).toHaveBeenCalled();
    // task-94：树默认展开所有根笔记本一层 ⇒ 「分组A」直接可见（用户不用先展开）
    expect(treeTarget("分组A")).not.toBeNull();
    await act(async () => { treeTarget("分组A")!.click(); await Promise.resolve(); });
    await act(async () => { treeConfirm().click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(bridgeMock.batchNotes).toHaveBeenCalledWith({ action: "move", ids: ["n1"], space: "lake", parentId: "g1" });
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')).toBeNull(); // 成功退出选择
  });

  it("移动失败：弹窗内给原因并保留选择（不退出、不关窗）", async () => {
    bridgeMock.batchNotes.mockResolvedValueOnce({
      ok: false,
      results: [{ id: "n1", ok: false, reason: "parent-in-trash" }],
      summary: { total: 1, done: 0, failed: 1 },
      reason: "invalid-input",
    });
    await render();
    await enterByButton();
    await act(async () => { rowByTitle("周报").click(); await Promise.resolve(); });
    await act(async () => { moveButton().click(); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { treeTarget("分组A")!.click(); await Promise.resolve(); });
    await act(async () => { treeConfirm().click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(toastMock.showToast).toHaveBeenCalledWith("成功 0，失败 1（目标位置在回收站里）", { type: "error" });
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')).not.toBeNull(); // 保留选择
  });

  it("移动取消：不改动（不调 batchNotes）", async () => {
    await render();
    await enterByButton();
    await act(async () => { rowByTitle("周报").click(); await Promise.resolve(); });
    await act(async () => { moveButton().click(); await new Promise((r) => setTimeout(r, 0)); });
    const cancel = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => (b.textContent ?? "").trim() === "取消")!;
    await act(async () => { cancel.click(); await Promise.resolve(); });
    expect(bridgeMock.batchNotes).not.toHaveBeenCalled();
  });

  it("返回键：选择态先退出多选（列表不关）", async () => {
    await render();
    await enterByButton();
    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')).toBeNull();
    expect(host.querySelector('[aria-label="选择文档"]')).not.toBeNull();
  });

  it("筛选后：全选只作用于当前可见文档（不选被筛掉的）", async () => {
    await render();
    await clickChip("工作");
    await enterByButton();
    await act(async () => { topBarButtons()[1].click(); await Promise.resolve(); });
    expect(host.textContent).toContain("已选 2"); // 周报、随笔
  });
});

describe("DocListSheet 按标签筛选", () => {
  it("只列当前列表用到的标签（目录顺序），带计数；默认显示全部文档", async () => {
    await render();
    expect(chipNames()).toEqual(["全部", "工作", "灵感"]);
    expect(docTitles()).toEqual(["周报", "随笔", "无标签"]);
  });

  it("点标签 ⇒ 只显示含该标签的文档；再点一次恢复全部", async () => {
    await render();
    await clickChip("工作");
    expect(docTitles()).toEqual(["周报", "随笔"]);
    await clickChip("工作");
    expect(docTitles()).toEqual(["周报", "随笔", "无标签"]);
  });

  it("列表为空 ⇒ 空态文案（不会误报「该标签下暂无文档」）", async () => {
    await render([]);
    expect(host.textContent).toContain("暂无文档");
    expect(host.textContent).not.toContain("该标签下暂无文档");
    expect(host.querySelector(".qn-tag-filter-bar")).toBeNull();
  });

  it("全部文档都没标签 ⇒ 不渲染筛选条（不占空间）", async () => {
    tagReadsMock.loadNoteTagIdsForNotes.mockResolvedValue({ byNoteId: {}, truncated: false, requested: 3, loaded: 3 });
    await render();
    expect(host.querySelector(".qn-tag-filter-bar")).toBeNull();
    expect(docTitles()).toEqual(["周报", "随笔", "无标签"]);
  });

  it("P2-D 标签读取被截断 ⇒ 可见提示（不再静默丢标签）", async () => {
    tagReadsMock.loadNoteTagIdsForNotes.mockResolvedValue({ byNoteId: TAGS, truncated: true, requested: 20001, loaded: 20000 });
    await render();
    expect(host.textContent).toContain("列表过长");
    expect(host.textContent).toContain("20000");
    expect(host.textContent).toContain("20001");
  });

  it("P2-D a11y：筛选 chips 带 aria-pressed（选中态对读屏可见）", async () => {
    await render();
    const chips = [...host.querySelectorAll(".qn-tag-filter-bar .qn-tag")] as HTMLButtonElement[];
    const byText = (name: string) => chips.find((el) => (el.textContent ?? "").trim().startsWith(name))!;
    expect(byText("全部").getAttribute("aria-pressed")).toBe("true");
    expect(byText("工作").getAttribute("aria-pressed")).toBe("false");
    await clickChip("工作");
    expect(byText("全部").getAttribute("aria-pressed")).toBe("false");
    expect(byText("工作").getAttribute("aria-pressed")).toBe("true");
  });

  it("目录不可用 ⇒ 降级提示 + 不启用筛选，列表仍可切换", async () => {
    bridgeMock.listQuickNoteTags.mockRejectedValue(new Error("目录不可用"));
    await render();
    expect(host.textContent).toContain("标签目录暂不可用");
    expect(host.querySelector(".qn-tag-filter-bar")).toBeNull();
    expect(docTitles()).toEqual(["周报", "随笔", "无标签"]);
    const first = host.querySelector(".med-doc-item") as HTMLButtonElement;
    await act(async () => { first.click(); });
    expect(picked).toEqual(["n1"]);
  });
});
