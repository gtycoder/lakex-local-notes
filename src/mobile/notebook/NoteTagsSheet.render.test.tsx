// @vitest-environment jsdom
/**
 * 261105 晚：目录行「标签…」弹层（NoteTagsSheet）；261106 文案统一为「标签」（标题 / 无障碍名同源）。
 * 多选/取消 + 新建标签；保存 = bridge.setNoteTags（移动桥单库写关系）；失败明确提示、不静默关闭。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listQuickNoteTags: vi.fn(),
  listNoteTagLinks: vi.fn(),
  setNoteTags: vi.fn(),
  createQuickNoteTag: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    listQuickNoteTags: mocks.listQuickNoteTags,
    listNoteTagLinks: mocks.listNoteTagLinks,
    setNoteTags: mocks.setNoteTags,
    createQuickNoteTag: mocks.createQuickNoteTag,
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../ui/MobileSheet", () => ({
  MobileSheet: ({ children, title }: { children: unknown; title?: unknown }) => (
    <div data-testid="sheet"><div>{String(title ?? "")}</div>{children as never}</div>
  ),
}));

import { NoteTagsSheet } from "./NoteTagsSheet";

const DIR = [
  { id: "t_aaaaaaaaaaaaaaaa", name: "工作", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
  { id: "t_bbbbbbbbbbbbbbbb", name: "灵感", createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
const closed: number[] = [];

async function render(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<NoteTagsSheet open note={{ id: "n1", title: "文档一", kind: "note", parentId: "nb1", sortOrder: 0, icon: null }} onClose={() => closed.push(1)} />);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const tagButtons = (): HTMLButtonElement[] => [...host.querySelectorAll(".qn-tag-sheet__item")] as HTMLButtonElement[];
const byText = (name: string): HTMLButtonElement => tagButtons().find((el) => (el.textContent ?? "").includes(name))!;
/** 任意按钮按文字找（保存/取消/新建在 footer 或输入行，不属于标签行）。 */
const buttonByText = (name: string): HTMLButtonElement =>
  [...host.querySelectorAll("button")].find((el) => (el.textContent ?? "").trim() === name) as HTMLButtonElement;
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); }); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  closed.length = 0;
  mocks.listQuickNoteTags.mockReset().mockResolvedValue(DIR);
  mocks.listNoteTagLinks.mockReset().mockResolvedValue({ n1: ["t_aaaaaaaaaaaaaaaa"] });
  mocks.setNoteTags.mockReset().mockResolvedValue({ tagIds: ["t_aaaaaaaaaaaaaaaa"] });
  mocks.createQuickNoteTag.mockReset().mockResolvedValue({ id: "t_cccccccccccccccc", name: "新标签", createdAt: "x", updatedAt: "x" });
  mocks.showToast.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("NoteTagsSheet（文档标签多选）", () => {
  it("标题 =「标签 · <文档标题>」，不再出现「打标签」（无标题时就是「标签」）", async () => {
    await render();
    // MobileSheet 以字符串标题同时作为 role=dialog 的无障碍名（单点派生，不另写 ariaLabel）。
    expect(host.textContent).toContain("标签 · 文档一");
    expect(host.textContent).not.toContain("打标签");
  });

  it("按目录顺序列出全部标签；已关联的预选（aria-pressed）", async () => {
    await render();
    expect(tagButtons().map((el) => (el.textContent ?? "").replace(/\s+/g, ""))).toEqual(["工作", "灵感"]);
    expect(byText("工作").getAttribute("aria-pressed")).toBe("true");
    expect(byText("灵感").getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toContain("已选 1");
  });

  it("取消/新增选择；保存调用 setNoteTags（新选的插最前）并关闭", async () => {
    await render();
    await click(byText("灵感"));
    expect(byText("灵感").getAttribute("aria-pressed")).toBe("true");
    await click(byText("工作"));
    expect(byText("工作").getAttribute("aria-pressed")).toBe("false");
    await act(async () => { buttonByText("保存").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.setNoteTags).toHaveBeenCalledWith("n1", ["t_bbbbbbbbbbbbbbbb"]);
    expect(mocks.showToast).toHaveBeenCalledWith("已保存标签");
    expect(closed.length).toBe(1);
  });

  it("保存失败 ⇒ 明确报错，不关闭（用户可重试）", async () => {
    mocks.setNoteTags.mockRejectedValue(new Error("标签不存在或已删除"));
    await render();
    await click(buttonByText("保存"));
    expect(mocks.showToast).toHaveBeenCalledWith("保存标签失败：标签不存在或已删除", { type: "error" });
    expect(closed.length).toBe(0);
  });

  it("新建标签：输入名称 → 新建并选中（插到最前）", async () => {
    await render();
    const input = host.querySelector("input[aria-label=\"标签名\"]") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "新标签");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const createBtn = [...host.querySelectorAll("button")].find((el) => (el.textContent ?? "").includes("新建并选中")) as HTMLButtonElement;
    expect(createBtn).toBeTruthy();
    await click(createBtn);
    expect(mocks.createQuickNoteTag).toHaveBeenCalledWith("新标签");
    expect(host.textContent).toContain("已选 2");
  });

  it("读取中给加载态；读取失败降级提示（不白屏）", async () => {
    let rejectRead: ((reason: unknown) => void) | null = null;
    mocks.listNoteTagLinks.mockReturnValue(new Promise((_resolve, reject) => { rejectRead = reject; }));
    await render();
    expect(host.textContent).toContain("读取中…");
    await act(async () => { rejectRead!(new Error("目录库忙")); await Promise.resolve(); });
    expect(host.textContent).toContain("目录库忙");
  });
});
