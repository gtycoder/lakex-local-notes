import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 文档树多选的**接线护栏**（261106 task-8）：入口/行复选框/页头/底部条/返回键必须真的接在
 * 工作区与抽屉上（渲染行为见同目录 render 用例；纯判据见 treeSelection.test）。
 * 静态读源码的判据只钉「谁调用谁」，不重复断言文案细节。
 *
 * 用户定稿：**长按不抢拖拽**——目录行长按仍是拖拽排序，多选入口只有页头「选择」按钮。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WORKSPACE = read("./NotebookWorkspace.tsx");
const DRAWERS = read("./WorkspaceDrawers.tsx");
const PANELS = read("./WorkspacePanels.tsx");
const LIST = read("./NotebookTreeList.tsx");
const HOOK = read("./useTreeSelection.ts");
const DRAG = read("./useTreeDrag.ts");
const CHECKBOX = read("../ui/SelectionCheckbox.tsx");

describe("文档树多选：工作区接线（261106 task-8）", () => {
  it("工作区用 useTreeSelection，并把它接到树/抽屉/平板面板", () => {
    // 261107：批量创建副本前要先过保存屏障（flushSaves 经 ref 接线到 useWorkspaceSession.flushAllTabs）
    expect(WORKSPACE).toContain("useTreeSelection({");
    expect(WORKSPACE).toContain("flushSaves: () => flushSavesRef.current?.()");
    expect(WORKSPACE).toContain("flushSavesRef.current = flushAllTabs;");
    expect(WORKSPACE).toContain("selection={{");
    expect(WORKSPACE).toContain("onEnterSelect={() => selection.enter()}");
    expect(WORKSPACE).toContain("onCancelSelect={() => selection.exit()}");
    expect(WORKSPACE).toContain("onToggleAllSelect={() => selection.toggleAll()}");
    expect(WORKSPACE).toContain("selectionActions={treeSelection.actions}");
    expect(WORKSPACE).toContain("onSelectionAction={treeSelection.runAction}");
    expect(WORKSPACE).toContain("<MoveTargetTreeSheet {...treeSelection.moveSheet} />");
    // 抽屉收起（点遮罩/胶囊）⇒ 退出多选，避免选择态悬空。
    expect(WORKSPACE).toContain("if (padTwoPane ? !padTreeOpen : !sidebarOpen) selection.exit();");
  });

  it("长按不抢拖拽：目录行长按仍只做拖拽排序，多选入口只有页头「选择」", () => {
    // useTreeDrag 恢复原样（没有"长按认领"钩子）；工作区不再有长按进多选/吞 click 的接线。
    expect(DRAG).not.toContain("onLongPressNode");
    expect(WORKSPACE).not.toContain("onLongPressNode");
    expect(WORKSPACE).not.toContain("suppressTreeTap");
    // 入口在页头（手机抽屉文本按钮 / 平板图标钮都带同一 aria-label）。
    expect(DRAWERS).toContain('aria-label="选择文档"');
    expect(PANELS).toContain('aria-label="选择文档"');
  });

  it("返回键 / Esc：选择态先退出选择（不关抽屉）", () => {
    expect(HOOK).toContain("pushBackHandler(() => { selection.exit(); return true; })");
    expect(WORKSPACE).toContain("if (selection.active) { selection.exit(); return true; }");
  });

  it("行：选择态左缘复选框 + aria-selected + 隐藏 ⋮/＋；分组/笔记本置灰不可选", () => {
    expect(LIST).toContain("<SelectionCheckbox");
    expect(LIST).toContain("aria-selected={selecting ?");
    expect(LIST).toContain("selecting && selectable");
    expect(LIST).toContain("nb-sel-cb");
    expect(LIST).toContain("{!selecting && (");
    expect(CHECKBOX).toContain('role: "checkbox"');
    expect(CHECKBOX).toContain('"aria-label": label');
  });

  it("页头与底部条：抽屉/平板面板都挂同一套 SelectionTopBar + SelectionActionBar", () => {
    for (const source of [DRAWERS, PANELS]) {
      expect(source).toContain("<SelectionTopBar");
      expect(source).toContain("<SelectionActionBar");
      expect(source).toContain('aria-label="选择文档"');
    }
  });

  it("动作编排：创建副本走 duplicateNotes，移动/回收站走共享 runDocBatch（含统一确认与汇总）", () => {
    expect(HOOK).toContain("bridge.duplicateNotes({ ids: [...selectedIds] })");
    expect(HOOK).toContain("runDocBatch(selectedIds");
    expect(HOOK).toContain('{ action: "move", parentId }');
    expect(HOOK).toContain('{ action: "trash" }');
    expect(HOOK).toContain("duplicateResultNotice(result)");
    // 回收站二次确认 / 移动目标 / 标签目录 options 都复用 ui/docBatch 的单一来源。
    expect(HOOK).toContain("confirmTrashDocs(selectedIds.length)");
    expect(HOOK).toContain("moveTargetsFromSnapshot(snapshot)");
    expect(HOOK).toContain("tagOptionsFromTags(tags)");
  });
});
