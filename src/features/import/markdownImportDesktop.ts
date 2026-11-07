/**
 * 261106 Markdown 导入：**桌面 host 适配**（把 native IPC 适配成 MarkdownImportHost）。
 *
 * 移动端（task-86）不引本文件，直接注入自己的 bridge 实现（同一 MarkdownImportHost 契约）。
 */
import { native } from "../../lib/native";
import type { MarkdownImportHost } from "./markdownBatchImport";

/** 桌面 host：树操作 / 建文档 / 资源上传 / 保存 / 软删（移入回收站）/ 读导入图片。 */
export function createDesktopMarkdownImportHost(): MarkdownImportHost {
  return {
    listTreeNodes: () => native.listTreeNodes(),
    createGroup: (parentId: string, title: string) => native.createGroup(parentId, title),
    createNoteIn: (parentId: string | null, title: string) => native.createNoteIn(parentId, title),
    createUsheetIn: (parentId: string | null, title: string) => native.createUsheetIn(parentId, title),
    uploadResource: (input, noteId) => native.uploadResource(input, noteId),
    saveNote: (id: string, title: string, body: string) => native.saveNote(id, title, body),
    // 失败回滚 = 软删（移入回收站），与「删除 = 移入回收站」一致
    deleteNote: (id: string) => native.deleteNote(id),
    readImportImage: async (absolutePath: string) => {
      const image = await native.readImportImage(absolutePath);
      // HTTP/JSON 客户端会把 bytes 传成 number[]；统一成 Uint8Array（与 upload_resource 同姿势）
      return { ...image, bytes: image.bytes instanceof Uint8Array ? image.bytes : new Uint8Array(image.bytes) };
    },
  };
}