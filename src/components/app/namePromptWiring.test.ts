import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261105 用户验收接线护栏：**所有「需要写名字」的新建都走同一个 NamePromptDialog**
 * （notebook/group/note/usheet/bitable/board/ink），不再有内联创建行，也不再「创建后自动重命名」。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SIDEBAR = read("./Sidebar.tsx");
const TAGS = read("../../features/tags/TagsWorkspace.tsx");
const TREE_ACTIONS = read("../../hooks/useTreeActions.ts");
const NOTE_LIFECYCLE = read("../../hooks/useNoteLifecycle.ts");
const APP = read("../../App.tsx");
const DIALOG = read("./NamePromptDialog.tsx");

describe("统一新建弹窗（NamePromptDialog）", () => {
  it("共用弹窗原语：ln-dialog + autofocus 输入 + Enter 提交 / Esc 取消 + 空名禁用 + 错误就地", () => {
    expect(DIALOG).toContain("Dialog");
    expect(DIALOG).toContain("InlineRenameInput");
    expect(DIALOG).toContain("initialValue");
    expect(DIALOG).toContain("disabled={busy || !trimmed}");
    expect(DIALOG).toContain('role="alert"');
    expect(DIALOG).toContain("onCancel={onClose}");
    // 用户复验：结构与「重命名」弹窗一致 —— head 与 body 同级、actions 是 body 的兄弟、尺寸复用 rename 那套
    expect(DIALOG).toContain('className="name-prompt-dialog"');
    expect(DIALOG).toContain("initialFocus={inputRef}");
    const headIdx = DIALOG.indexOf('className="ln-dialog__head"');
    const bodyIdx = DIALOG.indexOf('className="ln-dialog__body"');
    const actionsIdx = DIALOG.indexOf('className="ln-dialog__actions"');
    expect(headIdx).toBeGreaterThan(0);
    expect(headIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(actionsIdx);
    // 按钮层级与 rename 一致：主 primary「创建」/ 次 ghost「取消」；错误行不再用 ln-empty
    expect(DIALOG).toContain('className="ln-btn ln-btn--primary"');
    expect(DIALOG).toContain('className="ln-btn ln-btn--ghost"');
    expect(DIALOG).toContain('className="name-prompt-dialog__error"');
    expect(DIALOG).not.toContain("ln-empty");
    // 样式复用（不另写一套尺寸/内距）：与 rename 并排；标题/正文档与控件高度组也包含它
    const CSS = read("../../styles/dialog.css");
    expect(CSS).toContain(".rename-dialog,\n.name-prompt-dialog,\n.note-tag-dialog { width: min(460px, 92vw); }");
    expect(CSS).toContain(".name-prompt-dialog__error {");
    expect(read("../../styles/overlay.css")).toContain(".rename-dialog, .name-prompt-dialog, .s3-transfer-dialog");
    expect(read("../../styles/feature.css")).toContain(".rename-dialog,\n.name-prompt-dialog,");
  });

  it("Sidebar：七个 kind 的弹窗预设（六个 kind 预填默认名）+ 统一提交/选中/滚动", () => {
    expect(SIDEBAR).toContain("<NamePromptDialog");
    expect(SIDEBAR).toContain("CREATE_DIALOG_PRESETS");
    for (const [title, inputLabel, defaultName] of [
      ["新建分组", "分组名称", "新建分组"],
      ["新建文档", "文档名称", "无标题文档"],
      ["新建表格", "表格名称", "无标题表格"],
      ["新建多维表", "多维表名称", "无标题多维表"],
      ["新建画板", "画板名称", "无标题画板"],
      ["新建手写板", "手写板名称", "无标题手写板"],
    ] as const) {
      expect(SIDEBAR, title).toContain('title: "' + title + '"');
      expect(SIDEBAR, inputLabel).toContain('inputLabel: "' + inputLabel + '"');
      expect(SIDEBAR, defaultName).toContain('defaultName: "' + defaultName + '"');
    }
    expect(SIDEBAR).toContain("initialValue={preset.defaultName}");
    expect(SIDEBAR).toContain("const id = await Promise.resolve(props.onCreate(kind, parentId, title));");
    // 261105 回归：只有文档类 onSelect 打开；笔记本/分组是树节点 id，不能当 note 打开（否则「笔记不存在」）。
    expect(SIDEBAR).toContain('if (kind !== "notebook" && kind !== "group") props.onSelect(id);');
    expect(SIDEBAR).toContain("window.requestAnimationFrame(() => revealNodeRef.current(id));");
    expect(SIDEBAR).toContain("revealNodeRef.current(id)");
  });

  it("内联创建与「创建后自动重命名」已移除（普通重命名入口保留）", () => {
    expect(SIDEBAR).not.toContain("pendingCreate");
    expect(SIDEBAR).not.toContain("createField");
    expect(SIDEBAR).not.toContain("inline-create");
    expect(NOTE_LIFECYCLE).not.toContain("setPendingRenameId(note.id)");
    expect(SIDEBAR).toContain("const beginRename = useCallback");
    expect(TAGS).toContain('ariaLabel={"重命名标签 " + entry.name}');
  });

  it("所有入口都走同一弹窗：目录右键/行内「＋」、资料库空态「新建文档」", () => {
    // 目录：create() 与 createChild() 都只打开弹窗（不再直接 onCreate / 内联行）
    const openCount = (SIDEBAR.match(/openCreateDialog\(/g) ?? []).length;
    expect(openCount).toBeGreaterThanOrEqual(2); // create + createChild（定义在 useCallback 里，不计入）
    expect(SIDEBAR).not.toContain("props.onCreate(kind, parentId);");
    // 资料库空态「新建文档」= App 级同一弹窗（预填默认名）
    expect(APP).toContain("<NamePromptDialog");
    expect(APP).toContain('title="新建文档"');
    expect(APP).toContain('initialValue="无标题文档"');
    expect(APP).toContain("onCreateNote={() => { setNewNoteError(null); setNewNoteOpen(true); }}");
    expect(APP).not.toContain("void createNote()");
  });

  it("数据层：六 kind 收标题并回传 id；失败一律对弹窗抛出（就地显示）", () => {
    expect(TREE_ACTIONS).toContain("return await createNoteIn(parentId, resolvedTitle);");
    expect(TREE_ACTIONS).toContain("return await createUsheetIn(parentId, resolvedTitle);");
    expect(TREE_ACTIONS).toContain("return await createBitableIn(parentId, resolvedTitle);");
    expect(TREE_ACTIONS).toContain("return await createBoardIn(parentId, resolvedTitle);");
    expect(TREE_ACTIONS).toContain("return await createInkIn(parentId, resolvedTitle);");
    expect(TREE_ACTIONS).toContain("const node = await native.createGroup(parentId, resolvedTitle);");
    expect(TREE_ACTIONS).toContain("throw reason;");
    // 笔记类创建器收标题 + 回传 id（useNoteLifecycle）
    expect(NOTE_LIFECYCLE).toContain("async function createNoteIn(parentId: string | null, title = ");
    expect(NOTE_LIFECYCLE).toContain("): Promise<string> {");
    expect(NOTE_LIFECYCLE).toContain("return note.id;");
  });

  it("标签空间：＋新建/空态 CTA 同一弹窗；创建后 reload + 选中", () => {
    expect(TAGS).toContain("<NamePromptDialog");
    expect(TAGS).toContain('title="新建标签"');
    expect(TAGS).toContain("onSubmit={createTag}");
    expect(TAGS).toContain("setSelectedTagId(id)");
    expect(TAGS).not.toContain("tags-dir__create");
  });
});
