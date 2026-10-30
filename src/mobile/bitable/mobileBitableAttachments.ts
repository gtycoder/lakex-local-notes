/**
 * 移动端多维表：表单里上传附件/图片（261030 P1）。
 *
 * 为什么单独一层：`pickLocalFiles` 与 `bridge.uploadResource` 都是副作用入口（原生选择器 + 落盘），
 * 上传结果的**映射规则**（url → 磁盘名 file / 展示名 name / size）必须可单测，所以抽成「注入 uploader」的纯函数：
 * 组件只负责选文件、串流程、给 busy/error 反馈。
 *
 * 契约与桌面 `BitableEditor.uploadFiles` 完全一致：`file` = 本地资产磁盘名（parseLocalAssetUrl），
 * `name` = 原始文件名（空则回落磁盘名），`size` = 字节数。附件字段走同一路径（不按 MIME 分叉）。
 */
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import type { BitableAttachment } from "../../core/bitableDoc.js";

export interface BitableUploadResult {
  url: string;
  filename: string;
  size: number;
}

/** 一文件一次上传（顺序执行：原生侧并发上传容易抢内存，且表单一次最多几张）。 */
export type BitableUploader = (input: { bytes: Uint8Array; filename: string }) => Promise<BitableUploadResult>;

/** 把选中的本地文件上传成多维表附件值（顺序上传；任一失败即抛出，由调用方回滚与提示）。 */
export async function uploadBitableAttachments(files: readonly File[], upload: BitableUploader): Promise<BitableAttachment[]> {
  const out: BitableAttachment[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await upload({ bytes, filename: file.name });
    const diskName = parseLocalAssetUrl(uploaded.url)?.filename || uploaded.filename;
    out.push({
      file: diskName,
      name: file.name.trim() || diskName,
      size: typeof uploaded.size === "number" && uploaded.size >= 0 ? uploaded.size : bytes.length,
    });
  }
  return out;
}
