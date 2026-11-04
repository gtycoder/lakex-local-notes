/**
 * 页签编辑表单（261104 二十六批三/四轮）：**两端共享逻辑的唯一来源**。
 * 桌面 = 底栏「页签」弹层里的内容；移动端 = 底部 Sheet 里的内容（同一份 draft/dirty/按钮语义）。
 *
 * 语义：页签 = page.note 字段存在（空串 = 纯标记）。
 *  - 无页签：按钮为「打标记」（空输入也是有效提交）；
 *  - 有文字改了：「保存」；
 *  - 「清除页签」= 删字段。
 * 只读：输入框与两个动作都禁用（入口仍可见，别让人找不到）。
 */
import { useEffect, useState } from "react";
import { MAX_PAGE_NOTE_CHARS, type InkPage } from "../../core/inkDoc.js";

export interface InkPageTabFormProps {
  page: Pick<InkPage, "note"> | undefined;
  pageNumber: number;
  readOnly: boolean;
  /** 桌面弹层里自动聚焦输入框；移动 Sheet 不自动聚焦（否则一开面板就弹键盘）。 */
  autoFocus?: boolean;
  onSave: (text: string) => void;
  onClear: () => void;
  /** Esc：关闭所在弹层（桌面弹层 / 移动 Sheet）。 */
  onCancel?: () => void;
}

export function InkPageTabForm({ page, pageNumber, readOnly, autoFocus = false, onSave, onClear, onCancel }: InkPageTabFormProps) {
  const [draft, setDraft] = useState(page?.note ?? "");
  const hasTab = page?.note !== undefined;
  const currentText = (page?.note ?? "").trim();
  const draftText = draft.trim();
  const dirty = currentText !== draftText;
  const canSave = !readOnly && (dirty || !hasTab);
  const saveLabel = dirty && draftText ? "保存" : (!hasTab && !draftText ? "打标记" : "保存");

  // 切页 / 外部改了页签时同步（不覆盖同一页正在输入的草稿由 dirty 判断兜住）
  useEffect(() => { setDraft(page?.note ?? ""); }, [page?.note, pageNumber]);

  return (
    <div className="ink-page-tab__form">
      <div className="ink-page-tab__label">第 {pageNumber} 页页签</div>
      <input
        className="ink-page-tab__input"
        value={draft}
        maxLength={MAX_PAGE_NOTE_CHARS}
        disabled={readOnly}
        autoFocus={autoFocus}
        placeholder={readOnly ? "只读状态不能改页签" : "写一句话说明；留空 = 只打标记"}
        aria-label={"第 " + pageNumber + " 页页签"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (canSave) onSave(draftText);
          }
          if (event.key === "Escape") { event.stopPropagation(); onCancel?.(); }
        }}
      />
      <div className="ink-page-tab__actions">
        <button
          className="ink-page-tab__save"
          onClick={() => onSave(draftText)}
          disabled={!canSave}
          title={canSave ? (draftText ? "保存页签（Enter）" : "保存为纯标记（Enter）") : "这一页已有页签，没有改动"}
        >{saveLabel}</button>
        <button
          className="ink-page-tab__clear"
          onClick={onClear}
          disabled={readOnly || !hasTab}
          title={hasTab ? "清除这一页的页签" : "这一页还没有页签"}
        >清除页签</button>
      </div>
    </div>
  );
}

export default InkPageTabForm;
