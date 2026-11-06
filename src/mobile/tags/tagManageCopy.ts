/**
 * 标签删除/合并的**用户可见文案** —— 与桌面 TagsWorkspace 同一口径，单一来源。
 * 管理态（标签页）与底部 Sheet（MobileQuickNoteTagManager）都用这里，别各写一份。
 */

/** 合并提示（桌面合并弹窗原句）：源标签消失；内容保留，引用改到目标标签。 */
export const MERGE_TAG_HINT = "合并后源标签消失；文档与小记会保留，引用改到目标标签。";

/**
 * 删除二次确认正文（桌面 TagsWorkspace.removeTag 原句）。
 * docCount 给了就带「引用 N 篇文档、M 条小记」；没给小记库口径的计数时用通用句。
 */
export function deleteTagConfirmBody(docCount: number | null, quickNoteCount: number): string {
  if (docCount === null) return "会同时移除文档与小记上的该标签；文档与小记本身不会被删除。";
  return "会同时移除文档与小记上的该标签（引用 " + docCount + " 篇文档、" + quickNoteCount + " 条小记）；文档与小记本身不会被删除。";
}
