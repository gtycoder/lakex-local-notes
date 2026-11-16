import { ArrowLeft, X } from "lucide-react";
import { MobileSheet } from "./MobileSheet";
import { EmptyState } from "./EmptyState";
import { DelayedLoading } from "./delayedLoading";

/** 按需模块加载期间沿用目标面板的壳，立即反馈且仍可返回，不载入业务依赖。
 *  261116 A：壳（标题/返回/关闭）**立即**出现 = 操作即时反馈；只把「正在加载…」正文延迟 300ms ——
 *  分包通常 <300ms ⇒ 快加载不再闪一句正在加载，慢加载仍有明确说明（见 ui/delayedLoading.tsx）。 */
export function PanelLoading({ kind, title, onClose }: { kind: "settings" | "search" | "page"; title: string; onClose(): void }) {
  const content = <DelayedLoading><EmptyState role="status">正在加载{title}…</EmptyState></DelayedLoading>;
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
