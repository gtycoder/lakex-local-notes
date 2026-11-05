import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261105 用户验收接线护栏：新建笔记本 / 新建标签都走同一个 NamePromptDialog
 * （标题 + 输入框 + Enter/Esc + 空名禁用 + 错误就地显示），不再用内联输入行新建。
 * 行内重命名保留 InlineRenameInput（编辑 ≠ 新建）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SIDEBAR = read("./Sidebar.tsx");
const TAGS = read("../../features/tags/TagsWorkspace.tsx");
const TREE_ACTIONS = read("../../hooks/useTreeActions.ts");
const DIALOG = read("./NamePromptDialog.tsx");

describe("新建笔记本 / 新建标签 = 弹窗（NamePromptDialog）", () => {
  it("共用弹窗原语：ln-dialog + autofocus 输入 + Enter 提交 / Esc 取消 + 空名禁用 + 错误就地", () => {
    expect(DIALOG).toContain("Dialog");
    expect(DIALOG).toContain("InlineRenameInput");
    expect(DIALOG).toContain("emptyPolicy=\"fallback\"");
    expect(DIALOG).toContain("disabled={busy || !trimmed}");
    expect(DIALOG).toContain("role=\"alert\"");
    expect(DIALOG).toContain("onCancel={onClose}");
  });

  it("Sidebar：+ → 新建笔记本打开弹窗；提交 await onCreate → 关闭 → 选中/滚动；内联行已移除", () => {
    expect(SIDEBAR).toContain("<NamePromptDialog");
    expect(SIDEBAR).toContain('title="新建笔记本"');
    expect(SIDEBAR).toContain('inputLabel="笔记本名称"');
    expect(SIDEBAR).toContain('const id = await Promise.resolve(props.onCreate("notebook", null, title));');
    expect(SIDEBAR).toContain("props.onSelect(id)");
    expect(SIDEBAR).toContain("revealNodeRef.current(id)");
    // 内联笔记本创建行已删；分组内联行保留（文档/分组新建行为不变）
    expect(SIDEBAR).not.toContain('pendingCreate?.kind === "notebook" && createField(0)');
    expect(SIDEBAR).toContain('setNewTitle("新建分组")');
    // create() 不再为 notebook 走 pendingCreate
    expect(SIDEBAR).toContain("if (kind === \"notebook\") {");
  });

  it("数据层：创建笔记本返回新节点 id；失败对弹窗抛出（就地显示）", () => {
    expect(TREE_ACTIONS).toContain("const node = await native.createNotebook(resolvedTitle);");
    expect(TREE_ACTIONS).toContain("return node.id;");
    expect(TREE_ACTIONS).toContain('if (kind === "notebook") throw reason;');
    expect(TREE_ACTIONS).toContain("return createTreeItem(kind, parentId, title);");
  });

  it("TagsWorkspace：＋新建标签/空态 CTA 打开同一弹窗；创建后 reload + 选中；行内重命名仍在", () => {
    expect(TAGS).toContain("<NamePromptDialog");
    expect(TAGS).toContain('title="新建标签"');
    expect(TAGS).toContain('inputLabel="新标签名称"');
    expect(TAGS).toContain("onSubmit={createTag}");
    expect(TAGS).toContain("await onReload();");
    expect(TAGS).toContain("setSelectedTagId(id)");
    // 内联新建输入行已移除
    expect(TAGS).not.toContain("tags-dir__create");
    // 重命名仍是行内输入
    expect(TAGS).toContain('ariaLabel={"重命名标签 " + entry.name}');
  });
});
