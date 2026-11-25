/**
 * M-02 对拍（审计 03-mobile）：`collectSubtree` 的两路边集必须与共享场景表一致。
 * 场景表 = src/core/trashSubtreeScenarios.ts（判据单一来源）；桌面侧由 electron/trashCascade.test.ts
 * 用同一张表对拍 SQL 递归实现（两端实现不合并，只对拍判据数据）。
 */
import { describe, expect, it } from "vitest";
import { collectSubtree, type ParentedNode } from "./trashSubtree";
import { TRASH_SUBTREE_SCENARIOS, type TrashSubtreeScenarioNode } from "../../core/trashSubtreeScenarios.js";

/** 场景行 → collectSubtree 的输入形状（folders / notes 两张表的行）。 */
const toParented = (node: TrashSubtreeScenarioNode): ParentedNode => ({
  id: node.id,
  parent_id: node.parent_id,
  deleted_from_parent_id: node.deleted_from_parent_id ?? null,
  trashed_at: node.trashed_at ?? null,
});

describe("M-02 两路边集共享场景表对拍（core/trashSubtreeScenarios）", () => {
  for (const scenario of TRASH_SUBTREE_SCENARIOS) {
    it(scenario.title, () => {
      const folders = scenario.nodes.filter((node) => node.kind === "folder").map(toParented);
      const notes = scenario.nodes.filter((node) => node.kind === "note").map(toParented);
      const subtree = collectSubtree(folders, notes, scenario.rootId);
      expect([...subtree.folderIds].sort()).toEqual([...scenario.expect.folderIds].sort());
      expect([...subtree.noteIds].sort()).toEqual([...scenario.expect.noteIds].sort());
      expect([...subtree.allIds].sort()).toEqual([...scenario.expect.allIds].sort());
    });
  }
});
