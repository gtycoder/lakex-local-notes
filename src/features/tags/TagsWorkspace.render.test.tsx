// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TagsWorkspace, type TagsWorkspaceProps } from "./TagsWorkspace";
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";

/**
 * 标签空间（P1）：目录（名称/计数/更新时间）、聚合列表（文档分组 + 小记分组、更新时间倒序、可切）、
 * 空态、就地元数据管理（改名/合并/删除/排序）、只读预览与跳转。预览正文（内核）在 Suspense 里，
 * 本测试只断言接线（onLoadPreview 被调用 + 「在文档中打开」入口存在）。
 */
const tag = (id: string, name: string): QuickNoteTag => ({ id, name, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" });
const note = (id: string, title: string, updatedAt: string): NoteSummary => ({ id, title, parentId: "nb1", sortOrder: 0, updatedAt, isConflict: false } as NoteSummary);
const quick = (id: string, previewText: string, updatedAt: string, tagIds: string[]): QuickNoteListSummary => ({
  id, createdAt: updatedAt, updatedAt, previewText, imageCount: 0, contentHash: "h", syncState: "synced", isConflict: false, tagIds, tags: [], assetMimeTypes: [],
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function props(overrides: Partial<TagsWorkspaceProps> = {}): TagsWorkspaceProps {
  return {
    active: true,
    tags: [tag("t1", "灵感"), tag("t2", "项目")],
    documentLinks: { n1: ["t1"], n2: ["t1", "t2"] },
    notes: [note("n1", "文档一", "2026-11-01T00:00:00.000Z"), note("n2", "文档二", "2026-11-05T00:00:00.000Z")],
    quickNotes: [quick("q1", "小记一", "2026-11-03T00:00:00.000Z", ["t1"])],
    available: true,
    onReload: vi.fn(async () => {}),
    onRenameTag: vi.fn(async () => {}),
    onMergeTag: vi.fn(async () => {}),
    onDeleteTag: vi.fn(async () => {}),
    onReorderTags: vi.fn(async () => {}),
    onOpenDocument: vi.fn(),
    onOpenQuickNote: vi.fn(),
    onLoadPreview: vi.fn(async () => "<p>正文</p>"),
    onError: vi.fn(),
    ...overrides,
  };
}
function render(overrides: Partial<TagsWorkspaceProps> = {}) {
  const merged = props(overrides);
  act(() => root.render(createElement(TagsWorkspace, merged)));
  return merged;
}
const byText = (text: string): HTMLElement | undefined => [...document.body.querySelectorAll<HTMLElement>("button, h1, h3, p, span, strong")].find((el) => (el.textContent ?? "").includes(text));
const byAria = (label: string): HTMLButtonElement => {
  const found = document.body.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  if (!found) throw new Error("找不到按钮：" + label);
  return found;
};

describe("TagsWorkspace（标签空间）", () => {
  it("目录：名称 + 文档/小记数 + 更新时间；先给出选择提示", () => {
    render();
    expect(document.body.textContent).toContain("灵感");
    expect(document.body.textContent).toContain("项目");
    expect(document.body.textContent).toContain("2 个标签");
    // 灵感：文档 2 篇（n1/n2）、小记 1 条（q1）
    expect(byAria("重命名标签 灵感")).toBeTruthy();
    expect(document.body.textContent).toContain("从左侧选择一个标签");
  });

  it("选中标签 ⇒ 文档分组 + 小记分组，各自按更新时间倒序", () => {
    render();
    act(() => byText("灵感")!.closest("button")!.click());
    expect(document.body.textContent).toContain("文档（2）");
    expect(document.body.textContent).toContain("小记（1）");
    // 文档按更新时间倒序：n2(11-05) 在 n1(11-01) 前
    const titles = [...document.body.querySelectorAll(".tags-aggregate__row-title")].map((el) => el.textContent);
    expect(titles.slice(0, 2)).toEqual(["文档二", "文档一"]);
  });

  it("切换「仅文档 / 仅小记」只影响分组显示", () => {
    render();
    act(() => byText("灵感")!.closest("button")!.click());
    act(() => byText("仅小记")!.click());
    expect(document.body.textContent).toContain("小记（1）");
    expect(document.body.textContent).not.toContain("文档（2）");
    act(() => byText("仅文档")!.click());
    expect(document.body.textContent).toContain("文档（2）");
    expect(document.body.textContent).not.toContain("小记（1）");
  });

  it("点击聚合条目 ⇒ 调 onLoadPreview，并出现「在文档中打开」跳转", async () => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof IntersectionObserver);
    const merged = render();
    act(() => byText("灵感")!.closest("button")!.click());
    await act(async () => { byText("文档二")!.closest("button")!.click(); await Promise.resolve(); });
    expect(merged.onLoadPreview).toHaveBeenCalledWith(expect.objectContaining({ kind: "doc", id: "n2" }));
    expect(document.body.textContent).toContain("在文档中打开");
    act(() => byText("在文档中打开")!.click());
    expect(merged.onOpenDocument).toHaveBeenCalledWith("n2");
  });

  it("点小记条目 ⇒ 预览取 readQuickNote 路径，并出现「在小记中打开」跳转", async () => {
    const merged = render();
    act(() => byText("灵感")!.closest("button")!.click());
    await act(async () => { byText("小记一")!.closest("button")!.click(); await Promise.resolve(); });
    expect(merged.onLoadPreview).toHaveBeenCalledWith(expect.objectContaining({ kind: "quickNote", id: "q1" }));
    expect(document.body.textContent).toContain("在小记中打开");
    act(() => byText("在小记中打开")!.click());
    expect(merged.onOpenQuickNote).toHaveBeenCalledWith("q1");
  });

  it("删除标签：二次确认并说明会同时移除文档与小记上的该标签", async () => {
    const merged = render();
    act(() => byAria("删除标签 灵感").click());
    expect(document.body.textContent).toContain("会同时移除文档与小记上的该标签");
    await act(async () => {
      const confirmBtn = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").includes("删除标签") && !btn.hasAttribute("aria-label"));
      confirmBtn?.click();
      await Promise.resolve();
    });
    expect(merged.onDeleteTag).toHaveBeenCalledWith("t1");
  });

  it("合并：选目标后调 onMergeTag(source, target)；目录只剩一个标签时禁用合并", () => {
    const merged = render();
    act(() => byAria("合并标签 灵感").click());
    const dialog = document.querySelector(".tags-merge-dialog")!;
    expect(dialog.textContent).toContain("把「灵感」合并到");
    const targetButton = [...dialog.querySelectorAll<HTMLButtonElement>(".ln-row")].find((btn) => (btn.textContent ?? "").includes("项目"))!;
    act(() => targetButton.click());
    expect(merged.onMergeTag).toHaveBeenCalledWith("t1", "t2");

    render({ tags: [tag("t1", "唯一")] });
    expect(byAria("合并标签 唯一").disabled).toBe(true);
  });

  it("拖拽排序：把后一个拖到前一个之前 ⇒ onReorderTags", () => {
    const merged = render();
    const rows = [...document.body.querySelectorAll<HTMLElement>(".tags-dir__row")];
    expect(rows).toHaveLength(2);
    // 必须分两次 act：drop 处理器读的是 dragstart 之后的状态（同一次 act 里还是旧闭包）。
    act(() => { rows[1]!.dispatchEvent(new Event("dragstart", { bubbles: true })); });
    act(() => { rows[0]!.dispatchEvent(new Event("drop", { bubbles: true })); });
    expect(merged.onReorderTags).toHaveBeenCalledWith(["t2", "t1"]);
  });

  it("空态：无标签 / 标签下无内容 / 数据层不可用 / 目录读取失败", () => {
    render({ tags: [], documentLinks: {} });
    expect(document.body.textContent).toContain("还没有标签");
    render();
    act(() => byText("项目")!.closest("button")!.click());
    // 项目：有 1 篇文档、0 条小记 ⇒ 切「仅小记」给出空态
    act(() => byText("仅小记")!.click());
    expect(document.body.textContent).toContain("「项目」下还没有小记");
    render({ available: false });
    expect(document.body.textContent).toContain("标签数据暂不可用");
    render({ dataError: "标签目录暂不可用：小记库降级" });
    expect(document.body.textContent).toContain("标签目录暂不可用");
  });
});
