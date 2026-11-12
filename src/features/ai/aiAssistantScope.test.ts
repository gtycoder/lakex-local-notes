// @vitest-environment jsdom
/**
 * F-03 护栏：AI 助手的「当前文档」判据（261112 审计）。
 *
 * 背景：AI 面板按「作用域」各挂一份会话（src/features/ai/aiAssistantSession.ts），作用域 =
 * 一级空间 + 当前活动文档。历史上 SCOPE_EDITOR_SELECTOR 只认 `.lake-editor-tab`（doc 宿主），
 * 于是**表格 / 多维表 / 画板 / 手写板**上的 AI 面板拿不到文档维度（退化成空间级 ⇒ 切文档不换会话、
 * 关掉文档也不丢弃）。修法 = 5 个宿主根节点统一带 `data-note-id`，选择器改成与
 * features/editor/activeEditor.ts 同一判据族的 `[data-active="true"][data-note-id]`。
 *
 * 本文件钉两件事：
 *  ① 行为：`readAiScope()` / `isNoteHostAlive()` 对 5 个宿主类名都成立（任意一种编辑器当活动宿主）；
 *  ② 契约：5 个宿主源码都写了 `data-note-id={noteId}` —— 漏一个（新增第 6 种 kind 时最容易忘）就红。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { aiScopeNoteId, isNoteHostAlive, readAiScope } from "./aiAssistantSession";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 去掉注释，避免「注释里提到某属性」误判（与 quickNoteSyncGate.test.ts 同口径）。 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 宿主清单：名字 → 源码 → 根节点类名（与 EDITOR_HOST_SELECTOR 一一对应）。 */
const HOSTS = [
  ["doc", "../editor/EditorTab.tsx", "lake-editor lake-editor-tab"],
  ["usheet", "../usheet/UniverSheetEditor.tsx", "sheet-editor usheet-editor"],
  ["bitable", "../bitable/BitableEditor.tsx", "bitable-editor"],
  ["board", "../board/BoardEditor.tsx", "board-editor"],
  ["ink", "../ink/InkPad.tsx", "ink-pad ink-pad--desktop"],
] as const;

function mountHost(className: string, noteId: string, active: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.setAttribute("data-note-id", noteId);
  if (active) el.setAttribute("data-active", "true");
  document.body.appendChild(el);
  return el;
}

function mountShell(): void {
  const shell = document.createElement("div");
  shell.className = "app-shell";
  document.body.appendChild(shell);
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("AI 作用域：当前活动文档判据（F-03）", () => {
  it.each(HOSTS.map(([kind, , cls]) => [kind, cls] as const))("活动宿主 = %s 时作用域取到该文档 id", (kind, cls) => {
    mountShell();
    mountHost(cls, "note-42", true);
    expect(readAiScope(), kind + " 宿主必须参与作用域，否则 AI 面板退化成空间级").toBe("library::note-42");
    expect(aiScopeNoteId(readAiScope())).toBe("note-42");
  });

  it("同时存在多个宿主时只认 data-active（后台标签不算）", () => {
    mountShell();
    mountHost("lake-editor lake-editor-tab", "doc-1", false);
    mountHost("sheet-editor usheet-editor", "sheet-2", true);
    expect(readAiScope()).toBe("library::sheet-2");
  });

  it("空间态类参与作用域前缀（切空间即换会话）", () => {
    const shell = document.createElement("div");
    shell.className = "app-shell quick-notes-active";
    document.body.appendChild(shell);
    mountHost("bitable-editor", "bt-9", true);
    expect(readAiScope()).toBe("quick-notes-active::bt-9");
  });

  it("没有活动宿主时文档维度为空串（空间作用域）", () => {
    mountShell();
    expect(readAiScope()).toBe("library::");
    expect(aiScopeNoteId("library::")).toBe("");
  });

  it("isNoteHostAlive：隐藏（keep-alive）算活着，宿主被移除才算关掉", () => {
    const el = mountHost("board-editor", "board-7", false);
    expect(isNoteHostAlive("board-7")).toBe(true);
    expect(isNoteHostAlive("other-note")).toBe(false);
    el.remove();
    expect(isNoteHostAlive("board-7")).toBe(false);
  });
});

describe("AI 作用域：5 个宿主都带 data-note-id（源码契约，漏一个就红）", () => {
  it.each(HOSTS.map(([kind, file]) => [kind, file] as const))("%s 宿主根节点带 data-note-id={noteId}", (_kind, file) => {
    const src = code(read(file));
    expect(src, file + " 的宿主根节点必须写 data-note-id={noteId}（否则 AI 作用域/文档存活判据失效）")
      .toMatch(/data-note-id=\{noteId\}/);
  });

  it("作用域选择器与 activeEditor 同族，且不再只认 doc 的类名", () => {
    const session = code(read("./aiAssistantSession.ts"));
    expect(session).toMatch(/\[data-active="true"\]\[data-note-id\]/);
    expect(session, "不能再写死 .lake-editor-tab（那是 F-03 的根因）").not.toMatch(/SCOPE_EDITOR_SELECTOR = '\.lake-editor-tab/);
  });

  it("AiAssistantDialog 的「文档还活着」走同一清单（不自己写第二份选择器）", () => {
    const dialog = code(read("./AiAssistantDialog.tsx"));
    expect(dialog).toMatch(/isNoteHostAlive\(noteId\)/);
    expect(dialog, "对话框里不应再出现自写的宿主选择器").not.toMatch(/"\.lake-editor-tab\[data-note-id\]"/);
  });
});
