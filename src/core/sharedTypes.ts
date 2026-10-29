/**
 * 跨端共享领域类型（**定义处**；CORE-10 tail，261028）。
 *
 * 背景：这些类型原先定义在渲染层 `src/lib/types.ts`，但 core 的纯逻辑（cloudState / syncModes /
 * syncSettings / s3v3Engine / noteInfo / quickNoteQueries）要用它们 ⇒ core 反向 import 渲染层
 * （门禁长期白名单）。现在把「两端都需要的共享类型」下沉为**定义处**，`src/lib/types.ts` 改为从这里
 * re-export（渲染层 import 路径不变；类型-only，运行时零影响）。渲染层专属类型仍留在 lib/types.ts。
 *
 * 判断口径：类型被 src/core 生产文件引用 ⇒ 放这里；只有 UI/IPC 外壳用 ⇒ 留 lib。
 * ⚠️ 本文件只放类型定义，不放运行时值（避免类型模块变成隐形的运行时代码依赖）。
 */

/**
 * 云同步设置（桌面 settings 表 / 移动 localStorage 同形）。
 * 归一判据单一来源 = `src/core/syncSettings.ts` 的 normalizeSyncSettings。
 */
export interface SyncSettings {
  enabled: boolean;
  autoMode: "interval" | "onOpenClose" | "manual";
  autoIntervalMinutes: number;
  /** 按需资产（P0-4，261026）：首拉只同步 pointer/索引/正文，媒体字节打开/预览时补拉。
   *  缺省 false（全量语义）；移动端从「按需下载附件」开关写入。 */
  deferAssets?: boolean;
}

/** 同步警告：远端对象/资源缺失时「跳过受影响条目、不覆盖本地、其余继续」（V5 §5.5 B 方案）的结构化报告。
 *  由 core 直接产出（不再拼字符串让消费方正则反解）；UI 据此展示与点击定位。 */
export type SyncWarningKind =
  | "remote_incomplete"
  | "asset_missing"
  /** 本地正文文件缺失（被手动删除等），且没有可拉回的云端副本 ⇒ 跳过，不上传空正文。 */
  | "local_body_missing"
  /** 本地正文缺失但云端有副本：已自动拉回恢复。 */
  | "local_body_restored"
  /** 本地附件未落地/读不出（不是用户删除）⇒ 保留云端声明，避免误删云端附件。 */
  | "asset_kept_remote";
export interface SyncWarning {
  kind: SyncWarningKind;
  /** 受影响文档 id（能定位时）。 */
  noteId?: string;
  /** 文档标题（core 能取到时带上，省 UI 一次回查）。 */
  title?: string;
  /** 资源文件名（asset_missing 且能定位到具体文件时）。 */
  filename?: string;
  /** 人类可读一行（日志/兜底展示；UI 优先用 title/filename）。 */
  message: string;
}

export interface NoteInfoAsset {
  filename: string;
  size: number;
  kind: string;
}

/** 文档属性（"属性"弹窗数据；core/noteInfo 组装）。 */
export interface NoteInfo {
  id: string;
  title: string;
  /** 所属路径（笔记本 / 分组 …），根下为空 */
  parentPath: string;
  /** 所属路径链（自根向下，带 id，供跳转） */
  parents: Array<{ id: string; title: string }>;
  /** 卡片统计（图片/视频/附件/代码块/表格…） */
  cardStats: Array<{ key: string; label: string; count: number }>;
  createdAt: string | null;
  updatedAt: string;
  isDirty?: boolean;
  isPurged?: boolean;
  /** v3：云端已彻底删除、本机仅保留回收站副本。 */
  cloudDeleted?: boolean;
  isConflict: boolean;
  isEditLocked: boolean;
  lakePath: string;
  assetsDir: string;
  sizeBytes: number;
  charCount: number;
  wordCount: number;
  /** 当前正文（已落盘那份）的 sha256：历史面板用来标出"与当前版本一致"的快照。 */
  contentHash: string;
  assets: NoteInfoAsset[];
  assetTotalBytes: number;
  history: Array<{ id: number; createdAt: string; size: number; contentHash: string }>;
}

export type TreeNodeType = "notebook" | "group" | "note";

/** 目录/知识库节点（侧栏树）。 */
export interface TreeNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  nodeType: TreeNodeType;
  title: string;
  noteFileId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isPurged?: boolean;
  isDirty?: boolean;
  /** v3：云端已彻底删除、本机仅保留回收站副本。 */
  cloudDeleted?: boolean;
  isConflict: boolean;
  icon?: string | null;
  description?: string | null;
  summary?: string | null;
  /** 文档类型（doc | usheet | bitable | board | ink；缺省 doc）：宿主据此对非 doc 隐藏导出/大纲等。 */
  kind?: "doc" | "usheet" | "bitable" | "board" | "ink";
}

/** 小记图片（含附件扩展：mimeType 决定是否按图片渲染）。 */
export interface QuickNoteImage {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
  hash: string;
  url?: string;
}

/** 小记内容（core/quickNoteModel 的持久化/校验形态）。 */
export interface QuickNoteContent {
  version: number;
  /** 纯文本镜像（预览/搜索/移动端降级显示）；v2 起不再是唯一真相。 */
  text: string;
  /** v2：内核形态正文（Lake HTML）。桌面编辑态由内核产出，其它入口由 text 合成。 */
  body: string;
  images: QuickNoteImage[];
  /** 读取模型：关联表里的标签 ID（标签目录/关联表是唯一事实，`.qnote` 不落盘标签）。 */
  tagIds: string[];
  /** 展示用标签名（由标签目录解析，不落盘）；与 tagIds 一一对应。 */
  tags: string[];
}

/** 小记列表/详情摘要（core/quickNoteQueries 投影）。 */
export interface QuickNoteSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  previewText: string;
  imageCount: number;
  contentHash: string;
  syncState: "local" | "synced" | "conflict";
  isConflict: boolean;
}

export interface QuickNoteDocument extends QuickNoteSummary {
  content: QuickNoteContent;
}
