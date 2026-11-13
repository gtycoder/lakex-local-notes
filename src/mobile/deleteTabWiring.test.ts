/**
 * 「删除后关闭已打开标签」全入口接线（261114 task-8；行为侧见
 * data/trashCascade.test.ts、notebook/useWorkspaceSession.test.ts、notebook/useTreeSelection.render.test.tsx、
 * editor/DocListSheet.render.test.tsx）。
 *
 * 判据：所有删除入口都必须用**数据层返回的真实软删 note ids** 调 dismissNoteTabs ——
 * 不能用前端 tree 现算（首页入口只有全库快照、工作区只加载当前笔记本子树 ⇒ 树未加载全时必漏），
 * 也不允许漏掉任何入口（桌面 useNoteLifecycle.deleteTreeNode 同语义：先收标签再删）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const HOME = code(read("src/mobile/home/HomePage.tsx"));
const DIARY = code(read("src/mobile/diary/DiaryPage.tsx"));
const TREE_ACTIONS = code(read("src/mobile/notebook/useNotebookTreeActions.ts"));
const TREE_SELECTION = code(read("src/mobile/notebook/useTreeSelection.ts"));
const DOC_LIST = code(read("src/mobile/editor/DocListSheet.tsx"));
const MISSING = code(read("src/mobile/settings/MissingBodiesSheet.tsx"));
const SESSION = code(read("src/mobile/notebook/useWorkspaceSession.ts"));
const CONVERT = code(read("src/mobile/diary/diaryToQuickNote.ts"));
const REPO = code(read("src/mobile/data/noteRepository.ts"));
const TRASH = code(read("src/mobile/data/trashRepository.ts"));
const BRIDGE = code(read("src/mobile/bridge/notes.ts"));
const BATCH = code(read("src/mobile/bridge/batchNotes.ts"));
const CLEANUP = code(read("src/mobile/notebook/tabSessionCleanup.ts"));
const AUTO_SYNC = code(read("src/mobile/hooks/useAutoSync.ts"));
const TRASH_LIST = code(read("src/mobile/settings/TrashList.tsx"));

describe("删除入口：关闭已打开标签（与桌面 deleteTreeNode 一致）", () => {
  it("首页长按删笔记本：用数据层返回的子树 ids 关标签 + 清该笔记本标签存档", () => {
    expect(HOME).toContain('const removedNoteIds = await bridge.trashTreeItem(nb.id, "folder")');
    expect(HOME).toContain("dismissNoteTabs(removedNoteIds)");
    expect(HOME).toContain("clearPersistedNotebookTabsFor(nb.id)");
    // 失败路径不得假装成功（原 catch 保留）
    expect(HOME).toMatch(/catch \{ showToast\("删除失败", \{ type: "error" \}\); \}/);
  });

  it("日记页删条目 / 转小记：都用数据层 ids 关标签（转小记原文是级联软删）", () => {
    expect(DIARY).toContain('const removedNoteIds = await bridge.trashTreeItem(entry.noteId, "note")');
    expect(DIARY).toContain("dismissNoteTabs(removedNoteIds)");
    expect(DIARY).toContain("const result = await bridge.diaryToQuickNote(entry.noteId)");
    expect(DIARY).toContain("dismissNoteTabs(result.trashedNoteIds)");
  });

  it("目录树单条删除：用返回 ids 而非前端 tree 现算（树未加载全也不漏）", () => {
    expect(TREE_ACTIONS).toContain('const removedNoteIds = await bridge.trashTreeItem(node.id, node.kind === "note" ? "note" : "folder")');
    expect(TREE_ACTIONS).toContain("dismissNoteTabs(removedNoteIds)");
    // 旧实现（按当前 tree 收集子树）必须已删除，避免回到"树没加载全就漏"的坑。
    expect(TREE_ACTIONS).not.toContain("descendantNoteTabIds");
  });

  it("批量多选（目录树 / 编辑器文档列表）：用 batch 结果的 trashedNoteIds（含级联）关标签", () => {
    expect(TREE_SELECTION).toContain("dismissNoteTabs(result.trashedNoteIds)");
    expect(DOC_LIST).toContain("dismissNoteTabs(result.trashedNoteIds)");
    // 失败提示仍只由 failed 决定（不因关标签而假装成功）。
    expect(TREE_SELECTION).toMatch(/if \(failed > 0\)[\s\S]{0,80}\{ type: "error" \}/);
  });

  it("设置·缺正文「彻底删除」：先软删拿 ids、purge 再拿 ids，一起关标签", () => {
    expect(MISSING).toContain("const removedNoteIds = await bridge.trashNote(doc.id)");
    expect(MISSING).toContain("const purged = await bridge.purgeTreeItem(doc.id, \"note\")");
    expect(MISSING).toContain("dismissNoteTabs([...removedNoteIds, ...purged.noteIds])");
  });

  it("工作区：注册统一通道 ⇒ cancelAutoSave + 批量 removeTabs（keep-alive 隐藏但挂载时同样生效）", () => {
    expect(SESSION).toContain("registerNoteTabDismisser(");
    // 先取消每条的待保存（否则全量 flush 会去写已删行、屏障卡住）…
    expect(SESSION).toMatch(/registerNoteTabDismisser\(\(noteIds\)[\s\S]{0,200}cancelAutoSave\(id\)/);
    // …再**一次批量移除**（循环 removeTab 会因旧 tabsRef 互相覆盖而残留被删 tab，设备实测过）。
    expect(SESSION).toMatch(/registerNoteTabDismisser\(\(noteIds\)[\s\S]{0,260}removeTabs\(noteIds\)/);
    expect(SESSION).toMatch(/const discardTab[\s\S]{0,120}cancelAutoSave\(id\)/);
  });

  it("G1：批量删除（目录树多选 / 文档列表）先 flushSaves 再 batchNotes（不丢 ≤1s 编辑）", () => {
    expect(TREE_SELECTION).toMatch(/applyTrash[\s\S]{0,400}flushSaves[\s\S]{0,400}runDocBatch\(selectedIds, \{ action: "trash" \}\)/);
    // 落盘失败中止（不调 batchNotes）
    expect(TREE_SELECTION).toMatch(/保存失败，未移入回收站/);
    expect(DOC_LIST).toMatch(/payload\.action === "trash"[\s\S]{0,200}flushSaves/);
    expect(DOC_LIST).toMatch(/保存失败，未移入回收站/);
  });

  it("G3：彻底删除（设置·回收站 / 缺正文 / 自动过期）按返回 ids 关标签", () => {
    expect(TRASH_LIST).toContain("dismissNoteTabs(result.noteIds)");
    expect(MISSING).toContain("dismissNoteTabs([...removedNoteIds, ...purged.noteIds])");
    expect(AUTO_SYNC).toMatch(/bridge\.purgeTreeItem\(root\.id[\s\S]{0,200}dismissNoteTabs\(result\.noteIds\)/);
    // 自动过期仍返回 boolean 给调度器（契约不变）
    expect(AUTO_SYNC).toContain("return result.purged");
  });

  it("G2/G4/G5：恢复支持 note 作父；purge 清 orphan_assets 行 + 只允许回收站行 / kind 由 DB 派生", () => {
    expect(TRASH).toMatch(/SELECT id FROM notes WHERE id=\? AND trashed_at IS NULL/);
    expect(TRASH).toContain("DELETE FROM orphan_assets WHERE note_id=?");
    expect(TRASH).toContain("rootRow.trashed_at == null");
    expect(TRASH).toMatch(/derivedKind !== kind/);
  });
});

describe("数据层：删除返回真实软删 note ids（UI 不依赖前端树）", () => {
  it("noteRepository.trashNote / trashRepository.trashTreeItem 返回整棵子树 note ids", () => {
    expect(REPO).toMatch(/export async function trashNote[\s\S]{0,600}return trashedNoteIds/);
    expect(TRASH).toContain("return await trashSubtree(d, id, now)");
    expect(TRASH).toContain("return Array.from(subtree.noteIds)");
    // folder 分支也要记「删除前父」（同步扁平化后 restore 靠这条边回原父）
    expect(TRASH).toMatch(/UPDATE folders SET trashed_at=\?[\s\S]{0,200}deleted_from_parent_id/);
  });

  it("bridge 透传 ids；批量结果扩展 trashedNoteIds（quickNotes 为空）", () => {
    expect(BRIDGE).toMatch(/async trashNote\(id: string\): Promise<string\[\]>/);
    expect(BRIDGE).toMatch(/async trashTreeItem\(id: string, kind: "folder" \| "note"\): Promise<string\[\]>/);
    expect(BATCH).toContain("trashedNoteIds.push(...await noteRepository.trashNote(d, item.id))");
    expect(BATCH).toContain("export type MobileBatchNotesResult");
    expect(BATCH).toContain("trashedNoteIds: []");
  });

  it("转小记数据层返回 trashedNoteIds（级联子树），由日记页关标签", () => {
    expect(CONVERT).toContain("trashedNoteIds = await trashRepository.trashTreeItem(d, noteId, \"note\")");
    expect(CONVERT).toMatch(/return \{ quickNoteId, droppedKinds: \[\] as string\[\], trashedNoteIds \}/);
  });

  it("删除笔记本时清理标签存档（恢复笔记本后旧标签不复活）", () => {
    expect(CLEANUP).toContain("export function clearPersistedNotebookTabsFor");
    expect(CLEANUP).toContain("notebookTabsStorageKey(notebookId)");
    expect(CLEANUP).toContain("notebookTabsActiveStorageKey(notebookId)");
  });
});
