
/**
 * Markdown 导入结果汇总（261106 task-85）：成功 / 跳过（不支持类型、超 20MB）/ 失败（逐条原因）/ warnings 可展开。
 * 跳过与失败都带文件名，warnings 用 <details> 折叠（远程图片未下载、frontmatter 丢弃、脚注降级等）。
 */
import { Dialog } from "../ui/Overlay";

export interface ImportResultItem {
  name: string;
  reason: string;
}

export interface ImportResultDialogProps {
  open: boolean;
  success: number;
  skipped: readonly ImportResultItem[];
  failed: readonly ImportResultItem[];
  warnings: readonly string[];
  onClose(): void;
}

export function ImportResultDialog({ open, success, skipped, failed, warnings, onClose }: ImportResultDialogProps) {
  if (!open) return null;
  const summary = "成功 " + success + " 篇" + (skipped.length > 0 ? "，跳过 " + skipped.length + " 个" : "") + (failed.length > 0 ? "，失败 " + failed.length + " 篇" : "");
  return (
    <Dialog open onDismiss={onClose} label="导入完成" className="import-result-dialog">
      <div className="ln-dialog__head"><span className="ln-dialog__title">导入完成</span></div>
      <div className="ln-dialog__body">
        <p className="import-result-dialog__summary" role="status">{summary}</p>
        {skipped.length > 0 && (
          <section className="import-result-dialog__section" aria-label="跳过">
            <h3 className="import-result-dialog__title">跳过 {"(" + skipped.length + ")"}</h3>
            <ul className="import-result-dialog__list">
              {skipped.map((item) => (
                <li key={item.name + "|" + item.reason}><span className="ln-ellipsis">{item.name}</span><em>{item.reason}</em></li>
              ))}
            </ul>
          </section>
        )}
        {failed.length > 0 && (
          <section className="import-result-dialog__section" aria-label="失败">
            <h3 className="import-result-dialog__title">失败 {"(" + failed.length + ")"}</h3>
            <ul className="import-result-dialog__list">
              {failed.map((item) => (
                <li key={item.name + "|" + item.reason}><span className="ln-ellipsis">{item.name}</span><em>{item.reason}</em></li>
              ))}
            </ul>
          </section>
        )}
        {warnings.length > 0 && (
          <details className="import-result-dialog__warnings">
            <summary>提示 {"(" + warnings.length + ")"}</summary>
            <ul className="import-result-dialog__list">
              {warnings.map((text, index) => <li key={index}><span className="import-result-dialog__warning-text">{text}</span></li>)}
            </ul>
          </details>
        )}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--primary" onClick={onClose}>完成</button>
      </div>
    </Dialog>
  );
}
