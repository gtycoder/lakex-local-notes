/**
 * S3 配置导入（移动端备用路径：粘贴迁移码）。
 *
 * 与桌面 `components/app/S3ConfigImportDialog.tsx` **同形同构**：标题 + 说明 + 迁移码输入框 +
 * 状态/错误行 +（从剪贴板粘贴 · 取消 · 导入配置）。区别只在移动端用自有浮层原语 `MobileSheet`
 * 和 `mb-*` 样式（桌面是 `.ln-dialog`）。
 *
 * 解码/校验/落库与「从文件导入」走同一条渲染层路径（`useS3SettingsForm.importFromCode`）；
 * Secret 只在 `bridge.saveS3Settings` 进原生，不落 WebView 存储。
 */
import { useEffect, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { getNativeErrorMessage } from "../../lib/nativeErrors";

export interface S3ConfigImportSheetProps {
  open: boolean;
  onClose: () => void;
  /** 把整段迁移码交给表单钩子；成功 resolve，失败抛出可读原因（就地展示）。 */
  onImport: (code: string) => Promise<void>;
}

export function S3ConfigImportSheet({ open, onClose, onImport }: S3ConfigImportSheetProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // 每次打开都是干净的一次导入（不把上次的残码/报错带进来）。
  useEffect(() => {
    if (!open) return;
    setValue("");
    setMsg("");
    setError("");
    setBusy(false);
  }, [open]);

  const pasteCode = async () => {
    setError("");
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setMsg("剪贴板里没有文本"); return; }
      setValue(text);
      setMsg("已从剪贴板粘贴");
    } catch {
      setMsg("无法读取剪贴板：请长按输入框手动粘贴");
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
    <MobileSheet
      open={open}
      title="粘贴 S3 迁移码"
      onClose={() => { if (!busy) onClose(); }}
      dismissible={!busy}
      bodyClassName="mb-sheet__body--form"
    >
      <div className="mb-set-items">
        <div className="mb-form__desc">
          粘贴另一台设备「同步设置 → 配置迁移 → 导出迁移码」得到的迁移码（LLN1. 开头）。
          导入会覆盖本机已保存的 S3 配置（同步策略不变）。导入后请先「测试连接」，再开启云同步。
        </div>
        <div className="mb-input mb-input--multiline">
          <textarea
            ref={textareaRef}
            rows={6}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="粘贴 LLN1. 开头的迁移码"
            aria-label="S3 迁移码"
            spellCheck={false}
          />
        </div>
        {msg && <div className="mb-form__desc">{msg}</div>}
        {error && <div className="mb-form__desc mb-form__desc--error">{error}</div>}
        <div className="mb-set-block__actions">
          <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void pasteCode()}>
            <ClipboardPaste size={16} aria-hidden="true" />
            从剪贴板粘贴
          </button>
          <button type="button" className="mb-btn mb-btn--ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="mb-btn mb-btn--primary" disabled={busy || !value.trim()} onClick={() => void submitImport()}>
            {busy ? "导入中…" : "导入配置"}
          </button>
        </div>
      </div>
    </MobileSheet>
  );
}
