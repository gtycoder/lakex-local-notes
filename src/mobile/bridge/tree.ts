/** C3-5 第③步：tree 域（从 bridge.ts 抽取，行为保持）。 */
import { ensureDb, runWrite } from "./context";
import { indexNote } from "../data/searchIndex.js";

import type { TreeNode } from "../../lib/types";

import * as treeRepository from "../data/treeRepository.js";
import * as notebookTreeRepository from "../data/notebookTreeRepository.js";


export const treeDomain = {
  async listTreeNodes(): Promise<TreeNode[]> {
    const d = await ensureDb();
    return await treeRepository.listTreeNodes(d);
  },

  async createNotebook(input: { title: string; icon: string | null }): Promise<TreeNode> {
    return runWrite("createNotebook", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createNotebook(d, input);
      return node;
    });
  },

  async createGroup(parentId: string, title: string): Promise<TreeNode> {
    return runWrite("createGroup", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createGroup(d, parentId, title);
      return node;
    });
  },

  async renameTreeNode(id: string, title: string): Promise<TreeNode> {
    return runWrite("renameTreeNode", async () => {
      const d = await ensureDb();
      const node = await treeRepository.renameTreeNode(d, id, title);
      // 重命名即时更新搜索索引（folder 重命名时 indexNote 找不到 notes 行，自动 no-op）。
      await indexNote(d, id);
      return node;
    });
  },

  async setNodeIcon(id: string, icon: string | null): Promise<TreeNode> {
    return runWrite("setNodeIcon", async () => {
      const d = await ensureDb();
      const node = await treeRepository.setNodeIcon(d, id, icon);
      return node;
    });
  },

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
    return runWrite("moveTreeNodeOrdered", async () => {
      const d = await ensureDb();
      const node = await treeRepository.moveTreeNodeOrdered(d, id, parentId, orderedIds);
      return node;
    });
  },

  async reorderSiblings(parentId: string | null, orderedIds: string[]): Promise<void> {
    return runWrite("reorderSiblings", async () => {
      const d = await ensureDb();
      await treeRepository.reorderSiblings(d, parentId, orderedIds);
    });
  },

  async listNotebookTree(notebookId: string): Promise<notebookTreeRepository.NotebookTreeItem[]> {
    const d = await ensureDb();
    return await notebookTreeRepository.listNotebookTree(d, notebookId);
  },
};
