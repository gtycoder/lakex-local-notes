/**
 * 小记写作卡工具条上的**自定义工具项**：日期 / 表情 / 附件（261010 用户定稿）。
 *
 * 为什么必须自定义：内核工具条只认得它注册表里的 id —— `date` / `dateCard` / `emoji` / `file` /
 * `attachment` 塞进 `toolbar.agentConfig.*.items` 会被**静默丢弃**（实测 11 个候选只渲染 6 个）。
 * 这三个能力在「+」插入面板里有（内核面板「小工具」组 = 日历/日期/表情 + 基础组的附件），
 * 但用户要的是**工具条上就是这 9 个**，所以走内核官方的自定义工具项通道。
 *
 * 内核实现（vendor `components/lakex/lakex.js` 实测读码，行号即 bundle 内行号）：
 * - `_createToolbarUI`（160955-160974）：items 元素若是**函数** ⇒ `new Cls(editor, id)` + `init()`；
 *   若是对象 ⇒ `new item.clazz(editor, name, item.pluginContext)`；若是字符串 ⇒ 查 `_descriptorDefines`。
 * - `createWidget`（160497-160503）：用 `descriptor.constructor.Type` 选控件 ⇒ `'Button'` 渲染 `<evF descriptor/>`。
 * - `Button` 控件（159794-159883）用到的 descriptor 接口：
 *   `getInitUIState()` / `getUIState()` / `onEvent(name, payload)` / `isReady()` /
 *   `on('statechange', fn)` / `name` / `disabled` / `toolbarNode`（160706 由视图写入）。
 *   状态里 `icon` 为**字符串**时由内核自己的图标组件渲染（`<m1 type={icon}/>`）⇒ 直接复用内核图标名
 *   （`editor-main-date` / `editor-main-expression` / `editor-main-attachment`，与面板同款）。
 *   `tooltip` 形状 = 字符串数组（`ToolbarUIDescriptor.getTooltip` 147920：返回 `[文案, 快捷键?]`）。
 *
 * ⚠️ 内核**没有导出** `ToolbarUIDescriptor` 基类（`dist/index.d.ts` 只有 `ToolbarItemSpec` 等类型），
 * 所以这里按上面那套**实际调用面**做最小实现，而不是改 vendor（AGENTS §18：能不动依赖就不动）。
 */

/** 工具条描述符用到的编辑器能力（只声明我们用到的，避免依赖内核类型）。 */
export interface QuickNoteToolbarEditor {
  execCommand(name: string, ...args: unknown[]): unknown;
}

export interface QuickNoteToolbarUIState {
  disabled?: boolean;
  className?: string;
  /** 内核图标名（字符串 ⇒ 内核自己渲染）；也可给组件（自定义图标）。 */
  icon?: string | ((props: { iconSize?: number }) => unknown);
  iconSize?: number;
  tooltip?: string[];
  [key: string]: unknown;
}

/** 最小事件发射器：内核 Button 控件用 `on('statechange')` 订阅状态变化。 */
export abstract class QuickNoteToolbarButton {
  /** 内核 `createWidget` 按这个静态字段选控件类型。 */
  static Type = "Button";

  editor: QuickNoteToolbarEditor;
  /** 视图挂载时写入的工具条容器（内核 160706）；我们不用，但内核会写，保留字段避免报错。 */
  toolbarNode: HTMLElement | null = null;
  disabled = false;

  private readonly _name: string;
  private readonly _listeners = new Map<string, Array<() => void>>();
  private _ready = false;

  constructor(editor: QuickNoteToolbarEditor, name: string) {
    this.editor = editor;
    this._name = name;
  }

  get name(): string { return this._name; }
  get uiLayer(): unknown { return (this.editor as { uiLayer?: unknown }).uiLayer; }

  /** 内核创建后立刻调用（`_createToolbarUI` 的 `i.init()`）。 */
  init(): void { /* 无异步初始化 */ }

  isReady(): boolean { return this._ready; }

  /** 置就绪并通知控件刷新 —— 控件挂载时若 `isReady()` 已 true 会立刻取一次 `getUIState()`。 */
  refresh(): void { this._ready = true; this.emit("statechange"); }

  on(event: string, handler: () => void): void {
    const list = this._listeners.get(event) ?? [];
    list.push(handler);
    this._listeners.set(event, list);
  }

  emit(event: string): void {
    for (const handler of this._listeners.get(event) ?? []) {
      try { handler(); } catch { /* 单个订阅者异常不影响工具条 */ }
    }
  }

  /** 视图启用/禁用工具条时会**逐个**调用这两个（bundle 160611-160624）—— 缺了就 `e.enable is not a function` 白屏。 */
  disable(): void { this.disabled = true; this.refresh(); }
  enable(): void { this.disabled = false; this.refresh(); }

  removeAllListeners(): void { this._listeners.clear(); }
  destroy(): void { this.removeAllListeners(); }
  close(): void { /* 无浮层 */ }

  abstract getInitUIState(): QuickNoteToolbarUIState;
  abstract getUIState(): QuickNoteToolbarUIState;
  abstract onEvent(eventName: string, payload?: unknown): void;
}

/**
 * 表情面板（自带，纯 DOM，不引依赖）。
 *
 * 为什么不用内核那条路：内核「表情」只会**插一张空占位卡**（`insertCardNode('unicodeEmoji', {})`，bundle 121559），
 * 而那张卡的内核 UI 写死只画「插入表情」图标、**从不渲染 value**（200615-200625）⇒ 点不开选择器，是个死键
 * （插入面板的「表情」项同样如此，实测两次）。所以选择器我们自己给，选中后按**内核原意插文本**
 * （`insertAtSelection('text/lake', '<span>😀</span>')`；内核自己也是 `insertText` 后删卡，200896）。
 */
const QUICK_NOTE_EMOJI = [
  "😀", "😄", "😁", "😆", "😅", "😂", "🙂", "😉", "😊", "😍", "🤔", "😐",
  "😴", "😢", "😭", "😡", "👍", "👎", "👏", "🙏", "💪", "🎉", "🔥", "✨",
  "❤️", "💔", "⭐", "✅", "❌", "⚠️", "📌", "📎", "💡", "🚀", "☕", "🍀",
  "🌙", "☀️", "⏰", "📅",
] as const;

let emojiPanel: HTMLElement | null = null;
/** 面板的监听拆除函数（关面板时调用；显式持有，避免靠"观察 DOM 变化"猜什么时候该拆）。 */
let detachEmojiPanel: (() => void) | null = null;

/** 关掉表情面板（幂等）：移面板 + 撤监听。 */
function closeQuickNoteEmojiPicker(): void {
  detachEmojiPanel?.();
  detachEmojiPanel = null;
  emojiPanel?.remove();
  emojiPanel = null;
}

/** 打开表情面板（锚在传入的按钮下方，夹进视口；点外部 / 滚动 / Esc 即关）。 */
export function openEmojiPicker(anchor: HTMLElement | null, onPick: (emoji: string) => void): void {
  closeQuickNoteEmojiPicker();
  const panel = document.createElement("div");
  panel.className = "quick-note-emoji-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "选择表情");
  for (const emoji of QUICK_NOTE_EMOJI) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-note-emoji-panel__item";
    button.textContent = emoji;
    // 保住正文里的选区：按钮在 body 上，不拦 mousedown 的话焦点会移出 contenteditable
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeQuickNoteEmojiPicker();
      onPick(emoji);
    });
    panel.appendChild(button);
  }
  document.body.appendChild(panel);
  emojiPanel = panel;
  // 定位：优先贴在按钮下方，超出视口则上翻/夹住（不做估算高度的花活，直接用真实尺寸）
  const rect = anchor?.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  if (rect && rect.width > 0) {
    const left = Math.min(Math.max(8, rect.left - 8), Math.max(8, window.innerWidth - box.width - 8));
    const below = rect.bottom + 6;
    const top = below + box.height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - box.height - 6);
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
  }
  const onPointerDown = (event: Event) => {
    if (!panel.contains(event.target as Node)) closeQuickNoteEmojiPicker();
  };
  const onScroll = () => closeQuickNoteEmojiPicker();
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeQuickNoteEmojiPicker(); };
  // 下一帧再挂：否则"打开面板的那一次点击"会立刻命中 onPointerDown 把面板关掉。
  const timer = window.setTimeout(() => {
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
  }, 0);
  detachEmojiPanel = () => {
    window.clearTimeout(timer);
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("touchstart", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
  };
}

/** 把内核回传的 `event.target` 收敛成锚点元素（不直接用 `instanceof HTMLElement`：vitest 是 node 环境，没有该全局）。 */
function asAnchor(value: unknown): HTMLElement | null {
  return typeof value === "object" && value !== null && "getBoundingClientRect" in value ? (value as HTMLElement) : null;
}

/** 选文件（附件路径）。Capacitor/WebView 里 `<input type=file>` 会拉起系统选择器。 */
function pickQuickNoteFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    const done = (files: File[]) => { input.remove(); resolve(files); };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    input.click();
  });
}

/** 日期：与内核插入面板的日期项**同一条命令**（bundle 193641 `insertCard('dateCard', { date })`）。 */
export class QuickNoteDateToolbarItem extends QuickNoteToolbarButton {
  /** 工具条顺序/护栏用的稳定标识。 */
  static readonly QuickNoteId = "date";
  static readonly QuickNoteIcon = "editor-main-date";

  getInitUIState(): QuickNoteToolbarUIState {
    return { disabled: this.disabled, className: "ne-ui-toolbar-quicknote-date", icon: QuickNoteDateToolbarItem.QuickNoteIcon, tooltip: ["日期"] };
  }

  getUIState(): QuickNoteToolbarUIState { return { disabled: this.disabled }; }

  onEvent(eventName: string): void {
    if (eventName !== "click") return;
    this.editor.execCommand("insertCard", "dateCard", { date: Date.now() }, false);
  }
}

/**
 * 表情：**自带选择器**（内核那条路只插空卡且点不开面板，见 openEmojiPicker 的说明），
 * 选中后按内核卡模型插 `unicodeEmoji` 卡（value = `{ emoji }`）。
 */
export class QuickNoteEmojiToolbarItem extends QuickNoteToolbarButton {
  static readonly QuickNoteId = "emoji";
  static readonly QuickNoteIcon = "editor-main-expression";

  getInitUIState(): QuickNoteToolbarUIState {
    return { disabled: this.disabled, className: "ne-ui-toolbar-quicknote-emoji", icon: QuickNoteEmojiToolbarItem.QuickNoteIcon, tooltip: ["表情"] };
  }

  getUIState(): QuickNoteToolbarUIState { return { disabled: this.disabled }; }

  onEvent(eventName: string, payload?: unknown): void {
    if (eventName !== "click") return;
    this.openPicker(asAnchor(payload), (emoji) => this.insertEmoji(emoji));
  }

  /**
   * 插入表情 = 插**文本**（与内核表情卡同源：内核也是 `execCommand('insertText', emoji, pos)` 后删掉占位卡，
   * bundle 200896）。**不要**去插 `unicodeEmoji` 卡：那张卡的内核 UI 永远只画「插入表情」占位图标
   * （bundle 200615-200625 的 render 里写死 `type: 'card-emoji-insert'`，从不渲染 value）⇒ 插了就是死框。
   */
  protected insertEmoji(emoji: string): void {
    // 走**内核通用插入通道**（与块菜单同一个口：`insertAtSelection('text/lake', frag)`，见
    // vendor LOCAL-CHANGES #11 与 features/editor/blockMenuHelpers）。
    // ⚠️ 原生 `document.execCommand('insertText')` 在本内核模型下**不生效**（设备实测：选完表情正文无变化）。
    this.editor.execCommand("insertAtSelection", "text/lake", "<span>" + emoji + "</span>");
  }

  /** 测试缝：单测覆写它，避免真开面板。 */
  protected openPicker(anchor: HTMLElement | null, onPick: (emoji: string) => void): void {
    openEmojiPicker(anchor, onPick);
  }
}

/**
 * 附件：走内核「附件」路径 `execCommand('insertFiles', files, { from: 'ui', category: 'file' })`
 * （mediaCardRouting 的拦截口径同源 ⇒ 选到的 mp4/mp3 仍会被改写成视频/音频卡，与「+」面板一致）。
 */
export class QuickNoteAttachmentToolbarItem extends QuickNoteToolbarButton {
  static readonly QuickNoteId = "attachment";
  static readonly QuickNoteIcon = "editor-main-attachment";

  getInitUIState(): QuickNoteToolbarUIState {
    return { disabled: this.disabled, className: "ne-ui-toolbar-quicknote-attachment", icon: QuickNoteAttachmentToolbarItem.QuickNoteIcon, tooltip: ["附件"] };
  }

  getUIState(): QuickNoteToolbarUIState { return { disabled: this.disabled }; }

  onEvent(eventName: string): void {
    if (eventName !== "click") return;
    void this.pickFiles().then((files) => {
      if (!files.length) return;
      this.editor.execCommand("insertFiles", files, { from: "ui", category: "file" });
    });
  }

  /** 测试缝：单测覆写它避免真开系统选择器。 */
  protected pickFiles(): Promise<File[]> { return pickQuickNoteFiles(); }
}
