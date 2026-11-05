import { ArrowLeft, X } from "lucide-react";
import { MobileSheet } from "./MobileSheet";

/** 按需模块加载期间沿用目标面板的壳，立即反馈且仍可返回，不载入业务依赖。 */
export function PanelLoading({ kind, title, onClose }: { kind: "settings" | "search" | "page"; title: string; onClose(): void }) {
  const content = <div className="mb-empty" role="status">正在加载{title}…</div>;
  if (kind === "search") return <MobileSheet open title={title} onClose={onClose} className="mb-sheet--search">{content}</MobileSheet>;
  return <>
    {kind === "settings" && <div className="mobile-settings-mask" onClick={onClose} />}
    <div className={"mobile-settings-page" + (kind === "page" ? " mobile-settings-page--full" : "")} role="dialog" aria-modal="true" aria-label={title}>
      <header className="mobile-settings-head">
        {kind === "page" ? <button type="button" className="mobile-settings-close" onClick={onClose} aria-label="返回"><ArrowLeft size={22} /></button> : <div className="mobile-settings-spacer" />}
        <div className="mobile-settings-title">{title}</div>
        {kind === "settings" ? <button type="button" className="mobile-settings-close" onClick={onClose} aria-label="关闭设置"><X size={22} /></button> : <div className="mobile-settings-spacer" />}
      </header>
      {content}
    </div>
  </>;
}
