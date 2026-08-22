/**
 * 桌面服务适配器（V5 Phase 3）：把 LakeNative（IPC facade）字段映射到跨端契约 DTO。
 * - createNote 父目录语义：parentId=null → 默认个人笔记本（native.createNote），否则 createNoteIn；
 * - saveNoteContent / renameNote 拆分（替代原 saveNote 混合签名）；
 * - uploadResource 参数顺序：noteId → filename → bytes（替代原 {bytes, filename} + noteId）。
 * 契约不含：导出 docx/pdf、S3 GC、pickExportDir、窗口控制（桌面专属，native.ts 保留）。
 */
import type { LakeNative } from "./native";
import type {
  AppServices,
  NoteDigestDto,
  NoteDto,
  QuickNoteDto,
  SyncResultDto,
  SyncStatusDto,
  TrashItemDto,
  TreeNodeDto,
  UploadedAssetDto,
} from "../core/services.js";

function noteToDto(note: {
  id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string;
  content: string; syncState: string; isLocked?: boolean;
}): NoteDto {
  return {
    id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder,
    updatedAt: note.updatedAt, content: note.content,
    syncState: note.syncState as NoteDto["syncState"],
    isLocked: note.isLocked ?? false,
  };
}

function treeNodeToDto(node: {
  id: string; parentId: string | null; nodeType: string; title: string; sortOrder: number;
  updatedAt: string; noteFileId: string | null;
}): TreeNodeDto {
  return {
    id: node.id, parentId: node.parentId,
    nodeType: (node.nodeType === "notebook" || node.nodeType === "group" || node.nodeType === "note" ? node.nodeType : "note"),
    title: node.title, sortOrder: node.sortOrder, updatedAt: node.updatedAt, noteFileId: node.noteFileId,
  };
}

function quickNoteToDto(item: {
  id: string; createdAt: string; updatedAt: string; syncState: string; isConflict: boolean;
  content: { text: string; images: Array<{ id: string; filename: string; mimeType: string; width: number | null; height: number | null; size: number }> };
}): QuickNoteDto {
  return {
    id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt,
    text: item.content.text, images: item.content.images,
    syncState: item.syncState as QuickNoteDto["syncState"], isConflict: item.isConflict,
  };
}

function trashItemToDto(item: { id: string; title: string; deletedAt: string | null }): TrashItemDto {
  return { id: item.id, title: item.title, deletedAt: item.deletedAt ?? "" };
}

function assetToDto(asset: { url: string; filename: string; mimeType: string; size: number }): UploadedAssetDto {
  return { url: asset.url, filename: asset.filename, mimeType: asset.mimeType, size: asset.size };
}

function syncResultToDto(result: { uploaded: number; downloaded: number; conflicts: number; completedAt: string }): SyncResultDto {
  return { uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts, completedAt: result.completedAt };
}

function syncStatusToDto(info: { lastSyncedAt: string | null }): SyncStatusDto {
  // 桌面端实时 phase 由渲染层运行时状态持有（snapshot.sync / 同步反馈），
  // 契约侧只暴露稳定的持久事实（最近同步时间）。
  return { phase: "idle", message: "", lastSyncedAt: info.lastSyncedAt };
}

/** 桌面适配器装配：以 LakeNative 为底层，产出跨端契约（移动端可换 RN/WebView 实现）。 */
export function createNativeServices(api: LakeNative): AppServices {
  return {
    notes: {
      listTree: () => api.listTreeNodes().then((nodes) => nodes.map(treeNodeToDto)),
      readNote: (id) => api.readNote(id).then(noteToDto),
      createNote: (parentId, title) =>
        (parentId === null ? api.createNote(title) : api.createNoteIn(parentId, title)).then(noteToDto),
      saveNoteContent: (id, title, content) => api.saveNote(id, title, content).then(noteToDto),
      renameNote: (id, title) => api.renameTreeNode(id, title).then(treeNodeToDto),
      moveNote: (id, parentId, sortOrder) => api.moveTreeNode(id, parentId, sortOrder).then(treeNodeToDto),
      deleteNote: (id) => api.deleteNote(id),
      getNoteDigest: (id) => api.getNoteDigest(id).then((digest) => digest ? ({ id: digest.id, title: digest.title, updatedAt: digest.updatedAt, deleted: digest.deleted } satisfies NoteDigestDto) : null),
    },
    quickNotes: {
      list: () => api.listQuickNotes().then((items) => items.map(quickNoteToDto)),
      create: (input) =>
        api.createQuickNote({ text: input.text, draftId: input.draftId, stagedImageIds: input.stagedImageIds }).then(quickNoteToDto),
      update: (id, input) =>
        api.updateQuickNote(id, { text: input.text, draftId: input.draftId, stagedImageIds: input.stagedImageIds, retainedImageIds: input.retainedImageIds }).then(quickNoteToDto),
      delete: (id) => api.deleteQuickNote(id),
    },
    trash: {
      list: () => api.listTrash().then((items) => items.map(trashItemToDto)),
      restore: (id) => api.restoreTrash(id),
      purge: (id) => api.purgeTrash(id),
      empty: () => api.emptyTrash(),
    },
    assets: {
      upload: (noteId, filename, bytes) =>
        api.uploadResource({ bytes: Array.from(bytes), filename }, noteId).then(assetToDto),
      downloadRemote: (url, noteId) => api.downloadRemoteResource(url, noteId).then(assetToDto),
    },
    sync: {
      syncNow: () => api.syncNow().then(syncResultToDto),
      getStatus: () => api.getSyncStatus().then(syncStatusToDto),
      onProgress: (callback) => api.onSyncProgress((progress) => callback(progress.phase, progress.message)),
    },
  };
}
