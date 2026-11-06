
/**
 * Markdown 导入进度浮层（261106 task-85）：模态、显示「正在导入 N/M：文件名」，可取消。
 * 取消语义 = **停止后续文件**（已导入成功的不回滚），所以按钮文案是「取消导入」而不是「撤销」。
 */
import { Dialog } from "../ui/Overlay";

export interface ImportProgressDialogProps {
  open: boolean;
  done: number;
  total: number;
  /** 当前正在转换的文件名（文件夹导入时用相对路径更直观）。 */
  currentFile?: string | null;
  /** 已请求取消：按钮置灰并提示正在停止。 */
  stopping?: boolean;
  onCancel(): void;
}

export function ImportProgressDialog({ open, done, total, currentFile = null, stopping = false, onCancel }: ImportProgressDialogProps) {
  if (!open) return null;
  const safeTotal = Math.max(0, total);
  const safeDone = Math.min(Math.max(0, done), safeTotal);
  return (
    <Dialog open onDismiss={() => { if (!stopping) onCancel(); }} label="正在导入 Markdown" className="import-progress-dialog">
      <div className="ln-dialog__head"><span className="ln-dialog__title">正在导入 Markdown</span></div>
      <div className="ln-dialog__body">
        <p className="import-progress-dialog__text" role="status" aria-live="polite">
          {"正在导入 " + safeDone + "/" + safeTotal + (currentFile ? "：" + currentFile : "…")}
        </p>
        <p className="import-progress-dialog__hint">共 {safeTotal} 个文件；已导入的文档会保留，取消只停止后续文件。</p>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onCancel} disabled={stopping}>{stopping ? "正在停止…" : "取消导入"}</button>
      </div>
    </Dialog>
  );
}
