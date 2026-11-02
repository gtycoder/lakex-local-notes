/**
 * 分享 PDF → 自动新建手写板并导入的路由静态断言（18b）。
 *
 * 钉住链路：MobileApp 的 pdf 分支必须走 readSharedContentBytes → importSharedPdfAsInkNote → setRoute；
 * 成功路径不再弹「暂未接入」提示；file kind 仍只给「暂不支持该分享类型」；image 行为不变（seed → capture）。
 * 回滚与标题派生在 mobilePdfImport（createInk / importPdfIntoInkNote / trashNote / sharedPdfTitle）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const APP = read("../MobileApp.tsx");
const MODULE = read("./mobilePdfImport.ts");
const SHARED = read("../native/sharedContent.ts");

describe("分享 PDF → 自动导入路由（18b）", () => {
  it("MobileApp：pdf 走 readSharedContentBytes + 共享导入编排 + 路由打开新文档", () => {
    expect(APP).toContain("readSharedContentBytes");
    expect(APP).toContain("sharedContentKind(content)");
    expect(APP).toContain("importSharedPdfAsInkNote");
    expect(APP).toContain('setRoute({ kind: "notebook", notebookId: imported.notebookId, initialNoteId: imported.noteId })');
    // 成功路径不弹「暂未接入」提示：只有读取失败才给 PDF 可见提示
    expect(APP).toContain("if (!payload) {");
    expect(APP).toContain("正在导入 PDF…");
    // 分享互斥（冷启动 + 热启动可能同时到达）
    expect(APP).toContain("shareBusyRef");
  });

  it("file kind 保持可见提示；image 仍进小记 seed（不走 PDF 路由）", () => {
    expect(APP).toContain("const unsupported = sharedContentUnsupportedHint(content);");
    expect(APP).toContain('showToast(unsupported, { type: "error" })');
    expect(APP).toContain("sharedContentToSeed(content)");
    expect(APP).toContain("setCaptureOpen(true)");
  });

  it("共享模块：createInk + importPdfIntoInkNote + saveNote + 失败 trash 回滚 + 标题派生", () => {
    expect(MODULE).toContain("export async function importPdfIntoInkNote");
    expect(MODULE).toContain("export async function importPdfPagesToAssets");
    expect(MODULE).toContain("bridge.saveNote(input.noteId, note.title, inkToBody(plan.next))");
    expect(MODULE).toContain("planPdfPageInsert");
    expect(MODULE).toContain("deps.createInk(title, notebookId)");
    expect(MODULE).toContain("deps.trashNote(note.id)");
    expect(MODULE).toContain("export function sharedPdfTitle");
    expect(MODULE).toContain("export function sharedPdfNotebookId");
    // MobileInkPad 手动导入与分享共用同一适配器（不复制实现）
    expect(read("./MobileInkPad.tsx")).toContain("importPdfPagesToAssets");
    expect(read("./MobileInkPad.tsx")).not.toContain("renderPdfPages(");
  });

  it("PDF 读取失败提示已更新（不再说「暂未接入导入」）；helper 仍然存在", () => {
    expect(SHARED).toContain("export async function readSharedContentBytes");
    expect(SHARED).not.toContain("暂未接入导入");
    expect(SHARED).toContain("已保留可重试");
  });
});
