/**
 * 文档属性（「属性」弹窗 / 抽屉）的**共享事实**：清单 + 两个格式化口径（C1-7，261016）。
 *
 * ## 为什么抽这里
 * 桌面的 `components/app/NoteInfoDialog`（Dialog）与移动端的 `mobile/ui/NoteInfoSheet`（底部抽屉）
 * 形态差异是**有意的**（用户 261012 定稿：交互形态可各自重做），但**「属性要显示什么」这份清单**
 * 与两个格式化函数被逐字写了两遍 ⇒ 改一处漏一处就会让两端显示口径漂移。
 * 这里只收**纯逻辑**：清单构造 + 时间/体积格式化 + 同步状态文案；**渲染与交互仍各端自有**。
 *
 * ## 与 C1-5 的区别（别混）
 * 本模块的 `formatNoteInfoTime` 是**属性面板专用的绝对时间**（`YYYY-MM-DD HH:mm`），
 * 不是 C1-5 说的"列表相对时间措辞"（那属产品口径，仍待裁决）——所以这里只做**原样搬迁**，不改格式。
 *
 * ## 体积口径说明
 * `formatNoteInfoSize` 是**第三种**体积口径（`<1024` 不带小数，其余保留 1 位；无 ≥100 取整），
 * 与 `lib/formatBytes`（只到 MB、恒 1 位）与 `lib/formatBytesCompact`（到 GB、≥100 取整）都不同。
 * 按 B1 的结论：**不同口径不合并**，但同一口径只能有一份实现。
 */
import type { NoteInfo } from "./sharedTypes.js";
import { formatDateTime } from "./dateFormat.js";

/** 同步状态 → 文案（两端共用；未知状态原样回显）。 */
export const SYNC_STATE_LABEL: Record<string, string> = { local: "未同步", synced: "已同步", conflict: "冲突" };

/** 属性面板的绝对时间：`YYYY-MM-DD HH:mm`；空 → 「—」，非法值原样回显。 */
export function formatNoteInfoTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTime(d);
}

/** 属性面板的体积：B / KB / MB / GB；B 档不带小数，其余保留 1 位。 */
export function formatNoteInfoSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/**
 * 属性面板的主清单（两端**同一份**，顺序即展示顺序）：创建 / 更新 / 字数 / 大小 / 状态。
 * 返回 `[标签, 值]` 元组数组，方便两端各自用现有的 `dl` 渲染。
 * 注意：位置/附件/历史/文件路径等**不在这里** —— 那些两端形态与入口不同（桌面有内联快照预览、
 * 移动端跳自己的历史面板），属各端自有。
 */
export function noteInfoRows(info: NoteInfo): Array<[string, string]> {
  return [
    ["创建", formatNoteInfoTime(info.createdAt)],
    ["更新", formatNoteInfoTime(info.updatedAt)],
    ["字数", `${info.wordCount} 字 · ${info.charCount} 字符`],
    ["大小", formatNoteInfoSize(info.sizeBytes)],
    // cloudDeleted 优先于 isDirty：这类文档云端已没有，标「云端已删除 · 仅本地」比「待同步」准确；
    // 恢复并重新上传成功后标记与 dirty 都会清掉，自动回到「已同步」。
    ["状态", `${info.cloudDeleted ? "云端已删除 · 仅本地" : info.isPurged ? "已彻底删除" : info.isDirty ? "待同步" : "已同步"}${info.isConflict ? " · 有冲突副本" : ""}${info.isEditLocked ? " · 已锁定" : ""}`],
  ];
}
