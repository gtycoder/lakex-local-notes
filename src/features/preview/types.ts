/**
 * 预览能力层的公共类型（261112 审计 02 报告 §3.4；用户裁决 Q01 = 发布前做预览 Phase 2）。
 *
 * 分层约定（与 02 报告一致）：
 * - 本文件 = **纯类型**，不依赖 React、不依赖内核、不含副作用；
 * - 档位决策在 previewAsset.ts（纯函数）；预设常量在 policy.ts；内核只读宿主在 useReadOnlyKernelViewer.ts；
 * - 渲染器分派仍归各宿主（NoteDocPreview / QuickNotePreview / HistorySnapshotPreview），
 *   本层只提供它们共用的输入类型与策略。
 *
 * 为什么先有类型层：本轮六份审计里"预览"是最横切的一块，30 个入口出现 4 种"能做什么"的组合；
 * 先把「内容种类 / 策略 / 资产引用」三种形状钉住，后续每加一个入口就不用再各自发明参数。
 */
import type { NoteKind } from "../../core/noteKind.js";

/** 预览支持的内容种类：5 种文档 kind + 小记 + markdown（AI 答案）。 */
export type PreviewContentKind = NoteKind | "quickNote" | "markdown";

/**
 * 预览的内容描述：只回答「是什么 + 正文/引用」，**不管内容怎么取**（取数仍归各空间既有 IPC/bridge）。
 * 能力层不 import native/bridge —— 由调用方把数据准备好再传进来（保证可单测、无平台耦合）。
 */
export type PreviewSource =
  | { type: "note"; noteId: string; kind: PreviewContentKind; body: string; title?: string }
  | { type: "historySnapshot"; noteId: string; snapshotId: number; kind: PreviewContentKind; body: string }
  | {
      type: "quickNote";
      noteId: string;
      body: string;
      assets: PreviewAsset[];
      /** 已在封面上展示过的图片（磁盘名）→ 卡内预览跳过，避免同一张图出现两次（261112）。 */
      hiddenMediaNames?: ReadonlySet<string>;
    }
  | { type: "markdown"; text: string };

/** 预览用资产（正文里的 canonical URL + 可选元数据）。 */
export interface PreviewAsset {
  filename: string;
  url?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}

/**
 * 预览资产的**引用**：不含具体 URL 档位。
 * 档位由 intent 决定（previewAsset.resolvePreviewAssetUrl），调用方不再各拼 URL。
 */
export interface PreviewAssetRef {
  /** 资源所属文档/小记 id（与内核解析资源用同一个 id）。 */
  noteId: string;
  /** 磁盘文件名（资产服务 URL 末段）。 */
  filename: string;
  /** 正文里的原始显示 src（含 token 也可）；缺省时按 noteId+filename 现拼 canonical URL。 */
  src?: string;
  /** MIME（可选）：只用于判断"能否走图片缩略"，不参与 URL 身份。 */
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}

/**
 * 预览里允许做什么 —— **单一策略对象**（替代此前每个入口各自决定"能不能放大图/开附件/复制/长按菜单"）。
 * 注意：这里是**语义**，不是组件实现；两端 UI 仍各自实现（AGENTS §3#14）。
 */
export interface PreviewPolicy {
  /** 整篇内嵌正文（false = 只给"打开"入口，如标签空间）。 */
  inlineBody: boolean;
  /** 图片可放大（Lightbox）；false = 不提供放大。放大时取哪个档位见 intent。 */
  zoomImage: false | { intent: PreviewAssetIntent };
  /** 附件/文件卡可点开（系统或内嵌）。 */
  openAttachment: boolean;
  /** 允许复制正文选区。 */
  copySelection: boolean;
  /** 允许卡片右键/长按菜单（重命名 / 剪切 / 另存为）。 */
  cardMenu: boolean;
  /** 内核实例的挂载策略（见 ReadOnlyKernelMount）。 */
  mount: ReadOnlyKernelMount;
}

/** 5 个预设键（本轮 30 个入口归纳出的 5 种组合；新增空间先选预设，不要自造字段）。 */
export type PreviewPolicyKey = "docPane" | "trash" | "history" | "tagSpace" | "quickNoteCard";

/**
 * 内核只读实例的挂载策略：
 * - keep-alive：宿主挂载即创建，宿主卸载/换 key 才销毁（历史面板、回收站、AI 答案）；
 * - reveal-latch：进入视口才创建，**进入一次后常驻**（小记卡片内核兜底；261111 修「来回滚反复白屏」）。
 */
export type ReadOnlyKernelMount = "keep-alive" | "reveal-latch";

/** 预览资产的三种取用意图（display / original / materialized，见 previewAsset.ts）。 */
export type PreviewAssetIntent = "display" | "original" | "materialized";
