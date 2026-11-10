// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TagsWorkspace, type TagsWorkspaceProps } from "./TagsWorkspace";
import { TAG_STATE_STORAGE_KEY } from "./tagsWorkspaceState";
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";

/**
 * 标签空间（P1）：目录（名称/计数/更新时间）、聚合列表（文档分组 + 小记分组、更新时间倒序、可切）、
 * 空态、就地元数据管理（改名/合并/删除/排序）、右栏预览与跳转。261106 起：文档预览只出少量信息
 * （点击 = 打开文档，不内嵌正文）、小记预览 = 限高卡片 + 展开/收起 + 编辑；另验「记住上次状态」。
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
  // 小记预览（QuickNotePreview 内核兜底）需要 IntersectionObserver
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  // 状态持久化：每个用例从干净存储开始（否则上一个用例的选中会漏到下一个）
  localStorage.clear();
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
    onRemoveTagFromItem: vi.fn(async () => {}),
    onError: vi.fn(),
    ...overrides,
  };
}
function render(overrides: Partial<TagsWorkspaceProps> = {}) {
  const merged = props(overrides);
  act(() => root.render(createElement(TagsWorkspace, merged)));
  return merged;
}
/** 重新挂载（模拟「离开标签空间再回来」）：换 root 而不是复用旧组件状态。 */
function remount(overrides: Partial<TagsWorkspaceProps> = {}) {
  act(() => root.unmount());
  root = createRoot(host);
  return render(overrides);
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

  it("选中标签后中栏说明：主文案（条数）+ 弱化时间（无「」/分号）", () => {
    render();
    act(() => byText("灵感")!.closest("button")!.click());
    const main = document.querySelector(".tags-aggregate__hint-main")!;
    const meta = document.querySelector(".tags-aggregate__hint-meta")!;
    expect(main.textContent).toContain("2 篇文档");
    expect(main.textContent).toContain("1 条小记");
    expect(meta.textContent).toContain("按更新时间倒序");
    expect(meta.textContent).toContain("更新于");
    const hint = document.querySelector(".tags-aggregate__hint")!.textContent ?? "";
    expect(hint).not.toContain("「");
    expect(hint).not.toContain("；");
  });

  it("聚合行「移除该标签」：调 onRemoveTagFromItem(当前条目, 当前标签) 并刷新（无二次确认）", async () => {
    const merged = render();
    act(() => byText("灵感")!.closest("button")!.click());
    await act(async () => {
      byAria("移除标签 灵感").click();
      await Promise.resolve();
    });
    expect(merged.onRemoveTagFromItem).toHaveBeenCalledWith(expect.objectContaining({ kind: "doc", id: "n2" }), "t1");
    expect(merged.onReload).toHaveBeenCalled();
  });

  it("预览头部也提供「移除该标签」（与行内同一动作）", async () => {
    const merged = render();
    act(() => byText("灵感")!.closest("button")!.click());
    await act(async () => { byText("文档二")!.closest("button")!.click(); await Promise.resolve(); });
    const removeBtn = [...document.querySelectorAll<HTMLButtonElement>(".tags-preview__head button")].find((btn) => (btn.textContent ?? "") === "移除标签")!;
    expect(removeBtn).toBeTruthy();
    await act(async () => { removeBtn.click(); await Promise.resolve(); });
    expect(merged.onRemoveTagFromItem).toHaveBeenCalledWith(expect.objectContaining({ kind: "doc", id: "n2" }), "t1");
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

  it("文档预览只显示少量信息（不读正文），点击卡片 = 打开文档", async () => {
    const merged = render();
    act(() => byText("灵感")!.closest("button")!.click());
    await act(async () => { byText("文档二")!.closest("button")!.click(); await Promise.resolve(); });
    // 261106：不再内嵌整篇正文 ⇒ 不读正文、不出内核预览容器
    expect(merged.onLoadPreview).not.toHaveBeenCalled();
    expect(document.querySelector(".tags-preview__open-doc")).not.toBeNull();
    const card = document.querySelector<HTMLButtonElement>(".tags-preview__open-doc")!;
    expect(card.textContent).toContain("文档二");
    expect(card.textContent).toContain("更新于");
    expect(card.textContent).toContain("点击打开文档");
    act(() => card.click());
    expect(merged.onOpenDocument).toHaveBeenCalledWith("n2");
  });

  it("小记预览 = 卡片（限高）+ 展开/收起 + 编辑入口打开小记", async () => {
    const merged = render();
    act(() => byText("灵感")!.closest("button")!.click());
    await act(async () => { byText("小记一")!.closest("button")!.click(); await Promise.resolve(); });
    expect(merged.onLoadPreview).toHaveBeenCalledWith(expect.objectContaining({ kind: "quickNote", id: "q1" }));
    const card = document.querySelector(".tags-preview__note-card")!;
    expect(card).not.toBeNull();
    expect(card.classList.contains("is-expanded")).toBe(false);
    expect(card.querySelector(".tags-preview__note-body")).not.toBeNull();
    const toggle = [...card.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "") === "展开")!;
    act(() => toggle.click());
    expect(document.querySelector(".tags-preview__note-card")!.classList.contains("is-expanded")).toBe(true);
    const collapse = [...document.querySelectorAll<HTMLButtonElement>(".tags-preview__note-actions button")].find((btn) => (btn.textContent ?? "") === "收起")!;
    act(() => collapse.click());
    expect(document.querySelector(".tags-preview__note-card")!.classList.contains("is-expanded")).toBe(false);
    const edit = [...document.querySelectorAll<HTMLButtonElement>(".tags-preview__note-actions button")].find((btn) => (btn.textContent ?? "") === "编辑")!;
    act(() => edit.click());
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

  it("行主区 = kit 的 .ln-row__main--row（261110 第二批）：父行仍负责 hover/选中", () => {
    render();
    const rowMain = document.body.querySelector<HTMLButtonElement>(".tags-dir__row .tags-dir__select")!;
    expect(rowMain).not.toBeNull();
    expect(rowMain.className).toContain("ln-row__main");
    expect(rowMain.className).toContain("ln-row__main--row");
    act(() => byText("灵感")!.closest("button")!.click());
    const aggregateMain = document.body.querySelector<HTMLButtonElement>(".tags-aggregate__row .tags-aggregate__open")!;
    expect(aggregateMain.className).toContain("ln-row__main");
    // 父行 = ln-row（选中态仍由父行 is-selected 提供）
    expect(document.body.querySelector(".tags-aggregate__row")!.className).toContain("ln-row");
    expect(document.querySelector(".tags-dir__row.is-selected")).not.toBeNull();
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
    expect(document.body.textContent).toContain("该标签下暂无内容");
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
    // 创建后自动选中新标签（左栏出现 selected 行，中栏进入其聚合视图）
    expect(document.querySelector(".tags-dir__row.is-selected")?.textContent).toContain("新标签");
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

  it("行 ⋯ 菜单：重命名进入内联编辑，且打开即全选原名（261106）", () => {
    render();
    openRowMenu("灵感");
    act(() => menuItem("重命名").click());
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="重命名标签 灵感"]');
    expect(input).not.toBeNull();
    // 全选覆盖整个名称：直接打字 = 整体替换（标签行内输入与目录弹窗同一条 InlineRenameInput 契约）
    expect(input!.value).toBe("灵感");
    expect(input!.selectionStart).toBe(0);
    expect(input!.selectionEnd).toBe(input!.value.length);
    // 进入编辑态后 ⋯ 让位给「保存名称」
    expect(byAria("保存名称")).toBeTruthy();
  });
});
/**
 * 261106 用户验收：标签空间记住上次状态（选中标签 / 聚合筛选 / 右栏预览 / 中栏滚动）。
 * 设备本地 localStorage；坏值/标签已删回默认；数据不可用时不写坏状态。
 */
describe("TagsWorkspace（记住上次状态）", () => {
  it("恢复选中标签 + 筛选 + 预览（离开再回来）", async () => {
    localStorage.setItem(TAG_STATE_STORAGE_KEY, JSON.stringify({
      tagId: "t1", filter: "quickNote", preview: { kind: "quickNote", id: "q1" }, scrollTop: 0,
    }));
    const merged = remount();
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector(".tags-dir__row.is-selected")?.textContent).toContain("灵感");
    const activeTab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(activeTab?.textContent).toBe("仅小记");
    expect(merged.onLoadPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }));
    expect(document.querySelector(".tags-preview__note-card")).not.toBeNull();
  });

  it("选择/筛选/预览都写回设备本地（含滚动位置字段）", async () => {
    render();
    act(() => byText("灵感")!.closest("button")!.click());
    act(() => byText("仅文档")!.click());
    await act(async () => { byText("文档二")!.closest("button")!.click(); await Promise.resolve(); });
    const stored = JSON.parse(localStorage.getItem(TAG_STATE_STORAGE_KEY) ?? "null");
    expect(stored).toMatchObject({ tagId: "t1", filter: "doc", preview: { kind: "doc", id: "n2" } });
    expect(typeof stored.scrollTop).toBe("number");
  });

  it("坏存储 / 标签已被删除：回未选中态，不报错", () => {
    localStorage.setItem(TAG_STATE_STORAGE_KEY, "{坏 JSON");
    const merged = remount();
    expect(document.querySelector(".tags-dir__row.is-selected")).toBeNull();
    expect(document.body.textContent).toContain("从左侧选择一个标签");
    expect(merged.onError).not.toHaveBeenCalled();

    localStorage.setItem(TAG_STATE_STORAGE_KEY, JSON.stringify({
      tagId: "t_missing", filter: "all", preview: { kind: "doc", id: "n1" }, scrollTop: 120,
    }));
    remount();
    expect(document.querySelector(".tags-dir__row.is-selected")).toBeNull();
    expect(document.body.textContent).toContain("从左侧选择一个标签");
  });

  it("预览条目已不在该标签下 ⇒ 只清预览，保留标签与筛选", async () => {
    localStorage.setItem(TAG_STATE_STORAGE_KEY, JSON.stringify({
      tagId: "t1", filter: "all", preview: { kind: "doc", id: "n999" }, scrollTop: 0,
    }));
    const merged = remount({ documentLinks: { n1: ["t1"] } });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector(".tags-dir__row.is-selected")?.textContent).toContain("灵感");
    expect(document.querySelector(".tags-preview__open-doc")).toBeNull();
    expect(document.body.textContent).toContain("选择一条内容查看只读预览");
    expect(merged.onLoadPreview).not.toHaveBeenCalled();
  });

  it("数据不可用（降级）时不恢复也不覆盖存储", () => {
    const stored = JSON.stringify({ tagId: "t1", filter: "doc", preview: null, scrollTop: 0 });
    localStorage.setItem(TAG_STATE_STORAGE_KEY, stored);
    render({ available: false });
    expect(localStorage.getItem(TAG_STATE_STORAGE_KEY)).toBe(stored);
  });
});
