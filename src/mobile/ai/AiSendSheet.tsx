/**
 * AI「本轮发送」清单（261023）：逐篇开关；默认继承上一轮。
 * 改清单 = 资料块变化 = 从该点起重重建缓存（文案里写清，不改语义）。
 * 行复用设置页 Switch 原语（.mb-switch，命中区 44），表面复用 .mb-sheet。
 */
import { useEffect, useRef } from "react";
import { pushBackHandler } from "../ui/backStack";
import { Switch } from "../ui/settingsPrimitives";
import { useSwipeToClose } from "../ui/useSwipeToClose";
import { AI_CORPUS_MAX_CHARS } from "./aiSession";

export interface AiSendDoc { id: string; title: string; chars: number }

export interface AiSendSheetProps {
  open: boolean;
  docs: AiSendDoc[];
  sendIds: string[];
  onToggle: (id: string) => void;
  onAll: (on: boolean) => void;
  onClose: () => void;
}

export function AiSendSheet({ open, docs, sendIds, onToggle, onAll, onClose }: AiSendSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useSwipeToClose(sheetRef, onClose, open);
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);
  if (!open) return null;

  const used = docs.filter((doc) => sendIds.includes(doc.id)).reduce((sum, doc) => sum + doc.chars, 0);
  return (
    <>
      <div className="mb-scrim" data-prevent-swipe onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="mb-sheet ai-sheet" role="dialog" aria-modal="true" aria-label="本轮发送" data-prevent-swipe>
        <div className="mb-sheet__head">
          <span className="mb-sheet__title">本轮发送</span>
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onClose}>完成</button>
        </div>
        <p className="ai-sheet__note">默认继承上一轮。改动只影响之后：会从资料块起重<strong>建缓存</strong>（本轮全价，之后恢复命中）。资料集在会话里固定。</p>
        <div className="mb-sheet__body ai-sheet__body">
          {docs.length === 0 && <div className="mb-empty mb-empty--inset">会话里还没有资料。先选择资料，或这一轮直接不带资料发问。</div>}
          {docs.map((doc) => (
            <Switch
              key={doc.id}
              name={"《" + doc.title + "》"}
              desc={doc.chars.toLocaleString("en-US") + " 字"}
              checked={sendIds.includes(doc.id)}
              onChange={() => onToggle(doc.id)}
            />
          ))}
          {docs.length > 0 && (
            <div className="ai-sheet__bulk">
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => onAll(true)}>全部发送</button>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => onAll(false)}>全部不发</button>
            </div>
          )}
        </div>
        <div className="ai-sheet__foot">
          <span className={"ai-budget" + (used > AI_CORPUS_MAX_CHARS ? " is-warn" : "")}>
            本轮发送 <b>{sendIds.length}</b> 篇，{used.toLocaleString("en-US")} 字
          </span>
          <button type="button" className="mb-btn mb-btn--primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </>
  );
}
