/**
 * AI 字段「整列生成」对话框（261003）：
 * 确认范围（仅空缺 / 全部）→ 生成中进度 + 取消 → 结束后失败重试。
 *
 * 生成前必须显式确认：内容会发往用户配置的 AI 服务（可能产生费用）。
 * 生成中不允许关闭对话框（避免进度不可见）；取消后已完成的格保留。
 */
import { useEffect, useState } from "react";
import { Dialog } from "../../components/ui/Overlay";
import type { BitableField, BitableTable } from "../../core/bitableDoc.js";
import type { AiBatchState } from "./useAiFieldGeneration.js";

export type AiGenerateMode = "empty" | "all";

export function isAiCellEmpty(value: unknown): boolean {
  return value == null || value === "";
}

export function BitableAiGenerateDialog({ open, field, table, batch, onStart, onCancelRun, onRetryFailed, onClose }: {
  open: boolean;
  field: BitableField;
  table: BitableTable;
  /** 当前字段的批量状态（hook 里已在跑的那一批）；缺省 = 还没开始。 */
  batch: AiBatchState | null;
  onStart: (mode: AiGenerateMode) => void;
  onCancelRun: () => void;
  onRetryFailed: () => void;
  onClose: () => void;
}) {
  const emptyCount = table.records.filter((record) => isAiCellEmpty(record.values[field.id])).length;
  const [mode, setMode] = useState<AiGenerateMode>(emptyCount > 0 ? "empty" : "all");
  useEffect(() => {
    if (open) setMode(emptyCount > 0 ? "empty" : "all");
  }, [open, emptyCount]);
  if (!open) return null;
  const running = batch?.running ?? false;
  const targetCount = mode === "empty" ? emptyCount : table.records.length;
  return (
    <Dialog open onDismiss={() => { if (!running) onClose(); }} label="AI 生成整列" className="bt-dialog">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">AI 生成整列：{field.name}</h3></header>
      <div className="ln-dialog__body">
        {!batch && (
          <>
            <label className="bt-field-check">
              <input type="radio" name="bt-ai-mode" disabled={running} checked={mode === "empty"} onChange={() => setMode("empty")} />
              仅生成空缺记录（{emptyCount} 条）
            </label>
            <label className="bt-field-check">
              <input type="radio" name="bt-ai-mode" disabled={running} checked={mode === "all"} onChange={() => setMode("all")} />
              全部记录（{table.records.length} 条）
            </label>
            <div className="bt-field-label-text">将逐条调用你配置的 AI 服务生成 {targetCount} 格（可能产生费用）；可随时取消，已生成的结果会保留。</div>
          </>
        )}
        {batch && (
          <div className="bt-field-label-text" aria-live="polite">
            已完成 {batch.done} / {batch.total}
            {batch.failed > 0 ? "，失败 " + batch.failed : ""}
            {batch.running ? "（生成中…）" : batch.cancelled ? "（已取消）" : "（已结束）"}
          </div>
        )}
        {batch && !batch.running && batch.failed > 0 && (
          <div className="bt-field-label-text">失败的格子已在单元格里标出（可单格重试）；也可以直接重试失败项。</div>
        )}
      </div>
      <div className="ln-dialog__actions">
        {running ? (
          <button type="button" className="bt-secondary" onClick={onCancelRun}>取消生成</button>
        ) : (
          <>
            {batch && batch.failed > 0 ? <button type="button" className="bt-secondary" onClick={onRetryFailed}>重试失败项</button> : null}
            <span className="bt-toolbar-spacer" />
            <button type="button" className="bt-secondary" onClick={onClose}>关闭</button>
            {!batch && <button type="button" className="bt-primary" disabled={targetCount === 0} onClick={() => onStart(mode)}>开始生成</button>}
          </>
        )}
      </div>
    </Dialog>
  );
}