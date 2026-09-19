/**
 * 小记「+」插入面板的白名单过滤（内核官方钩子 `slash.filterOption`）。
 *
 * 为什么需要：小记编辑态复用**文档编辑器外观**，但卡片预览是我们自己的只读渲染器
 * （`quickNotePreviewParser.ts`，零内核实例）。为了避免"插了预览显示不了的块"，把「+」面板
 * 收成白名单；**卡片注册照旧全量**（否则已有小记里的表格/自定义卡一进编辑就会被内核丢弃）。
 *
 * 判定口径：优先看 `mainSearch`（内核各卡片的稳定标识，如 `/tp` 图片、`/sp` 本地视频），
 * 再用中文 label 兜底（内核若改 search 仍能命中）。
 */

/** 允许的插入项 mainSearch 前缀。 */
export const QUICK_NOTE_INSERT_ALLOW_SEARCH = [
  "/tp",       // 图片
  "/wj",       // 文件/附件
  "/sp",       // 本地视频
  "/yp",       // 音频
  "/yinyue",   // 音乐（别名）
  "/wx",       // 无序列表
  "/yx",       // 有序列表
  "/rw",       // 任务列表
  "/yinyong",  // 引用
  "/fgx",      // 分割线
] as const;

/** 允许的插入项标签（中文兜底；内核本地化文案变更时同步这里）。 */
export const QUICK_NOTE_INSERT_ALLOW_LABEL = [
  "图片", "附件", "本地文件", "文件", "本地视频", "视频", "本地音频", "音频", "音乐",
  "正文", "标题", "无序列表", "有序列表", "任务列表", "待办", "引用", "分割线",
] as const;

type InsertItem = Record<string, unknown>;
interface InsertGroup { name?: string; items?: InsertItem[] }

/** 单个插入项是否在白名单内。 */
export function isQuickNoteInsertAllowed(item: InsertItem): boolean {
  const search = typeof item.mainSearch === "string" ? item.mainSearch : "";
  if (search && QUICK_NOTE_INSERT_ALLOW_SEARCH.some((prefix) => search.startsWith(prefix))) return true;
  const label = typeof item.label === "string" ? item.label : "";
  const name = typeof item.name === "string" ? item.name : "";
  return QUICK_NOTE_INSERT_ALLOW_LABEL.some((text) => label.includes(text) || name === text);
}

/** 过滤「+」面板配置：只留白名单条目，空分组丢掉。宽容处理未知结构（原样返回）。 */
export function filterQuickNoteInsert<T>(config: T): T {
  const parsed = config as { groups?: InsertGroup[] } | null;
  if (!parsed || !Array.isArray(parsed.groups)) return config;
  const groups = parsed.groups
    .map((group) => ({ ...group, items: (group.items ?? []).filter(isQuickNoteInsertAllowed) }))
    .filter((group) => (group.items ?? []).length > 0);
  return { ...parsed, groups } as unknown as T;
}
