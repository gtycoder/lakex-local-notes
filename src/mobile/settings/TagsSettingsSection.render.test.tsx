// @vitest-environment jsdom
/**
 * 261106 用户验收：移动端「标签」设置页（标签目录管理入口 + 简化标签空间）。
 * 锁：列表计数（文档数/小记数）、聚合（文档 + 小记，更新时间倒序）、行点击打开、
 *     行内移除该标签（文档 setNoteTags / 小记 setQuickNoteTags）、小记库不可用时的降级提示与重试。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNoteTagLinks: vi.fn(),
  setNoteTags: vi.fn(async () => undefined),
  setQuickNoteTags: vi.fn(async () => undefined),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    listNoteTagLinks: mocks.listNoteTagLinks,
    setNoteTags: mocks.setNoteTags,
    setQuickNoteTags: mocks.setQuickNoteTags,
    createQuickNoteTag: vi.fn(),
    updateQuickNoteTag: vi.fn(),
    mergeQuickNoteTags: vi.fn(),
    deleteQuickNoteTag: vi.fn(),
    reorderQuickNoteTags: vi.fn(),
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: vi.fn(async () => true) }));

import type { QuickNoteTag } from "../../core/quickNoteTags";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { MobileQuickNote } from "../home/HomePage";
import { aggregateTagRows, tagCounts, TagsSettingsSection } from "./TagsSettingsSection";

const T = "2026-11-01T00:00:00.000Z";
const tag = (id: string, name: string): QuickNoteTag => ({ id, name, createdAt: T, updatedAt: T });
const doc = (id: string, title: string, updatedAt: string): LocalNoteSummary => ({ id, title, updatedAt } as unknown as LocalNoteSummary);
const quick = (id: string, previewText: string, updatedAt: string, tagIds: string[] = []): MobileQuickNote => ({
  id, createdAt: T, updatedAt, previewText, imageCount: 0, firstImage: null, tags: [], tagIds,
});

const TAGS = [tag("t_a", "工作"), tag("t_b", "灵感")];
const NOTES = [
  doc("n1", "周报", "2026-11-05T08:00:00.000Z"),
  doc("n2", "月报", "2026-11-04T08:00:00.000Z"),
  doc("n3", "随手记", "2026-11-03T08:00:00.000Z"),
];
const QUICKS = [
  quick("q1", "想法一", "2026-11-06T09:00:00.000Z", ["t_a"]),
  quick("q2", "想法二", "2026-11-02T09:00:00.000Z", ["t_b"]),
];
const LINKS = { n1: ["t_a"], n2: ["t_a", "t_b"] };

let host: HTMLDivElement;
let root: Root;
const onOpenNote = vi.fn();
const onOpenQuickNote = vi.fn();
const onChanged = vi.fn(async () => undefined);

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(
      <TagsSettingsSection
        tags={TAGS}
        notes={NOTES}
        quickNotes={QUICKS}
        onOpenNote={onOpenNote}
        onOpenQuickNote={onOpenQuickNote}
        onChanged={onChanged}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const click = async (el: Element | null | undefined): Promise<void> => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const byText = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").trim() === text);
const rowByText = (text: string): HTMLElement | null =>
  ([...host.querySelectorAll<HTMLElement>(".mb-row--two-line")].find((el) => (el.textContent ?? "").includes(text)) ?? null);
const rowTitles = (): string[] => [...host.querySelectorAll<HTMLElement>(".mb-row--two-line .mb-row__title")].map((el) => el.textContent ?? "");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.listNoteTagLinks.mockReset();
  mocks.listNoteTagLinks.mockResolvedValue(LINKS);
  mocks.setNoteTags.mockReset();
  mocks.setNoteTags.mockResolvedValue(undefined);
  mocks.setQuickNoteTags.mockReset();
  mocks.setQuickNoteTags.mockResolvedValue(undefined);
  mocks.showToast.mockReset();
  onOpenNote.mockReset();
  onOpenQuickNote.mockReset();
  onChanged.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("标签空间（简化页）", () => {
  it("标签列表按目录顺序展示，并给出「N 篇文档、M 条小记」计数", async () => {
    await render();
    expect(rowTitles()).toEqual(["工作", "灵感"]);
    const work = rowByText("工作")!;
    expect(work.textContent).toContain("2 篇文档、1 条小记");
    const idea = rowByText("灵感")!;
    expect(idea.textContent).toContain("1 篇文档、1 条小记");
    // 入口：管理标签（新建/改名/合并/删除）在页面里
    expect(byText("管理标签")).toBeTruthy();
  });

  it("选中标签 → 聚合文档 + 小记，更新时间倒序；行点击分别打开文档 / 小记", async () => {
    await render();
    await click(rowByText("工作"));
    // q1（11-06 09:00）比 n1（11-05 08:00）、n2（11-04 08:00）新 ⇒ 小记排最前
    expect(rowTitles()).toEqual(["想法一", "周报", "月报"]);
    await click(rowByText("周报")!.querySelector("button.mb-row__main"));
    expect(onOpenNote).toHaveBeenCalledWith("n1");
    await click(byText("全部标签"));
    await click(rowByText("工作"));
    await click(rowByText("想法一")!.querySelector("button.mb-row__main"));
    expect(onOpenQuickNote).toHaveBeenCalledWith("q1");
  });

  it("行内移除文档标签：只删这一条关系（setNoteTags 传剩余 tagIds），并重新读取关系", async () => {
    await render();
    await click(rowByText("工作"));
    await click(host.querySelector('[aria-label="从「工作」移除「月报」"]'));
    expect(mocks.setNoteTags).toHaveBeenCalledWith("n2", ["t_b"]);
    expect(mocks.listNoteTagLinks).toHaveBeenCalledTimes(2); // 首屏 1 次 + 移除后重读
    expect(onChanged).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("已移除标签");
  });

  it("行内移除小记标签：setQuickNoteTags 传剩余 tagIds（不动正文）", async () => {
    await render();
    await click(rowByText("工作"));
    await click(host.querySelector('[aria-label="从「工作」移除「想法一」"]'));
    expect(mocks.setQuickNoteTags).toHaveBeenCalledWith("q1", []);
    expect(mocks.showToast).toHaveBeenCalledWith("已移除标签");
  });

  it("移除失败：可见提示、不静默（保留原聚合）", async () => {
    mocks.setNoteTags.mockRejectedValueOnce(new Error("数据库忙"));
    await render();
    await click(rowByText("工作"));
    await click(host.querySelector('[aria-label="从「工作」移除「周报」"]'));
    const [message, options] = mocks.showToast.mock.calls[0] as [string, { type?: string }];
    expect(message).toContain("移除标签失败");
    expect(message).toContain("数据库忙");
    expect(options?.type).toBe("error");
    expect(rowTitles()).toContain("周报");
  });

  it("小记库不可用：给「标签目录暂不可用」+ 重试（不整页崩）", async () => {
    mocks.listNoteTagLinks.mockRejectedValueOnce(new Error("标签库不可用"));
    await render();
    expect(host.textContent).toContain("标签目录暂不可用");
    expect(host.textContent).toContain("标签库不可用");
    await click(byText("重试"));
    expect(mocks.listNoteTagLinks).toHaveBeenCalledTimes(2);
    expect(mocks.listNoteTagLinks).toHaveBeenLastCalledWith();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(rowTitles()).toEqual(["工作", "灵感"]);
  });
});

describe("标签聚合纯函数", () => {
  it("tagCounts：只统计仍存在的文档；同一引用重复 id 不重复计数", () => {
    const counts = tagCounts(TAGS, { n1: ["t_a", "t_a"], deleted: ["t_a"], n2: ["t_b"] }, NOTES, QUICKS);
    expect(counts.docs).toEqual({ t_a: 1, t_b: 1 });
    expect(counts.quickNotes).toEqual({ t_a: 1, t_b: 1 });
  });

  it("aggregateTagRows：时间倒序，同时间按 kind/id 稳定排序", () => {
    const same = "2026-11-05T08:00:00.000Z";
    const rows = aggregateTagRows("t_a", { n1: ["t_a"] }, [doc("n1", "甲", same)], [quick("q9", "乙", same, ["t_a"]), quick("q8", "丙", same, ["t_a"])]);
    expect(rows.map((row) => row.kind + ":" + row.id)).toEqual(["doc:n1", "quick:q8", "quick:q9"]);
  });
});
