// @vitest-environment jsdom
import { act, createElement, useState } from "react";
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
  // 行 ⋯ 菜单用 usePopoverPosition 测量 → jsdom 需要 ResizeObserver
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
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
    onCreateTag: vi.fn(async (name: string) => "t_new_" + name),
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
const openRowMenu = (name: string) => act(() => byAria("标签操作 " + name).click());
const menuItem = (text: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>(".context-menu button")].find((btn) => (btn.textContent ?? "").includes(text));
  if (!found) throw new Error("菜单项不存在：" + text);
  return found;
};
const byAria = (label: string): HTMLButtonElement => {
  const found = document.body.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  if (!found) throw new Error("找不到按钮：" + label);
  return found;
};

describe("TagsWorkspace（标签空间）", () => {
  it("左栏只展示名称（无条数/更新时间）；头部有 ＋新建/刷新 两个按钮；⋯ 菜单固定可见", () => {
    render();
    expect(document.body.textContent).toContain("灵感");
    expect(document.body.textContent).toContain("项目");
    // 用户验收：条数（文2 记0）与更新时间都只在选中后于中栏摘要展示 ⇒ 左行文本里不出现
    const rowText = [...document.body.querySelectorAll(".tags-dir__row")].map((row) => row.textContent ?? "").join("|");
    expect(rowText).not.toMatch(/文\s*\d|记\s*\d/);
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // 头部两个 icon 按钮（顺序：＋ 在前、刷新在后）
    const headButtons = [...document.body.querySelectorAll(".tags-dir__head button")].map((btn) => btn.getAttribute("aria-label"));
    expect(headButtons).toContain("新建标签");
    expect(headButtons).toContain("刷新标签");
    expect(headButtons.indexOf("新建标签")).toBeLessThan(headButtons.indexOf("刷新标签"));
    // 行操作入口 = 固定可见的 ⋯ 菜单
    expect(byAria("标签操作 灵感").getAttribute("aria-haspopup")).toBe("menu");
    expect(byAria("标签操作 灵感").getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).toContain("从左侧选择一个标签");
  });

  it("三栏可拖：两条 SplitHandle（目录/预览）+ 默认宽度 aria-valuenow", () => {
    render();
    const handles = [...document.body.querySelectorAll<HTMLElement>('[role="separator"]')];
    const labels = handles.map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(expect.arrayContaining(["调整标签目录宽度", "调整标签预览宽度"]));
    const dirHandle = document.body.querySelector<HTMLElement>('[role="separator"][aria-label="调整标签目录宽度"]')!;
    const previewHandle = document.body.querySelector<HTMLElement>('[role="separator"][aria-label="调整标签预览宽度"]')!;
    expect(dirHandle).toBeTruthy();
    expect(previewHandle).toBeTruthy();
    expect(dirHandle.getAttribute("aria-valuenow")).toBe("260");
    expect(previewHandle.getAttribute("aria-valuenow")).toBe("380");
    expect(dirHandle.getAttribute("tabindex")).toBe("0");
    // 键盘微调：← 收窄左栏 16px（接线到 onPreview/onCommit）
    act(() => { dirHandle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(document.body.querySelector<HTMLElement>('[role="separator"][aria-label="调整标签目录宽度"]')!.getAttribute("aria-valuenow")).toBe("244");
  });

  it("头部刷新按钮触发 onReload；新建按钮展开内联输入", () => {
    const merged = render();
    act(() => byAria("刷新标签").click());
    expect(merged.onReload).toHaveBeenCalledTimes(1);
    act(() => byAria("新建标签").click());
    expect(document.body.querySelector('input[aria-label="新标签名称"]')).not.toBeNull();
  });

  it("选中标签后中栏摘要含条数与「更新于 …」", () => {
    render();
    act(() => byText("灵感")!.closest("button")!.click());
    const hint = document.querySelector(".tags-aggregate__hint")!.textContent ?? "";
    expect(hint).toContain("2 篇文档");
    expect(hint).toContain("1 条小记");
    expect(hint).toContain("更新于");
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
    openRowMenu("灵感");
    expect(byAria("标签操作 灵感").getAttribute("aria-expanded")).toBe("true");
    act(() => menuItem("删除").click());
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
    openRowMenu("灵感");
    act(() => menuItem("合并到…").click());
    const dialog = document.querySelector(".tags-merge-dialog")!;
    expect(dialog.textContent).toContain("把「灵感」合并到");
    const targetButton = [...dialog.querySelectorAll<HTMLButtonElement>(".ln-row")].find((btn) => (btn.textContent ?? "").includes("项目"))!;
    act(() => targetButton.click());
    expect(merged.onMergeTag).toHaveBeenCalledWith("t1", "t2");
  });

  it("目录只剩一个标签时：⋯ 菜单里的「合并到…」禁用", () => {
    render({ tags: [tag("t1", "唯一")] });
    openRowMenu("唯一");
    expect(menuItem("合并到…").disabled).toBe(true);
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

  it("新建标签：头部与空目录都有入口；点击出现内联输入", () => {
    render({ tags: [], documentLinks: {} });
    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button[aria-label="新建标签"]')];
    expect(buttons.length).toBeGreaterThanOrEqual(2); // 头部 + 空目录 CTA
    expect(document.body.textContent).toContain("新建一个标签");
    act(() => buttons[0]!.click());
    // 261105 用户验收：新建标签 = 弹窗（不再是内联输入行）
    expect(document.body.querySelector(".name-prompt-dialog")).not.toBeNull();
    expect(document.body.textContent).toContain("新建标签");
    expect(document.body.querySelector('input[aria-label="新标签名称"]')).not.toBeNull();
    // 空名 ⇒ 「创建」禁用
    const createButton = [...document.body.querySelectorAll<HTMLButtonElement>(".name-prompt-dialog button")].find((btn) => (btn.textContent ?? "") === "创建")!;
    expect(createButton.disabled).toBe(true);
  });

  it("新建标签：Enter 调 onCreateTag → reload → 自动选中该标签", async () => {
    // 有状态宿主：onReload 后把新标签放进 props（模拟 App 的 tagSpace.reload）
    const created = tag("t_new", "新标签");
    const onCreateTag = vi.fn(async (_name: string) => created.id);
    const onReload = vi.fn(async () => {});
    function Host() {
      const [tags, setTags] = useState<QuickNoteTag[]>([tag("t1", "灵感")]);
      return createElement(TagsWorkspace, {
        ...props({ tags, onCreateTag, onReload }),
        onReload: async () => { const next = [created, tag("t1", "灵感")]; setTags(next); await onReload(); },
        onCreateTag: async (name: string) => { const id = await onCreateTag(name); return id; },
      });
    }
    act(() => root.render(createElement(Host)));
    act(() => document.body.querySelectorAll<HTMLButtonElement>('button[aria-label="新建标签"]')[0]!.click());
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="新标签名称"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "新标签");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await Promise.resolve(); });
    expect(onCreateTag).toHaveBeenCalledWith("新标签");
    expect(onReload).toHaveBeenCalled();
    expect(document.body.textContent).toContain("「新标签」");
  });

  it("新建标签：Esc 取消（不调 onCreateTag，输入消失）", () => {
    const merged = render();
    act(() => document.body.querySelectorAll<HTMLButtonElement>('button[aria-label="新建标签"]')[0]!.click());
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="新标签名称"]')!;
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(merged.onCreateTag).not.toHaveBeenCalled();
    expect(document.body.querySelector('input[aria-label="新标签名称"]')).toBeNull();
  });

  it("行 ⋯ 菜单：开合、aria-expanded 跟随；三个动作都在", () => {
    render();
    expect(byAria("标签操作 灵感").getAttribute("aria-expanded")).toBe("false");
    openRowMenu("灵感");
    expect(byAria("标签操作 灵感").getAttribute("aria-expanded")).toBe("true");
    // 三个动作齐全（重命名 / 合并到… / 删除）
    expect(menuItem("重命名")).toBeTruthy();
    expect(menuItem("合并到…")).toBeTruthy();
    expect(menuItem("删除")).toBeTruthy();
    // 再点一次 ⋯ 收起
    act(() => byAria("标签操作 灵感").click());
    expect(document.querySelector(".context-menu")).toBeNull();
    expect(byAria("标签操作 灵感").getAttribute("aria-expanded")).toBe("false");
  });

  it("行 ⋯ 菜单：重命名进入内联编辑", () => {
    render();
    openRowMenu("灵感");
    act(() => menuItem("重命名").click());
    expect(document.body.querySelector('input[aria-label="重命名标签 灵感"]')).not.toBeNull();
    // 进入编辑态后 ⋯ 让位给「保存名称」
    expect(byAria("保存名称")).toBeTruthy();
  });
});
