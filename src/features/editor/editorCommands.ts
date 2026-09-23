/**
 * Lake 编辑器「有效命令」注册表 —— 桌面/移动端共用的命令字典（唯一事实来源）。
 *
 * 背景：移动端 dock / 桌面工具栏都必须调用 lakex 的 renderer.execCommand，但命令名与
 * 常见富文本（document.execCommand）不同，且大量命令在 lakex 里是静默 no-op（点了没反应）。
 * 历史踩坑（见 HANDOFF §8.2 / §8.8，**仅移动端 renderer.execCommand 实测**）：
 * insertUnorderedList/formatBlock/heading/setHeading/insertBulletList/strike/justifyLeft|Center|Right
 * 是 no-op，不得使用；正确名字是 unorderedList/orderedList/taskList/style "h1"/"p"/code/quote/hr。
 * 260924 桌面实测更正（官方 docs/08 + LAKEX-CONTRACT §5.9）：strikethrough / fontsize / clearFormat /
 * indent / outdent / alignment / color / bgColor / link 在桌面 editor.execCommand 上**有效**——
 * 此前把移动端的 no-op 结论误套到了桌面。
 *
 * 设计：两端都从这里取命令定义，避免各写一套、重复踩坑；新增命令先在此登记 + 单测。
 */
export type EditorCommandGroup = "mark" | "block" | "insert" | "history";

export interface EditorCommandDef {
  /** 传给 renderer.execCommand 的命令名 */
  name: string;
  /** 额外传给 execCommand 的参数（例如 style 命令的 block 类型） */
  args?: unknown[];
  /** UI 标签 */
  label: string;
  /** 命令类别：mark=行内标记（需选中文本），block=块级（光标在段内即可），insert=插入，history=历史 */
  group: EditorCommandGroup;
}

/** 块级样式（style 命令取值） */
export const STYLE_BLOCKS: { value: string; label: string }[] = [
  { value: "p", label: "正文" },
  { value: "h1", label: "H1" },
  { value: "h2", label: "H2" },
  { value: "h3", label: "H3" },
  { value: "h4", label: "H4" },
];

/** 浮动工具栏「段落样式」：正文 + H1–H6（标签对齐内核固定工具栏：正文/标题1..6）。
 * 与 STYLE_BLOCKS 分开维护，避免影响移动端 dock 的既有取值。 */
export const PARAGRAPH_STYLES: { value: string; label: string; keys: string }[] = [
  { value: "p", label: "正文", keys: "⌥ ⌘ 0" },
  { value: "h1", label: "标题1", keys: "⌥ ⌘ 1" },
  { value: "h2", label: "标题2", keys: "⌥ ⌘ 2" },
  { value: "h3", label: "标题3", keys: "⌥ ⌘ 3" },
  { value: "h4", label: "标题4", keys: "⌥ ⌘ 4" },
  { value: "h5", label: "标题5", keys: "⌥ ⌘ 5" },
  { value: "h6", label: "标题6", keys: "⌥ ⌘ 6" },
];

/** 浮动工具栏「转为」：结构块转换（260924 用户口径：代码块 = 行内代码；高亮块 = 内核 alert 命令）。 */
export const CONVERT_ITEMS: { name: string; label: string; icon: string }[] = [
  { name: "orderedList", label: "有序列表", icon: "editor-orderedList" },
  { name: "unorderedList", label: "无序列表", icon: "editor-unorderedList" },
  { name: "taskList", label: "待办列表", icon: "editor-taskList" },
  { name: "quote", label: "引用", icon: "editor-quote" },
  { name: "code", label: "代码块", icon: "editor-inlinecode" },
  { name: "alert", label: "高亮块", icon: "text-border" },
];

/** 行内标记命令（需先有选中文本，且不可在面板 blur 后执行） */
export const MARK_COMMANDS: EditorCommandDef[] = [
  { name: "bold", label: "加粗", group: "mark" },
  { name: "italic", label: "斜体", group: "mark" },
  { name: "underline", label: "下划线", group: "mark" },
  { name: "strikethrough", label: "删除线", group: "mark" },
  { name: "code", label: "行内代码", group: "mark" },
];

/** 块级/插入命令（光标在段内即可执行，可在面板 blur 后执行） */
export const BLOCK_INSERT_COMMANDS: EditorCommandDef[] = [
  { name: "quote", label: "引用", group: "block" },
  { name: "unorderedList", label: "列表", group: "block" },
  { name: "orderedList", label: "有序列表", group: "block" },
  { name: "taskList", label: "待办", group: "block" },
  { name: "hr", label: "分割线", group: "insert" },
];

/** 历史命令 */
export const HISTORY_COMMANDS: EditorCommandDef[] = [
  { name: "undo", label: "撤销", group: "history" },
  { name: "redo", label: "重做", group: "history" },
];

/** 全部已知有效命令名（防误用 no-op；更新此表时同步单测） */
export const KNOWN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...MARK_COMMANDS.map((c) => c.name),
  ...BLOCK_INSERT_COMMANDS.map((c) => c.name),
  ...HISTORY_COMMANDS.map((c) => c.name),
  "style", // 块级样式（配 STYLE_BLOCKS 的 value）
  "fontsize", // 字号（带数值参数；取值见 FONT_SIZE_OPTIONS，官方 docs/08）
  "indent", "outdent", // 缩进
  "link", "unlink", // 链接
  "clearFormat", // 清除格式
  "alignment", // 对齐（带 left/center/right/justify 参数）
  "color", "clearColor", "bgColor", "clearBgColor", // 字体色 / 背景色
  "alert", // 高亮块（命令式注册；execCommand('alert') 插入 blockquote.lake-alert）
]);

/** 字号档位（官方 docs/08：execCommand('fontsize', N) 的取值区间）。 */
export const FONT_SIZE_OPTIONS: readonly number[] = [12, 13, 14, 15, 16, 19, 22, 24, 29, 32, 40];

/** 判断是否为已知有效命令（非 no-op）。 */
export function isKnownEditorCommand(name: string): boolean {
  return KNOWN_COMMAND_NAMES.has(name);
}
