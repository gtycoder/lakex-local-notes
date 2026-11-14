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
const CARD_SRC = readSource("src/mobile/tags/TagQuickNoteCard.tsx");
const QN_CSS = readSource("src/mobile/quick-notes.css");
const MOBILE_CSS = readSource("src/mobile/mobile.css");

/** ResizeObserver 桩：记录实例与观察目标，测试里可手动 trigger 复现「内容长高」。 */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly targets: Element[] = [];
  constructor(private readonly callback?: ResizeObserverCallback) { ResizeObserverStub.instances.push(this); }
  observe(target?: Element): void { if (target) this.targets.push(target); }
  disconnect(): void {}
  unobserve(): void {}
  trigger(): void { this.callback?.([], this as unknown as ResizeObserver); }
}

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
/** 小记卡自己的「展开/收起」（在裁切区外，是 .mb-set-item__main 的直接子按钮）。 */
const expandToggle = (): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>(".mb-set-item__main > .quick-note-preview-toggle")][0];
/**
 * 模拟真机的「内容真实高度 / 被裁后的可视高度」并触发一次 ResizeObserver 复测。
 * 卡片未展开时 clientHeight = 被 max-height 夹住的 180（判定 scrollHeight > clientHeight + 2 才有意义）。
 */
const setCardScrollHeight = async (scrollHeight: number): Promise<void> => {
  const card = host.querySelector<HTMLElement>(".tag-quick-card");
  expect(card).not.toBeNull();
  (card as HTMLElement & { __scrollHeight?: number; __clientHeight?: number }).__scrollHeight = scrollHeight;
  (card as HTMLElement & { __clientHeight?: number }).__clientHeight = 180;
  // 页面上有多个 RO（卡片判溢出 + 富预览自身的折叠测量）：全部触发一次，等价于真机上内容长高。
  await act(async () => {
    for (const ro of ResizeObserverStub.instances) ro.trigger();
    await Promise.resolve();
  });
};
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
  ResizeObserverStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement & { __clientHeight?: number }) { return this.__clientHeight ?? 800; },
  });
  // scrollHeight 默认 0（不溢出）；需要模拟「内容超限」时给单个元素打 __scrollHeight 再手动触发 RO。
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement & { __scrollHeight?: number }) { return this.__scrollHeight ?? 0; },
  });
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

  it("标准页头：大标题「标签」+ 数量小字 + 右上仅「＋」；常驻长按说明已删除", async () => {
    await renderTab();
    const head = host.querySelector("header.mobile-settings-head.mobile-page-head");
    expect(head).not.toBeNull();
    expect(head!.querySelector(".mobile-settings-title")!.textContent).toContain("标签");
    expect(head!.textContent).toContain("2 个");
    const buttons = [...head!.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["新建标签"]);
    expect(buttons[0].className).toContain("mb-iconbtn"); // 44 命中
    expect(listRows().length).toBe(2);
    // 常驻说明已删（不再有这句噪音）
    expect(host.textContent).not.toContain("长按可拖动排序");
    expect(TAB_SRC).not.toContain("长按可拖动排序");
  });

  it("列表行 = 一个白色强调块（.mb-set-section，行间发丝）；页头在块外、不套双层卡", async () => {
    await renderTab();
    expect(host.querySelector(".mobile-scroll")).not.toBeNull();
    const sections = [...host.querySelectorAll<HTMLElement>(".mb-set-section")];
    expect(sections.length).toBe(1);                                  // 列表只有一个白块
    expect(sections[0].querySelectorAll(":scope > .mb-set-item[data-tag-id]").length).toBe(2);
    // 页头不在卡片里
    const head = host.querySelector("header.mobile-settings-head")!;
    expect(sections[0].contains(head)).toBe(false);
    expect(head.querySelector(".mb-set-section")).toBeNull();
    // 不双层套卡
    expect(sections[0].querySelector(".mb-set-section")).toBeNull();
    // 块外仍有页面内距（与设置页分组同一容器约定）
    expect(host.querySelector(".mobile-quick-cards > .mb-set-section")).not.toBeNull();
    for (const cls of ["mobile-scroll", "mobile-settings-head", "mobile-quick-cards", "mb-set-section", "mb-set-item", "mb-iconbtn", "mb-empty"]) {
      expect(TAB_SRC).toContain(cls);
    }
    for (const invented of ["tags-page", "tags-row", "tag-list", "tags-list", "tag-detail-page"]) {
      expect(TAB_SRC).not.toContain(invented);
    }
  });

  it("详情：文档 / 小记 = 两个白块，段标题在各自块内；副标题在块外；不双层套卡", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    await click(rowMain("工作"));
    const sections = [...host.querySelectorAll<HTMLElement>(".mb-set-section")];
    expect(sections.length).toBe(2);
    const [docBlock, quickBlock] = sections;
    expect(docBlock.querySelector(":scope > .mb-set-section__title")!.textContent).toBe("文档（2）");
    expect(quickBlock.querySelector(":scope > .mb-set-section__title")!.textContent).toBe("小记（1）");
    // 段标题在自己块内、行也在同一个块内
    expect(docBlock.querySelectorAll(":scope > .mb-set-item").length).toBe(2);
    expect(quickBlock.querySelectorAll(":scope > .mb-set-item").length).toBe(1);
    // 副标题在块外
    const subtitle = host.querySelector(".tag-detail-sub")!;
    expect(subtitle).not.toBeNull();
    expect(sections.some((section) => section.contains(subtitle))).toBe(false);
    // 不双层套卡（小记卡自身不是又一个 mb-set-section）
    expect(host.querySelector(".mb-set-section .mb-set-section")).toBeNull();
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
    const imgSrc = img!.getAttribute("src") ?? "";
    expect(imgSrc).toContain("pic.png");
    // 261111 图片缩略第二步：列表式富预览的图片也走资产服务离散档位（与首页卡片同 helper）。
    expect(imgSrc).toContain("w=1024");

    // 点勾选框：只读、不切换，也不触发打开小记。
    const opened = onOpenQuickNote.mock.calls.length;
    await click(box);
    expect(onOpenQuickNote.mock.calls.length).toBe(opened);
    // 点卡片其它位置：打开小记。
    await click(byAria("打开小记 想法一"));
    expect(onOpenQuickNote).toHaveBeenCalledWith("q1");
  });

  it("详情 = 独立页头（返回 / 标签名 / ⋯）+ 副标题计数；不再出现列表页头与「＋」", async () => {
    await renderTab();
    // 列表页：没有返回，页头只有「＋」
    expect(byAria("返回标签列表")).toBeNull();
    expect(host.querySelectorAll("header.mobile-settings-head").length).toBe(1);

    await click(rowMain("工作"));
    const headers = host.querySelectorAll<HTMLElement>("header.mobile-settings-head");
    expect(headers.length).toBe(1); // 列表页头整块消失，只剩详情页头
    const head = headers[0];
    expect(head.querySelector(".mobile-settings-title")!.textContent).toBe("工作");
    expect([...head.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")))
      .toEqual(["返回标签列表", "标签操作 工作"]);
    // 详情没有「＋新建」
    expect(byAria("新建标签")).toBeNull();
    // 副标题计数 + 两个分区（各带计数）
    expect(host.textContent).toContain("2 篇文档、1 条小记");
    expect(host.textContent).toContain("文档（2）");
    expect(host.textContent).toContain("小记（1）");
    // 返回按钮回到列表
    await click(byAria("返回标签列表"));
    expect(inDetail()).toBe(false);
    expect(byAria("新建标签")).toBeTruthy();
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
    // × 只在右侧独立列（__ctl）里；卡片底部没有额外动作行。
    const quickRow = host.querySelector('.mb-set-item__main[aria-label="打开小记 想法一"]')!.closest(".mb-set-item")!;
    const ctlButtons = [...quickRow.querySelectorAll<HTMLElement>(".mb-set-item__ctl button")];
    expect(ctlButtons.map((el) => el.getAttribute("aria-label"))).toEqual(["移除标签「想法一」"]);
    expect(quickRow.querySelectorAll(".mb-set-item__ctl .mb-iconbtn").length).toBe(1);

    // 详情注册了返回栈：consumeBack 先回列表（不会落到「两次返回退出」）。
    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(inDetail()).toBe(false);
    expect(listRows().length).toBeGreaterThan(0);
  });

  it("小记卡：内容不超 180 ⇒ 不出现「展开」按钮（判的是卡片本体 scrollHeight，不是父容器）", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    await click(rowMain("工作"));
    await setCardScrollHeight(120);
    expect(expandToggle()).toBeUndefined();
    // 短内容：不溢出 ⇒ 不加 is-clipped（渐隐只由 CSS 的 .is-clipped 触发）。
    expect(host.querySelector(".tag-quick-card")!.className).not.toContain("is-clipped");

    // 静态防回归：判据是「卡片本体 scrollHeight > clientHeight + 2」，RO 观察内容子节点，且有 rAF 复测。
    expect(CARD_SRC).toContain("const el = cardRef.current");
    expect(CARD_SRC).toContain("el.scrollHeight > el.clientHeight + OVERFLOW_SLACK_PX");
    expect(CARD_SRC).toContain("ro?.observe(contentRef.current)");
    expect(CARD_SRC).toContain("requestAnimationFrame(measure)");
    // 渐隐只在 .is-clipped 时画（短内容不会出现那层渐变）。
    expect(QN_CSS).toContain(".tag-quick-card.is-clipped::after");
    expect(QN_CSS).not.toMatch(/\.tag-quick-card::after/);
    expect(QN_CSS).toContain(".tag-quick-card {");
  });

  it("小记卡：内容超 180 ⇒ 出现「展开」，点击 → is-expanded + 「收起」，再点恢复", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    await click(rowMain("工作"));
    await setCardScrollHeight(400);
    // 长内容：真的被裁 ⇒ is-clipped（渐隐）+ 展开按钮。
    expect(host.querySelector(".tag-quick-card")!.className).toContain("is-clipped");
    const toggle = expandToggle();
    expect(toggle).toBeTruthy();
    expect(toggle!.textContent?.trim()).toBe("展开");
    // 按钮在裁切区之外（不是 .tag-quick-card 的后代）⇒ 卡片被裁也不影响可点。
    expect(host.querySelector(".tag-quick-card")!.contains(toggle!)).toBe(false);
    await click(toggle);
    const expandedClass = host.querySelector(".tag-quick-card")!.className;
    expect(expandedClass).toContain("is-expanded");
    expect(expandedClass).not.toContain("is-clipped"); // 展开后限制解除、渐隐消失
    expect(expandToggle()!.textContent?.trim()).toBe("收起");
    await click(expandToggle());
    const collapsedClass = host.querySelector(".tag-quick-card")!.className;
    expect(collapsedClass).not.toContain("is-expanded");
    expect(collapsedClass).toContain("is-clipped");    // 收起后重新裁切
    expect(expandToggle()!.textContent?.trim()).toBe("展开");
  });

  it("小记卡：正文异步到达后能从「无按钮」→「有按钮」（readQuickNote 延迟 resolve + 内容长高）", async () => {
    let resolveDetail!: (value: unknown) => void;
    mocks.readQuickNote.mockImplementationOnce(() => new Promise((resolve) => { resolveDetail = resolve; }));
    await renderTab({ tags: [tag("t_a", "工作")] });
    await click(rowMain("工作"));
    expect(host.querySelector(".tag-quick-card")).not.toBeNull();
    await setCardScrollHeight(40); // 只有回落摘要，未溢出
    expect(expandToggle()).toBeUndefined();
    expect(host.querySelector(".tag-quick-card")!.className).not.toContain("is-clipped");

    // 正文到达（异步）+ 内容长高（RO 由内容子节点触发）⇒ 复测后出现「展开」。
    await act(async () => {
      resolveDetail({
        id: "q1",
        content: { text: "1111", body: RICH_BODY, images: [PIC] },
        tagIds: [], tags: [], previewText: "想法一", updatedAt: "2026-11-06T09:00:00.000Z",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await setCardScrollHeight(400);
    expect(host.querySelector(".tag-quick-card")!.className).toContain("is-clipped");
    expect(expandToggle()).toBeTruthy();
  });

  it("间距：副标题用既有间距令牌（块外、横向页内距 16）；段标题改用块内 .mb-set-section__title", async () => {
    await renderTab({ tags: [tag("t_a", "工作")] });
    await click(rowMain("工作"));
    expect(host.querySelector(".tag-detail-sub")).not.toBeNull();
    expect(MOBILE_CSS).toContain(".tag-detail-sub");
    expect(MOBILE_CSS).toMatch(/\.tag-detail-sub \{[^}]*var\(--lake-space-/s);
    expect(MOBILE_CSS).toMatch(/\.tag-detail-sub \{[^}]*var\(--mb-page-pad\)/s);
    // 段标题现在用块内既有的 .mb-set-section__title（自定义 .tag-detail-section 已退役）
    expect(host.querySelectorAll(".mb-set-section__title").length).toBe(2);
    expect(TAB_SRC).not.toContain("tag-detail-section");
    expect(MOBILE_CSS).not.toContain(".tag-detail-section");
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
  // 261110：空间入口从顶栏文字 tab 下沉到【底部五格 Dock】；按 label 文本定位同一颗按钮。
  const tabButton = (label: string): HTMLButtonElement | undefined =>
    [...host.querySelectorAll<HTMLButtonElement>(".mb-home-dock__item")].find((el) => (el.textContent ?? "").trim() === label);

  beforeEach(() => { onTabChange.mockReset(); });

  it("五个一级空间（底部 Dock）与切页回调；标签页 panes 常驻 + inert", async () => {
    await renderHome("quick");
    expect([...host.querySelectorAll(".mb-home-dock__label")].map((el) => el.textContent)).toEqual(["知识库", "小记", "标签", "AI", "日记"]);
    await click(tabButton("标签"));
    expect(onTabChange).toHaveBeenCalledWith("tags");
    await renderHome("tags");
    expect(host.textContent).toContain("1 篇文档、1 条小记");
    const panes = [...host.querySelectorAll<HTMLElement>(".mobile-tab-pane")];
    expect(panes.length).toBe(5);
    // pane 顺序 = HOME_TABS（知识库 / 小记 / 标签 / AI / 日记）；只有当前页不是 inert。
    expect(panes[0].hasAttribute("inert")).toBe(true);
    expect(panes[2].hasAttribute("inert")).toBe(true);
    expect(panes[3].hasAttribute("inert")).toBe(true);
    expect(panes[4].hasAttribute("inert")).toBe(false);
  });
});
