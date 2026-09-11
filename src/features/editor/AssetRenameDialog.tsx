/**
 * 附件重命名弹窗（只改展示名，不动存储文件/路径）。
 * 扩展名锁定：附件类型按扩展名判定，输入框只编辑基名，扩展名固定展示不可改。
 * 复用浮层通用 .ln-dialog 样式；Enter 确认、Esc 取消。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <section className="ln-dialog asset-rename-dialog" role="dialog" aria-modal="true" aria-label="重命名附件">
        <header className="ln-dialog__head">
          <Pencil size={15} />
          <h3 className="ln-dialog__title">重命名附件</h3>
          <button className="ln-close" onClick={onCancel} aria-label="关闭"><X size={15} /></button>
        </header>
        <div className="ln-dialog__body">
          <div className="asset-rename-field">
            <input
              className="b3-text-field"
              autoFocus
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
            <button className="b3-button b3-button--cancel" onClick={onCancel}>取消</button>
            <button className="b3-button" disabled={!canConfirm} onClick={() => canConfirm && onConfirm(trimmed + ext)}>确定</button>
          </footer>
        </div>
      </section>
    </div>,
    document.body
  );
}
