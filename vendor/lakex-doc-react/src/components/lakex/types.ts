import type { ComponentType, ReactNode } from "react";
import type { BlockMenuAction } from "../BlockContextMenu";

export type LakexEditorContentType =
  | "text/lake"
  | "text/html"
  | "text/plain"
  | "text/markdown"
  | "json";

export interface LakexEditorContent {
  type: LakexEditorContentType; // 内容类型
  text: string;
}

export type LakexEditorLanguage = "zh-cn" | "en-us";

export interface LakexEditorPlaceholder {
  tip: string; // 编辑器空内容时展示的提示文案
  emptyParagraphTip?: string; // 在光标聚焦的空段落首的提示文案
}

// ============================================================================
// 适配器（envAdapter）
// ============================================================================
export interface EnvAdapter {
  /** 打开链接（阅读/编辑模式共用） */
  openLink?: (url: string, isExternal: boolean) => void;
  /** 打开提及人链接（阅读/编辑模式共用） */
  openMentionLink?: (url: string, isExternal: boolean) => void;
  /** 预览图片（阅读/编辑模式共用） */
  previewImgs?: (
    imgs: Array<{
      src: string;
      msrc?: string;
      w?: number;
      h?: number;
      layoutSlef?: () => void;
      size?: number;
    }>,
    index: number
  ) => void;
  /** 卡片长按事件（阅读/编辑模式共用） */
  longPressCard?: (params: Record<string, any>) => void;
  /** 编辑模式：在本地打开链接 */
  openLocalLink?: (url: string) => void;
  /** 编辑模式：打开书签链接 */
  openBookmarkLink?: (url: string) => void;
  /** 编辑模式：打开三方服务链接 */
  openThirdpartyLink?: (url: string) => void;
}

// ============================================================================
// 图片（image）
// ============================================================================
export interface ImageConfig {
  /** 服务端抓取图片转存接口 */
  crawlURL?: string | (() => string) | null;
  /** 上传图片文件接口 */
  uploadFileURL?: string | (() => string) | null;
  /** 自定义上传任务，配合 isCaptureImageURL 使用 */
  createUploadPromise?: (
    request: { type: "url" | "file" | "base64"; data: File | string }
  ) => Promise<{ url: string; size: number; filename: string }>;
  /** 可识别为图片类型的文件后缀 */
  accept?: string | string[] | null;
  /** 判断图片是否需要被抓取转存 */
  isCaptureImageURL?: (url: string, patterns: RegExp[], excludePatterns: RegExp[]) => boolean;
  /** 作为 isCaptureImageURL 的第一个参数 */
  capturePatterns?: RegExp[];
  /** 作为 isCaptureImageURL 的第二个参数 */
  excludeCapturePatterns?: RegExp[];
  /**
   * 图片选中后上方浮动操作栏（cardToolbar）的按钮项。
   * 每个项必须同时包含 `name` 与 `onClick`；`'|'` 表示分隔线。
   * onClick 签名：(editor, cardUI, item) => void，其中 cardUI.cardData 为图片卡片数据。
   * 也可只写 { name, title } 复用框架内置处理器（copy/delete/maximize/widthMode 等）。
   */
  miniToolbar?: Array<
    | "|"
    | {
        name: string;
        title?: string;
        icon?: string;
        onClick?: (editor: any, cardUI: any, item: any) => void;
      }
  >;
  /** 浮动工具栏显示时机：'focus' | 'hover' | 'never'（image 默认 'focus'） */
  showMiniToolbarWhen?: "focus" | "hover" | "never";
}

// ============================================================================
// 输入（input）
// ============================================================================
export interface InputConfig {
  /** 中英文输入自动追加空格 */
  autoSpacing?: boolean;
  /** 输入成对符号时自动补全（1.34.0+） */
  autoClosing?: boolean;
}

// ============================================================================
// 布局（layout）
// ============================================================================
export interface LayoutConfig {
  /** 布局模式：fixed 标宽(750px) / adapt 自适应 */
  layout?: "fixed" | "adapt";
}

// ============================================================================
// 多级标题（heading）
// ============================================================================
export interface HeadingConfig {
  /** 根据当前页面地址和标题节点 id 生成 hash 链接 */
  generateHashLink?: (url: string | URL, id: string) => string | null;
  /** 是否开启标题锚点，默认 false */
  anchor?: boolean;
  /** 是否开启标题折叠，默认 true */
  folding?: boolean;
}

// ============================================================================
// 视频（video）
// ============================================================================
export interface VideoConfig {
  /** 可接受的后缀名 */
  accept?: string[] | null;
  /** 默认上传 URL */
  uploadFileURL?: string | null;
  /** 自定义上传任务 */
  createUploadPromise?: (
    data: File
  ) => Promise<{ url: string; size: number; filename: string }>;
  /** 视频转存（对老版本 lake/html 数据读取） */
  crawlVideo?: (
    src: string
  ) => Promise<{ url: string; size: number; filename: string }>;
  /** 是否使用原始资源地址 */
  useOriginSrc?: (src: string) => boolean;
}

// ============================================================================
// 附件（file）
// ============================================================================
export interface FileConfig {
  /** 获取文件下载链接 */
  getFileDownloadURL?: ((src: string) => string) | null;
  /** 获取文件预览地址 */
  getPreviewUrl?: ((src: string) => string) | null;
  /** 文件上传地址 */
  uploadFileURL?: string;
  /** 自定义上传任务 */
  createUploadPromise?: (
    file: File
  ) => Promise<{ url: string; size: number; filename: string }>;
  /** 是否允许下载 */
  canDownload?: (cardData: any) => boolean;
  /** 是否允许预览 */
  canPreview?: (cardData: any) => boolean;
  /** 阅读态卡片 tooltip */
  viewerTooltip?: (ui: any) => ReactNode;
  /** 行内附件节点点击 */
  onViewerInlineFileClick?: (e: MouseEvent, ui: any) => void;
}

// ============================================================================
// 提及（mention）
// ============================================================================
export interface MentionUserData {
  id: string;
  nickName?: string | null;
  name: string;
  avatar: string;
  avatar_url?: string;
  dep: string;
  login: string;
}

export interface MentionContentData {
  url: string;
  id: string;
  title: string;
  /** 文档类型，用于展示对应 UI */
  type: string;
  updated_at: string;
  group: string;
  book: string;
}

export type MentionResponse =
  | { docs: MentionContentData[]; users: MentionUserData[] }
  | MentionUserData[];

export interface MentionConfig {
  /** 补全头像完整 URL 所需的 origin */
  avatarOrigin?: string;
  /** 默认列表内容，或返回默认列表的异步函数 */
  defaultList?: MentionResponse | (() => Promise<MentionResponse>);
  /** 是否支持快捷键输入（默认 true） */
  enableQuickInput?: boolean;
  /** 跳转提及人链接是否新开标签页（默认 false） */
  externalOpen?: boolean;
  /** 根据人项获取提及 UI 相关数据 */
  generateMentionInfo?: (detail: {
    login?: string | null;
    nickName?: string | null;
    name?: string | null;
  }) => { text?: string | null; url?: string | null; externalOpen?: boolean };
  /** 获取提及列表的接口 */
  mentionURL?: string;
  /** 提及接口入参 */
  mentionURLParams?:
    | object
    | ((input: string, tab?: "users" | "docs") => object);
  /** 是否同时支持提及文档（默认 false） */
  multiTypes?: boolean;
  /** kernel 插件初始化后的钩子 */
  onAfterKernelPluginInit?: (kernel: any) => void;
  /** 提及查询接口，配置后 mentionURL/mentionURLParams 无效 */
  onMentionSearch?: (
    input: string,
    tab: "users" | "docs"
  ) => Promise<MentionResponse>;
  /** 生成跳转链接使用的 origin */
  origin?: string | null;
  /** 记录提及行为的接口 */
  recordURL?: string;
  /** 编辑模式下弹层的父容器（1.7.0+） */
  popupContainer?: () => HTMLElement;
}

// ============================================================================
// 日期卡片（dateCard）
// ============================================================================
export interface DateCardConfig {
  /** 是否支持 mention 选择日期，默认 true */
  supportMention?: boolean;
}

// ============================================================================
// 日历（calendar）
// ============================================================================
export interface CalendarConfig {
  /** 以星期几作为开头，0-6 表示周日到周六，默认 0 */
  startWeekDay?: number;
  /** 输出 html 时生成日历卡片的链接 */
  getDocReadURL?: (currentURL: string, cardId: string) => string;
}

// ============================================================================
// 公式（math）— 阅读器和编辑器配置项相同
// ============================================================================
export interface MathConfig {
  /** katex 的 umd 资源地址。不建议配置该项 */
  KaTexURL?: string;
  /** 根据 IntersectionObserver 判断公式卡片不可见时是否隐藏节点以提升渲染性能，默认 false */
  hideOnInvisible?: boolean;
}

// ============================================================================
// 斜杠命令（slash）— 仅支持编辑模式的配置
// ============================================================================
export interface ICardSelectGroupConfig {
  /** 展示名称 */
  title?: string;
  /** 唯一 key */
  name?: string;
  /** 当前组的布局样式：normal 普通流式 / icon 小图标 / column 两栏 */
  type?: string;
  /** 当前组的菜单项数组，每项可为字符串或带二级菜单的对象 */
  items?: Array<string | Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ICardSelectOptionConfig {
  /** 分组列表，通常只需要配置 groups 字段 */
  groups?: ICardSelectGroupConfig[];
  [key: string]: unknown;
}

export interface SlashConfig {
  /** 是否禁用快捷键（/ 或 \ 唤起斜杠面板），默认 false */
  disableQuickInput?: boolean;
  /** 菜单项配置，key 为唤起环境：general / table / collapse / simple */
  cardSelect?: Record<string, ICardSelectOptionConfig>;
}

// ============================================================================
// 大纲（toc）
// ============================================================================
export interface TocEditingConfig {
  /** 是否开启，默认 false */
  enable?: boolean;
  /** 是否为展开状态，默认 true。
   * 注意：用户手动执行过展开/收起操作后，状态会存入 localStorage，
   * 此时会优先采用用户上一次的行为而非本配置项。 */
  normalView?: boolean;
  /** 大纲被点击后是否允许改变 hash，默认 true */
  allowModifyHash?: boolean;
}

export interface TocReadingConfig {
  /** 是否开启，默认 false */
  enable?: boolean;
  /** 大纲被点击后是否允许改变 hash，默认 true */
  allowModifyHash?: boolean;
  /** 指定挂载的 TOC 节点（() => HTMLElement）。阅读模式大纲需要配置真实滚动容器 scrollNode */
  getContainer?: (() => HTMLElement) | null;
}

export interface TocConfig {
  /** 编辑模式配置项 */
  editing?: TocEditingConfig;
  /** 阅读模式配置项 */
  reading?: TocReadingConfig;
}
export interface CodeblockConfig {
  /** 支持自定义样式，默认：false */
  supportCustomStyle: boolean;
}

// ============================================================================
// 音频（audio）
// ============================================================================
// 编辑与阅读模式配置项相同，注意两者都要配置（1.23.0 支持）
/** 音频上传响应值 */
export interface AudioUploadResponse {
  /** 音频 id，建议服务端可据此查询播放/下载地址 */
  audioId?: string;
  /** 播放地址 */
  audioUrl: string;
  /** 下载地址 */
  downloadUrl: string;
  /** 文件大小（字节） */
  filesize: number;
  /** 文件名 */
  filename: string;
}

/** 音频卡片数据（queryAudioUrl 入参，内部字段自行 console 查看） */
export type AudioCardData = Record<string, any>;
/** 自定义音频播放组件 props（接口自行 console 查看） */
export type AudioPlayerComponentProps = Record<string, any>;
/** 自定义音频异常组件 props（上传失败时展示，接口自行 console 查看） */
export type AudioErrorComponentProps = Record<string, any>;

export interface AudioConfig {
  /**
   * 音频上传。可在上传过程中调用 progress（value 需在 0-1 范围内）。
   * 需返回 AudioUploadResponse
   */
  createUploadPromise?: (
    data: File,
    progress: (value: number) => void
  ) => Promise<AudioUploadResponse>;
  /**
   * 获取音频的播放地址。建议配套服务端根据 audioId 查询播放与下载地址；
   * 若没有服务能力，可把 audioId 直接配置成播放地址，纯前端即可拿到。
   */
  queryAudioUrl?: (
    cardData: AudioCardData
  ) => Promise<{ audioUrl: string; downloadUrl: string }>;
  /** 是否允许音频播放，默认阅读页不允许 */
  allowAudioPlayer?: boolean;
  /** 自定义音频播放组件（默认原生 audio 标签视图） */
  playerComponent?: ComponentType<AudioPlayerComponentProps>;
  /** 自定义音频异常组件（上传失败时展示） */
  errorComponent?: ComponentType<AudioErrorComponentProps>;
  /** 输出 html 时使用的跳转地址 */
  getDocReadURL?: (currentURL: string, cardId: string) => string;
}

// ============================================================================
// 链接（link）
// ============================================================================
export interface VLinkMiniToolbarItem {
  /** tooltip 文案 */
  tooltip: string;
  /** 图标，可为 ReactNode 或字符串 */
  icon: ReactNode | string;
  /** 点击回调，入参为当前 link 节点 */
  onClick: (node: any) => void;
}

export interface LinkConfig {
  /** 阅读模式：配置鼠标 hover 链接时的情景工具栏，入参为当前 hover 的 link 元素 */
  vMiniToolbar?: (node: any) => VLinkMiniToolbarItem[];
}

// ============================================================================
// html 数据（htmlDataSource）— 编辑模式配置项
// ============================================================================
export interface HtmlDataSourceConfig {
  /** 是否读取空行，默认 false（使用 html 渲染文档会忽略空行） */
  readEmptyLine?: boolean;
}

// ============================================================================
// 异常卡片（fallbackcard）— 编辑模式配置项
// ============================================================================
export interface FallbackcardConfig {
  /** 主提示文案，默认 "该卡片暂时无法显示" */
  mainTipHTML?: string;
  /** 次提示文案，默认 "请刷新页面后再试" */
  subTipHTML?: string;
}

// ============================================================================
// kernel-assistant（1.7.0+）
// ============================================================================
export interface KernelAssistantConfig {
  /** emoji 使用独立字体，让以前会渲染错误的 emoji 尽量正确渲染 */
  supportEmoji?: boolean;
}

// ============================================================================
// 默认字号（defaultFontsize）— 阅读器和编辑器都支持
// ============================================================================
export interface DefaultFontsizeConfig {
  /** 默认字号（不对标题、卡片的字号生效）。支持 12/13/14/15/16/19/22/24 */
  defaultFontsize?: number;
}

// ============================================================================
// 工具栏（toolbar）
// ============================================================================
export type ToolbarItemSpec = string | Record<string, unknown>;
export interface ToolbarModeConfig {
  /** 工具栏按钮列表，字符串 "|" 表示分隔符，其余为 toolbarItems.* 对象 */
  items: ToolbarItemSpec[];
}
export interface ToolbarAgentConfig {
  /** 默认工具栏（光标不在 table 时展示） */
  default?: ToolbarModeConfig;
  /** table 选区工具栏（光标位于 table 时展示） */
  table?: ToolbarModeConfig;
}
export interface ToolbarConfig {
  /** 工具栏配置，在创建编辑器时传入。修改工具栏的方法 */
  agentConfig?: ToolbarAgentConfig;
}

export interface ICustomEditorCardProps<TCardValue = any> {
  editor: any; // 编辑器实例
  cardValue: TCardValue;
  /** 更新数据，会触发组件重新渲染 */
  updateCardValue: (value: TCardValue) => void;
  cardType: 'inline' | 'block';
}

export interface CustomCardConfig<TCardValue = any> {
  /** 卡片名称。会被内部存储在卡片的cardValue的$name字段上，应确保唯一性，在读取数据时会根据该字段渲染自定义的react组件 */
  name: string;
  /** 卡片类型。分为行内和区块卡片，行内卡片布局时会和文本处于一行连续布局，区块卡片则独占一行 */
  cardType: 'inline' | 'block';
  /** 配置斜杠命令面板以及工具栏的cardselect菜单面板 */
  slash: {
      /** 图标 */
      icon: string;
      /**
       * 斜杆面板的搜索提示，提示用户搜索，例如：/glk
       */
      mainSearch?: string;
      /**
       * 关键字，搜索的时候根据关键字进行查找
       */
      keywords?: string | string[];
      /**
       * 选项名称，例如：高亮块
       */
      label: string | (() => {zhCN: string, enUS: string});
      /**
       * 选项描述，例如：高亮文本
       */
      description?: string | (() => {zhCN: string, enUS: string});
  };
  /**
   * 创建自定义卡片的初始数据，如果不需要初始数据请传null
   */
  initValue: Record<string, any> | null;

  /**
   * 编辑模式的组件的构造函数，支持函数式和类组件。组件的props请参考文档：https://www.yuque.com/yuque/developer/tik01se6xtqp6h3w
   */
  editorComponent: React.ComponentType<ICustomEditorCardProps<TCardValue>> | React.ElementType<ICustomEditorCardProps<TCardValue>>;

  /**
   * 阅读模式的组件的构造函数，支持函数式和类组件。组件的props请参考文档：https://www.yuque.com/yuque/developer/tik01se6xtqp6h3w
   */
  viewerComponent: React.ComponentType<ICustomEditorCardProps<TCardValue>> | React.ElementType<ICustomEditorCardProps<TCardValue>>;

  /**
   * 配置这个方法可以在复制数据、获取指定格式的文档内容的场景下，自定义text/plain格式的数据内容，以便粘贴到其他应用中或导出数据。默认为空字符串。
   */
  writeText: (value: TCardValue | null) => string;

  /**
   * 配置这个方法可以在复制数据、获取指定格式的文档内容的场景下，自定义text/html格式的数据内容，以便粘贴到其他应用中或导出数据。返回值为html字符串。默认为空字符串。
   */
  writeHtml: (value: TCardValue | null) => string;

}

export interface CustomCard<TCardValue = any> {
  /**
   * 自定义的卡片SVG。
   * 返回的svg如下格式。其中icon_id要和config.slash.icon一致。
   * path中尽量不要设置填充颜色。如果设置了填充颜色，则切换暗黑模式时颜色不会自动变化
   * 
   * <symbol id="icon_id" viewBox="0 0 1024 1024">
   *    <path d="xxx" />
   * </symbol>
   * 
   */
  icon?: React.ElementType | React.ComponentType | React.FC;

  /**
   * 自定义卡片配置
   */
  config: CustomCardConfig<TCardValue>;
}


export interface CustomCardsConfig {
  cards: CustomCard<any>[]
}

export interface BookmarkConfigFetchResult {
  icon: string,
  image: string,
  title: string,
  desc: string,
  url: string,
}

export interface BookmarkConfig {
  // 远端抓取的API地址
  detailAction?: string;
  // 自定义抓取
  fetchDetailHandler?: (url: string) => Promise<BookmarkConfigFetchResult>;
  // 是否启用链接转Bookmark
  pasteLinkConvert?: boolean
}

export type DrawingBoardAILocale = "zh-CN" | "en-US";

export interface DrawingBoardAIRequest {
  /** 用户在 AI 画板助手中输入的原始描述。 */
  description: string;
  /** 完整的画板 JSON 格式规范，可直接作为模型的 system prompt。 */
  systemPrompt: string;
  /**
   * 已组合好的本轮用户消息：包含历史需求、当前画布的唯一一份最新
   * JSON，以及本轮需求。业务侧应优先把它作为 user message 发送。
   */
  contextPrompt?: string;
  /** 当前会话中已经成功生成过的用户需求，不包含 AI JSON。 */
  history?: readonly string[];
  /** 发起请求时从画布实时序列化的最新 AI 中间格式。 */
  currentBoard?: Record<string, unknown>;
  locale: DrawingBoardAILocale;
  /** 关闭生成弹窗时触发，用于取消业务侧 fetch 请求。 */
  signal?: AbortSignal;
}

export type DrawingBoardAIResponse = string | Record<string, unknown>;

export interface DrawingBoardAIConfig {
  /**
   * 调用业务侧 AI 服务。前端画板不会保存 API Key，也不绑定具体模型。
   * 返回值可以是 JSON 字符串，也可以是已经解析的 JSON 对象。
   */
  generate: (
    request: DrawingBoardAIRequest,
  ) => Promise<DrawingBoardAIResponse>;
}

// ============================================================================
// createOpenEditor 的完整配置对象
// ============================================================================
export interface LakexEditorConfig {
  // 通用配置
  /** 禁用插件列表 */
  disabledPlugins?: string[];
  /** 文档上方渲染的 React 组件 */
  header?: ComponentType<any>;
  /** 编辑器类型：simple / default / small */
  uiSwitch?: { default?: "simple" | "default" | "small" };
  /** 输出 html 时部分卡片用到的当前页面链接 */
  currentURL?: string;
  /** 适配器，用于处理不同设备/业务场景的交互 */
  envAdapter?: EnvAdapter | null;
  /** 是否开启虚拟渲染（1.6.0+） */
  virtualRendering?: boolean;
  /** 滚动容器，阅读器大纲需要配置真实滚动容器 */
  scrollNode?: HTMLElement | (() => HTMLElement);
  /** 阅读器大纲滚动偏移量 */
  boundaryTopOffset?: number;
  /** 占位文案 */
  placeholder?: string | LakexEditorPlaceholder;

  // 插件配置（插件名为一级 key）
  image?: ImageConfig;
  input?: InputConfig;
  layout?: LayoutConfig;
  heading?: HeadingConfig;
  video?: VideoConfig;
  file?: FileConfig;
  mention?: MentionConfig;
  dateCard?: DateCardConfig;
  calendar?: CalendarConfig;
  math?: MathConfig;
  slash?: SlashConfig;
  toc?: TocEditingConfig;
  codeblock?: CodeblockConfig;
  audio?: AudioConfig;
  link?: LinkConfig;
  htmlDataSource?: HtmlDataSourceConfig;
  fallbackcard?: FallbackcardConfig;
  kernelAssistant?: KernelAssistantConfig;
  defaultFontsize?: DefaultFontsizeConfig;
  /** 工具栏配置（agentConfig.default / agentConfig.table） */
  toolbar?: ToolbarConfig;

  // 自定义卡片（内部默认包含 mindMapCardConfig
  customCard?: CustomCardsConfig;
  // Bookmark配置，配置后链接可以转为书签卡片样式
  bookmark?: BookmarkConfig;
  /** AI 画板助手，由业务层注入实际的模型调用。 */
  drawingBoardAI?: DrawingBoardAIConfig;
  
}

export interface LakexEditorProps {
  /**
   * 文档的ID，当id变化时，编辑器会重新渲染
   */
  id?: string;
  /**
   * 是否启用暗黑模式，当该值变化时，编辑器会重新选软
   */
  dark?: boolean;
  /**
   * 显示语言，当该值变化时，编辑器会重新渲染
   */
  language?: LakexEditorLanguage;
  /**
   * 初始内容
   */
  content?: LakexEditorContent;
  /**
   * 内容改变时监听函数
   */
  onContentChange?: (value: LakexEditorContent[]) => void; 
  /** 
   * 透传给 createOpenEditor 的底层配置
   */
  config?: Partial<LakexEditorConfig>;
  /**
   * 禁用合并配置功能，当禁用后，编辑器默认配置将不会
   */
  disableMergeConfig?: boolean;
  /**
   * 是否启用行首悬浮手柄和块操作菜单，默认 true
   */
  blockMenu?: boolean;
  /**
   * 块操作回调（右键菜单动作触发时调用）
   * 可用于业务方自定义处理或追踪用户操作
   */
  onBlockAction?: (action: BlockMenuAction, data: {
    blockElement: HTMLElement;
    blockType: string;
    payload?: string;
  }) => void;
}
