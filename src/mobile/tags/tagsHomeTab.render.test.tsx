// @vitest-environment jsdom
/**
 * 261106 用户验收：一级「标签」页（flomo 式：标签即入口；**没有「管理」模式**）。
 * 本轮（261106 三次返工）锁：行 ⋯ 菜单（重命名弹输入并全选 / 合并提示与实参 / 删除确认逐字）、
 * 行主区点击进详情、长按 350ms 拖拽排序（且拖拽后那次 click 不进详情）、详情行尾 × + 二次确认。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
  readQuickNote: vi.fn(),
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
    readQuickNote: mocks.readQuickNote,
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
import { consumeBack } from "../ui/backStack";
import { TagsHomeTab } from "./TagsHomeTab";

const readSource = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const TAB_SRC = readSource("src/mobile/tags/TagsHomeTab.tsx");

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

// 富预览正文：待办勾选框（1111）+ 一张图片卡（资源在 readQuickNote 的 images 里）。
const CHECKBOX = (state: "true" | "false") => '<card type="inline" name="checkbox" value="data:' + state + '"></card>';
const RICH_BODY = '<ul class="lake-list"><li class="lake-list-node lake-list-task">' + CHECKBOX("false") + '<span>1111</span></li></ul>'
  + '<p><card type="inline" name="image" value="data:%7B%22src%22%3A%22pic.png%22%7D"></card></p>';
const PIC = { id: "pic.png", filename: "pic.png", mimeType: "image/png", width: 4, height: 4, size: 9, hash: "h" };

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
const byText = (text: string): HTMLElement | undefined =>
  [...host.querySelectorAll<HTMLElement>("button")].find((el) => (el.textContent ?? "").trim() === text);
/** Sheet 底部按钮（与页头同名的「新建」「保存」等要按容器取）。 */
const sheetButton = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((el) => (el.textContent ?? "").trim() === text);
/** 列表行（data-tag-id）+ 行主区（role=button）。 */
const listRows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".mb-set-item[data-tag-id]")];
const rowMain = (name: string): HTMLElement | null => host.querySelector('.mb-set-item__main[role="button"][aria-label="' + name + '"]');
const inDetail = (): boolean => host.querySelector('[aria-label="返回标签列表"]') !== null;
/** 详情聚合行标题（main role=button）。 */
const detailTitles = (): string[] =>
  [...host.querySelectorAll<HTMLElement>('.mb-set-item__main[role="button"]:not([aria-label])')].map((el) => el.querySelector(".mb-set-name")?.textContent ?? "");
const typeInto = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const openRowMenu = async (name: string): Promise<void> => { await click(byAria("标签操作 " + name)); };

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
  mocks.readQuickNote.mockReset();
  mocks.readQuickNote.mockImplementation(async (id: string) => ({
    id,
    content: {
      text: id === "q1" ? "1111" : "想法二",
      body: id === "q1" ? RICH_BODY : '<p>想法二</p>',
      images: id === "q1" ? [PIC] : [],
    },
    tagIds: [],
    tags: [],
    previewText: id === "q1" ? "想法一" : "想法二",
    updatedAt: "2026-11-06T09:00:00.000Z",
  }));
  for (const fn of [mocks.setNoteTags, mocks.setQuickNoteTags, mocks.updateQuickNoteTag, mocks.deleteQuickNoteTag, mocks.mergeQuickNoteTags, mocks.reorderQuickNoteTags]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
  mocks.createQuickNoteTag.mockClear();
  mocks.showToast.mockReset();
  mocks.confirmMobile.mockReset();
  mocks.confirmMobile.mockResolvedValue(true);
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

describe("标签页 · 交互骨架（无「管理」模式）", () => {
  it("页头只有「＋新建」；没有「管理/完成」切换；列表行固定「⋯」", async () => {
    await renderTab();
    expect(byAria("管理标签")).toBeNull();
    expect(byAria("完成标签管理")).toBeNull();
    expect(byAria("新建标签")).toBeTruthy();
    expect(TAB_SRC).not.toContain("完成标签管理");
    expect(TAB_SRC).not.toContain("管理标签");
    expect(listRows().length).toBe(2);
    expect(byAria("标签操作 灵感")).toBeTruthy();
    expect(byAria("标签操作 工作")).toBeTruthy();
    // 行首拖拽手柄 + 既有拖拽态类（复用 qn-tag-manager 判据）。
    expect(TAB_SRC).toContain("qn-tag-manager__row");
    expect(TAB_SRC).toContain("is-drop-before");
  });

  it("容器 = mobile-scroll + mobile-quick-cards；行/卡/按钮全用既有 mb-* 原语", async () => {
    await renderTab();
    expect(host.querySelector(".mobile-scroll .mobile-quick-cards")).not.toBeNull();
    expect(host.querySelector(".mb-set-section .mb-set-item")).not.toBeNull();
    for (const cls of ["mobile-scroll", "mobile-quick-cards", "mb-set-section", "mb-set-item", "mb-iconbtn", "mb-empty"]) {
      expect(TAB_SRC).toContain(cls);
    }
    for (const invented of ["tags-page", "tags-row", "tag-list", "tags-list", "tag-detail"]) {
      expect(TAB_SRC).not.toContain(invented);
    }
  });
});

describe("行 ⋯ 菜单（重命名 / 合并到… / 删除）", () => {
  it("点 ⋯ 弹出三项动作；点「⋯」不会进详情", async () => {
    await renderTab();
    await openRowMenu("工作");
    for (const label of ["重命名", "合并到…", "删除"]) expect(byText(label)).toBeTruthy();
    expect(inDetail()).toBe(false);
  });

  it("重命名：弹输入（预填 + 全选）→ 保存走 updateQuickNoteTag 并刷新", async () => {
    await renderTab();
    await openRowMenu("工作");
    await click(byText("重命名"));
    const input = host.querySelector('input[aria-label="标签名"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("工作");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2); // 全选当前名称
    await typeInto(input, "工作区");
    await click(sheetButton("保存"));
    expect(mocks.updateQuickNoteTag).toHaveBeenCalledWith("t_a", { name: "工作区" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("重命名：与已有标签同名 ⇒ 就地报错且不调桥", async () => {
    await renderTab();
    await openRowMenu("工作");
    await click(byText("重命名"));
    await typeInto(host.querySelector('input[aria-label="标签名"]') as HTMLInputElement, "灵感");
    await click(sheetButton("保存"));
    expect(mocks.updateQuickNoteTag).not.toHaveBeenCalled();
    expect(host.textContent).toContain("已有同名标签");
  });

  it("合并到…：提示与桌面同句，选目标后确认 → mergeQuickNoteTags(source, target)", async () => {
    await renderTab();
    await openRowMenu("工作");
    await click(byText("合并到…"));
    expect(host.textContent).toContain("合并后源标签消失；文档与小记会保留，引用改到目标标签。");
    await click(byAria("合并到 灵感"));
    const options = mocks.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string };
    expect(options.title).toContain("把「工作」合并到「灵感」");
    expect(options.body).toBe("合并后源标签消失；文档与小记会保留，引用改到目标标签。");
    expect(mocks.mergeQuickNoteTags).toHaveBeenCalledWith("t_a", "t_b");
    expect(onChanged).toHaveBeenCalled();
  });

  it("删除：二次确认文案与桌面逐字一致（引用计数），确认后 deleteQuickNoteTag", async () => {
    await renderTab();
    await openRowMenu("工作");
    await click(byText("删除"));
    const options = mocks.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string };
    expect(options.title).toBe("删除标签「工作」？");
    expect(options.body).toBe("会同时移除文档与小记上的该标签（引用 2 篇文档、1 条小记）；文档与小记本身不会被删除。");
    expect(mocks.deleteQuickNoteTag).toHaveBeenCalledWith("t_a");
    expect(onChanged).toHaveBeenCalled();
  });

  it("没有第二个标签时「合并到…」禁用", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    await openRowMenu("工作");
    const merge = byText("合并到…") as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
  });
});

describe("行主区 / 长按拖拽", () => {
  it("行主区点击进详情；详情主区点击打开文档 / 小记", async () => {
    await renderTab();
    await click(rowMain("工作"));
    expect(inDetail()).toBe(true);
    expect(host.textContent).toContain("文档（2）");
    expect(host.textContent).toContain("小记（1）");
    expect(detailTitles()).toEqual(["周报", "月报"]);
    await click(host.querySelector('.mb-set-item__main[role="button"]:not([aria-label])'));
    expect(onOpenNote).toHaveBeenCalledWith("n1");
    await click(byAria("返回标签列表"));
    await click(rowMain("工作"));
    await click(byAria("打开小记 想法一"));
    expect(onOpenQuickNote).toHaveBeenCalledWith("q1");
  });

  it("详情里小记用首页同一套富预览：待办 → 只读勾选框、媒体按卡片规则、正文按需 readQuickNote", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    expect(mocks.readQuickNote).not.toHaveBeenCalled(); // 列表页不读正文
    await click(rowMain("工作"));
    expect(mocks.readQuickNote).toHaveBeenCalledWith("q1");
    expect(mocks.readQuickNote).not.toHaveBeenCalledWith("n1"); // 文档行不需要正文
    const preview = host.querySelector(".quick-note-preview");
    expect(preview).not.toBeNull();
    // 待办 = 勾选框（只读），不再显示 "[ ] 1111"
    const box = preview!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box).toBeTruthy();
    expect(box!.readOnly).toBe(true);
    expect(preview!.textContent).toContain("1111");
    // 媒体卡按卡片规则渲染成图片（资源来自 readQuickNote 的 images）
    const img = preview!.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src") ?? "").toContain("pic.png");

    // 点勾选框：只读、不切换，也不触发打开小记。
    const opened = onOpenQuickNote.mock.calls.length;
    await click(box);
    expect(onOpenQuickNote.mock.calls.length).toBe(opened);
    // 点卡片其它位置：打开小记。
    await click(byAria("打开小记 想法一"));
    expect(onOpenQuickNote).toHaveBeenCalledWith("q1");
  });

  it("× 在行右侧（文档/小记同一套；小记卡不再有底部单独 ×）；详情返回键先回列表", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    await click(rowMain("工作"));
    const removeButtons = [...host.querySelectorAll<HTMLElement>('.mb-set-item__ctl [aria-label^="移除标签"]')];
    expect(removeButtons.map((el) => el.getAttribute("aria-label"))).toEqual(["移除标签「周报」", "移除标签「月报」", "移除标签「想法一」"]);
    for (const button of removeButtons) {
      expect(button.className).toContain("mb-iconbtn");   // 44×44 命中
      expect(button.textContent ?? "").toBe("");          // 只有图标
    }
    // 小记行只有这一个 ×（没有底部单独一条动作行）。
    const quickRow = host.querySelector('.mb-set-item__main[aria-label="打开小记 想法一"]')!.closest(".mb-set-item")!;
    expect(quickRow.querySelectorAll("button")).toHaveLength(1);

    // 详情注册了返回栈：consumeBack 先回列表（不会落到「两次返回退出」）。
    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(inDetail()).toBe(false);
    expect(listRows().length).toBeGreaterThan(0);
  });

  it("长按 350ms 拖拽 → reorderQuickNoteTags；拖拽后的那次 click 不进详情", async () => {
    await renderTab();
    const rows = listRows();
    expect(rows.length).toBe(2);
    const [first, second] = rows; // 灵感、工作
    first.getBoundingClientRect = () => ({ top: 0, bottom: 48, height: 48, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    second.getBoundingClientRect = () => ({ top: 48, bottom: 96, height: 48, left: 0, right: 300, width: 300, x: 0, y: 48, toJSON: () => ({}) } as DOMRect);
    await act(async () => {
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [{ clientX: 10, clientY: 10 }] });
      first.dispatchEvent(start);
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => second });
    await act(async () => {
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(move, "touches", { value: [{ clientX: 10, clientY: 80 }] });
      document.dispatchEvent(move);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      document.dispatchEvent(new Event("touchend", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.reorderQuickNoteTags).toHaveBeenCalledWith(["t_a", "t_b"]);
    expect(onChanged).toHaveBeenCalled();

    // 松手后浏览器会补一次 click：必须被吞掉，不能顺带进详情。
    await act(async () => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(inDetail()).toBe(false);
    // 下一次正常点击仍能进详情。
    await click(rowMain("灵感"));
    expect(inDetail()).toBe(true);
  });
});

describe("详情 / 新建 / 空态 / 降级", () => {
  it("详情行尾 = ×（IconButton/44 命中、aria 明确）；点击先二次确认，文案说明只删关联；取消不调桥", async () => {
    await renderTab();
    await click(rowMain("工作"));
    const removeBtn = byAria("移除标签「周报」");
    expect(removeBtn).toBeTruthy();
    expect(removeBtn!.className).toContain("mb-iconbtn");
    expect(removeBtn!.textContent ?? "").toBe("");
    mocks.confirmMobile.mockResolvedValueOnce(false);
    await click(removeBtn);
    expect(mocks.setNoteTags).not.toHaveBeenCalled();
    const options = mocks.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string };
    expect(options.title).toContain("移除标签「工作」");
    expect(options.body).toContain("仅");
    expect(options.body).toContain("不受影响");
    expect(options.body).toContain("标签本身");

    mocks.confirmMobile.mockResolvedValue(true);
    await click(byAria("移除标签「月报」"));
    expect(mocks.setNoteTags).toHaveBeenCalledWith("n2", ["t_b"]);
    expect(mocks.listNoteTagLinks).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledWith("已移除标签");
  });

  it("小记行 ×：确认后 setQuickNoteTags(剩余)；失败给 error toast", async () => {
    await renderTab();
    await click(rowMain("工作"));
    await click(byAria("移除标签「想法一」"));
    expect(mocks.setQuickNoteTags).toHaveBeenCalledWith("q1", []);

    mocks.showToast.mockClear();
    mocks.setNoteTags.mockRejectedValueOnce(new Error("数据库忙"));
    await click(byAria("移除标签「周报」"));
    const [message, options] = mocks.showToast.mock.calls[0] as [string, { type?: string }];
    expect(message).toContain("移除标签失败");
    expect(options?.type).toBe("error");
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

  it("空态与目录降级（提示 + 重试）", async () => {
    mocks.listNoteTagLinks.mockRejectedValueOnce(new Error("标签库不可用"));
    await renderTab();
    expect(host.textContent).toContain("标签目录暂不可用");
    await click(byText("重试"));
    expect(mocks.listNoteTagLinks).toHaveBeenCalledTimes(2);
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
    expect(listRows().length).toBe(2);
  });

  it("空目录文案", async () => {
    await renderTab({ tags: [] });
    expect(host.textContent).toContain("还没有标签。新建一个标签，或在文档 / 小记里添加标签。");
  });

  it("active=false 时不读关系", async () => {
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

  it("三个一级 tab 与切页回调；标签页三 pane 常驻 + inert", async () => {
    await renderHome("quick");
    expect([...host.querySelectorAll(".mobile-htab")].map((el) => el.textContent)).toEqual(["小记", "知识库", "标签"]);
    await click(tabButton("标签"));
    expect(onTabChange).toHaveBeenCalledWith("tags");
    await renderHome("tags");
    expect(host.textContent).toContain("1 篇文档、1 条小记");
    const panes = [...host.querySelectorAll<HTMLElement>(".mobile-tab-pane")];
    expect(panes.length).toBe(3);
    expect(panes[0].hasAttribute("inert")).toBe(true);
    expect(panes[2].hasAttribute("inert")).toBe(false);
  });
});
