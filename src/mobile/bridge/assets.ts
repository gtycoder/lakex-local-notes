/**
 * C3-5 第②步（a）：资产域 —— 从 bridge.ts 抽出（零行为变化）。
 *
 * 只含「本地资源读写/预览/另存/孤儿清理/上传落盘」；下载已声明资产属于同步域，见 sync.ts。
 */
import { Filesystem, Directory } from "@capacitor/filesystem";
import { registerPlugin } from "@capacitor/core";
import { loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs, bytesToBase64 } from "../native/assetFs";
import { buildAssetFilename, isSafeShellOpenFilename, mimeTypeForFilename } from "../../core/assetNaming.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
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
};
