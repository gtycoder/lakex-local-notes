// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrashItem } from "../../core/trashPolicy";

/**
 * 回收站「云端已删除（仅本地）」副本预览加固（task-89；用户报：点开右侧一直停在「选择左侧文档查看内容」）。
 *
 * 复现结论（Lead 内存远端复现）：listTrash 的 title/nodeType/noteFileId/hasFile 正常、readNote 正文可读
 * ⇒ 数据层没问题，问题在 UI 交互与边界。这里锁四件事：
 *  ① 整行可点：标题被「云端已删除（仅本地）」徽标挤窄时，点行内任意位置（不是标题文字）也进预览，
 *     并把正文交给 NoteDocPreview(policyKey="trash")；键盘 Enter 走同一条路径；
 *  ② noteFileId 缺失 / hasFile=false / readNote 回 bodyMissing 时不挂空 viewer，给可操作提示；
 *  ③ 无标题且无 deletedAt 时兜底「文档」，不留「无标题」/悬空分隔符；
 *  ④ 行内「恢复/彻底删除」是独立控件，点它们不能连带选中（否则删一篇先预览一篇）。
 * 内核无法在 vitest 里实例化 ⇒ mock NoteDocPreview 只取 props（真机行为由设备/E2E 覆盖）。
 */
const nativeMock = vi.hoisted(() => ({
  listTrash: vi.fn(),
  listQuickNoteTrash: vi.fn(),
  getS3GcSettings: vi.fn(),
  ensureTrashNoteAssets: vi.fn(),
  readNote: vi.fn(),
}));
const previewCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../../lib/native", () => ({ native: nativeMock }));
vi.mock("./NoteDocPreview", () => ({
  NoteDocPreview: (props: Record<string, unknown>) => { previewCalls.push(props); return <div data-testid="note-doc-preview" />; },
}));
vi.mock("./HistorySnapshotPreview", () => ({
  HistorySnapshotPreview: () => <div data-testid="history-preview" />,
}));

import { TrashPanel } from "./TrashPanel";

function trashItem(over: Partial<TrashItem> = {}): TrashItem {
  return {
    id: "n1",
    title: "会议纪要",
    nodeType: "note",
    noteFileId: "n1",
    parentId: null,
    deletedAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
    hasFile: true,
    purged: false,
    cloudDeleted: true,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nativeMock.listTrash.mockReset().mockResolvedValue([]);
  nativeMock.listQuickNoteTrash.mockReset().mockResolvedValue([]);
  nativeMock.getS3GcSettings.mockReset().mockResolvedValue({ trashAutoPurgeDays: 0 });
  nativeMock.ensureTrashNoteAssets.mockReset().mockResolvedValue({ warnings: [], skipped: null });
  nativeMock.readNote.mockReset().mockResolvedValue({ id: "n1", title: "会议纪要", content: "<p>正文</p>", kind: "doc", cloudDeleted: true });
  previewCalls.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function renderPanel(items: TrashItem[]) {
  nativeMock.listTrash.mockResolvedValue(items);
  act(() => root.render(<TrashPanel open embed onClose={() => undefined} onRestored={() => undefined} />));
  await flush();
}

const row = () => container.querySelector<HTMLElement>(".ln-list-item");

async function activate(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("回收站预览（task-89）：整行可点 + 缺正文提示 + 标题兜底", () => {
  it("cloudDeleted 副本：点行内徽标（不是标题文字）也触发 readNote，正文交给 NoteDocPreview(policyKey=trash)", async () => {
    await renderPanel([trashItem()]);
    // 之前只有标题文字 div 有 onClick，点徽标/行内空白无反应 ⇒ 右侧一直是占位文案。
    const badge = [...container.querySelectorAll(".badge")].find((el) => el.textContent?.includes("云端已删除（仅本地）"));
    await activate(badge ?? null);

    expect(nativeMock.readNote).toHaveBeenCalledWith("n1");
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0]).toMatchObject({ noteId: "n1", body: "<p>正文</p>", policyKey: "trash" });
    expect(container.querySelector(".history-preview-inline-title")?.textContent).toBe("会议纪要");
    expect(container.textContent).not.toContain("选择左侧文档查看内容");
  });

  it("行结构（task-105）：行 = role=group（不再是 role=button），预览 = 文本区独立原生按键（Enter/空格由浏览器默认语义）", async () => {
    await renderPanel([trashItem()]);
    const first = row()!;
    expect(first.getAttribute("role")).toBe("group");
    expect(first.hasAttribute("tabindex")).toBe(false);
    expect(first.querySelectorAll('button[aria-label="恢复（含全部内容）"], button[aria-label="彻底删除（含全部内容）"]').length).toBeGreaterThan(0);
    // 文本区是真正的 <button>：读屏可按「按钮」播报，键盘 Enter/空格原生产生 click。
    const text = first.querySelector<HTMLButtonElement>("button.trash-row-text")!;
    expect(text.tagName).toBe("BUTTON");
    expect(text.getAttribute("aria-label")).toContain("预览「会议纪要」");
    await activate(text);
    expect(nativeMock.readNote).toHaveBeenCalledWith("n1");
  });

  it("行内「彻底删除」是独立控件：点它不触发预览", async () => {
    await renderPanel([trashItem()]);
    const purge = container.querySelector<HTMLButtonElement>('button[aria-label="彻底删除（含全部内容）"]');
    await activate(purge);
    expect(nativeMock.readNote).not.toHaveBeenCalled();
  });

  it("缺 noteFileId / hasFile=false：不空转 readNote，直接给可操作提示（不留空白占位）", async () => {
    await renderPanel([trashItem({ id: "n-nofile", noteFileId: null, hasFile: false })]);
    await activate(row());
    expect(nativeMock.readNote).not.toHaveBeenCalled();
    expect(previewCalls).toHaveLength(0);
    expect(container.textContent).toContain("缺少正文文件引用");
    expect(container.textContent).toContain("无法预览");
    expect(container.textContent).not.toContain("选择左侧文档查看内容");

    // hasFile 与 noteFileId 在数据层当前同源，但 UI 不该假设耦合：hasFile=false 单独出现也要给提示。
    act(() => root.unmount());
    root = createRoot(container);
    previewCalls.length = 0;
    nativeMock.readNote.mockClear();
    await renderPanel([trashItem({ id: "n-lostbody", hasFile: false })]);
    await activate(row());
    expect(nativeMock.readNote).not.toHaveBeenCalled();
    expect(container.textContent).toContain("正文文件不在本机");
  });

  it("readNote 回 bodyMissing：不挂空 viewer，提示正文文件不在本机（回收站不产生空白预览）", async () => {
    nativeMock.readNote.mockResolvedValue({ id: "n1", title: "会议纪要", content: "", kind: "doc", bodyMissing: true });
    await renderPanel([trashItem()]);
    await activate(row());
    expect(previewCalls).toHaveLength(0);
    expect(container.textContent).toContain("正文文件不在本机");
    expect(container.textContent).not.toContain("选择左侧文档查看内容");
  });

  it("无标题且无 deletedAt：标题兜底「文档」，行内不出现「无标题」也不留悬空分隔符", async () => {
    await renderPanel([trashItem({ title: "", deletedAt: null })]);
    expect(row()?.querySelector(".ln-row2__title")?.textContent).toBe("文档");
    expect(row()?.querySelector(".ln-row2__meta")).toBeNull();
    expect(container.textContent).not.toContain("无标题");

    await activate(row());
    expect(container.querySelector(".history-preview-inline-title")?.textContent).toBe("文档");
    expect(nativeMock.readNote).toHaveBeenCalledWith("n1");
  });
});

/**
 * 样式护栏（task-89 真根因，活实例 9237 实测 rowW=287.5 / textW=0）：
 * 行里两个徽标（云端已删除 + N 天后清除）与动作钮都不可收缩，会把 flex:1 1 auto 的文本挤成 0 宽 ⇒ 视觉没标题。
 * 这两条规则是「整行可点」能真正被用起来的前提，改之前先读这里的来历。
 */
describe("panels.css：回收站行可读性（task-89）", () => {
  // jsdom 环境下 import.meta.url 不是 file: ⇒ 用仓库根相对路径（与 NoteDocPreview.render.test.tsx 同口径）
  const CSS = readFileSync(path.resolve("src/styles/app/panels.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("文本保底宽度：flex: 1 0 96px（不能写 min-width：kit 的 .ln-ellipsis 在更高层，会把 legacy 层的 min-width 压掉）", () => {
    expect(CSS).toMatch(/\.trash-tree-node \.ln-list-item__text \{ flex: 1 0 96px; \}/);
    expect(CSS).not.toMatch(/\.trash-tree-node \.ln-list-item__text \{[^}]*min-width/);
    // 手型光标与整行可点一起生效，缺一个都会让用户以为「点了没反应」
    expect(CSS).toMatch(/\.trash-tree-node > \.ln-list-item \{ cursor: pointer; \}/);
    // task-105：文本区是原生 button，必须复位浏览器按钮外观（否则边框/底色/居中把行排版打乱）
    const reset = CSS.match(/\.trash-tree-node button\.trash-row-text \{([^}]*)\}/);
    expect(reset).toBeTruthy();
    for (const decl of ["border: 0;", "background: transparent;", "color: inherit;", "font: inherit;", "text-align: left;", "cursor: pointer;"]) {
      expect(reset?.[1]).toContain(decl);
    }
  });

  it("P3-6：窄分栏（≤290px，task-89 实测 rowW 287.5）用容器查询隐藏倒计时徽标；默认行宽不触发", () => {
    // 容器 = 行包裹（.trash-tree-node）；隐藏目标 = 倒计时徽标专属类（不能误伤「云端已删除」等告警徽标）
    expect(CSS).toMatch(/\.trash-tree-node \{ container-type: inline-size; \}/);
    expect(CSS).toMatch(/@container \(max-width: 340px\)/);
    // 只在「还有别的徽标抢位」时隐藏（只有倒计时一个徽标时保留）
    expect(CSS).toMatch(/\.trash-tree-node:has\(\.badge:not\(\.trash-row-days\)\) \.trash-row-days \{ display: none; \}/);
    // 阈值来历（261113 第 4 轮真实截图）：行宽 303.5 时倒计时已被截成「90…」（无信息量）⇒ 必须覆盖它；
    // 宽浮层面板（≥400）不能触发。
    expect(340).toBeGreaterThan(303.5);
    expect(340).toBeLessThan(400);
  });

  it("窄行下徽标让位给标题：可收缩 + 省略号（flex:0 1 auto / min-width:0 / overflow hidden / ellipsis / nowrap）", () => {
    const rule = CSS.match(/\.trash-tree-node \.ln-list-item \.badge \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    for (const decl of ["flex: 0 1 auto;", "min-width: 0;", "overflow: hidden;", "text-overflow: ellipsis;", "white-space: nowrap;"]) {
      expect(rule?.[1]).toContain(decl);
    }
  });
});
