import type { QuickNoteDocument, QuickNoteImage } from "../../lib/types";

export interface DraftImage {
  image: QuickNoteImage;
  source: "saved" | "staged";
}

export interface DraftState {
  id: string;
  /** 纯文本镜像（由编辑器产出；判定「有内容」与预览）。 */
  text: string;
  /** 内核形态正文（编辑器产出；保存写入 `.qnote.body`）。 */
  body: string;
  images: DraftImage[];
  tagIds: string[];
  /**
   * 载入时的基线（**判定"有没有改过"用**）。
   * 曾经用 `hasDraftContent()` 判脏 ⇒ 只要编辑一条已有小记（它本来就有内容）就永远是"脏"的，
   * 于是切来切去总弹「是否放弃编辑」，还会把没改动的正文重写一遍（连带触发 S3）。用户 260919 报。
   */
  baseline: { text: string; body: string; imageCount: number; tagIds: string[] };
}

export const newDraft = (): DraftState => ({ id: crypto.randomUUID(), text: "", body: "", images: [], tagIds: [], baseline: { text: "", body: "", imageCount: 0, tagIds: [] } });

/** 用一条已保存小记开一份编辑草稿（基线 = 载入内容，用于"改没改过"判定）。 */
export const draftOf = (item: QuickNoteDocument): DraftState => ({
  id: crypto.randomUUID(),
  text: item.content.text,
  body: item.content.body,
  images: item.content.images.map((image) => ({ image, source: "saved" as const })),
  tagIds: [...item.content.tagIds],
  baseline: { text: item.content.text, body: item.content.body, imageCount: item.content.images.length, tagIds: [...item.content.tagIds] },
});
export const hasDraftContent = (draft: DraftState) => draft.text.trim().length > 0 || draft.images.length > 0;

/**
 * 「改过没有」= 与载入基线比较（不是"有没有内容"）。
 * 文本先做**去噪归一**：内核空文档的 `text/plain` 是 `"\uFEFF\n"`（零宽 BOM + 换行），
 * 直接字符串比较会把"没动过的新草稿"判成脏（260919 用户报：列表页点条目打不开、还弹「请至少记录文字或一张图片」）。
 */
const normalizeMirror = (text: string) => text.replace(/[\uFEFF\u200B]/g, "").trim();
export const isDraftDirty = (draft: DraftState) =>
  normalizeMirror(draft.text) !== normalizeMirror(draft.baseline.text)
  || draft.images.length !== draft.baseline.imageCount
  || draft.tagIds.join("\u0000") !== draft.baseline.tagIds.join("\u0000");

/**
 * 正文里是否还有「上传中」的媒体卡。内核的卡片值把状态写在 `status` 字段（`data:` + encodeURIComponent，
 * 两种形态都要认）：图片卡 pending/uploading、视频/音频/附件卡同样先落 pending 节点再回填 url。
 * 保存必须等它消失，否则会把 `url:null` 的 pending 卡写进正文 ⇒ 卡片流看着有、一进编辑就没了。
 */
export function hasPendingMediaCard(body: string): boolean {
  return body.includes("%22status%22%3A%22pending%22") || body.includes("%22status%22%3A%22uploading%22")
    || body.includes('"status":"pending"') || body.includes('"status":"uploading"');
}
