/**
 * 打开期行高自愈（261123）—— 桌面 UniverSheetEditor 与移动 MobileUsheetViewer 共用。
 *
 * 背景：自动行高的**渲染高度**是 `rowData[row].ah`（内核 getRowHeight：`ia` 行有 `ah` 用 `ah`，
 * 否则掉回 `h`/默认 24）；`ah` 只在编辑 / 样式 / 列宽等命令后由 AutoHeightService 重算，
 * **打开文档时内核从不重算** ⇒ 正文里缺 `ah`（或缓存过期）的行，重开后全部掉回 24px
 * （261123 用户复现「关标签重开行高乱」；261122 曾靠删 `ah`「让内核重算」——没有触发点，不成立）。
 *
 * 这里在打开后发一次内核 Operation `sheet.operation.mark-dirty-row-auto-height`（不推 undo 栈），
 * 触发 AutoHeightService 按**当前列宽/字号**重算并写回 `ah`：
 * - 只改派生缓存 ⇒ 宿主按「无声收编」处理（desktop doFlush 的 usheetAutoHeightOnlyDiff 分支 /
 *   mobile capture 的 docBaselineSettled 放宽分支），**不标脏、不写盘、不触发同步**（「打开 = 只读」）；
 * - 真实内容变更时最新 `ah` 随 capture 一起持久化（重算结果 = 持久化落点）。
 *
 * 行数与 normalize 的 ia 标记同限（USHEET_AUTO_ROW_HEIGHT_MAX_ROWS，避免给上万行的表塞满 rowData）。
 * 300/1500/4000ms 三次是**骨架就绪重试**（AutoHeightService 在 skeleton 缺失时静默丢弃任务；
 * 重复触发幂等——算出值不变则不写回，_loopTask 里按 getRowHeight 相等过滤）。
 * 内核机制实测见 docs/LAKEX-CONTRACT.md（getRowHeight / ah / mark-dirty 链路）。
 */
import { USHEET_AUTO_ROW_HEIGHT_MAX_ROWS, type UsheetWorkbook } from "../../core/usheetDoc.js";

/** 内核 Operation id（MarkDirtyRowAutoHeightOperation；见 usheetKernelContract 登记）。 */
export const USHEET_MARK_DIRTY_AUTO_HEIGHT = "sheet.operation.mark-dirty-row-auto-height";

const HEAL_DELAYS_MS = [300, 1500, 4000] as const;

export type UsheetExecuteCommand = (id: string, params?: unknown, options?: unknown) => unknown;

/**
 * 安排打开期行高自愈；返回 dispose（卸载时清掉未触发的重试）。
 * executeCommand 抛错/失败静默吞掉（下一次重试；坏内核不该让打开路径失败）。
 */
export function scheduleUsheetAutoHeightHeal(
  executeCommand: UsheetExecuteCommand,
  workbook: UsheetWorkbook,
): () => void {
  const targets: Array<{ subUnitId: string; endRow: number }> = [];
  for (const sheet of Object.values(workbook.sheets ?? {})) {
    const s = sheet as { id?: unknown; rowCount?: unknown };
    const rows = typeof s.rowCount === "number" && Number.isFinite(s.rowCount) ? Math.floor(s.rowCount) : 0;
    if (typeof s.id === "string" && rows > 0) {
      targets.push({ subUnitId: s.id, endRow: Math.min(rows, USHEET_AUTO_ROW_HEIGHT_MAX_ROWS) - 1 });
    }
  }
  const unitId = typeof workbook.id === "string" ? workbook.id : "workbook";
  const run = () => {
    for (const target of targets) {
      try {
        void Promise.resolve(executeCommand(
          USHEET_MARK_DIRTY_AUTO_HEIGHT,
          {
            unitId,
            subUnitId: target.subUnitId,
            ranges: [{ startRow: 0, endRow: target.endRow, startColumn: 0, endColumn: 0 }],
            id: "usheet-heal-" + target.subUnitId + "-" + Date.now(),
          },
          { onlyLocal: true },
        )).catch(() => { /* 内核未就绪/拒绝：下一次重试 */ });
      } catch { /* 同上 */ }
    }
  };
  const timers = HEAL_DELAYS_MS.map((ms) => window.setTimeout(run, ms));
  return () => { for (const timer of timers) window.clearTimeout(timer); };
}
