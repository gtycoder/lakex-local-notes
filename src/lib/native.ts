import type { CleanOrphanResult, NoteDocument, OrphanAsset, QuickNoteDocument, QuickNoteImage, ResourceUploadInput, ResourceUploadOutput, S3Settings, SaveQuickNoteInput, SyncProgress, SyncResult, SyncStatusInfo, TreeNode, WorkspaceSnapshot } from "./types";

interface LakeNative {
  bootstrap(): Promise<WorkspaceSnapshot>;
  readNote(id: string): Promise<NoteDocument>;
  setNoteLocked(id: string, locked: boolean): Promise<NoteDocument>;
  createNote(title: string): Promise<NoteDocument>;
  saveNote(id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }): Promise<NoteDocument>;
  updateNoteCaches(id: string, markdown: string | null, plain: string | null): Promise<void>;
  readNoteCaches(id: string): Promise<{ markdown: string | null; plain: string | null }>;
  getNotePaths(id: string): Promise<{ title: string; lakePath: string; assetsDir: string }>;
  pickExportDir(): Promise<string | null>;
  exportNote(id: string, format: "markdown" | "html" | "lake" | "docx" | "pdf", baseDir?: string): Promise<{ format: string; exportPath: string; imageCount: number; skipped: number; size: number }>;
  setNodeIcon(id: string, icon: string | null): Promise<TreeNode>;
  deleteNote(id: string): Promise<void>;
  listTreeNodes(): Promise<TreeNode[]>;
  listNoteSummaries(): Promise<import("./types").NoteSummary[]>;
  createNotebook(title: string): Promise<TreeNode>;
  createGroup(parentId: string, title: string): Promise<TreeNode>;
  renameTreeNode(id: string, title: string): Promise<TreeNode>;
  createNoteIn(parentId: string | null, title: string): Promise<NoteDocument>;
  moveTreeNode(id: string, parentId: string | null, sortOrder: number): Promise<TreeNode>;
  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode>;
  reorderTreeNodes(parentId: string | null, orderedIds: string[]): Promise<void>;
  deleteTreeNode(id: string): Promise<void>;
  uploadResource(input: ResourceUploadInput, noteId: string): Promise<ResourceUploadOutput>;
  downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput>;
  listOrphanAssets(): Promise<OrphanAsset[]>;
  cleanOrphanAssets(): Promise<CleanOrphanResult>;
  getS3Settings(): Promise<S3Settings | null>;
  saveS3Settings(settings: S3Settings): Promise<void>;
  testS3Connection(): Promise<string>;
  syncNow(): Promise<SyncResult>;
  getSyncStatus(): Promise<SyncStatusInfo>;
  listQuickNotes(): Promise<QuickNoteDocument[]>;
  createQuickNote(input: SaveQuickNoteInput): Promise<QuickNoteDocument>;
  updateQuickNote(id: string, input: SaveQuickNoteInput): Promise<QuickNoteDocument>;
  deleteQuickNote(id: string): Promise<void>;
  stageQuickNoteImage(draftId: string, input: { bytes: number[]; filename: string }): Promise<QuickNoteImage>;
  discardQuickNoteDraft(draftId: string): Promise<void>;
  discardStagedQuickNoteImage(draftId: string, imageId: string): Promise<void>;
  convertQuickNote(quickNoteId: string, notebookId: string): Promise<NoteDocument>;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
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
  setNoteLocked: (id: string, locked: boolean) => api().setNoteLocked(id, locked),
  createNote: (title: string) => api().createNote(title),
  saveNote: (id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }) => api().saveNote(id, title, content, caches),
  updateNoteCaches: (id: string, markdown: string | null, plain: string | null) => api().updateNoteCaches(id, markdown, plain),
  readNoteCaches: (id: string) => api().readNoteCaches(id),
  getNotePaths: (id: string) => api().getNotePaths(id),
  pickExportDir: () => api().pickExportDir(),
  exportNote: (id: string, format: "markdown" | "html" | "lake" | "docx" | "pdf", baseDir?: string) => api().exportNote(id, format, baseDir),
  setNodeIcon: (id: string, icon: string | null) => api().setNodeIcon(id, icon),
  deleteNote: (id: string) => api().deleteNote(id),
  listTreeNodes: () => api().listTreeNodes(),
  listNoteSummaries: () => api().listNoteSummaries(),
  createNotebook: (title: string) => api().createNotebook(title),
  createGroup: (parentId: string, title: string) => api().createGroup(parentId, title),
  renameTreeNode: (id: string, title: string) => api().renameTreeNode(id, title),
  createNoteIn: (parentId: string | null, title: string) => api().createNoteIn(parentId, title),
  moveTreeNode: (id: string, parentId: string | null, sortOrder: number) => api().moveTreeNode(id, parentId, sortOrder),
  moveTreeNodeOrdered: (id: string, parentId: string | null, orderedIds: string[]) => api().moveTreeNodeOrdered(id, parentId, orderedIds),
  reorderTreeNodes: (parentId: string | null, orderedIds: string[]) => api().reorderTreeNodes(parentId, orderedIds),
  deleteTreeNode: (id: string) => api().deleteTreeNode(id),
  uploadResource: (input: ResourceUploadInput, noteId: string) => api().uploadResource(input, noteId),
  downloadRemoteResource: (url: string, noteId: string) => api().downloadRemoteResource(url, noteId),
  listOrphanAssets: () => api().listOrphanAssets(),
  cleanOrphanAssets: () => api().cleanOrphanAssets(),
  getS3Settings: () => api().getS3Settings(),
  saveS3Settings: (settings: S3Settings) => api().saveS3Settings(settings),
  testS3Connection: () => api().testS3Connection(),
  syncNow: () => api().syncNow(),
  getSyncStatus: () => api().getSyncStatus(),
  listQuickNotes: () => api().listQuickNotes(),
  createQuickNote: (input: SaveQuickNoteInput) => api().createQuickNote(input),
  updateQuickNote: (id: string, input: SaveQuickNoteInput) => api().updateQuickNote(id, input),
  deleteQuickNote: (id: string) => api().deleteQuickNote(id),
  stageQuickNoteImage: (draftId: string, input: { bytes: number[]; filename: string }) => api().stageQuickNoteImage(draftId, input),
  discardQuickNoteDraft: (draftId: string) => api().discardQuickNoteDraft(draftId),
  discardStagedQuickNoteImage: (draftId: string, imageId: string) => api().discardStagedQuickNoteImage(draftId, imageId),
  convertQuickNote: (quickNoteId: string, notebookId: string) => api().convertQuickNote(quickNoteId, notebookId),
  onSyncProgress: (callback: (progress: SyncProgress) => void) => api().onSyncProgress(callback),
};
