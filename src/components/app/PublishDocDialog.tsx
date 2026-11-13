/**
 * 「保存为文档」目标弹窗（浮层共享实现，261112 task-91）。
 *
 * 起源：AI 写作「生成文档」（261110 用户定稿：浮动窗 + 可改标题）与日记「转为文档」（task-91 用户裁决：
 * 与 AI 写作同款弹窗/逻辑/样式）是**同一个交互** —— 选一个知识库（笔记本）落点 + 确认/改标题。
 * 因此从 `features/aiWriting/PublishDocDialog` 提到 `components/app/` 共用；弹窗**不再做业务过滤**：
 * 候选列表由调用方按各自的 core 判据给（AI：`selectableNotebooks`；日记：`moveTargetCandidates` 后只留
 * notebook）——这样两边不会各写一遍「哪些能选」。
 *
 * 约束：候选**只到笔记本这一层**（分组/日记本不出现由调用方保证）；标题默认值由调用方给、可改、
 * 为空不许确认；尺寸/位置设备本地记忆（`useFloatingDialog`，仅本机，不进 S3）。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { DialogResizeHandles } from "../ui/DialogResizeHandles";
import { useFloatingDialog } from "../hooks/useFloatingDialog";
import { Select } from "../ui/Select";

/** 候选知识库（只到笔记本这一层；调用方已按各自的 core 判据过滤好）。 */
export interface PublishDocNotebook {
  id: string;
  title: string;
}

export interface PublishDocDialogProps {
  open: boolean;
  /** 弹窗标题（头部文案 + 可访问名）：AI 写作「生成文档」/ 日记「转为文档」。 */
  heading?: string;
  /** 标题输入框的默认值（用户可改；空白不允许确认）。 */
  title: string;
  /** 可落点的知识库（顺序即下拉顺序，首项为默认目标）。 */
  notebooks: readonly PublishDocNotebook[];
  /** 一句说明（默认 = AI 写作「生成文档」的文案；日记侧传自己的口径）。 */
  description?: string;
  /** 主按钮文案（默认「确认」）。 */
  confirmLabel?: string;
  busy?: boolean;
  /** 处理中时主按钮文案（默认「处理中…」；AI 写作传「生成中…」）。 */
  busyLabel?: string;
  error?: string | null;
  /** 确认：目标知识库 + **用户改过的标题**（已 trim；空标题不会走到这里）。 */
  onConfirm: (notebookId: string, title: string) => void;
  onClose: () => void;
}

const DEFAULT_DESCRIPTION = "把这条回答保存为一篇文档，选择要放进哪个知识库。";

export function PublishDocDialog({
  open, heading = "生成文档", title, notebooks,
  description = DEFAULT_DESCRIPTION, confirmLabel = "确认", busy = false, busyLabel = "处理中…", error = null,
  onConfirm, onClose,
}: PublishDocDialogProps) {
  const floating = useFloatingDialog({ id: "publish-doc", initialSize: { w: 780, h: 460 }, minSize: { w: 560, h: 340 } });
  /** 首焦点 = 标题输入（用户 261110：标题必须可改，进来就能直接改）。 */
  const titleRef = useRef<HTMLInputElement>(null);
  const options = notebooks.map((node) => ({ value: node.id, label: node.title }));
  const [notebookId, setNotebookId] = useState(options[0]?.value ?? "");
  /** 文档标题：默认值由调用方给（AI = 回答摘要首行；日记 = 日期键），**可编辑**。 */
  const [docTitle, setDocTitle] = useState(title);
  /** 只在「打开那一刻」重置表单（task-105 P3-7）：目录树刷新会让 notebooks 引用/首本 id 变化，
   *  若无条件跟随就会把用户已经改好的标题清回默认值。 */
  const openedRef = useRef(false);
  useEffect(() => {
    if (!open) { openedRef.current = false; return; }
    if (openedRef.current) return;
    openedRef.current = true;
    setNotebookId(options[0]?.value ?? "");
    setDocTitle(title);
  }, [open, title, options]);
  const canConfirm = Boolean(notebookId) && docTitle.trim().length > 0 && !busy;
  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      label={heading}
      surfaceRef={floating.panelRef}
      surfaceClassName="floating-dialog publish-doc"
      style={floating.panelStyle}
      initialFocus={titleRef}
    >
      <div className="ln-dialog__head floating-dialog-header" onPointerDown={floating.startDrag}>
        <span className="ln-dialog__title">{heading}</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="ln-dialog__body">
        <div className="publish-doc__body">
          <p className="publish-doc__desc">{description}</p>
          {options.length === 0 ? (
            <p className="publish-doc__empty">还没有可用的知识库，先到左侧目录新建一个笔记本。</p>
          ) : (
            <div className="ln-form__row publish-doc__row">
              <span className="ln-form__label publish-doc__label">知识库</span>
              <Select value={notebookId} options={options} onChange={setNotebookId} label="选择知识库" className="publish-doc__select" />
            </div>
          )}
          <div className="ln-form__row publish-doc__row">
            <span className="ln-form__label publish-doc__label">标题</span>
            <input
              ref={titleRef}
              className="ln-text-field publish-doc__title"
              value={docTitle}
              aria-label="文档标题"
              placeholder={heading}
              onChange={(event) => setDocTitle(event.target.value)}
            />
          </div>
          {error && <p className="publish-doc__error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose}>取消</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canConfirm} onClick={() => onConfirm(notebookId, docTitle.trim())}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
      <DialogResizeHandles onResize={floating.startResize} />
    </Dialog>
  );
}
