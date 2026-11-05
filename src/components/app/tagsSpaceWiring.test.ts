import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 标签空间的**接线**护栏（P1）：数据层在 main/preload（task-33），这里钉渲染层四件事：
 * ① 一级入口「标签」在空间类型/顶栏菜单/App 视图里真的接上了；
 * ② App 用 lazy 挂载 TagsWorkspace（内核预览在组件内再懒一层 ⇒ 不破桌面内核边界）；
 * ③ 侧栏按标签筛选接到 Sidebar（visibleIds 只收窄显示，不参与拖拽兄弟集合）；
 * ④ 属性面板挂上标签编辑行。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const APP = read("../../App.tsx");
const SIDEBAR = read("./Sidebar.tsx");
const INFO = read("./NoteInfoDialog.tsx");
const TYPES = read("../../desktop/desktopTypes.ts");
const TOPBAR = read("../../desktop/DesktopTopBar.tsx");
const WORKSPACE = read("../../features/tags/TagsWorkspace.tsx");
const PREVIEW = read("../../features/tags/TagPreviewBody.tsx");
const NATIVE = read("../../lib/native.ts");

describe("标签空间接线（P1）", () => {
  it("一级入口：空间类型 + 顶栏空间菜单 + App 视图（与 资料库/小记 并列）", () => {
    expect(TYPES).toContain('"tags"');
    expect(TOPBAR).toContain('tags: { label: "标签", Icon: Tag }');
    expect(TOPBAR).toContain('{ id: "tags", label: "标签", Icon: Tag }');
    expect(APP).toContain('desktopWorkspace === "tags"');
    expect(APP).toContain("<TagsWorkspace");
    expect(APP).toContain('workspace="tags"');
  });

  it("App 用 lazy 挂载标签空间；内核只读预览在组件内再懒一层（P12 内核边界）", () => {
    expect(APP).toContain('lazy(() => import("./features/tags/TagsWorkspace")');
    expect(WORKSPACE).toContain('lazy(() => import("./TagPreviewBody"))');
    expect(PREVIEW).toContain("QuickNoteKernelPreview");
    // 预览组件本身不得被 App 静态 import
    expect(APP).not.toContain('import { TagPreviewBody }');
  });

  it("侧栏按标签筛选：App 注入 visibleIds + Sidebar 只收窄显示", () => {
    expect(APP).toContain("tagFilter={{ tags: tagSpace.tagOptions, selection: tagSelection, visibleIds: tagVisibleIds, onChange: setTagSelection }}");
    expect(SIDEBAR).toContain("<SidebarTagFilter tags={props.tagFilter.tags}");
    expect(SIDEBAR).toContain("tagFilter.visibleIds.has(id)");
    // 拖拽兄弟集合仍来自完整 treeIndex（不是 displayIndex）
    expect(SIDEBAR).toContain("const siblings = (treeIndex.childrenByParent.get(parentId)");
  });

  it("属性面板：标签编辑行（标签目录 + 文档关系读写）", () => {
    expect(INFO).toContain("<NoteTagRow noteId={note.noteFileId}");
    expect(INFO).toContain("data-note-tags");
    expect(NATIVE).toContain("listNoteTagLinks");
    expect(NATIVE).toContain("setNoteTags");
    // 主进程侧（task-33）三条同步：IPC 注册 / preload 暴露 / WEB_METHODS（通道一致性由 ipcChannelParity 兜底）
    expect(read("../../../electron/ipc/registerQuickNotes.ts")).toContain('ipc.handle("list_note_tag_links"');
    expect(read("../../../electron/preload.cjs")).toContain('listNoteTagLinks: () => invoke("list_note_tag_links")');
    expect(read("../../../electron/preload.cjs")).toContain('setNoteTags: (noteId, tagIds) => invoke("set_note_tags", noteId, tagIds)');
    expect(read("../../../electron/webApiServer.ts")).toContain('setNoteTags: "set_note_tags"');
  });
});
