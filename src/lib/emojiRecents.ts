/**
 * 「最近使用的表情/图标」——**设备本地**记忆（localStorage）。
 *
 * **按入口分桶**（AGENTS §3#14「最近使用必须按入口分桶」，与 colorMemory 同一口径）：
 * - `icon`  = 「设置图标」面板（给笔记本/文档选图标）
 * - `input` = 输入态的表情面板（小记工具条 / 移动 dock 往正文插表情）
 * 两个入口的用途不同，混在一个列表里会让两边都变脏。
 *
 * 归属：设备本地态，**不进正文、不进 S3、不进 manifest**（见 docs/STORAGE-LAYERS.md）。
 * 两端共用本文件（共享必要逻辑）；UI 各端自有。
 */
import { writeLocalStorage } from "./localStorageSafe";

/** 桶 → localStorage 键。`icon` 沿用 261013 首版键名（不迁移，避免动已落盘的数据）。 */
const KEYS = {
  icon: "lakex-local-notes-v3.emoji-recents",
  input: "lakex-local-notes-v3.emoji-recents.input",
} as const;

export type EmojiRecentBucket = keyof typeof KEYS;

const MAX = 24;

/** 读「最近使用」（最新在前）。localStorage 不可用（隐私模式/测试环境）时返回空表，不影响选表情。 */
export function readEmojiRecents(bucket: EmojiRecentBucket = "icon"): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEYS[bucket]);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, MAX);
  } catch {
    return [];
  }
}

/** 记一次使用（去重后置顶，最多 MAX 条）。写失败只影响「最近」这一栏，不抛错。 */
export function pushEmojiRecent(char: string, bucket: EmojiRecentBucket = "icon"): void {
  if (!char) return;
  if (typeof localStorage === "undefined") return;
  const next = [char, ...readEmojiRecents(bucket).filter((item) => item !== char)].slice(0, MAX);
  // 写入统一走 localStorageSafe（隐私模式/配额满时只 warn，不影响选表情）
  writeLocalStorage(KEYS[bucket], JSON.stringify(next));
}

/** 测试与自动化用：暴露键表，避免测试里再抄一份字面量。 */
export const EMOJI_RECENTS_KEYS = KEYS;
