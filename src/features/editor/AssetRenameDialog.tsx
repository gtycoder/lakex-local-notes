/**
 * 附件重命名弹窗（只改展示名，不动存储文件/路径）。
 * 扩展名锁定：附件类型按扩展名判定，输入框只编辑基名，扩展名固定展示不可改。
 * 复用浮层通用 .ln-dialog 样式；Enter 确认、Esc 取消。
 */
import { useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";

function splitExt(name: string): { base: string; ext: string } {
  const m = /^(.*?)(\.[^./\\]*)?$/.exec(name);
  return { base: m?.[1] ?? name, ext: m?.[2] ?? "" };
}

export function AssetRenameDialog({ initial, onCancel, onConfirm }: {
  initial: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const { base: initialBase, ext } = splitExt(initial);
  const [value, setValue] = useState(initialBase);
  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0 && trimmed !== initialBase;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open onDismiss={onCancel} label="重命名附件" className="asset-rename-dialog" initialFocus={inputRef}>
        <header className="ln-dialog__head">
          <Pencil size={15} />
          <h3 className="ln-dialog__title">重命名附件</h3>
          <button className="ln-close" onClick={onCancel} aria-label="关闭"><X size={15} /></button>
        </header>
        <div className="ln-dialog__body">
          <div className="asset-rename-field">
            <input
              ref={inputRef}
              className="ln-text-field"
              value={value}
              aria-label="附件名称"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) onConfirm(trimmed + ext); }}
              onFocus={(e) => e.currentTarget.select()}
            />
            {ext && <span className="asset-rename-ext" title="扩展名不可修改">{ext}</span>}
          </div>
          <p className="asset-rename-hint">只改文档里显示的名称，磁盘文件名和扩展名都不变。</p>
          <footer className="asset-rename-actions">
            <button className="ln-btn ln-btn--ghost" onClick={onCancel}>取消</button>
            <button className="ln-btn ln-btn--primary" disabled={!canConfirm} onClick={() => canConfirm && onConfirm(trimmed + ext)}>确定</button>
          </footer>
        </div>
    </Dialog>
  );
}
