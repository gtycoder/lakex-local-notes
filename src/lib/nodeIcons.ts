/**
 * 目录节点图标 —— 值方言与「哪类节点用哪类资源」的判据（261020 精简版）。
 *
 * **存储不放新字段**：节点图标始终只是 `tree_nodes.icon` 上的一个短字符串（随 manifest 同步，
 * 表情符号就是这个字段的历史值）。本轮只保留两种可用方言：
 *
 *   · 表情符号（历史值，**不变**）        `"😀"`
 *   · 笔记本/分组的语雀彩色插画（261020） `"n:<id>"`（图形见 notebookIcons.tsx）
 *
 * **旧的线性图标方言 `i:<id>:<色号>` 已整体删除**（用户 261020：「彻底清除原来的图标这一块的逻辑」）——
 * 目录、色板、编码函数一并删掉，这里只留**识别**（`LEGACY_ICON_VALUE_PREFIX`）用于把历史值画成中性图形，
 * 绝不把 `i:star:0` 这种原始串显示到界面上。不做数据迁移（AGENTS §3#7）。
 *
 * **硬约束 = 16 字符**（两端各自校验：`src/core/treeRules.ts` 的 assertNodeIcon 与
 * `electron/noteMetadataRepository.ts` 的 setNodeIcon）；`n:` + 最长 id（interest 8 字符）仍有余量。
 */
import type { TreeNodeType } from "./types";
import { NOTEBOOK_ICON_PREFIX, notebookIconById, type NotebookIconDef } from "./notebookIcons";

/** 两端一致的资源页：容器（笔记本/分组）用图标，所有文档类型（文档/表格/多维表/画板）用表情。 */
export function nodeIconPickerMode(nodeType: TreeNodeType): "icon" | "emoji" {
  return nodeType === "note" ? "emoji" : "icon";
}

/** 两端校验的真实上限（`assertNodeIcon` / `setNodeIcon`）；编出来的值必须 ≤ 它。 */
export const NODE_ICON_VALUE_MAX_LENGTH = 16;

/** 已删除的旧方言前缀（261014–261019 的线性图标 + 色号）。只用于「认出旧值 ⇒ 画中性图形」。 */
export const LEGACY_ICON_VALUE_PREFIX = "i:";

export type ParsedNodeIcon =
  | { kind: "emoji"; char: string }
  /** 笔记本/分组的语雀彩色插画（`n:<id>`）；自带配色，没有色号。 */
  | { kind: "notebook"; icon: NotebookIconDef }
  /** 认得出是图标值但画不出来（旧方言 / 跨端版本差）⇒ 中性图形，**绝不把原始串显示出来**。 */
  | { kind: "unknown"; id: string };

/** 解析落库值。null/空串 ⇒ null（= 用默认图标）。 */
export function parseNodeIcon(value: string | null | undefined): ParsedNodeIcon | null {
  if (value === null || value === undefined || value === "") return null;
  if (value.startsWith(NOTEBOOK_ICON_PREFIX)) {
    const id = value.slice(NOTEBOOK_ICON_PREFIX.length);
    const nb = notebookIconById(id);
    // 认得出是笔记本图标值，但本端没有这个图形（跨端版本差）⇒ 中性图形，绝不显示原始串。
    return nb ? { kind: "notebook", icon: nb } : { kind: "unknown", id };
  }
  // 旧线性图标方言：目录已删，但历史值可能还在库/清单里 ⇒ 只给中性图形，不回落成表情文本。
  if (value.startsWith(LEGACY_ICON_VALUE_PREFIX)) {
    return { kind: "unknown", id: value.slice(LEGACY_ICON_VALUE_PREFIX.length) };
  }
  return { kind: "emoji", char: value };
}
