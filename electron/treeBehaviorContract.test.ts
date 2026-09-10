import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineTreeBehaviorContract, type TreeBehaviorAdapter } from "../src/core/treeBehaviorContract.js";
import { Store } from "./store.js";

function createDesktopAdapter(): TreeBehaviorAdapter {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-tree-contract-"));
  const store = new Store(dir);

  return {
    async createNotebook(title) {
      return store.createNotebook(title).id;
    },
    async createGroup(parentId, title) {
      return store.createGroup(parentId, title).id;
    },
    async createNote(parentId, title) {
      return store.createNoteIn(parentId, title).id;
    },
    async trashTree(rootId) {
      store.deleteTreeNode(rootId);
    },
    async restoreTree(rootId) {
      store.restoreTrashItem(rootId);
    },
    async notebookTreeIds(notebookId) {
      const nodes = store.listTreeNodes();
      const childrenByParent = new Map<string | null, string[]>();
      for (const node of nodes) {
        const siblings = childrenByParent.get(node.parentId) ?? [];
        siblings.push(node.id);
        childrenByParent.set(node.parentId, siblings);
      }
      const ids: string[] = [];
      const queue = [notebookId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        ids.push(id);
        queue.push(...(childrenByParent.get(id) ?? []));
      }
      return ids;
    },
    async isNoteTrashed(noteId) {
      return Boolean(store.getNoteForSync(noteId)?.trashedAt);
    },
    async noteParentId(noteId) {
      return store.getNoteForSync(noteId)?.parentId ?? null;
    },
    async noteSyncState(noteId) {
      return store.getNoteForSync(noteId)?.syncState ?? "";
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

defineTreeBehaviorContract("Desktop", createDesktopAdapter);
