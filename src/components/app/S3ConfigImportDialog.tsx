/**
 * S3 配置导入弹窗（桌面，备用路径：粘贴迁移码）。
 *
 * 主路径是「文件导入」——由主进程弹系统选择框、读文件、解码、落库（明文 Secret 不经过渲染层）。
 * 这里只处理手机端「导出迁移码」后复制过来的文本：主进程同样是解码/校验/落库，渲染层不接触 Secret。
 *
 * 交互与桌面其它浮层一致：标准 <Dialog>（遮罩/Esc/外点/焦点回收），表面只用 .ln-dialog 原语。
 */
import { useRef, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { getNativeErrorMessage } from "../../lib/nativeErrors";

export interface S3ConfigImportDialogProps {
  onClose: () => void;
  /** 把整段迁移码交给主进程；成功 resolve，失败抛出可读原因。 */
  onImport: (code: string) => Promise<void>;
}

export function S3ConfigImportDialog({ onClose, onImport }: S3ConfigImportDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const pasteCode = async () => {
    setError("");
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setMsg("剪贴板里没有文本"); return; }
      setValue(text);
      setMsg("已从剪贴板粘贴");
    } catch {
      setMsg("无法读取剪贴板：请点输入框后按 ⌘V 手动粘贴");
      textareaRef.current?.focus();
    }
  };

  const submitImport = async () => {
    setError("");
    setBusy(true);
    try {
      await onImport(value.trim());
      onClose();
    } catch (e) {
      setError(getNativeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onDismiss={() => { if (!busy) onClose(); }} label="粘贴 S3 迁移码" className="s3-transfer-dialog" initialFocus={textareaRef}>
      <header className="ln-dialog__head">
        <h2 className="ln-dialog__title">粘贴 S3 迁移码</h2>
        <button className="ln-close" type="button" aria-label="关闭" onClick={() => { if (!busy) onClose(); }}><X size={15} /></button>
      </header>
      <div className="ln-dialog__body">
        <p className="s3-transfer-dialog__hint">粘贴手机端「同步设置 → 配置迁移 → 导出迁移码」得到的迁移码。导入会覆盖本机已保存的 S3 配置（同步策略不变）；导入后请先「测试连接」再使用云同步。</p>
        <textarea
          ref={textareaRef}
          className="s3-transfer-dialog__code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="粘贴 LNS3.1. 开头的迁移码"
          aria-label="S3 迁移码"
          spellCheck={false}
        />
        {msg && <div className="s3-transfer-dialog__msg">{msg}</div>}
        {error && <div className="s3-transfer-dialog__error">{error}</div>}
        <div className="s3-transfer-dialog__actions">
          <button type="button" className="ln-btn ln-btn--ghost" onClick={() => void pasteCode()}><ClipboardPaste size={14} />从剪贴板粘贴</button>
          <span className="s3-transfer-dialog__spacer" />
          <button type="button" className="ln-btn ln-btn--secondary" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="ln-btn ln-btn--primary" disabled={busy || !value.trim()} onClick={() => void submitImport()}>{busy ? "导入中…" : "导入配置"}</button>
        </div>
      </div>
    </Dialog>
  );
}
