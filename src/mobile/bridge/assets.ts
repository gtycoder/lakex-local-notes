/**
 * C3-5 第②步（a）：资产域 —— 从 bridge.ts 抽出（零行为变化）。
 *
 * 只含「本地资源读写/预览/另存/孤儿清理/上传落盘」；下载已声明资产属于同步域，见 sync.ts。
 */
import { Filesystem, Directory } from "@capacitor/filesystem";
import { registerPlugin } from "@capacitor/core";
import { loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs, bytesToBase64 } from "../native/assetFs";
import { buildAssetFilename, extractAssetRefs, isSafeShellOpenFilename, mimeTypeForFilename } from "../../core/assetNaming.js";
import { isSafePathSegment } from "../../core/storeUtils.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { normalizeNoteKind } from "../../core/noteKind.js";
import { readNoteBody } from "../data/noteBodies";
import { assets, assertResourceBytes, ensureDb, runWrite } from "./context";
import * as orphanAssetRepository from "../data/orphanAssetRepository";

/** 系统默认应用打开本地文件（与 DocumentEditor 同插件）。 */
const OpenFile = registerPlugin<{
  open: (opts: { path: string }) => Promise<void>;
  saveAs: (opts: { path: string; name: string; mime?: string }) => Promise<void>;
}>("OpenFile");

export const assetsDomain = {
  async readAssetPreview(noteId: string, filename: string) {
    const mimeType = mimeTypeForFilename(filename);
    if (!mimeType.startsWith("image/")) return { filename, mimeType, supported: false };
    const bytes = await loadAssetBytesFs(`${noteId}/${filename}`);
    if (!bytes || bytes.length > 32 * 1024 * 1024) return { filename, mimeType, supported: false };
    return { filename, mimeType, supported: true, dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}` };
  },

  /** 系统默认应用打开本地附件（OpenFile 原生插件）。 */
  async openAttachment(noteId: string, filename: string) {
    // 与桌面 open_attachment 对齐：禁止 shell/ACTION_VIEW 打开可执行类附件
    if (!isSafeShellOpenFilename(filename)) {
      throw new Error("该附件类型不允许用系统应用打开（疑似可执行文件）");
    }
    const uri = await Filesystem.getUri({ path: `note-assets/${noteId}/${filename}`, directory: Directory.Data });
    await OpenFile.open({ path: uri.uri.replace(/^file:\/\//, "") });
    return { ok: true };
  },

  /**
   * 另存为到用户可见区域：图片 → 相册（MediaStore），其它附件 → SAF 系统"保存到"面板。
   * 私有 Data 目录里的文件用户看不到，这是把它转出去的唯一合规路径。
   */
  async saveAssetAs(noteId: string, filename: string, name?: string) {
    const uri = await Filesystem.getUri({ path: `note-assets/${noteId}/${filename}`, directory: Directory.Data });
    await OpenFile.saveAs({ path: uri.uri.replace(/^file:\/\//, ""), name: name || filename });
    return { ok: true };
  },

  /** 全局孤儿资源列表（对齐桌面 listOrphanAssets）。 */
  async listOrphanAssets(): Promise<Array<{ id: number; noteId: string; filename: string; size: number; mimeType: string; detectedAt: string }>> {
    const d = await ensureDb();
    return await orphanAssetRepository.listOrphanAssets(d);
  },

  /** 删除单个孤儿资源（本地文件 + 登记）。 */
  async deleteOrphanAsset(id: number): Promise<void> {
    await runWrite("deleteOrphanAsset", async () => {
      const d = await ensureDb();
      await orphanAssetRepository.deleteOrphanAsset(d, id, { assets, removeAssetFile: removeAssetBytesFs });
    });
  },

  /** 清理全部孤儿资源（本地文件 + 登记）。 */
  async cleanOrphanAssets(): Promise<void> {
    await runWrite("cleanOrphanAssets", async () => {
      const d = await ensureDb();
      await orphanAssetRepository.cleanOrphanAssets(d, { assets, removeAssetFile: removeAssetBytesFs });
    });
  },

  /** D8+：图片/附件上传（Lake 编辑器粘贴/插入调用）。本地落盘 + 返回 canonical URL（本地 AssetServer 服务）。
   * 附件（非图片）同样走本路径：任意字节落盘 + 保留原扩展名（与桌面 assetNaming 命名一致）。 */
  async uploadResource(
    input: { bytes: Uint8Array; filename: string },
    noteId: string
  ): Promise<{ url: string; resourceRef: string; filename: string; mimeType: string; size: number }> {
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes as unknown as ArrayLike<number>);
    assertResourceBytes(bytes);
    // 与桌面一致的资产文件名（共享 buildAssetFilename：{13ts}_{8hex}.{ext}，extractAssetRefs 正则匹配）
    const name = buildAssetFilename(input.filename);
    const key = noteId + "/" + name;
    assets.set(key, bytes);
    try {
      await saveAssetBytesFs(key, bytes);
    } catch (e) {
      assets.delete(key);
      throw new Error("图片落盘失败: " + (e as Error).message);
    }
    const mimeType = mimeTypeForFilename(name);
    const url = localAssetHttpUrl(noteId, name);
    // filename 字段 = 原始文件名（Lake file 卡片展示名；磁盘名/同步用 URL 里的生成名，与桌面一致）
    const displayName = input.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "附件";
    return { url, resourceRef: url, filename: displayName, mimeType, size: bytes.length };
  },

  /**
   * 按 filename 删除本笔记里**当前正文未引用**的资产（P7：PDF 导入失败/取消清已上传页图 + 删暂存 PDF）。
   * 桌面版 = cleanNoteOrphans（当前正文 ∪ 历史 ∪ 草稿保护，按 DB 登记 + 文件系统对账）；
   * 移动端这里只做「定向 + 当前正文保护」——调用方只会传**本轮新上传**的 filename（从未进过历史/草稿），
   * 所以不需要移动端再去扫历史 refs。未列 filenames = 不删（不做全局扫）。
   */
  async cleanNoteOrphans(noteId: string, filenames?: string[]): Promise<{ count: number }> {
    if (!isSafePathSegment(noteId) || !filenames || filenames.length === 0) return { count: 0 };
    return runWrite("cleanNoteOrphans", async () => {
      const d = await ensureDb();
      const protectedRefs = new Set<string>();
      const row = await d.prepare("SELECT doc_kind FROM notes WHERE id=?").get(noteId) as { doc_kind?: string | null } | undefined;
      if (row) {
        const body = await readNoteBody(normalizeNoteKind(row.doc_kind), noteId);
        if (body) for (const name of extractAssetRefs(body)) protectedRefs.add(name);
      }
      let count = 0;
      for (const filename of filenames) {
        if (!isSafePathSegment(filename) || protectedRefs.has(filename)) continue;
        const key = noteId + "/" + filename;
        try {
          await removeAssetBytesFs(key);
          assets.delete(key);
          await d.prepare("DELETE FROM orphan_assets WHERE note_id=? AND filename=?").run(noteId, filename);
          count += 1;
        } catch { /* 删不掉保留登记，下次再清 */ }
      }
      return { count };
    });
  },
};
