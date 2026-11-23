/**
 * 「云端首次相遇」合并方式弹窗（SYNC-PROTOCOL §21）：手动同步遇到无共同历史 + 双非空时弹出，
 * 亮事实（本机 N / 云端 M / 重合 K）+ 五选项；选定后一次性注入决策并重跑同步（此后永不再问）。
 * 桌面 ln-* 原语；渲染零内联样式。后台同步不经过本弹窗。
 */
import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { NativeDialog } from "../ui/Overlay";
import { clearFirstEncounterAsk, getEncounterAsk, subscribeEncounterAsk } from "../../lib/firstEncounterAsk";
import { ENCOUNTER_OPTIONS, encounterFactsText, setPendingFirstEncounterMode, type FirstEncounterMode } from "../../core/firstEncounter.js";

export function FirstEncounterDialog({ onRetry }: { onRetry: () => void }) {
  const facts = useSyncExternalStore(subscribeEncounterAsk, getEncounterAsk);
  if (!facts) return null;
  const choose = (mode: FirstEncounterMode) => {
    setPendingFirstEncounterMode(mode);
    clearFirstEncounterAsk();
    onRetry();
  };
  return (
    <NativeDialog open onDismiss={clearFirstEncounterAsk} label="首次同步：选择合并方式">
      <header className="ln-dialog__head">
        <h2 className="ln-dialog__title">首次同步：选择合并方式</h2>
        <button type="button" className="ln-close" aria-label="关闭" onClick={clearFirstEncounterAsk}><X size={15} aria-hidden="true" /></button>
      </header>
      <div className="ln-dialog__body">
        <p className="ln-row2__meta">{encounterFactsText(facts)}。本机与云端此前没有共同历史，请选择这次怎么合并（选定后不再询问）：</p>
        {ENCOUNTER_OPTIONS.map((o) => (
          <p key={o.mode} className="ln-row2">
            <button type="button" className="ln-btn ln-btn--outlined" onClick={() => choose(o.mode)}>{o.label}</button>
            <span className="ln-row2__meta">{o.hint}</span>
          </p>
        ))}
        <p className="ln-row2">
          <button type="button" className="ln-btn ln-btn--ghost" onClick={clearFirstEncounterAsk}>取消（本次不同步）</button>
        </p>
      </div>
    </NativeDialog>
  );
}