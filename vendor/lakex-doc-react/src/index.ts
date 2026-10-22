// Public entry for the `@dlient/lakex-doc-react` package.
// Re-exports everything a consumer needs to embed the lakex (语雀) document
// editor inside a React app, plus the bundled framework instance `Doc`.

// CSS styles are imported here so they're included in the bundle but
// don't appear in the .d.ts declaration files.
import "./assets/antd.css";
import "./assets/lakex-doc.css";
import "./components/BlockHoverHandle/BlockHoverHandle.css";
import "./components/BlockContextMenu/BlockContextMenu.css";

// The framework bundle (ESM). `Doc` is the lakex-doc root object.
export { default as Doc } from "./components/lakex/lakex";

// React editor component.
export { LakexEditor } from "./components/lakex/LakexEditor";
export type {
  LakexEditorProps,
  LakexEditorConfig,
  LakexEditorContent,
  LakexEditorContentType,
  LakexEditorPlaceholder,
  LakexEditorLanguage,
  EnvAdapter,
  ImageConfig,
  InputConfig,
  LayoutConfig,
  HeadingConfig,
  VideoConfig,
  FileConfig,
  MentionConfig,
  MentionUserData,
  MentionContentData,
  MentionResponse,
  DateCardConfig,
  CalendarConfig,
  TocConfig,
  TocEditingConfig,
  TocReadingConfig,
  MathConfig,
  SlashConfig,
  ICardSelectOptionConfig,
  ICardSelectGroupConfig,
  CodeblockConfig,
  AudioConfig,
  AudioUploadResponse,
  AudioCardData,
  LinkConfig,
  VLinkMiniToolbarItem,
  HtmlDataSourceConfig,
  FallbackcardConfig,
  KernelAssistantConfig,
  DefaultFontsizeConfig,
  ToolbarConfig,
  ToolbarItemSpec,
  ToolbarModeConfig,
  ToolbarAgentConfig,
  DrawingBoardAIConfig,
  DrawingBoardAILocale,
  DrawingBoardAIRequest,
  DrawingBoardAIResponse,
} from "./components/lakex/types";

// Reusable card height resizer (click-to-select + drag + delete-on-Delete).
export { default as CardResizer } from "./components/CardResizer/CardResizer";

// 查找卡片节点ID
export { default as findCardId } from './cards/utils';

// Shared card prop contract used by custom cards.
export type { ICardProps } from "./cards/types";

// custom card.
export { textToDiagramCard } from "./cards/TextToDiagram";
export { mindMapCard } from "./cards/MindMapCard";
export {
  drawingBoardCard,
  flowchartBoardCard,
  umlBoardCard,
  mindmapBoardCard,
  DrawingBoardEditor,
  DrawingBoardViewer,
} from "./cards/DrawingBoard";
export type { DrawingBoardPreset, IDrawingBoardCardValue } from "./cards/DrawingBoard";

// LOCAL-CHANGE #18：独立画板文档（kind=board）要直接挂画布内核（不经卡片/内核编辑器上下文），
// 因此把 DrawnixBoardCore 暴露给宿主。它只依赖 lakex-drawnix + @plait/*，不 import 内核。
//
// ⚠️ **必须走「懒加载器」而不是静态 re-export**：静态导出会让本模块（入口 chunk）静态依赖
// DrawnixBoardCore ⇒ 画板引擎（lakex-drawnix + @plait/*，≈511KB gzip）被并进宿主首屏，
// 直接推翻 LOCAL-CHANGE #7 的分包结论（构建会报 INEFFECTIVE_DYNAMIC_IMPORT）。
export function loadDrawnixBoardCore(): Promise<typeof import("./cards/DrawingBoard/DrawnixBoardCore")> {
  return import("./cards/DrawingBoard/DrawnixBoardCore");
}
export type { DrawnixBoardCoreProps } from "./cards/DrawingBoard/DrawnixBoardCore";

// export default config
export { default as GetDefaultEditorConfig} from './configs/editor'
export { default as GetDefaultSlashConfig } from "./configs/slash";
export { default as DefaultAudioConfig } from "./configs/audio";
export { default as DefaultEnvAdapterConfig } from "./configs/envAdapter";
export { default as DefaultFileConfig } from "./configs/file";
export { default as DefaultHeadingConfig } from "./configs/heading";
export { default as DeafultImageConfig } from "./configs/image";
export { default as DefaultInputConfig } from "./configs/input";
export { default as DefaultTocConfig } from "./configs/toc";
export { default as DefaultViedoConfig } from "./configs/video";

// 块悬浮拖拽手柄（hover 显示 ⋮ 图标，支持拖拽移动和右键菜单）
export { BlockHoverHandle } from "./components/BlockHoverHandle";
export type { BlockHoverHandleProps } from "./components/BlockHoverHandle";

// 块右键上下文菜单
export { BlockContextMenu, SAFE_BLOCK_ACTIONS } from "./components/BlockContextMenu";
export type {
  BlockContextMenuProps,
  MenuItem,
  BlockMenuAction,
} from "./components/BlockContextMenu";
