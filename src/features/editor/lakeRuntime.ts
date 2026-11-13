import { Doc, GetDefaultEditorConfig } from "@dlient/lakex-doc-react";
import { isDesktop } from "../../lib/native";
import { rlog } from "../../lib/log";
import { errorFields } from "../../core/logFormat";
import { mountBlockHoverHandle } from "./blockHandleMount";
import { mountSelectionToolbar } from "./selectionToolbar/mountSelectionToolbar";
import { registerEditorInstance } from "./editorRegistry";
import { DOCUMENT_IMAGE_DOWNLOAD_LIMITS, uploadLakeResource } from "./resourceUpload";
import { createImageUploadTask, resumePendingImageUploads, type ImageUploadPerform } from "./imageUploadTask";
import { pendingUploadsForNote } from "./uploadJournal";
import { registerNoteRefCard, withNoteRefSlashItem } from "./noteRefCard";
import { registerLockedTextCard, withLockedTextSlashItem } from "./lockedTextCard";
import { registerAiAssistantCard, withAiAssistantSlashItem } from "./aiAssistantCard";
import type { ResourceUploadOutput } from "../../lib/types";
import { ASSET_ORIGIN } from "../../lib/assetPort";
import { createImageThumbUploadTracker } from "./imageThumbUploadTracker";
import { LAKE_KATEX_SCRIPT, LAKE_MHCHEM_SCRIPT, injectKatexScriptsInOrder } from "./lakeKatexInjection";
import { setupAudioCardRetry } from "./lakeAudioCardRetry";
import { setupTocScrollFollow } from "./lakeTocScrollFollow";
import { subscribeDocInitPerf } from "./lakePerfSubscription";
import { setupViewerTocClickAssist } from "./lakeTileRender";
import { VIRTUAL_RENDERING, appendDisposeExtras, lakeBridge, deepMerge, ensureCustomCardIcons, ensureLakeLongTaskObserver, lakeMark, lakeMeasure, prepareCustomCards, recordLakeDocInitPerf, resolveScrollNode, QUICK_NOTE_TOOLBAR_ITEMS, QUICK_NOTE_FULL_TOOLBAR_ITEMS } from "./kernelConfig";
import type { LakeEditorPrefs } from "./kernelConfig";
import { hardenDestroyedHotKeyLookup, installBookmarkCardDegrade } from "./kernelBookmarkDegrade";
import { imageThumbDisplaySrc } from "./kernelImageThumb";
import { setupInsertedCardAutoOpen, setupVisibleCardHydration } from "./kernelCardHydration";
import { setupCardToolbarHoverBridge } from "./kernelToolbarBridge";
import { refreshTocSidebar } from "./kernelTocSidebar";
import type { NativeTocSidebar } from "./kernelTocSidebar";

export interface LakeKernelInstance {
  /** 内核命令入口（style/insertCard/insertAtSelection/delete… 与编辑器同一套命令）。 */
  execCommand?(name: string, ...args: unknown[]): unknown;
}

/** 内核渲染器的事件/命令面（闭源 lakex 无类型声明：字段全可选，缺失时静默降级）。 */
export interface LakeRendererBus {
  execCommand?(name: string, ...args: unknown[]): unknown;
  scrollByNodeId?(id: string): unknown;
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

export interface LakeEditorInstance {
  setDocument(type: "text/lake", content: string): void;
  /** 编辑器命令入口（等同内核命令，用于 blockMenuHelpers 等处的 style/insertCard 调用）。 */
  execCommand?(name: string, ...args: unknown[]): unknown;
  /** 读取命令当前值（active 态/字号/样式：bold→"true"、style→"p"/"h1"、fontsize→px 或 "null"）。 */
  queryCommandValue?(name: string, ...args: unknown[]): unknown;
  /** 命令是否可用（链接等先用它把门：link 需选区、insertLink 需光标）。 */
  queryCommandEnabled?(name: string): unknown;
  /** 命令执行态（内核 CommandState：-1 Unavailable / 0 NotExecuted / 1 Executed / 2 Unknown）。
   *  块级命令（列表/待办/引用）的生效与禁用判据，见 useSelectionToolbar.readState。 */
  queryCommandState?(name: string): unknown;
  /** 内核实例（命令/选区都挂在这里）。 */
  kernel?: LakeKernelInstance;
  /** 锁定态 Viewer 可能不完整支持 markdown/plain（调用方需 typeof 守卫 + try/catch）。 */
  getDocument(type: "text/lake" | "text/markdown" | "text/plain"): string;
  on(event: string, listener: () => void): void;
  off?: (event: string, listener: () => void) => void;
  destroy?: () => void;
  destory?: () => void;
  /** 请求对当前可见卡片执行一次懒初始化水合。 */
  requestCardHydration?: () => void;
  /** 内核渲染器（tileRenderCompleted/generalRenderCompleted 的事件源；与 lakeBridge.renderer 同一对象）。 */
  renderer?: LakeRendererBus;
  /** 应用侧挂载的「额外清理」清单（见 appendDisposeExtras；内核实例不带，由本文件附加）。 */
  __disposeExtras?: () => void;
  /** bookmark 卡降级补丁的清理函数（见 installBookmarkCardDegrade）。 */
  __disposeBookmarkDegrade?: () => void;
  /** 内核插件集合（数组 / Map / 普通对象三种形态都可能出现，见 findNativeTocSidebar）。 */
  _plugins?: unknown;
}

/**
 * Lake 内核运行时桥接（闭源 lakex 无类型声明）：kernel/renderer/事件系统集中在此声明，
 * 调用方经 lakeBridge(editor) 访问，避免调用点各自写内核私有字段的断言（PROJECT-AUDIT 建议收敛）。
 */
export interface LakeKernelBridge {
  kernel?: {
    getDocExtraContent?(): { toc?: unknown };
    onPluginEvent?(event: string, listener: () => void): (() => void) | undefined;
    /** 内核未返回退订函数时的回退路径（toc 重放监听）。 */
    offPluginEvent?(event: string, listener: () => void): void;
    /** 重放内核事件（刷新大纲时补发 tocChange）。 */
    emitPluginEvent?(event: string, payload?: unknown): unknown;
  };
  renderer?: LakeRendererBus;
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

/**
 * 内核编辑器工厂（DT-16）。lakex 的 d.ts 把 createOpenEditor 的 options 与返回值都写成
 * 未标注类型、createOpenViewer 只落在索引签名里 ⇒ 这里按**实测返回形状**（可当
 * LakeEditorInstance 用）收敛一次，调用点不再各自断言。直接复用 `Doc` 本体作接收者
 * （工厂是 Doc 上的方法，抽成裸函数会丢 this）。
 */
type LakeDocOpener = (this: unknown, mount: HTMLElement, options: Record<string, unknown>) => LakeEditorInstance;
const openLakeEditor: LakeDocOpener = Doc.createOpenEditor;
const openLakeViewer: LakeDocOpener = Doc.createOpenViewer;


export function createLakeDocument(
  element: HTMLElement,
  mode: "viewer" | "editor",
  onChange: () => void,
  tocEnabled: boolean,
  noteId: string,
  /** 真实滚动容器；可传 getter（移动端宿主 ref 首帧才有值），内核每次测量时求值。 */
  scrollNode?: HTMLElement | null | (() => HTMLElement | null),
  prefs?: LakeEditorPrefs,
  /** 覆盖资源上传落盘（小记编辑态用它把图片写进 quick-notes 空间；缺省走文档资源空间）。 */
  uploadResource?: (request: unknown) => Promise<ResourceUploadOutput>
): LakeEditorInstance {
  /** 小记版式：仅编辑态可用（阅读态是 viewer，没有工具条/展开语义）。 */
  /**
   * 小记专用：文档编辑器外观 + 受限工具栏（只影响小记，文档编辑器不传这个开关）。
   * 注意两个 default：
   * - 挂载点仍是文档版式（`ne-doc-major-editor`）⇒ 小记编辑态与文档页长得一样；
   * - 只裁剪「工具栏 items」，卡片注册、「+」面板、上传钩子、其余 option 全部照旧（261010 起面板不再过滤）。
   */
  const quickNoteUi = mode === "editor" ? prefs?.quickNoteUi : undefined;
  /**
   * 【task-26 / 边界 A】新插入图片的缩略「放行」器（只在启用显示缩略时创建；逻辑见 imageThumbUploadTracker.ts）。
   * 实测（261111，5554）：文件选择 / 粘贴在上传 promise resolve 之前，内核已把**真实 origin**
   * （来自上传前对 File 的解码）写进模型、src 仍为空 ⇒ resolve 时若正文里恰好一张这样的待上传卡，
   * 可以安全放行；并发/异常时退避重试，等 src 回填后按正文 origin 放行。
   */
  const thumbEditorHolder: { editor: LakeEditorInstance | null } = { editor: null };
  const imageThumbTracker = typeof prefs?.imageThumbWidth === "number"
    && prefs.imageThumbWidth > 0
    && prefs.imageThumbAllowFiles instanceof Set
    ? createImageThumbUploadTracker({
        width: prefs.imageThumbWidth,
        allow: prefs.imageThumbAllowFiles as Set<string>,
        readBody: () => {
          const instance = thumbEditorHolder.editor;
          if (!instance) return "";
          try { return instance.getDocument("text/lake") || ""; } catch { return ""; }
        },
        schedule: (delayMs: number, run: () => void) => {
          const timer = window.setTimeout(run, delayMs);
          return () => window.clearTimeout(timer);
        },
      })
    : null;

  /**
   * 261114：文档编辑器启用「可恢复图片上传」（createUploadTask + uploadJournal）。
   * 小记写作卡/导入临时内核有各自的资产落盘目标或一次性会话，不走持久日志/自愈。
   */
  const journalImageUploads = mode === "editor"
    && !uploadResource
    && noteId !== "markdown-import"
    && noteId !== "kernel-prewarm";
  const performDocumentImageUpload: ImageUploadPerform = (request) =>
    uploadLakeResource(request, noteId, { downloadLimits: DOCUMENT_IMAGE_DOWNLOAD_LIMITS });

  const mount = document.createElement("div");
  // 小记走内核 note 版式（小卡片外观 + 展开按钮）；`.ne-doc-note-editor` 是小记版式的挂载点前缀
  // （内核 fullscreen 把 `.ne-ui-fullscreen` 加到 editorNode 的父节点 = 本 mount，小记的展开整窗规则
  // `.ne-doc-note-editor.ne-ui-fullscreen` 也以此为前缀）；`.lakex-note-editor` 命中内核唯一的
  // `.lakex-note-editor .ne-ui-enter-fullscreen{top:6px;right:6px}`（展开按钮内缩量）。
  mount.className = quickNoteUi === "card"
    ? "lake-editor-mount ne-doc-note-editor lakex-note-editor"
    : "lake-editor-mount ne-doc-major-editor";
  // 锁/解锁是「同一文档换渲染模式」，旧实例若立刻销毁，正文区会空白数帧到数百毫秒
  // （大文档更久）＝白屏闪烁。EditorTab 因此把旧挂载点标记 is-outgoing 交给新实例
  // （见其 pendingDisposeRef）：这里保留这些仍在显示旧内容的节点，其余照旧清掉。
  // outgoing 由 CSS 抬到新挂载点之上，新实例首屏渲染出正文后整层移除，中间没有空白帧。
  for (const child of Array.from(element.children)) {
    if (!child.classList.contains("is-outgoing")) child.remove();
  }
  element.appendChild(mount);
  const prefsSize = typeof prefs?.fontSize === "number" ? prefs.fontSize : 18;
  // viewer（阅读态）内核不消费 defaultFontsize，落回自身 14px 默认——字号挂到 mount 根，
  // 阅读/编辑两态同源继承（设置里的正文字号此前在移动端阅读态从未生效）。
  mount.style.fontSize = `${prefsSize}px`;
  // lakex-doc-react 的默认配置是函数（按语言生成）；本项目固定 zh-cn。
  const defaultConfig = GetDefaultEditorConfig("zh-cn") as Record<string, unknown>;
  /** vendor 默认配置里「斜杠面板分组」的最小形状（只读、用于过滤第三方分组）。 */
  const vendorSlash = defaultConfig as {
    slash?: {
      cardSelect?: {
        general?: { groups?: Array<{ name?: string }> };
        table?: { groups?: Array<{ name?: string }> };
      };
    };
  };
  const customOptions: Record<string, unknown> = {
    // 编辑态不禁用 emoji 插件：unicodeEmoji 卡片的表情选择器依赖其默认数据，
    // 禁用后选择器渲染为空（0x0）。Viewer 仍保持纯只读。
    disabledPlugins: mode === "viewer"
      ? ["save", "toolbar", "emoji"]
      : ["save", ...(prefs?.showToolbar === false ? ["toolbar"] : [])],
    // 语雀/Lake 导出的 bookmark 卡（bookmarkInline / bookmark）能否被注册进内核，
    // 取决于 BookmarkEditorPlugin(option name="bookmark") 的 isEnable，而其
    // isEnable = !!_option.detailAction || !!_option.fetchDetailHandler。
    // 本地没有语雀 API，故提供 fetchDetailHandler 返回最小 detail，仅用于让插件
    // 走三参 registerInlineCard/registerBlockCard 注册卡类（否则 getCardClass 返回
    // null 直接崩溃）。已有 detail 的剪贴板卡不会走到该 handler；真正缺少 detail 的
    // 纯 URL 粘贴时才被调用，这里返回基于 url 的最小结构、不出网。
    bookmark: {
      fetchDetailHandler: (src: unknown) => {
        const url = typeof src === "string" ? src : String((src as { url?: unknown })?.url ?? "");
        return Promise.resolve({
          title: url,
          icon: null,
          image: null,
          desc: null,
          url,
        });
      },
    },
    input: {},
    defaultFontsize: prefsSize,
    // 小记专用：**只裁剪工具栏 items**（261010 起「+」面板不再过滤），外观与文档页完全一致。
    // 文档编辑器不传 `quickNoteUi` ⇒ 这段完全不生效（红线：不要影响文档）。
    ...(quickNoteUi
      ? {
          // 两种版式的工具条：card＝小卡片最小集 + 展开后完整；full＝直接完整（文档样式）。
          // 展开（fullscreen）＝切到完整工具条，**只在桌面保留**：移动端用户 261010 定稿「不要展开，
          // 一行放下全部工具图标」⇒ 移动端连展开按钮都不渲染（卡片右上角那个）。
          ...(quickNoteUi === "card"
            ? { uiSwitch: { default: "note" }, fullscreen: { enable: isDesktop() } }
            : {}),
          toolbar: {
            agentConfig: {
              // 自定义工具项是**类**（内核按构造函数实例化），而 vendor 的 ToolbarItemSpec 只声明了
              // string | Record<> ⇒ 这里显式放宽类型（内核实测接受函数，见 quickNoteToolbarWidgets.ts 的读码记录）。
              ...(quickNoteUi === "card"
                ? { note: { items: [...QUICK_NOTE_TOOLBAR_ITEMS] as unknown as string[] } }
                : {}),
              default: { items: [...QUICK_NOTE_FULL_TOOLBAR_ITEMS] },
            },
          },
        }
      : {}),
    toc: {
      enable: !!tocEnabled && !prefs?.disableNativeToc,
      // 增强大纲 = 原生大纲被 CSS 隐藏，但必须同时让内核退出「展开」布局态，否则 .ne-normal-toc
      // 仍给正文留 280px 占位（大段空白）。官方配置项 toc.normalView（默认 true=展开）；显式传值
      // 时内核不读 localStorage，故能可靠压过用户上次的展开偏好。
      // allowAutoPin/rememberLastPin 必须一起关：内核在 viewSizeChange 时会 isAllowAutoPin() 自动
      // 把大纲展开（bundle 179780），只传 normalView=false 会在创建后又被改回展开 → 占位复发。
      ...(prefs?.collapseNativeToc ? { normalView: false, allowAutoPin: false, rememberLastPin: false } : {}),
      // 内核默认 allowModifyHash=true（lakex.js 编辑态 ekg / 阅读态 ezx 两套默认都是 !0）：
      // 点击大纲会把 location.hash 改成标题节点 id → 触发浏览器锚点导航 → 浏览器滚锚点的
      // 整条祖先滚动链（.ne-editor-wrap 之外还滚 html）→ html 被滚 42px（=topbar 高，html
      // 未锁 overflow 时）→ 整壳上移、topbar 滚出视野、tab 栏顶到第一行（260916 实测，用户
      // 报「点大纲布局乱套」）。关闭后走 scrollByNodeId 正常跳转、不再写 hash；base.css 的
      // html,body{overflow:hidden} 为兜底。注意：内核 option 是扁平 schema（OptionName 'toc'，
      // 编辑/阅读共用），allowModifyHash 直接挂在 toc 下，没有 editing/reading 嵌套。
      allowModifyHash: false,
    },
    // 官方阅读器配置（语雀文档 47）：阅读态大纲判定「当前标题」时忽略顶部这么多像素。
    // 内核编辑态写死 40（bundle 179499），阅读态默认 0 → 两态高亮口径不一致（阅读态刚滚过
    // 标题就切高亮）。统一为 40。仅阅读态传（编辑态无此 option）。
    ...(mode === "viewer" ? { boundaryTopOffset: 40 } : {}),
    // 锁定态（Viewer）分帧渲染（261111）：内核 ViewerRenderer 的 tile controller 每帧只渲 30 个
    // 顶层块（_tileSize 硬编码，lakex.js 57095）⇒ 首帧 ~9ms、长文档的长任务被摊平成 N 帧；
    // **DOM 节点/堆总量与 direct 完全一致**（不省占用，只省首帧阻塞）。编辑态不受影响：内核先判
    // virtualRendering 走引擎 windowed controller（lakex.js 48281-48285）。
    // 代价与配套（大纲/位置恢复必须处理）见 lakeTileRender.ts 文件头。
    // 仅桌面：移动端的文档内查找（MobileFindBar 自研 DOM 扫描）与阅读态走查都以「全文已在 DOM」
    // 为前提，分帧会先只铺 30 块；移动端要开必须另做查找兜底并过设备门禁（AGENTS §21④）。
    ...(mode === "viewer" && isDesktop() ? { tileRendering: true } : {}),
    codeblock: {
      // 使用与当前 Lake 资源链匹配的 CodeMirror 7.1.3，旧版 lakex-doc 资源
      // 在 Slash 新建代码块时可能只留下空壳而没有可编辑实例。
      codemirrorURL: "./vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
    },
    math: {
      // 统一使用随应用镜像的 KaTeX 0.16.8 与 mhchem，避免外链脚本加载顺序/全局
      // `katex.__defineMacro` 不存在导致包含公式或思维导图文档出现运行时异常。
      KaTexURL: [LAKE_KATEX_SCRIPT, LAKE_MHCHEM_SCRIPT],
    },
    image: {
      // 261114：文档编辑器用自实现的可恢复任务（taskId → uploadJournal → 正文回填）；
      // 小记/导入等自定义落盘目标仍走 createUploadPromise（不写持久日志，避免把 staging 资产
      // 记到文档 noteId 下）。
      ...(journalImageUploads
        ? {
            // 必须显式清掉默认 createUploadPromise：内核 createUploadTask 解析顺序是
            // 「createUploadPromise 优先 → createUploadTask」，vendor 默认配置带一个直通 URL 的
            // createUploadPromise 桩（url 原样返回、size 0）⇒ 不清掉的话 createUploadTask 永远不执行，
            // 远程图会变成「src=原 URL/status done」的假成功卡（本 bug 的另一半）。
            createUploadPromise: undefined,
            createUploadTask: (request: { type?: unknown; data?: unknown }) => {
              return createImageUploadTask({
              noteId,
              type: request.type === "file" || request.type === "base64" ? request.type : "url",
              data: request.data,
              perform: performDocumentImageUpload,
              journal: true,
              onOutput: (output) => imageThumbTracker?.onUploaded(output as { url?: unknown }),
              });
            },
          }
        : {
            // 边界 A：上传完成后登记本条资产（tracker 在 promise resolve 时确认 origin 已正确，再并进活 allowlist）。
            createUploadPromise: (request: unknown) => {
              const upload = (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request);
              if (!imageThumbTracker) return upload;
              return Promise.resolve(upload).then((output) => {
                imageThumbTracker.onUploaded(output as { url?: unknown });
                return output;
              });
            },
          }),
      // 本地资源服务器 URL 必须排除，否则 Lake 每次 setDocument 都会重新下载并上传本地图片
      isCaptureImageURL: (url: string) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith(`${ASSET_ORIGIN}/`),
      // 【task-26，仅移动端小记写作卡】只改显示 src（内核 toDisplaySrc 出口），模型/保存不受影响。
      // 必须同时拿到 allowlist（卡片已带 original 的图）才挂 hook；缺集合/宽度一律不挂 = fail-safe。
      ...(typeof prefs?.imageThumbWidth === "number"
        && prefs.imageThumbWidth > 0
        && prefs.imageThumbAllowFiles instanceof Set
        ? {
            onBeforeRenderImage: (src: string): string =>
              imageThumbDisplaySrc(src, prefs.imageThumbWidth, prefs.imageThumbAllowFiles),
          }
        : {}),
    },
    file: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
    },
    // 视频/音频卡片：必须配 createUploadPromise，否则 Lake 走默认 uploadFileURL（/api/upload/video，
    // 应用内不存在）→ 上传失败/一直"上传中"。uploadLakeResource 对非图片 File 走附件落盘
    // （note-assets + canonical URL），video/audio 卡片 src=canonical 本地可达、持久可加载。
    video: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
    },
    audio: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
      // audio 卡上传成功后 setId(audioId = canonical URL)，播放地址 = canonical（本地可达，持久）。
      // 不配 queryAudioUrl 时 Lake 走 queryURL 轮询（应用无此端点）→ 永远"上传中"。
      // allowAudioPlayer=false（Lake 默认，版权保护）会把卡片渲染成"版权限制"链接（点击跳系统
      // 浏览器打开附件 URL）——本地私有笔记应内嵌播放，必须置 true。
      allowAudioPlayer: true,
      queryAudioUrl: (cardData: unknown) => {
        const info = (cardData as { getAudioInfo?: () => { id?: string | null } } | null)?.getAudioInfo?.();
        const url = info?.id ?? null;
        return url
          ? Promise.resolve({ audioUrl: url, downloadUrl: url })
          : Promise.reject(new Error("audio url unavailable"));
      },
    },
    // 移除第三方 embed 分组（我们不渲染外部嵌入卡）；画板/导图等分组由 lakex-doc-react 的卡片配置自带。
    // 261010：**不再过滤「+」面板** —— 面板全量 = 与桌面端一致。此前用官方钩子 `filterOption` 把小记面板
    // 收成白名单，理由是"不能预览展示的就不让插入"；现在预览对内核格式是「快路径 + 内核只读兜底」，
    // 任何格式都能显示，白名单只剩坏处（日期/表情/表格在移动端被我们自己的清单藏起来）。
    slash: {
      cardSelect: {
        general: {
          groups: withLockedTextSlashItem(
            withAiAssistantSlashItem(
              withNoteRefSlashItem(
                (vendorSlash.slash?.cardSelect?.general?.groups || []).filter(
                  (g) => g.name !== "third-party-services"
                )
              )
            )
          ),
        },
        table: {
          groups: withLockedTextSlashItem(
            withAiAssistantSlashItem(
              withNoteRefSlashItem(
                (vendorSlash.slash?.cardSelect?.table?.groups || []).filter(
                  (g) => g.name !== "third-party-services"
                )
              )
            )
          ),
        },
      },
    },
    // scrollNode 与虚拟渲染解耦：原生 TOC 的点击定位/滚动高亮需要真实滚动容器
    // （body overflow:hidden 时 Lake 默认回退 document.scrollingElement||document.body 会拿错，
    // TROUBLESHOOTING #26）。编辑态与锁定 Viewer 都要下发：阅读态 TOC 点击跳转走
    // viewer.scrollNode.scrollTop（bundle 236871），不下发时回退 html——html 已被
    // overflow:hidden 锁死（W-8 兜底），点击大纲正文就不滚了（260916 用户实测）。
    // 移动端 disableVirtualRendering=true 表示无内部滚动容器，不传。
    ...(prefs?.disableVirtualRendering
      ? {}
      : { scrollNode: () => resolveScrollNode(scrollNode) }),
    ...(VIRTUAL_RENDERING.enabled && mode === "editor" && !prefs?.disableVirtualRendering
      ? {
          // Viewer 不需要编辑态的卡片懒加载。原生 Viewer 在虚拟卡片节点尚未
          // appear 时可能只留下 hole，尤其是 Drawnix 画板会在锁定切换后丢失。
          // 锁定文档数量通常远小于编辑态交互频率，Viewer 直接完整渲染更稳定。
          virtualRendering: true,
          cardLazyInit: VIRTUAL_RENDERING.cardLazyInit,
        }
      : {}),
  };

  const mergedOptions = deepMerge(defaultConfig, customOptions);

  // 「文档引用」卡（R2，261008）：追加自定义卡 + 斜杠项；必须在 prepareCustomCards 之前注册
  // （它负责把 label/description 的函数形态归一化成字符串）。放在 deepMerge 之后 ⇒ 不覆盖内核自带卡。
  registerNoteRefCard(mergedOptions);
  // 「加密文本」卡（261023）：同样必须在 prepareCustomCards 之前注册（否则卡不注册 ⇒ 面板无项、正文读成 fallback）。
  registerLockedTextCard(mergedOptions);
  // 「AI 写作助手」插入卡（261107）：复用顶栏 AI 的无上下文面板 + 光标锚点，只增加插入能力。
  registerAiAssistantCard(mergedOptions);

  // 先收集图标：新 vendor 的 React `icon` 挂在 `{ config, icon }` 包装上，prepareCustomCards 解包后会丢。
  ensureCustomCardIcons(mergedOptions);
  prepareCustomCards(mergedOptions);

  ensureLakeLongTaskObserver();
  lakeMark("lake:create:start");
  // Lake 的 gJ 注入的是默认 async 的动态 <script>，katex/mhchem 并行加载时
  // 执行顺序无保证；mhchem 抢先运行时 window.katex 尚未就绪就会抛
  // "Cannot read properties of undefined (reading '__defineMacro')"。
  // 这里在编辑器创建前按顺序预注入（async=false 强制经典脚本顺序执行），
  // Lake 稍后通过 script[src] 去重复用，不再重复注入。
  // DT-07：注入是全局副作用，单独成模块；它的 dispose 是契约性空操作（脚本进程级共享）。
  const disposeKatexInjection = injectKatexScriptsInOrder();
  // `.call(Doc)` 保持内核工厂的接收者（与原先直接 `Doc.createOpenXxx(...)` 一致）。
  const editor = mode === "viewer"
    ? openLakeViewer.call(Doc, mount, mergedOptions)
    : openLakeEditor.call(Doc, mount, mergedOptions);

  lakeMark("lake:create:end");
  lakeMeasure("lake:create:openEditor", "lake:create:start", "lake:create:end");
  hardenDestroyedHotKeyLookup(editor);
  appendDisposeExtras(editor, disposeKatexInjection);
  if (imageThumbTracker) {
    thumbEditorHolder.editor = editor;
    appendDisposeExtras(editor, () => {
      imageThumbTracker.dispose();
      // 销毁后残留定时器不该再碰已销毁的内核实例。
      thumbEditorHolder.editor = null;
    });
  }
  if (mode === "editor") {
    editor.on("contentchange", onChange);
  }
  // 语雀 bookmark 卡本地降级为普通超链接（ne-link），见 installBookmarkCardDegrade。
  if (mode === "editor") {
    try { editor.__disposeBookmarkDegrade = installBookmarkCardDegrade(mount, editor); } catch { /* 忽略 */ }
  }
  // 仅编辑态启用 virtualRendering + cardLazyInit，因此可见卡片水合只挂在编辑器实例；
  // 锁定态 Viewer 明确关闭虚拟渲染，避免自定义卡片停留在 hole 空壳。
  if (mode === "editor" && VIRTUAL_RENDERING.enabled && VIRTUAL_RENDERING.cardLazyInit) {
    // 虚拟渲染下 Lake 原生 TOC watcher 的二分探测失效（视口外标题无 DOM），
    // 自研滚动跟随高亮 + 点击精确滚动；另有表格浮动工具栏 hover 桥。
    // 清理函数挂在 editor 上由 destroyLakeEditor 调。
    try {
      const disposes: Array<() => void> = [];
      // 代码块等卡片的 $appear / CodeMirror 初始化不能依赖原生 TOC。桌面端关闭
      // 原生 TOC、改用应用自建大纲时，这条水合订阅仍必须保留；Viewer 同样需要。
      try {
        const hydration = setupVisibleCardHydration(
          element,
          editor,
          () => resolveScrollNode(scrollNode),
          mode === "editor",
        );
        disposes.push(hydration.dispose);
        editor.requestCardHydration = hydration.requestHydration;
      } catch { /* 忽略 */ }
      if (mode === "editor" && !prefs?.disableNativeToc) {
        // DT-07：TOC watcher 独立成模块；TOC 数据与内核事件在这里注入（避免循环 import）。
        const getTocIds = (): string[] => {
          try {
            const toc = lakeBridge(editor).kernel?.getDocExtraContent?.()?.toc;
            return Array.isArray(toc) ? toc.map((t: { id?: string }) => t?.id).filter((id): id is string => Boolean(id)) : [];
          } catch { return []; }
        };
        try {
          disposes.push(setupTocScrollFollow(element, editor, () => resolveScrollNode(scrollNode), getTocIds, lakeBridge(editor).kernel));
        } catch { /* 忽略 */ }
      }
      if (mode === "editor") {
        try { disposes.push(setupCardToolbarHoverBridge(element)); } catch { /* 忽略 */ }
      }
      // 保留先注册的清理（DT-07 的 katex 注入 dispose）再按原数组顺序清理这三段。
      const prevDispose = editor.__disposeExtras;
      editor.__disposeExtras = () => {
        try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
        for (const dispose of disposes) {
          try { dispose(); } catch { /* 忽略 */ }
        }
      };
    } catch { /* 非编辑器环境忽略 */ }
  }
  // 锁定态（Viewer）分帧渲染的配套：阅读态原生大纲点击用 querySelector 找标题，分帧收集期
  // 找不到就静默不滚（lakex.js 236848 _scrollTo）⇒ 补「延后一帧 + 按需 flush + 几何对齐」，
  // 并在分帧铺完（viewer ready）时补发一次 scroll 让内核大纲 watcher 重算当前小节。
  // 详见 lakeTileRender.ts 文件头。与 tileRendering 同一道门（仅桌面）：移动端本轮不开分帧，
  // 多挂一个捕获监听 + ready 时的 scroll 派发都是无收益的移动端行为变化（改移动端须过设备门禁）。
  if (mode === "viewer" && isDesktop()) {
    try {
      const disposeTocAssist = setupViewerTocClickAssist(element, editor, () => resolveScrollNode(scrollNode));
      const prevDispose = editor.__disposeExtras;
      editor.__disposeExtras = () => {
        try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
        try { disposeTocAssist(); } catch { /* 忽略 */ }
      };
    } catch { /* 非编辑器环境忽略 */ }
  }
  // 表情/公式卡片插入后自动打开选择器/编辑器（不依赖虚拟渲染开关）
  if (mode === "editor") {
    try {
      const disposeAutoOpen = setupInsertedCardAutoOpen(element);
      const prevDispose = editor.__disposeExtras;
      editor.__disposeExtras = () => {
        try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
        try { disposeAutoOpen(); } catch { /* ignore */ }
      };
    } catch { /* 非编辑器环境忽略 */ }
  }
  // 订阅 Lake 内置性能监控：docInitPerf（code 55），直接给出异步渲染管线的
  // parseTime / renderTime / nodeLength，用于量化 setDocument 之后的主线程耗时。
  // DT-07：订阅独立成模块并带 dispose（此前只订阅、从不退订）。
  appendDisposeExtras(editor, subscribeDocInitPerf(editor, (perf) => {
    lakeMark("lake:render:completed");
    recordLakeDocInitPerf(perf);
  }));
  // audio 卡内嵌播放兜底（桌面/移动端共用）：Lake 的 queryAudioUrl 自动触发在「加载已有卡」时
  // 不稳定（渲染成版权/错误链接，点击会跳系统浏览器打开附件 URL）。直接调 onTranscodeSuccess
  // 设置播放器（audio 元素 src=canonical，应用内嵌播放）。卡渲染完成后调用才生效——持续重试
  // （最长 ~20s）直到播放器出现；DT-07：重试计时器与清理都收进 lakeAudioCardRetry.ts。
  appendDisposeExtras(editor, setupAudioCardRetry(mount));
  // 块悬浮手柄 + 块操作菜单（桌面编辑态 opt-in；见 blockHandleMount 的安全边界说明）
  if (mode === "editor" && prefs?.blockHandle) {
    const disposeHandle = mountBlockHoverHandle(element, mount, editor, noteId);
    const prevDispose = editor.__disposeExtras;
    editor.__disposeExtras = () => {
      try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
      disposeHandle();
    };
  }
  // 浮动工具栏（桌面编辑态 opt-in）：选中文字/图片时在选区上方弹出浮框。
  if (mode === "editor" && prefs?.floatingToolbar) {
    const disposeSelectionToolbar = mountSelectionToolbar(element, mount, editor, noteId);
    const prevDispose = editor.__disposeExtras;
    editor.__disposeExtras = () => {
      try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
      disposeSelectionToolbar();
    };
  }
  registerEditorInstance(mount, editor);
  return editor;
}


/**
 * 打开文档时恢复日志里仍 pending 的图片下载（261114：跨重启/崩溃/上传期间退出）。
 * 结果写回 uploadJournal；EditorTab 的日志订阅会触发一次正文回填（不阻塞编辑器创建）。
 * 只处理文档编辑器（导入临时内核/预取实例没有持久正文）。
 */
export function resumePendingDocumentImageUploads(noteId: string): void {
  if (!noteId || noteId === "markdown-import" || noteId === "kernel-prewarm") return;
  const entries = pendingUploadsForNote(noteId);
  if (entries.length === 0) return;
  resumePendingImageUploads(
    noteId,
    (request) => uploadLakeResource(request, noteId, { downloadLimits: DOCUMENT_IMAGE_DOWNLOAD_LIMITS }),
    entries.map((entry) => ({ taskId: entry.taskId, url: entry.url, type: entry.type, status: entry.status })),
  );
}

export function destroyLakeEditor(editor: LakeEditorInstance | null): void {
  try {
    editor?.__disposeExtras?.();
  } catch (error) {
    rlog.warn("editor", "Lake editor extras cleanup failed", { ...errorFields(error) });
  }
  try {
    editor?.__disposeBookmarkDegrade?.();
  } catch { /* 忽略 */ }
  try {
    editor?.destroy?.();
    if (!editor?.destroy) editor?.destory?.();
  } catch (error) {
    rlog.warn("editor", "Lake editor cleanup failed", { ...errorFields(error) });
  }
}


// 公共符号 re-export（拆分后导出名/类型名保持不变）
export { QUICK_NOTE_TOOLBAR_ITEMS, lakeBridge, resolveScrollNode };
export type { LakeEditorPrefs };
export { refreshTocSidebar };
export type { NativeTocSidebar };
