
// @vitest-environment jsdom
/**
 * 桌面 Markdown 导入 UI（261106 task-85）：「+」菜单导入子菜单、目标父级 = 触发 + 的容器、
 * picker 取消无副作用、进度浮层（N/M、可取消）、结果汇总（成功/跳过/失败 + warnings 可展开）。
 * 管线/落盘整体 mock（真实管线由 features/import 自己的测试覆盖）。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";
import { readFileSync } from "node:fs";
import path from "node:path";

const nativeMocks = vi.hoisted(() => ({ pickImportFiles: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: nativeMocks }));

const importMocks = vi.hoisted(() => ({
  createNotesFromImportBatch: vi.fn(),
  createDesktopMarkdownImportHost: vi.fn(() => ({ host: true })),
  convertMarkdownToLake: vi.fn(),
  convertHtmlToLake: vi.fn(),
}));
vi.mock("../../features/import/fileImportBatch", () => ({ createNotesFromImportBatch: importMocks.createNotesFromImportBatch }));
vi.mock("../../features/import/markdownImportDesktop", () => ({ createDesktopMarkdownImportHost: importMocks.createDesktopMarkdownImportHost }));
vi.mock("../../features/import/markdownImportPipeline", () => ({ convertMarkdownToLake: importMocks.convertMarkdownToLake }));
vi.mock("../../features/import/htmlImportPipeline", () => ({ convertHtmlToLake: importMocks.convertHtmlToLake }));

// 浮层简化：Dialog 渲染内容；Submenu 把 label + 子项都渲染出来（真实原语由 Overlay 自己的测试覆盖）
vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) => (open === false ? null : createElement("div", { role: "dialog" }, children)),
  Submenu: ({ label, children }: { label: ReactNode; children: ReactNode }) => createElement("div", { "data-submenu": "" }, label, children),
}));

import { Sidebar } from "./Sidebar";

type Props = Parameters<typeof Sidebar>[0];
const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title: id,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);
const NODES = [
  node("nb", "notebook", null),
  node("g1", "group", "nb"),
  node("n1", "note", "g1", 0),
  node("nb2", "notebook", null, 1),
];

let host: HTMLDivElement;
let root: Root;
let props: Props;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  for (const fn of Object.values(nativeMocks)) fn.mockReset();
  for (const fn of Object.values(importMocks)) { if (fn.mockReset) fn.mockReset(); }
  importMocks.createDesktopMarkdownImportHost.mockReturnValue({ host: true });
  importMocks.convertMarkdownToLake.mockResolvedValue({ body: "<p/>", warnings: [], imageCount: 0, durationMs: 1 });
  nativeMocks.pickImportFiles.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    nodes: NODES, activeId: null, search: "", mode: "docked", width: 220, minWidth: 160, maxWidth: 400,
    lockedNoteIds: new Set<string>(), revealNodeId: null, pendingRenameId: null,
    onSelect: vi.fn(), onSearch: vi.fn(), onRefreshTree: vi.fn(async () => {}), onCreate: vi.fn(async () => "nb-new"),
    onRename: vi.fn(), onMoveNode: vi.fn(), onRequestDelete: vi.fn(), onCopyMarkdown: vi.fn(),
    onExportAs: vi.fn(), onCopyPaths: vi.fn(), onSetIcon: vi.fn(), onShowInfo: vi.fn(), onOpenHistory: vi.fn(),
    onToggleLockNote: vi.fn(), onRevealConsumed: vi.fn(), onPendingRenameConsumed: vi.fn(),
    onPreviewEnter: vi.fn(), onPreviewLeave: vi.fn(), onResizeActiveChange: vi.fn(),
    onWidthChange: vi.fn(), onWidthCommit: vi.fn(), onTagsChanged: vi.fn(),
  } as unknown as Props;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const render = () => act(() => root.render(createElement(Sidebar, props)));
const row = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-tree-node-id="' + id + '"]');
  if (!found) throw new Error("找不到目录行：" + id);
  return found;
};
const menuButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((btn) => (btn.textContent ?? "").trim() === text);
const dialogButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((btn) => (btn.textContent ?? "").trim() === text);
const bodyText = () => document.body.textContent ?? "";
const openRowMenu = (id: string) => act(() => {
  const plus = row(id).querySelector<HTMLButtonElement>('button[aria-label="新建子项"]')!;
  plus.click();
});
const file = (name: string, overrides: Record<string, unknown> = {}) => ({
  path: "/tmp/import/" + name, name, relativePath: name, size: 10, supported: true,
  kind: name.endsWith(".md") ? "markdown" : "other", markdown: "# " + name,
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("Markdown 导入：菜单与目标父级", () => {
  it("目录行「＋」菜单出现「导入文件」子菜单（统一 picker；文件夹入口已删除）", () => {
    render();
    openRowMenu("nb");
    expect(bodyText()).toContain("导入");
    expect(menuButton("Markdown…")).toBeTruthy();
    expect(menuButton("Markdown 文件夹…")).toBeUndefined();
    // 源码级：入口与 native 绑定都不再出现（task-91）
    const sidebar = readFileSync(path.resolve("src/components/app/Sidebar.tsx"), "utf8");
    expect(sidebar).not.toContain("Markdown 文件夹…</span>");
    expect(sidebar).not.toContain("pickMarkdownFolder");
  });

  it("目录栏头部「＋」菜单：只剩「新建笔记本」，不再提供「导入」（用户 261111）", () => {
    render();
    act(() => { document.querySelector<HTMLButtonElement>(".create-btn")!.click(); });
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = [...menu!.querySelectorAll<HTMLButtonElement>("button")].map((b) => (b.textContent ?? "").trim());
    // 头部「＋」只保留「新建笔记本」；「导入」属于行级「＋」（目标语义不同）
    expect(items).toEqual(["新建笔记本"]);
    // 源码级：表面/条目改成与目录右键同款；头部导入的派生数据与子菜单已删干净
    const sidebar = readFileSync(path.resolve("src/components/app/Sidebar.tsx"), "utf8");
    expect(sidebar).not.toContain("importTargetOfActive");
    expect(sidebar).toContain('surfaceClassName="context-menu"');
  });

  it("类型菜单分别把 kind 传给 picker；Word → docx HTML 交给通用批量", async () => {
    nativeMocks.pickImportFiles.mockResolvedValue([file("a.docx", { kind: "docx", html: "<h1>报告</h1>" })]);
    importMocks.createNotesFromImportBatch.mockResolvedValue({ ok: true, results: [], summary: { total: 0, done: 0, failed: 0, skipped: 0 }, warnings: [] });
    render();
    openRowMenu("nb");
    await act(async () => { menuButton("Word（.docx）…")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(nativeMocks.pickImportFiles).toHaveBeenCalledWith("docx");
    const request = importMocks.createNotesFromImportBatch.mock.calls[0][0];
    expect(request.items).toEqual([{ kind: "docx", path: "/tmp/import/a.docx", name: "a.docx", relativePath: "a.docx", html: "<h1>报告</h1>" }]);
    expect(typeof request.convertHtml).toBe("function");
  });

  it("目标父级 = 触发「＋」的笔记本（子项文件夹也落到它下面）", async () => {
    nativeMocks.pickImportFiles.mockResolvedValue([file("a.md")]);
    importMocks.createNotesFromImportBatch.mockResolvedValue({ ok: true, results: [{ path: "/tmp/import/a.md", ok: true, noteId: "n9" }], summary: { total: 1, done: 1, failed: 0, skipped: 0 }, warnings: [] });
    render();
    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(nativeMocks.pickImportFiles).toHaveBeenCalledWith("markdown");
    expect(importMocks.createNotesFromImportBatch).toHaveBeenCalledTimes(1);
    const request = importMocks.createNotesFromImportBatch.mock.calls[0][0];
    expect(request.parentNotebookId).toBe("nb");
    expect(request.items).toEqual([{ kind: "markdown", path: "/tmp/import/a.md", name: "a.md", relativePath: "a.md", markdown: "# a.md" }]);
    expect(request.host).toEqual({ host: true });
    expect(importMocks.convertMarkdownToLake).toBe(request.convertMarkdown);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(props.onRefreshTree).toHaveBeenCalled();
  });

  it("目标父级 = 分组节点；文档行「＋」则沿祖先找最近容器", async () => {
    nativeMocks.pickImportFiles.mockResolvedValue([file("a.md")]);
    importMocks.createNotesFromImportBatch.mockResolvedValue({ ok: true, results: [], summary: { total: 0, done: 0, failed: 0, skipped: 0 }, warnings: [] });
    render();
    openRowMenu("g1");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(importMocks.createNotesFromImportBatch.mock.calls[0][0].parentNotebookId).toBe("g1");
  });


  it("取消选择器（空数组）⇒ 无副作用（不调批量、不弹结果）", async () => {
    nativeMocks.pickImportFiles.mockResolvedValue([]);
    render();
    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(importMocks.createNotesFromImportBatch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("Markdown 导入：跳过/进度/结果", () => {
  it("不支持/超 20MB/读失败 计入跳过（不传给批量）；成功/失败进结果汇总", async () => {
    nativeMocks.pickImportFiles.mockResolvedValue([
      file("ok.md"),
      file("photo.png", { supported: false }),
      file("huge.md", { tooLarge: true }),
      file("bad.md", { markdown: undefined, error: "无权限" }),
    ]);
    importMocks.createNotesFromImportBatch.mockResolvedValue({
      ok: false,
      results: [
        { path: "/tmp/import/ok.md", ok: true, noteId: "n9" },
        { path: "/tmp/import/other.md", ok: false, reason: "转换失败" },
      ],
      summary: { total: 2, done: 1, failed: 1, skipped: 0 },
      warnings: ["远程图片未下载：x.png"],
    });
    render();
    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });

    const request = importMocks.createNotesFromImportBatch.mock.calls[0][0];
    expect(request.items).toHaveLength(1);
    const text = bodyText();
    expect(text).toContain("成功 1 篇");
    expect(text).toContain("跳过 3 个");
    expect(text).toContain("失败 1 篇");
    expect(text).toContain("不支持的文件类型");
    expect(text).toContain("超过 20MB");
    expect(text).toContain("读取失败：无权限");
    expect(text).toContain("转换失败");
    expect(text).toContain("远程图片未下载");
  });

  it("多选文件：进度浮层 N/M 可取消（abort 信号）；结果弹窗保留失败汇总", async () => {
    const gate = deferred<{ ok: boolean; results: never[]; summary: { total: number; done: number; failed: number; skipped: number }; warnings: string[] }>();
    let seenSignal: AbortSignal | null = null;
    importMocks.createNotesFromImportBatch.mockImplementation((request: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; path: string }) => void }) => {
      seenSignal = request.signal ?? null;
      request.onProgress?.({ index: 1, total: 2, path: "/tmp/import/a.md" });
      return gate.promise;
    });
    nativeMocks.pickImportFiles.mockResolvedValue([file("a.md"), file("b.md")]);
    render();
    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });

    // 进度浮层：N/M + 文件名 + 可取消
    expect(bodyText()).toContain("正在导入 1/2");
    expect(bodyText()).toContain("a.md");
    const cancel = dialogButton("取消导入")!;
    act(() => { cancel.click(); });
    expect(seenSignal!.aborted).toBe(true);
    expect(bodyText()).toContain("正在停止");

    await act(async () => { gate.resolve({ ok: false, results: [], summary: { total: 2, done: 0, failed: 2, skipped: 0 }, warnings: [] }); await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const request = importMocks.createNotesFromImportBatch.mock.calls[0][0];
    expect(request.items).toHaveLength(2);
  });

  it("导入进行中重复触发被 busy 挡住（不再调 picker）", async () => {
    const gate = deferred<never>();
    importMocks.createNotesFromImportBatch.mockImplementation(() => gate.promise);
    nativeMocks.pickImportFiles.mockResolvedValue([file("a.md")]);
    props.activeId = "n1";
    render();
    // 用**目录行「＋」**菜单触发导入（头部「＋」已不再提供导入，用户 261111）
    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(nativeMocks.pickImportFiles).toHaveBeenCalledTimes(1);

    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); });
    expect(nativeMocks.pickImportFiles).toHaveBeenCalledTimes(1);

    await act(async () => { gate.resolve(undefined as never); await Promise.resolve(); await Promise.resolve(); });
  });

  it("结果弹窗「完成」关闭；warnings 可展开（details）", async () => {
    nativeMocks.pickImportFiles.mockResolvedValue([file("a.md")]);
    importMocks.createNotesFromImportBatch.mockResolvedValue({
      ok: true,
      results: [{ path: "/tmp/import/a.md", ok: true, noteId: "n9" }],
      summary: { total: 1, done: 1, failed: 0, skipped: 0 },
      warnings: ["frontmatter 已丢弃"],
    });
    render();
    openRowMenu("nb");
    await act(async () => { menuButton("Markdown…")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector("details.import-result-dialog__warnings")).not.toBeNull();
    expect(bodyText()).toContain("frontmatter 已丢弃");
    act(() => { dialogButton("完成")!.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});