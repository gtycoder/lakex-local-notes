/**
 * Lake 编辑器「有效命令」注册表 —— 桌面/移动端共用的命令字典（唯一事实来源）。
 *
 * 背景：移动端 dock / 桌面工具栏都必须调用 lakex 的 renderer.execCommand，但命令名与
 * 常见富文本（document.execCommand）不同，且大量命令在 lakex 里是静默 no-op（点了没反应）。
 * 历史踩坑（见 HANDOFF §8.2 / §8.8）：insertUnorderedList/formatBlock/heading/setHeading/
 * insertBulletList/strike/strikethrough/justifyLeft|Center|Right/clearFormat/fontsize/indent/outdent
 * 都是 no-op，不得使用；正确名字是 unorderedList/orderedList/taskList/style "h1"/"p"/code/quote/hr。
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

/** 行内标记命令（需先有选中文本，且不可在面板 blur 后执行） */
export const MARK_COMMANDS: EditorCommandDef[] = [
  { name: "bold", label: "加粗", group: "mark" },
  { name: "italic", label: "斜体", group: "mark" },
  { name: "underline", label: "下划线", group: "mark" },
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
]);

/** 判断是否为已知有效命令（非 no-op）。 */
export function isKnownEditorCommand(name: string): boolean {
  return KNOWN_COMMAND_NAMES.has(name);
}

/** 取某类别命令（按注册顺序），供工具栏/面板渲染。 */
export function commandsByGroup(group: EditorCommandGroup): EditorCommandDef[] {
  return [...MARK_COMMANDS, ...BLOCK_INSERT_COMMANDS, ...HISTORY_COMMANDS].filter((c) => c.group === group);
}
