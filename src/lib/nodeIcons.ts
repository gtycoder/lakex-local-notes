/**
 * 目录节点自定义图标 —— 第二类目「图标」的共享目录与值编解码（261014）。
 *
 * **存储不放新字段**：节点图标一直只是 `tree_nodes.icon` 上的一个短字符串（随 manifest 同步，
 * 表情符号就是这个字段的历史值）。所以新类目只扩展**值的方言**，不动库表、不动同步协议：
 *
 *   · 表情符号（历史值，**不变**）  `"😀"`        —— 以 `i:` 开头的字符串不可能是表情，两种方言不会歧义
 *   · 图标（本文件新增）            `"i:<id>:<色号>"`  例：`i:zap:5` / `i:notebook:2`
 *
 * **硬约束 = 16 字符**（两端各自校验：`src/core/treeRules.ts` 的 assertNodeIcon 与
 * `electron/noteMetadataRepository.ts` 的 setNodeIcon）。因此 id 必须是**本文件自定的短 id**
 * （≤10 字符，不复用 lucide 的长名如 `graduation-cap`），色号是 0..7 的一位数字。
 * 见 `nodeIcons.test.ts`：逐条断言编出来的值 ≤ 16。
 *
 * 为什么是 `i:` 前缀而不是新字段：加列要同时动 schema/manifest/两端读写与同步对拍，
 * 而这里要的只是"图标长什么样"——一个短字符串就够，且**旧端读到不认识的 id 也只是画个中性图形**。
 */
import {
  Book, BookMarked, BookOpen, Bookmark, Briefcase, Calendar, Camera, ClipboardCheck, Clock, Code,
  Coffee, Database, FileText, Flag, Flame, Folder, FolderOpen, Globe, GraduationCap, Heart, House,
  Key, Library, Lightbulb, ListChecks, Lock, Map as MapIcon, Music, Notebook, Palette, Plane, Rocket, Sparkles,
  Star, StickyNote, Tag, Target, Terminal, Trophy, Zap,
  type LucideIcon,
} from "lucide-react";
import type { TreeNodeType } from "./types";

/** 两端一致的默认资源页：容器优先图标，所有文档类型优先表情。 */
export function nodeIconPickerMode(nodeType: TreeNodeType): "icon" | "emoji" {
  return nodeType === "note" ? "emoji" : "icon";
}

/** 图标浅渐变预制色，与 themes/base.css 同源。code 是落库色号，不随色板展示顺序改变。 */
export const NODE_ICON_TINTS = [
  { id: "peach", label: "暖橙", code: 4 },
  { id: "coral", label: "珊瑚", code: 5 },
  { id: "rose", label: "粉红", code: 6 },
  { id: "violet", label: "浅紫", code: 7 },
  { id: "indigo", label: "靛蓝", code: 1 },
  { id: "blue", label: "柔蓝", code: 0 },
  { id: "teal", label: "青绿", code: 2 },
  { id: "green", label: "浅绿", code: 3 },
] as const;

export type NodeIconTintId = (typeof NODE_ICON_TINTS)[number]["id"];

export interface NodeIconDef {
  /** 落库用的短 id（≤10 字符；**不要**换成 lucide 长名，会超 16 字符上限）。 */
  id: string;
  /** 面板里的中文名（也是搜索关键词与无障碍名）。 */
  label: string;
  Icon: LucideIcon;
}

/** 可选图标（40 个，8 列 × 5 行；顺序按"笔记本/文档最常用"排在前）。 */
export const NODE_ICONS: readonly NodeIconDef[] = [
  { id: "notebook", label: "笔记本", Icon: Notebook },
  { id: "doc", label: "文档", Icon: FileText },
  { id: "folder", label: "文件夹", Icon: Folder },
  { id: "folder2", label: "打开的文件夹", Icon: FolderOpen },
  { id: "book", label: "书", Icon: Book },
  { id: "book-open", label: "翻开的书", Icon: BookOpen },
  { id: "book-mark", label: "书签书", Icon: BookMarked },
  { id: "library", label: "书架", Icon: Library },
  { id: "note", label: "便签", Icon: StickyNote },
  { id: "star", label: "星标", Icon: Star },
  { id: "heart", label: "心形", Icon: Heart },
  { id: "mark", label: "书签", Icon: Bookmark },
  { id: "tag", label: "标签", Icon: Tag },
  { id: "flag", label: "旗子", Icon: Flag },
  { id: "clock", label: "时间", Icon: Clock },
  { id: "calendar", label: "日历", Icon: Calendar },
  { id: "list", label: "清单", Icon: ListChecks },
  { id: "todo", label: "待办", Icon: ClipboardCheck },
  { id: "target", label: "目标", Icon: Target },
  { id: "idea", label: "灵感", Icon: Lightbulb },
  { id: "zap", label: "闪电", Icon: Zap },
  { id: "flame", label: "火焰", Icon: Flame },
  { id: "rocket", label: "火箭", Icon: Rocket },
  { id: "sparkle", label: "闪耀", Icon: Sparkles },
  { id: "trophy", label: "奖杯", Icon: Trophy },
  { id: "coffee", label: "咖啡", Icon: Coffee },
  { id: "work", label: "工作", Icon: Briefcase },
  { id: "study", label: "学习", Icon: GraduationCap },
  { id: "code", label: "代码", Icon: Code },
  { id: "terminal", label: "终端", Icon: Terminal },
  { id: "database", label: "数据库", Icon: Database },
  { id: "palette", label: "调色板", Icon: Palette },
  { id: "camera", label: "相机", Icon: Camera },
  { id: "music", label: "音乐", Icon: Music },
  { id: "globe", label: "地球", Icon: Globe },
  { id: "map", label: "地图", Icon: MapIcon },
  { id: "plane", label: "旅行", Icon: Plane },
  { id: "home", label: "首页", Icon: House },
  { id: "key", label: "钥匙", Icon: Key },
  { id: "lock", label: "加密", Icon: Lock },
];

/** 图标值的方言前缀（表情符号不含它）。 */
export const NODE_ICON_VALUE_PREFIX = "i:";
/** 两端校验的真实上限（`assertNodeIcon`）；编出来的值必须 ≤ 它。 */
export const NODE_ICON_VALUE_MAX_LENGTH = 16;

const ICON_BY_ID: ReadonlyMap<string, NodeIconDef> = new Map(NODE_ICONS.map((d) => [d.id, d]));
const TINT_BY_ID: ReadonlyMap<string, number> = new Map(NODE_ICON_TINTS.map((t) => [t.id, t.code]));

/** 编成落库值。未知 id/色号不抛错（调用点只可能来自目录与色表，防御性回落）。 */
export function encodeNodeIcon(iconId: string, tint: NodeIconTintId): string {
  const index = TINT_BY_ID.get(tint) ?? 0;
  return NODE_ICON_VALUE_PREFIX + iconId + ":" + index;
}

export type ParsedNodeIcon =
  | { kind: "emoji"; char: string }
  | { kind: "icon"; icon: NodeIconDef; tint: NodeIconTintId }
  /** 认得出是图标值，但目录里没有这个 id（跨端版本差/目录改过）⇒ 画中性图形，**绝不把原始串显示出来**。 */
  | { kind: "unknown"; id: string };

/** 解析落库值。null/空串 ⇒ null（= 用默认图标）。 */
export function parseNodeIcon(value: string | null | undefined): ParsedNodeIcon | null {
  if (value === null || value === undefined || value === "") return null;
  if (!value.startsWith(NODE_ICON_VALUE_PREFIX)) return { kind: "emoji", char: value };
  const parts = value.slice(NODE_ICON_VALUE_PREFIX.length).split(":");
  const id = parts[0] ?? "";
  const def = ICON_BY_ID.get(id);
  if (!def) return { kind: "unknown", id };
  const index = Number.parseInt(parts[1] ?? "", 10);
  const tint = NODE_ICON_TINTS.find((t) => t.code === index)?.id ?? "blue";
  return { kind: "icon", icon: def, tint };
}
