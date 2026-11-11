/**
 * 「保存到小记」弹窗：**浮动窗（可拖动/8 向缩放，尺寸本地记忆）** + ln-* 原语。
 * 261110 用户定稿：默认 860×620（min 560×420）；正文用**内核只读视图**渲染（小记本身就挂 Lake 内核），
 * 不再显示 markdown 源码 textarea —— 用户在弹窗里看到的就是入库后小记的样子。
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import { DialogResizeHandles } from "../../components/ui/DialogResizeHandles";
import { useFloatingDialog } from "../../components/hooks/useFloatingDialog";
import { MarkdownView } from "../../components/ui/markdown/MarkdownView";

/**
 * 内核只读渲染 = **lazy 边界**（内核 chunk 约 1.6MB gz，绝不能进入口静态图；与答案消息共用同一个组件）。
 * 护栏：src/features/editor/desktopKernelLazy.test.ts。
 */
const AiAnswerPreview = lazy(() => import("./AiAnswerViewer"));

export interface SaveQuickNoteDialogProps {
  open: boolean;
  content: string;
  busy: boolean;
  error: string | null;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

export function SaveQuickNoteDialog({ open, content, busy, error, onConfirm, onClose }: SaveQuickNoteDialogProps) {
  const floating = useFloatingDialog({ id: "aiw-save-quicknote", initialSize: { w: 860, h: 620 }, minSize: { w: 560, h: 420 } });
  /** 首焦点 = 主操作（正文改成只读渲染后没有输入框可聚焦）。 */
  const confirmRef = useRef<HTMLButtonElement>(null);
  /** 内核就绪前 / 内核失败时用 MarkdownView 兜底，保证弹窗里始终有内容可读。 */
  const [richReady, setRichReady] = useState(false);
  const [richFailed, setRichFailed] = useState(false);
  useEffect(() => { if (open) { setRichReady(false); setRichFailed(false); } }, [open, content]);
  const canSave = content.trim().length > 0 && !busy;
  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      label="保存到小记"
      surfaceRef={floating.panelRef}
      surfaceClassName="floating-dialog aiw-quicknote"
      style={floating.panelStyle}
      initialFocus={confirmRef}
    >
      <div className="ln-dialog__head floating-dialog-header" onPointerDown={floating.startDrag}>
        <span className="ln-dialog__title">保存到小记</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="ln-dialog__body">
        <div className="aiw-quicknote__body">
          <div className="aiw-quicknote__preview" role="document" aria-label="小记预览">
            {/* 流式期间/内核未就绪/内核失败都用 MarkdownView 兜底，任何时候都有正文。 */}
            {(!richReady || richFailed) && <MarkdownView source={content} />}
            {!richFailed && (
              <Suspense fallback={null}>
                <AiAnswerPreview markdown={content} onReady={() => setRichReady(true)} onError={() => setRichFailed(true)} />
              </Suspense>
            )}
          </div>
          {error && <p className="aiw-quicknote__error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose}>{busy ? "取消保存" : "关闭"}</button>
        <button ref={confirmRef} type="button" className="ln-btn ln-btn--primary" disabled={!canSave} onClick={() => onConfirm(content)}>
          {busy ? "保存中…" : "小记一下"}
        </button>
      </div>
      <DialogResizeHandles onResize={floating.startResize} />
    </Dialog>
  );
}