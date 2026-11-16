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

/**
 * 多维表行「展开」按钮：**IconPark FullScreen**（261116 用户裁决换图；原为云端 lakex
 * `lt-icon-RowExpand` 的 1024 网格实心四角箭头）。
 *
 * 来源：IconPark `@icon-park/react@1.4.2` 的 `es/icons/FullScreen.js`（Apache-2.0，
 * 包内无 NOTICE 文件）；本项目**只取图形几何**，未引入其运行时。原 viewBox `0 0 48 48`、
 * 四条 path（四角折角），此处把坐标整体 ÷2 重写到 24 网格，配色改 `currentColor`。
 * 许可登记见仓库根 `NOTICE`。
 *
 * 描边不在这里写：24 网格 + `className="lucide"` ⇒ 吃 `svg.lucide{stroke-width:1.75}` 单一来源
 * （15px 档 = 1.09px）。**不要**给它加 `fill` 或改回 48/1024 网格（加了 lucide 类再用大网格会把描边压细）。
 */
export function RowExpandIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      className="lucide"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16.5 3H21V7.5" />
      <path d="M21 16.5V21H16.5" />
      <path d="M7.5 21H3V16.5" />
      <path d="M3 7.5V3H7.5" />
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
