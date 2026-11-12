/**
 * 多维表编辑器的模块级纯工具（261112 R1-S2 拆分：从 BitableEditor.tsx 原样搬出、零行为变化）。
 *
 * 为什么单独成文件：这些函数被容器与 6 个 useBitable* hook 共用；留在 BitableEditor.tsx 里会让
 * hook 反向 import 容器（循环依赖）。本文件只放纯函数/常量 + 供 hook 参数使用的共享类型。
 */
import type { MutableRefObject } from "react";
import { BITABLE_DOC_KIND, BITABLE_DOC_VERSION, createDefaultBitableTable, type BitableDoc, type BitableField, type BitableTable, type BitableView } from "../../core/bitableDoc.js";
export const DEFAULT_COL_WIDTH = 180;
/**
 * 列的**硬宽度**（用户 260930：「所有的列都是根据内容长度算的左右宽度，我需要能自由设置」）。
 * `table-layout: auto` 下 `<col style="width">` 只是「**至少**这么宽」——内容更宽就把列撑开（附件 chip 实测 180 → 413）。
 * 所以真正卡住列的是**每个格子的 `max-width`**；它按列写行内，因为宽度来自正文数据（字段 width），CSS 没法按列取值。
 * 配合 `.bt-grid` 的 `white-space: nowrap`：装不下就截断/省略，绝不换行撑高行高。
 */
export const columnWidth = (field: BitableField) => (field.width ?? DEFAULT_COL_WIDTH) + "px";

/** 云端 lakex 的「展开行」图标（lt-icon-RowExpand）：四角向外箭头。 */
export function RowExpandIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M481.528 534.22c15.36 15.36 15.616 40.092.78 55.768l-.78.8-236.68 236.68H394.68c21.716 0 39.392 17.304 39.984 38.88l.016 1.12c0 21.712-17.308 39.388-38.88 39.98l-1.12.016H179.428c-39.32 0-71.28-31.52-71.988-70.68l-.012-1.32V624.072c0-22.092 17.908-40 40-40 21.72 0 39.392 17.308 39.984 38.88l.016 1.12v147.676L424.96 534.22c15.62-15.62 40.948-15.62 56.568 0zM846.68 100.072c39.32 0 71.28 31.52 71.988 70.68l.012 1.32v211.392c0 22.092-17.908 40-40 40-21.72 0-39.392-17.308-39.984-38.88l-.016-1.12-.008-147.572L591.02 483.548c-15.62 15.62-40.944 15.62-56.568 0-15.356-15.36-15.616-40.092-.78-55.768l.78-.8L781.36 180.068H631.428c-21.72 0-39.392-17.304-39.984-38.88l-.016-1.12c0-21.712 17.308-39.388 38.88-39.98l1.12-.016H846.68z" />
    </svg>
  );
}

/**
 * 设备本地导航（用户 261006 选 C）：切数据表 / 切视图只写 localStorage（按 noteId），**不进正文、不同步**。
 * 单一来源 = `bitableNavStore.ts`（桌面与移动端共用）；正文侧由 `useBitableSession` 恒写默认导航。
 */
/** 空/坏正文时的兜底文档（1 张默认数据表）；「这是不是一个可读正文」不在这里判断，由 core 判据回答。 */
export function defaultBitableDoc(): BitableDoc {
  const table = createDefaultBitableTable();
  return { kind: BITABLE_DOC_KIND, version: BITABLE_DOC_VERSION, tables: [table], activeTableId: table.id };
}

export function moveItem<T>(items: T[], fromId: string, toId: string, getId: (item: T) => string): T[] {
  const from = items.findIndex((item) => getId(item) === fromId);
  const to = items.findIndex((item) => getId(item) === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function stamp(): string {
  return new Date().toISOString();
}

/** 网格快捷键不能抢弹窗草稿、输入控件或应用共享预览的事件。 */
export function isGridShortcut(event: KeyboardEvent, root: HTMLElement | null): boolean {
  if (event.isComposing || event.altKey || !root?.isConnected) return false;
  if (document.querySelector('[aria-modal="true"], .image-lightbox, .attachment-preview')) return false;
  const target = event.target instanceof HTMLElement && event.target !== document.body
    ? event.target : document.activeElement;
  if (!target || target === document.body || target === document.documentElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [data-context-menu], .bt-form-shell')) return false;
  return root.contains(target) && Boolean(target.closest(".bt-grid-wrap"));
}

/** 组件内共享形状（拆分后各 hook 的参数类型；单一来源在此）。 */
export type MoveItem = typeof moveItem;
export type Stamp = typeof stamp;
export type UpdateDoc = (update: (prev: BitableDoc) => BitableDoc) => void;
/** 导航变化只落设备本地（不进正文）：与 UpdateDoc 同形，语义不同。 */
export type NavigateDoc = UpdateDoc;
export type PatchActiveTable = (updater: (table: BitableTable) => BitableTable) => void;
export type PatchView = (viewId: string, patch: Partial<BitableView>) => void;
export type DocRef = MutableRefObject<BitableDoc>;
export type ReadOnlyRef = MutableRefObject<boolean>;
