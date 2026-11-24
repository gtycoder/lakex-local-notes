/**
 * 图片预览「保存到手机」（261124 用户点单：点图片预览之后长按触发菜单，可以保存到手机上）。
 *
 * 分层：共享 Lightbox 只提供长按动作槽（features/editor/imagePreview.setPreviewActions）；
 * 保存实现留在移动层 —— 按资产 localKey 让原生**按路径直读**（字节不过 WebView 桥），
 * 图片走 OpenFile.saveAs 的相册分支（MediaStore Pictures，系统图库立即可见）。
 */
import { setPreviewActions, type PreviewImage } from "../../features/editor/imagePreview";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { saveFileToUserVisible } from "./openFileSave";
import { showToast } from "../ui/toastBus";

/** 预览 URL → 资产 localKey（App 私有资产根下的相对路径）；staging 草稿/非本机资产返回 null。 */
export function assetLocalKeyOf(src: string): string | null {
  const ref = parseLocalAssetUrl(src);
  if (!ref || ref.staging) return null;
  return ref.space === "note" ? `note-assets/${ref.noteId}/${ref.filename}` : `quick-notes/assets/${ref.noteId}/${ref.filename}`;
}

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "image/*";
}

/** 注册预览长按动作（移动端启动时调用一次）。 */
export function installImagePreviewSave(): void {
  setPreviewActions([{
    id: "save-to-phone",
    label: "保存到手机",
    run: async (image: PreviewImage) => {
      // 保存原图（原图 URL 去了显示档位参数）；没有原图就保存当前显示档位。
      const url = typeof image.originalSrc === "string" && image.originalSrc ? image.originalSrc : image.src;
      const ref = parseLocalAssetUrl(url);
      const localKey = assetLocalKeyOf(url);
      if (!ref || !localKey) {
        showToast(ref?.staging ? "暂存中的图片请先保存草稿，再从正文预览保存" : "该图片不在本机资源库（可能是云端链接），暂不支持保存到手机", { type: "error" });
        return;
      }
      const result = await saveFileToUserVisible({ localKey, name: ref.filename, mime: mimeFor(ref.filename), toDownloads: false });
      showToast(
        result.ok ? `已保存到相册：${ref.filename}` : "保存失败：" + (result.error ?? "未知原因"),
        { type: result.ok ? "info" : "error" },
      );
    },
  }]);
}
