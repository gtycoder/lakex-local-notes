/**
 * 日记 → 小记（261109）的**渲染层组合**（纯函数）：日期标题写入小记第一行，正文原样接在后面。
 *
 * 媒体卡片不搬运（小记资源是 /quick-notes/<id>/ 作用域），由 `droppedMedia` 让调用方明说。
 * 真正的落库仍走既有 IPC：`createQuickNote`（小记）+ 把日记移入回收站（软删，可恢复）。
 */
import { lakeBodyForQuickNoteFromDiary } from "../../core/lakeDocForm";

export interface ComposedDiaryQuickNote {
  text: string;
  body: string;
  /** 正文里有图片/附件卡片（已剥离，未搬运）。 */
  droppedMedia: boolean;
}

export function composeDiaryQuickNote(doc: { title: string; content?: string | null }): ComposedDiaryQuickNote {
  const suffix = crypto.randomUUID();
  const { text, body, droppedMedia } = lakeBodyForQuickNoteFromDiary(doc.content ?? "", doc.title, {
    paragraphId: "qn-title-" + suffix,
    textId: "qn-title-text-" + suffix,
  });
  return { text, body, droppedMedia };
}
