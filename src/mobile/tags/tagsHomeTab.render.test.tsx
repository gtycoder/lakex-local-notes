// @vitest-environment jsdom
/**
 * 261106 用户验收：一级「标签」页（与小记/知识库并列，flomo 式：标签即入口）。
 * 覆盖：列表计数/设备本地顺序/空态/降级重试、新建（弹层）、管理态（重命名/合并/删除确认文案 + 长按拖拽排序）、
 * 详情（文档/小记分组倒序、点击打开、行内移除重填实参与刷新、失败提示）、首页三 tab 切换。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNoteTagLinks: vi.fn(),
  setNoteTags: vi.fn(async () => undefined),
  setQuickNoteTags: vi.fn(async () => undefined),
  createQuickNoteTag: vi.fn(async () => ({ id: "t_new", name: "新", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" })),
  updateQuickNoteTag: vi.fn(async () => undefined),
  deleteQuickNoteTag: vi.fn(async () => undefined),
  mergeQuickNoteTags: vi.fn(async () => undefined),
  reorderQuickNoteTags: vi.fn(async () => undefined),
  showToast: vi.fn(),
  confirmMobile: vi.fn(async (_options?: { title?: string; body?: string }) => true),
}));

vi.mock("../bridge", () => ({
  bridge: {
    listNoteTagLinks: mocks.listNoteTagLinks,
    setNoteTags: mocks.setNoteTags,
    setQuickNoteTags: mocks.setQuickNoteTags,
    createQuickNoteTag: mocks.createQuickNoteTag,
    updateQuickNoteTag: mocks.updateQuickNoteTag,
    deleteQuickNoteTag: mocks.deleteQuickNoteTag,
    mergeQuickNoteTags: mocks.mergeQuickNoteTags,
    reorderQuickNoteTags: mocks.reorderQuickNoteTags,
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measure: () => undefined,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import type { QuickNoteTag } from "../../core/quickNoteTags";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { MobileQuickNote } from "../home/HomePage";
import { HomePage } from "../home/HomePage";
import { TagsHomeTab } from "./TagsHomeTab";

const T = "2026-11-01T00:00:00.000Z";
const tag = (id: string, name: string): QuickNoteTag => ({ id, name, createdAt: T, updatedAt: T });
const doc = (id: string, title: string, updatedAt: string): LocalNoteSummary => ({ id, title, updatedAt } as unknown as LocalNoteSummary);
const quick = (id: string, previewText: string, updatedAt: string, tagIds: string[] = []): MobileQuickNote => ({
  id, createdAt: T, updatedAt, previewText, imageCount: 0, firstImage: null, tags: [], tagIds,
});

// 设备本地顺序：灵感 在前、工作 在后（组件不得重新排序）。
const TAGS = [tag("t_b", "灵感"), tag("t_a", "工作")];
const NOTES = [
  doc("n1", "周报", "2026-11-05T08:00:00.000Z"),
  doc("n2", "月报", "2026-11-04T08:00:00.000Z"),
  doc("n3", "无关文档", "2026-11-03T08:00:00.000Z"),
];
const QUICKS = [
  quick("q1", "想法一", "2026-11-06T09:00:00.000Z", ["t_a"]),
  quick("q2", "想法二", "2026-11-02T09:00:00.000Z", ["t_b"]),
];
const LINKS = { n1: ["t_a"], n2: ["t_a", "t_b"] };

class IntersectionObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

let host: HTMLDivElement;
let root: Root;
const onOpenNote = vi.fn();
const onOpenQuickNote = vi.fn();
const onChanged = vi.fn(async () => undefined);

const renderTab = async (over: { active?: boolean; tags?: QuickNoteTag[] } = {}): Promise<void> => {
  await act(async () => {
    root.render(
      <TagsHomeTab
        tags={over.tags ?? TAGS}
        notes={NOTES}
        quickNotes={QUICKS}
        active={over.active ?? true}
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
const byAria = (label: string): HTMLElement | null => host.querySelector('[aria-label="' + label + '"]');
const byText = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").trim() === text);
/** Sheet 底部按钮（与页头同名的「新建」必须区分开）。 */
const sheetButton = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((el) => (el.textContent ?? "").trim() === text);
const rowByText = (text: string): HTMLElement | null =>
  [...host.querySelectorAll<HTMLElement>(".mb-row")].find((el) => (el.textContent ?? "").includes(text)) ?? null;
const rowTitles = (): string[] => [...host.querySelectorAll<HTMLElement>(".mb-row__title")].map((el) => el.textContent ?? "");
const typeInto = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} unobserve(): void {} });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.listNoteTagLinks.mockReset();
  mocks.listNoteTagLinks.mockResolvedValue(LINKS);
  for (const fn of [mocks.setNoteTags, mocks.setQuickNoteTags, mocks.updateQuickNoteTag, mocks.deleteQuickNoteTag, mocks.mergeQuickNoteTags, mocks.reorderQuickNoteTags]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
  mocks.createQuickNoteTag.mockClear();
  mocks.showToast.mockReset();
  mocks.confirmMobile.mockClear();
  onOpenNote.mockReset();
  onOpenQuickNote.mockReset();
  onChanged.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (document as unknown as Record<string, unknown>).elementFromPoint;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("一级「标签」页", () => {
  it("列表：按设备本地顺序展示，行内「N 篇文档、M 条小记」", async () => {
    await renderTab();
    expect(rowTitles()).toEqual(["灵感", "工作"]);
    expect(rowByText("工作")!.textContent).toContain("2 篇文档、1 条小记");
    expect(rowByText("灵感")!.textContent).toContain("1 篇文档、1 条小记");
    expect(byAria("管理标签")).toBeTruthy();
    expect(byAria("新建标签")).toBeTruthy();
  });

  it("空态：还没有标签（引导新建或去文档/小记里加）", async () => {
    await renderTab({ tags: [] });
    expect(host.textContent).toContain("还没有标签。新建一个标签，或在文档 / 小记里添加标签。");
  });

  it("目录不可用：可读提示 + 重试（恢复后正常出列表）", async () => {
    mocks.listNoteTagLinks.mockRejectedValueOnce(new Error("标签库不可用"));
    await renderTab();
    expect(host.textContent).toContain("标签目录暂不可用");
    expect(host.textContent).toContain("标签库不可用");
    await click(byText("重试"));
    expect(mocks.listNoteTagLinks).toHaveBeenCalledTimes(2);
    expect(rowTitles()).toEqual(["灵感", "工作"]);
  });

  it("详情：文档/小记分组、各自倒序；点行打开对应内容", async () => {
    await renderTab();
    await click(rowByText("工作"));
    // 文档段按 updatedAt 倒序（n1 比 n2 新）；小记在后
    expect(rowTitles()).toEqual(["全部标签", "周报", "月报", "想法一"]);
    await click(rowByText("周报"));
    expect(onOpenNote).toHaveBeenCalledWith("n1");
    await click(rowByText("想法一"));
    expect(onOpenQuickNote).toHaveBeenCalledWith("q1");
  });

  it("详情：行内移除标签 —— 文档 setNoteTags(剩余)、小记 setQuickNoteTags(剩余)，成功后刷新", async () => {
    await renderTab();
    await click(rowByText("工作"));
    await click(byAria("从「工作」移除「月报」"));
    expect(mocks.setNoteTags).toHaveBeenCalledWith("n2", ["t_b"]);
    expect(mocks.listNoteTagLinks).toHaveBeenCalledTimes(2); // 首读 + 移除后重读
    expect(onChanged).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("已移除标签");

    await click(byAria("从「工作」移除「想法一」"));
    expect(mocks.setQuickNoteTags).toHaveBeenCalledWith("q1", []);
  });

  it("详情：移除失败给可见提示（不静默、保留原行）", async () => {
    mocks.setNoteTags.mockRejectedValueOnce(new Error("数据库忙"));
    await renderTab();
    await click(rowByText("工作"));
    await click(byAria("从「工作」移除「周报」"));
    const [message, options] = mocks.showToast.mock.calls[0] as [string, { type?: string }];
    expect(message).toContain("移除标签失败");
    expect(message).toContain("数据库忙");
    expect(options?.type).toBe("error");
    expect(rowTitles()).toContain("周报");
  });

  it("「＋新建」：弹输入 → 落库 → 刷新（同名再建就地报错、不调桥）", async () => {
    await renderTab();
    await click(byAria("新建标签"));
    const input = host.querySelector('input[aria-label="新标签名称"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await typeInto(input, "  工作区  ");
    await click(sheetButton("新建"));
    expect(mocks.createQuickNoteTag).toHaveBeenCalledWith("工作区");
    expect(onChanged).toHaveBeenCalled();

    mocks.createQuickNoteTag.mockClear();
    await click(byAria("新建标签"));
    await typeInto(host.querySelector('input[aria-label="新标签名称"]') as HTMLInputElement, "工作");
    await click(sheetButton("新建"));
    expect(mocks.createQuickNoteTag).not.toHaveBeenCalled();
    expect(host.textContent).toContain("已有同名标签");
  });

  it("管理态：重命名 / 合并（桌面同文案）/ 删除二次确认（带引用计数）", async () => {
    await renderTab();
    await click(byAria("管理标签"));
    expect(host.textContent).toContain("长按拖动可排序");
    // 重命名
    await click(byAria("更多操作 工作"));
    await click(byText("重命名"));
    const input = host.querySelector('input[aria-label="标签名"]') as HTMLInputElement;
    await typeInto(input, "工作区");
    await click(byText("保存"));
    expect(mocks.updateQuickNoteTag).toHaveBeenCalledWith("t_a", { name: "工作区" });

    // 合并：目标列表 + 桌面同款提示
    await click(byAria("更多操作 灵感"));
    await click(byText("合并到…"));
    expect(host.textContent).toContain("合并后源标签消失；文档与小记会保留，引用改到目标标签。");
    await click([...host.querySelectorAll(".qn-tag-sheet__item")].find((el) => (el.textContent || "").startsWith("工作")) ?? null);
    expect(mocks.mergeQuickNoteTags).toHaveBeenCalledWith("t_b", "t_a");
    const mergeOptions = mocks.confirmMobile.mock.calls[0]?.[0] as { body?: string };
    expect(mergeOptions.body).toBe("合并后源标签消失；文档与小记会保留，引用改到目标标签。");

    // 删除：桌面原句（引用 N 篇文档、M 条小记）
    mocks.confirmMobile.mockClear();
    await click(byAria("更多操作 工作"));
    await click(byText("删除"));
    const options = mocks.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string };
    expect(options.title).toBe("删除标签「工作」？");
    expect(options.body).toBe("会同时移除文档与小记上的该标签（引用 2 篇文档、1 条小记）；文档与小记本身不会被删除。");
    expect(mocks.deleteQuickNoteTag).toHaveBeenCalledWith("t_a");
  });

  it("管理态：长按拖拽排序 → reorderQuickNoteTags(新顺序)", async () => {
    await renderTab();
    await click(byAria("管理标签"));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-tag-id]")];
    expect(rows.length).toBe(2);
    const [first, second] = rows; // 灵感、工作
    first.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    second.getBoundingClientRect = () => ({ top: 40, bottom: 80, height: 40, left: 0, right: 300, width: 300, x: 0, y: 40, toJSON: () => ({}) } as DOMRect);
    // 长按第一行
    await act(async () => {
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [{ clientX: 10, clientY: 10 }] });
      first.dispatchEvent(start);
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    // 拖到第二行下半（松手落点在「工作」之后）
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => second });
    await act(async () => {
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(move, "touches", { value: [{ clientX: 10, clientY: 70 }] });
      document.dispatchEvent(move);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      document.dispatchEvent(new Event("touchend", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.reorderQuickNoteTags).toHaveBeenCalledWith(["t_a", "t_b"]);
  });

  it("不在这一页（active=false）时不读关系", async () => {
    await renderTab({ active: false });
    expect(mocks.listNoteTagLinks).not.toHaveBeenCalled();
  });
});

describe("首页三 tab（小记 / 知识库 / 标签）", () => {
  const onTabChange = vi.fn();
  const renderHome = async (tab: "quick" | "library" | "tags"): Promise<void> => {
    await act(async () => {
      root.render(
        <HomePage
          tab={tab}
          notebooks={[]}
          notes={NOTES}
          quickNotes={QUICKS}
          tagDirectory={TAGS}
          docCounts={{}}
          onTabChange={onTabChange}
          onOpenNotebook={() => {}}
          onOpenNote={() => {}}
          onOpenQuickNote={() => {}}
          onTagsChanged={async () => undefined}
          onOpenDrawer={() => {}}
          onOpenSearch={() => {}}
          onCreateNotebook={() => {}}
          onCreateNote={() => {}}
          onTreeChanged={async () => {}}
          onQuickNotesChanged={async () => {}}
          onQuickNoteTagsChanged={async () => {}}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const tabButton = (label: string): HTMLButtonElement | undefined =>
    [...host.querySelectorAll<HTMLButtonElement>(".mobile-htab")].find((el) => (el.textContent ?? "").trim() === label);

  beforeEach(() => { onTabChange.mockReset(); });

  it("顶部有三个一级 tab；点「标签」/「知识库」切 tab", async () => {
    await renderHome("quick");
    expect([...host.querySelectorAll(".mobile-htab")].map((el) => el.textContent)).toEqual(["小记", "知识库", "标签"]);
    await click(tabButton("标签"));
    expect(onTabChange).toHaveBeenCalledWith("tags");
    await click(tabButton("知识库"));
    expect(onTabChange).toHaveBeenCalledWith("library");
  });

  it("切到「标签」页：三页常驻，标签页内容可渲染（列表行可见）", async () => {
    await renderHome("tags");
    expect(host.textContent).toContain("灵感");
    expect(host.textContent).toContain("1 篇文档、1 条小记");
    expect(host.textContent).toContain("2 篇文档、1 条小记");
    // 非活动页 inert：小记/知识库两页对读屏与焦点不可及
    const panes = [...host.querySelectorAll<HTMLElement>(".mobile-tab-pane")];
    expect(panes.length).toBe(3);
    expect(panes[0].hasAttribute("inert")).toBe(true);
    expect(panes[1].hasAttribute("inert")).toBe(true);
    expect(panes[2].hasAttribute("inert")).toBe(false);
  });
});
