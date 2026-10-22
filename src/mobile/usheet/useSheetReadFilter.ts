import { useCallback, useMemo, useRef, useState } from "react";
import { showToast } from "../ui/toastBus";
import { readFilterAvailability } from "./usheetReadFilter";

export interface SheetReadFilterTarget {
  api: {
    executeCommand(command: string, params?: unknown): Promise<boolean> | unknown;
    syncExecuteCommand(command: string, params?: unknown): unknown;
  };
  unitId: string;
  subUnitId: string;
  column: number;
  block: { startRow: number; startColumn: number; endRow: number; endColumn: number };
}

/** 阅读态本机筛选：只活运行时；任何 capture / 切编辑前必须同步还原。 */
export function useSheetReadFilter(opts: {
  content: string;
  getTarget: () => { ok: true; target: SheetReadFilterTarget } | { ok: false; reason?: string };
}) {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const availability = useMemo(() => readFilterAvailability(opts.content), [opts.content]);

  /** 同步摘掉运行时筛选；capture 前调用，确保正文与打开时逐字节一致。 */
  const restore = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    const resolved = opts.getTarget();
    if (!resolved.ok) return;
    const { target } = resolved;
    try {
      target.api.syncExecuteCommand("sheet.command.remove-sheet-filter", { unitId: target.unitId, subUnitId: target.subUnitId });
    } catch {
      // 实例销毁中忽略：此时正文也不再落盘。
    }
  }, [opts.getTarget]);

  const apply = useCallback(() => {
    if (!availability.enabled) {
      showToast(availability.reason ?? "读态筛选不可用", { type: "error" });
      return;
    }
    const resolved = opts.getTarget();
    if (!resolved.ok) {
      if (resolved.reason) showToast(resolved.reason, { type: "error" });
      return;
    }
    const { target } = resolved;
    activeRef.current = true;
    setActive(true);
    void (async () => {
      await target.api.executeCommand("sheet.command.set-filter-range", {
        unitId: target.unitId,
        subUnitId: target.subUnitId,
        range: target.block,
      });
      const opened = await target.api.executeCommand("sheet.operation.open-filter-panel", {
        unitId: target.unitId,
        subUnitId: target.subUnitId,
        col: target.column,
      });
      if (!opened) showToast("筛选面板打不开：这个区域可能不足两行", { type: "error" });
    })();
  }, [availability, opts.getTarget]);

  return { active, availability, apply, restore };
}
