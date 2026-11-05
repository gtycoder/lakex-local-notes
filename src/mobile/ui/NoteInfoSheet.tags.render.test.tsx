// @vitest-environment jsdom
/**
 * 文档属性面板的**只读**标签 chips（261105 P1）：
 * 有标签才显示区块；目录缺失 id 只提示不渲染；目录/桥不可用降级提示但不影响其它内容（字段缺失不崩）。
 * 编辑入口不做（只读展示），本用例同时锁住「没有编辑按钮」。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({ getNoteInfo: vi.fn(), openAttachment: vi.fn() }));
const bridgeMock = vi.hoisted(() => ({ listQuickNoteTags: vi.fn() }));
const tagReadsMock = vi.hoisted(() => ({ loadNoteTagIdsForNotes: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/native", () => ({ native: nativeMock }));
vi.mock("../bridge", () => ({ bridge: bridgeMock }));
vi.mock("../bridge/noteTagReads", () => tagReadsMock);
vi.mock("./toastBus", () => ({ showToast: toastMock }));
vi.mock("./MobileSheet", () => ({
  MobileSheet: ({ children, title }: { children: unknown; title?: unknown }) => (
    <div data-testid="sheet"><div>{String(title ?? "")}</div>{children as never}</div>
  ),
}));

import { NoteInfoSheet } from "./NoteInfoSheet";

const INFO = {
  id: "n1",
  title: "文档一",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-02T00:00:00.000Z",
  charCount: 3,
  wordCount: 3,
  assets: [],
  assetTotalBytes: 0,
  history: [],
  parentPath: "",
  cardStats: [],
};

const DIR = [{ id: "t_work", name: "工作" }, { id: "t_idea", name: "灵感" }];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

async function render(noteFileId: string | null = "n1"): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<NoteInfoSheet noteFileId={noteFileId} title="文档一" onClose={() => undefined} onOpenHistory={() => undefined} />);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nativeMock.getNoteInfo.mockReset().mockResolvedValue(INFO);
  nativeMock.openAttachment.mockReset().mockResolvedValue({ ok: true });
  tagReadsMock.loadNoteTagIdsForNotes.mockReset().mockResolvedValue({ n1: ["t_idea", "t_work"] });
  bridgeMock.listQuickNoteTags.mockReset().mockResolvedValue(DIR);
  toastMock.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

const tagChipTexts = (): string[] =>
  [...host.querySelectorAll('[role="listitem"]')].map((el) => (el.textContent ?? "").trim());

describe("NoteInfoSheet 文档标签（只读）", () => {
  it("按本机顺序显示 chips（名称来自标签目录），且没有编辑入口", async () => {
    await render();
    expect(host.textContent).toContain("标签 2");
    expect(tagChipTexts()).toEqual(["灵感", "工作"]);
    // 只读：没有「添加标签 / 编辑标签」按钮
    expect(host.textContent).not.toContain("添加标签");
    expect(host.textContent).not.toContain("编辑标签");
  });

  it("无标签 ⇒ 整个标签区块不显示（空态不占位）", async () => {
    tagReadsMock.loadNoteTagIdsForNotes.mockResolvedValue({});
    await render();
    expect(host.textContent).not.toContain("标签");
    expect(tagChipTexts()).toEqual([]);
  });

  it("目录里没有的 id（他端已删/未同步）⇒ 不渲染 chip，只给一句降级提示（字段缺失不崩）", async () => {
    tagReadsMock.loadNoteTagIdsForNotes.mockResolvedValue({ n1: ["t_work", "t_gone"] });
    await render();
    expect(tagChipTexts()).toEqual(["工作"]);
    expect(host.textContent).toContain("另有 1 个标签不在本机目录中");
    // 属性其余部分照常渲染
    expect(host.textContent).toContain("文档 ID");
  });

  it("标签目录/桥不可用 ⇒ 降级提示，属性面板其余内容照常（不抛、不白屏）", async () => {
    bridgeMock.listQuickNoteTags.mockRejectedValue(new Error("目录库忙"));
    await render();
    expect(host.textContent).toContain("标签信息暂不可用");
    expect(host.textContent).toContain("目录库忙");
    expect(host.textContent).toContain("文档 ID");
  });
});
