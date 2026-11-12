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
const CHROME = read("../../styles/chrome.css");
const NOTE_TAG_DIALOG = read("./NoteTagDialog.tsx");
const TAGS_WORKSPACE = read("../../features/tags/TagsWorkspace.tsx");

describe("标签空间接线（P1）", () => {
  it("一级入口：空间类型 + 顶栏空间菜单 + App 视图（与 文档/小记 并列）", () => {
    expect(TYPES).toContain('"tags"');
    expect(TOPBAR).toContain('tags: { label: "标签", Icon: Tag }');
    // 261109 用户定稿：标签也进快捷键表（⌘5）
    expect(TOPBAR).toContain('{ id: "tags", label: "标签", Icon: Tag, hint: "⌘5" }');
    expect(APP).toContain('desktopWorkspace === "tags"');
    expect(APP).toContain("<TagsWorkspace");
    expect(APP).toContain('workspace="tags"');
  });

  it("App 用 lazy 挂载标签空间；内核只读预览在组件内再懒一层（P12 内核边界）", () => {
    expect(APP).toContain('lazy(() => import("./features/tags/TagsWorkspace")');
    expect(WORKSPACE).toContain('lazy(() => import("./TagPreviewBody"))');
    // 261106：doc 预览统一走 NoteDocPreview（回收站/历史/属性弹窗同一实现、同一排版字号）；
    // 非 doc 四族仍 HistorySnapshotPreview，小记仍 QuickNotePreview
    expect(PREVIEW).toContain("NoteDocPreview");
    expect(PREVIEW).toContain("HistorySnapshotPreview");
    expect(PREVIEW).toContain("QuickNotePreview");
    expect(PREVIEW).not.toContain("QuickNoteKernelPreview");
    // 预览组件本身不得被 App 静态 import
    expect(APP).not.toContain('import { TagPreviewBody }');
  });

  it("三修①：标签空间隐藏左侧目录栏（shell 类 + chrome.css 与回收站/资源同口径）", () => {
    expect(APP).toContain('desktopWorkspace === "tags" ? "tags-space-active" : ""');
    expect(CHROME).toContain(".app-shell.tags-space-active .sidebar { display: none; }");
    expect(CHROME).toContain(".app-shell.tags-space-active .statusbar { display: none; }");
    expect(CHROME).toMatch(/.app-shell.tags-space-active \{[\s\S]{0,160}grid-template-columns: var\(--activity-rail-width\) 0 minmax\(0, 1fr\);/);
  });

  it("三修②：只有一个 Filter——标签含/排除并进同一浮层，无独立标签图标", () => {
    // 只有 filter.open 时渲染标签段；不再有独立的 SidebarTagFilter 触发按钮
    expect(SIDEBAR).toContain("{filter.open && props.tagFilter && (");
    expect(SIDEBAR).toContain("<SidebarTagFilter tags={props.tagFilter.tags}");
    expect(SIDEBAR).not.toContain('aria-label="按标签筛选"');
    // 状态仍由 App 的 tagSelection 持有（不新增第二份状态）
    expect(APP).toContain("const [tagSelection, setTagSelection] = useState<TagSelection>(EMPTY_TAG_SELECTION);");
    // 三修② 之后：标签段在 filter.open 时才渲染（不是独立图标/弹层）
    expect(APP).toContain("tagFilter={{ tags: tagSpace.tagOptions, selection: tagSelection, visibleIds: tagVisibleIds, onChange: setTagSelection }}");
    // Sidebar 仍只收窄显示；拖拽兄弟集合来自完整 treeIndex
    expect(SIDEBAR).toContain("tagFilter.visibleIds.has(id)");
    expect(SIDEBAR).toContain("const siblings = (treeIndex.childrenByParent.get(parentId)");
  });

  it("新建标签：目录头部/空目录入口 → onCreateTag → native.createQuickNoteTag（目录唯一来源）", () => {
    expect(TAGS_WORKSPACE).toContain('aria-label="新建标签"');
    expect(TAGS_WORKSPACE).toContain("还没有标签。新建一个标签，或在文档属性/右键菜单里设置标签。");
    expect(TAGS_WORKSPACE).toContain("onCreateTag(name: string): Promise<string>;");
    // App → native.createQuickNoteTag（不新建第二套目录）
    expect(APP).toContain("const created = await native.createQuickNoteTag(name);");
    expect(APP).toContain("<TagsWorkspace");
    // 行操作 = 固定可见的 ⋯ 菜单（三个动作），不再依赖 hover 才出现的三个图标
    expect(TAGS_WORKSPACE).toContain('aria-label={"标签操作 " + entry.name}');
    expect(TAGS_WORKSPACE).toContain('aria-haspopup="menu"');
    expect(TAGS_WORKSPACE).toContain("<span>重命名</span>");
    expect(TAGS_WORKSPACE).toContain("<span>合并到…</span>");
    expect(TAGS_WORKSPACE).toContain("<span>删除</span>");
  });

  it("三修③：目录右键 note 行「标签…」→ 复用 NoteTagRow 的弹层，保存后通知宿主", () => {
    expect(SIDEBAR).toContain("<span>标签…</span>");
    expect(SIDEBAR).not.toContain("<span>打标签…</span>");
    expect(SIDEBAR).toContain("<TagIcon size={15} />");
    // 只在 note 分支里（ContextMenu 的 nodeType === "note" 三元分支）
    const noteBranch = SIDEBAR.slice(SIDEBAR.indexOf('node.nodeType === "note" ? ('), SIDEBAR.indexOf(") : (", SIDEBAR.indexOf('node.nodeType === "note" ? (')));
    expect(noteBranch).toContain("标签…");
    expect(SIDEBAR).toContain("<NoteTagDialog open noteId={tagEditor.noteId}");
    expect(SIDEBAR).toContain("onChanged={() => props.onTagsChanged?.()}");
    expect(APP).toContain("onTagsChanged={() => { void tagSpace.reload(); }}");
    expect(NOTE_TAG_DIALOG).toContain("<NoteTagRow");
    expect(NOTE_TAG_DIALOG).toContain("noteId={noteId}");
    expect(NOTE_TAG_DIALOG).toContain("onChanged={onChanged}");
    expect(NOTE_TAG_DIALOG).toContain("onError={(message) => setError(message)}");
  });

  it("261105 验收：空间名「知识库」→「文档」→「知识库」（261110）；三栏可拖（SplitHandle + tagsLayout）；头部按钮移到左栏", () => {
    const TOPBAR_SRC = read("../../desktop/DesktopTopBar.tsx");
    expect(TOPBAR_SRC).toContain('library: { label: "知识库", Icon: Files },');
    expect(TOPBAR_SRC).toContain('{ id: "library", label: "知识库", Icon: Files, hint: "⌘1" },');
    // 三栏：两条 SplitHandle（目录/预览）+ 纯逻辑在 tagsLayout
    expect(TAGS_WORKSPACE).toContain("<SplitHandle");
    expect(TAGS_WORKSPACE).toContain('ariaLabel="调整标签目录宽度"');
    expect(TAGS_WORKSPACE).toContain('ariaLabel="调整标签预览宽度"');
    expect(TAGS_WORKSPACE).toContain("resolveTagColumns(containerWidth, widths)");
    expect(TAGS_WORKSPACE).toContain("TAG_LAYOUT_STORAGE_KEY");
    expect(TAGS_WORKSPACE).toContain("writeLocalStorage(TAG_LAYOUT_STORAGE_KEY");
    // 头部：左栏头部两个 icon 按钮（＋在前、刷新在后），页面级刷新已移除
    expect(TAGS_WORKSPACE).toContain('<header className="tags-dir__head">');
    expect(TAGS_WORKSPACE).not.toContain("tags-space__head");
    expect(TAGS_WORKSPACE.split('aria-label="刷新标签"').length - 1).toBe(1);
    const headBlock = TAGS_WORKSPACE.slice(TAGS_WORKSPACE.indexOf('<header className="tags-dir__head">'), TAGS_WORKSPACE.indexOf("</header>"));
    expect(headBlock.indexOf("新建标签")).toBeLessThan(headBlock.indexOf("刷新标签"));
    // 左栏行：只剩名称（条数/时间只在选中后的中栏摘要）
    // 261110 第二批：行主区改为 .ln-row__main--row（钩子类名仍是 tags-dir__select）⇒ 按类名定位
    const selectAt = TAGS_WORKSPACE.indexOf("tags-dir__select");
    const selectBlock = TAGS_WORKSPACE.slice(selectAt, TAGS_WORKSPACE.indexOf("</button>", selectAt));
    expect(selectBlock).not.toContain("tags-dir__counts");
    expect(selectBlock).not.toContain("tags-dir__time");
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

  it("261106 五改：说明文案结构 / 移除该标签接线 / 预览复用 HistorySnapshotPreview / 中栏最小 270 / 「打标签」用户文案清零", () => {
    // 说明：主文案 + 弱化时间两段（无「」与分号）
    expect(TAGS_WORKSPACE).toContain("tags-aggregate__hint-main");
    expect(TAGS_WORKSPACE).toContain("tags-aggregate__hint-meta");
    expect(TAGS_WORKSPACE).not.toContain("（按更新时间倒序）；更新于");
    // 移除该标签（可逆、无二次确认）：行内 + 预览头同一动作
    expect(TAGS_WORKSPACE).toContain('aria-label={"移除标签 " + (selected?.name ?? "")}');
    expect(TAGS_WORKSPACE).toContain("onRemoveTagFromItem");
    expect(APP).toContain("onRemoveTagFromItem={removeTagFromItem}");
    expect(APP).toContain("const removeTagFromItem = useCallback");
    expect(APP).toContain("await native.setNoteTags(item.id, current.filter((id) => id !== tagId));");
    expect(APP).toContain("await native.setQuickNoteTags(item.id, (quick?.tagIds ?? []).filter((id) => id !== tagId));");
    // 预览：doc 走共享 NoteDocPreview（HistorySnapshotPreview 对 doc 只出结构化兜底 ⇒ 曾整块空白）；
    // 行内自建内核宿主的自定义大字号样式已删
    expect(read("../../features/tags/TagPreviewBody.tsx")).toContain("NoteDocPreview");
    expect(read("../../features/tags/TagPreviewBody.tsx")).toContain("HistorySnapshotPreview");
    expect(read("../../features/tags/TagPreviewBody.tsx")).not.toContain("QuickNoteKernelPreview");
    // 261106 二批：手写板预览不在这里另写一套——非 doc 四族统一交给 HistorySnapshotPreview，
    // 它的 ink 分支再懒加载 InkPreview（只读画布）⇒ 标签空间与历史面板同一实现、同一容器
    const HSP = read("../../components/app/HistorySnapshotPreview.tsx");
    expect(HSP).toContain('import("../../features/ink/InkPreview")');
    expect(HSP).toContain("<InkPreview content={body} />");
    expect(read("../../features/tags/TagPreviewBody.tsx")).not.toContain("<InkPreview");
    expect(read("../../features/tags/tags.css")).not.toContain("tags-preview__doc");
    // 中栏最小 270（容器下限 720）
    const layout = read("../../features/tags/tagsLayout.ts");
    expect(layout).toContain("export const TAG_AGG_MIN = 270;");
    const layoutTest = read("../../features/tags/tagsLayout.test.ts");
    expect(layoutTest).toContain("toBe(200 + 270 + 240 + 10)");
    // 用户可见文案「打标签」清零（注释不计）
    for (const src of [SIDEBAR, NOTE_TAG_DIALOG, TAGS_WORKSPACE]) {
      expect(src).not.toContain(">打标签<");
      expect(src).not.toContain(">打标签…<");
      expect(src).not.toContain('aria-label="关闭打标签"');
      expect(src).not.toContain("给文档打标签");
      expect(src).not.toContain("给内容打标签");
      expect(src).not.toContain("打标签…</span>");
    }
  });
});
/**
 * 261106 三改（用户验收）：右栏文档预览只出少量信息（点击打开）、小记卡片限高 + 展开/收起 + 编辑、
 * 记住上次状态（选中标签/筛选/预览，localStorage 设备本地）。
 */
describe("标签空间：预览改版 + 记住上次状态（261106）", () => {
  it("文档预览不内嵌正文：只出模板信息、整卡点击 = 打开文档", () => {
    expect(TAGS_WORKSPACE).toContain("tags-preview__open-doc");
    expect(TAGS_WORKSPACE).toContain("点击打开文档");
    // 文档分支在读正文**之前**就 return（不调 onLoadPreview）
    expect(TAGS_WORKSPACE).toMatch(/if \(item\.kind === "doc"\) \{/);
    expect(TAGS_WORKSPACE).toContain("onClick={() => onOpenDocument(previewItem.id)}");
    // 类型名走统一映射（同一文档类型在标签空间/文档空间叫法一致）
    expect(TAGS_WORKSPACE).toContain("DOC_KIND_LABELS");
  });

  it("小记预览 = 卡片 + 限高令牌 + 展开/收起 + 编辑入口", () => {
    expect(TAGS_WORKSPACE).toContain("tags-preview__note-card");
    expect(TAGS_WORKSPACE).toContain("tags-preview__note-body");
    expect(TAGS_WORKSPACE).toContain("quickExpanded");
    expect(TAGS_WORKSPACE).toContain("onClick={() => setQuickExpanded((value) => !value)}");
    expect(TAGS_WORKSPACE).toContain('onClick={() => onOpenQuickNote(previewItem.id)}>编辑');
    // 限高走令牌（240px 定义在 themes/base.css；这里不出现字号/尺寸字面量）
    expect(read("../../styles/themes/base.css")).toContain("--lake-preview-note-max-h: 240px;");
    const css = read("../../features/tags/tags.css");
    expect(css).toContain("max-height: var(--lake-preview-note-max-h);");
    expect(css).toContain(".tags-preview__note-card.is-expanded .tags-preview__note-body");
  });

  it("记住上次状态：设备本地 localStorage；恢复选中标签/筛选/预览，坏值与已删标签兜底", () => {
    const STATE = read("../../features/tags/tagsWorkspaceState.ts");
    expect(STATE).toContain('"lakex-local-notes-v3.tags-state"');
    expect(STATE).toContain("parseTagSpaceState");
    expect(STATE).toContain("resolveTagSpaceState");
    expect(TAGS_WORKSPACE).toContain("readTagSpaceState()");
    expect(TAGS_WORKSPACE).toContain("writeTagSpaceState({");
    expect(TAGS_WORKSPACE).toContain("resolveTagSpaceState(restoredState");
    // 降级时不写坏状态
    expect(TAGS_WORKSPACE).toMatch(/if \(!restored \|\| !available \|\| dataError\) return;/);
    // 三栏宽度不重复存（仍在 tagsLayout 的键里，本模块只存选中/筛选/预览/滚动）
    expect(STATE).not.toContain("TAG_LAYOUT_STORAGE_KEY");
    expect(STATE).not.toContain("serializeTagLayout");
  });
});
