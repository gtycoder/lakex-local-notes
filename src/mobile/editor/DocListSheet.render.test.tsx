// @vitest-environment jsdom
/**
 * 工作区「文档列表」按标签筛选（261105 P1，**只读/设备本地**）：
 * chips 只列当前列表里用到的标签（顺序 = 目录顺序）；点击过滤、再点取消；
 * 无标签文档不受影响；目录不可用降级为「不启用筛选 + 一句提示」，列表照常可切换。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({ listQuickNoteTags: vi.fn() }));
const tagReadsMock = vi.hoisted(() => ({ loadNoteTagIdsForNotes: vi.fn() }));
vi.mock("../bridge", () => ({ bridge: bridgeMock }));
vi.mock("../bridge/noteTagReads", () => tagReadsMock);
vi.mock("../ui/MobileSheet", () => ({
  MobileSheet: ({ children }: { children: unknown }) => <div data-testid="sheet">{children as never}</div>,
}));

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
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
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
