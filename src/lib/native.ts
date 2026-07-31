import type { NoteDocument, ResourceUploadInput, ResourceUploadOutput, TreeNode, WorkspaceSnapshot } from "./types";

interface LakeNative {
  bootstrap(): Promise<WorkspaceSnapshot>;
  readNote(id: string): Promise<NoteDocument>;
  createNote(title: string): Promise<NoteDocument>;
  saveNote(id: string, title: string, content: string): Promise<NoteDocument>;
  deleteNote(id: string): Promise<void>;
  listTreeNodes(): Promise<TreeNode[]>;
  createNotebook(title: string): Promise<TreeNode>;
  createGroup(parentId: string, title: string): Promise<TreeNode>;
  renameTreeNode(id: string, title: string): Promise<TreeNode>;
  createNoteIn(parentId: string | null, title: string): Promise<NoteDocument>;
  moveTreeNode(id: string, parentId: string | null, sortOrder: number): Promise<TreeNode>;
  reorderTreeNodes(parentId: string | null, orderedIds: string[]): Promise<void>;
  deleteTreeNode(id: string): Promise<void>;
  uploadResource(input: ResourceUploadInput): Promise<ResourceUploadOutput>;
  downloadRemoteResource(url: string): Promise<ResourceUploadOutput>;
}

declare global {
  interface Window { lakeNative?: LakeNative; }
}

export const isDesktop = () => typeof window.lakeNative !== "undefined";

function api(): LakeNative {
  if (!window.lakeNative) throw new Error("原生桥接未就绪，请在 Electron 环境中运行");
  return window.lakeNative;
}

export const native = {
  bootstrap: () => api().bootstrap(),
  readNote: (id: string) => api().readNote(id),
  createNote: (title: string) => api().createNote(title),
  saveNote: (id: string, title: string, content: string) => api().saveNote(id, title, content),
  deleteNote: (id: string) => api().deleteNote(id),
  listTreeNodes: () => api().listTreeNodes(),
  createNotebook: (title: string) => api().createNotebook(title),
  createGroup: (parentId: string, title: string) => api().createGroup(parentId, title),
  renameTreeNode: (id: string, title: string) => api().renameTreeNode(id, title),
  createNoteIn: (parentId: string | null, title: string) => api().createNoteIn(parentId, title),
  moveTreeNode: (id: string, parentId: string | null, sortOrder: number) => api().moveTreeNode(id, parentId, sortOrder),
  reorderTreeNodes: (parentId: string | null, orderedIds: string[]) => api().reorderTreeNodes(parentId, orderedIds),
  deleteTreeNode: (id: string) => api().deleteTreeNode(id),
  uploadResource: (input: ResourceUploadInput) => api().uploadResource(input),
  downloadRemoteResource: (url: string) => api().downloadRemoteResource(url),
};
