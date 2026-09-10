import { describe, expect, it } from "vitest";

export interface TreeBehaviorAdapter {
  createNotebook(title: string): Promise<string>;
  createGroup(parentId: string, title: string): Promise<string>;
  createNote(parentId: string, title: string): Promise<string>;
  trashTree(rootId: string): Promise<void>;
  restoreTree(rootId: string): Promise<void>;
  notebookTreeIds(notebookId: string): Promise<string[]>;
  isNoteTrashed(noteId: string): Promise<boolean>;
  noteParentId(noteId: string): Promise<string | null>;
  noteSyncState(noteId: string): Promise<string>;
  dispose?(): Promise<void> | void;
}

export function defineTreeBehaviorContract(
  platformName: string,
  createAdapter: () => TreeBehaviorAdapter | Promise<TreeBehaviorAdapter>,
): void {
  describe(`${platformName} tree behavior contract`, () => {
    it("trashes and restores nested documents through the notebook subtree", async () => {
      const adapter = await createAdapter();
      try {
        const notebookId = await adapter.createNotebook("嵌套子树契约");
        const groupId = await adapter.createGroup(notebookId, "分组");
        const parentId = await adapter.createNote(groupId, "父文档");
        const childId = await adapter.createNote(parentId, "子文档");
        const grandchildId = await adapter.createNote(childId, "孙文档");

        const initialTree = await adapter.notebookTreeIds(notebookId);
        expect(initialTree).toEqual(expect.arrayContaining([groupId, parentId, childId, grandchildId]));
        expect(await adapter.noteParentId(parentId)).toBe(groupId);
        expect(await adapter.noteParentId(childId)).toBe(parentId);
        expect(await adapter.noteParentId(grandchildId)).toBe(childId);

        await adapter.trashTree(notebookId);

        const trashedTree = await adapter.notebookTreeIds(notebookId);
        expect(trashedTree).not.toEqual(expect.arrayContaining([groupId, parentId, childId, grandchildId]));
        for (const noteId of [parentId, childId, grandchildId]) {
          expect(await adapter.isNoteTrashed(noteId)).toBe(true);
        }

        await adapter.restoreTree(notebookId);

        const restoredTree = await adapter.notebookTreeIds(notebookId);
        expect(restoredTree).toEqual(expect.arrayContaining([groupId, parentId, childId, grandchildId]));
        expect(await adapter.noteParentId(parentId)).toBe(groupId);
        expect(await adapter.noteParentId(childId)).toBe(parentId);
        expect(await adapter.noteParentId(grandchildId)).toBe(childId);
        for (const noteId of [parentId, childId, grandchildId]) {
          expect(await adapter.isNoteTrashed(noteId)).toBe(false);
          expect(await adapter.noteSyncState(noteId)).toBe("local");
        }
      } finally {
        await adapter.dispose?.();
      }
    });
  });
}
