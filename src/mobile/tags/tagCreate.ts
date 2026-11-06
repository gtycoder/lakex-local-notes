/**
 * 新建标签的**唯一实现**（目录唯一来源 = quick-notes 标签库；与桌面「新建标签」同一通道）。
 * 管理态列表（TagManageList）与「＋新建」弹层（TagsHomeTab）都走这里，别各写一份归一化/同名判定。
 */
import { normalizeQuickNoteTag } from "../../core/quickNoteTags";
import { bridge } from "../bridge";

/** 归一化 → 同名拦截 → 创建；返回归一化后的名字。失败抛错（调用方负责可见提示）。 */
export async function createTagFromName(raw: string, existing: readonly { name: string }[]): Promise<string> {
  const name = raw.trim();
  if (!name) throw new Error("标签名不能为空");
  const normalized = normalizeQuickNoteTag(name);
  if (existing.some((tag) => tag.name === normalized)) throw new Error("已有同名标签");
  await bridge.createQuickNoteTag(normalized);
  return normalized;
}
