/**
 * 预览策略的**预设常量**（纯数据，不依赖 React / 平台 / 内核）。
 *
 * 依据：docs/audit-261112/02-preview-unification.md §2 D2（30 个入口出现 4 种能力组合）与
 * 附录 E 用户裁决（Q01/Q02/Q05/Q06：做预览 Phase 2、放大换原图、统一预览档字号、桌面回收站/历史加放大）。
 *
 * 用法：宿主按自己的语义选一个预设（例如回收站预览 = PREVIEW_POLICY.trash），
 * 再把它传给渲染层/交互接线；**不要再在入口里逐个 if 决定**能不能放大图/开附件。
 * 具体视觉与几何仍由两端各自实现（AGENTS §3#14：不共享样式）。
 *
 * 当前消费方（261112 R1）：NoteDocPreview（trash/history 的 zoomImage → 双击看图与档位）。
 * docPane / tagSpace / quickNoteCard 是已裁决的预设记录（供后续宿主接线），**不要当死配置删除**。
 */
import type { PreviewPolicy, PreviewPolicyKey } from "./types";

/** 5 个预设（键的顺序 = 02 报告 §3.4 的顺序，测试按此断言）。 */
export const PREVIEW_POLICY: Readonly<Record<PreviewPolicyKey, PreviewPolicy>> = {
  /** 文档阅读面（桌面 tab 锁定态 / 移动阅读态）：编辑器能力面，允许复制与卡片菜单。 */
  docPane: {
    inlineBody: true,
    zoomImage: { intent: "original" },
    openAttachment: true,
    copySelection: true,
    cardMenu: true,
    mount: "keep-alive",
  },
  /**
   * 回收站预览（桌面 TrashPanel / 移动 TrashPreviewPage）。
   * Q04：移动端「打开回收站文档 = 只读预览 + 横幅」；Q06：桌面回收站加图片放大。
   * 仍是**只读**：不给复制、不给卡片菜单（此前的 LakeEditor 预览里能弹"重命名/剪切"是误导）。
   */
  trash: {
    inlineBody: true,
    zoomImage: { intent: "original" },
    openAttachment: true,
    copySelection: false,
    cardMenu: false,
    mount: "keep-alive",
  },
  /** 历史快照预览（桌面历史面板/文档属性；移动端 Q03 仅 doc）：只读、可放大原图、可开附件。 */
  history: {
    inlineBody: true,
    zoomImage: { intent: "original" },
    openAttachment: true,
    copySelection: false,
    cardMenu: false,
    mount: "keep-alive",
  },
  /** 标签空间右栏（Q09 维持「点击打开」）：不内嵌正文、不放大、不开附件。 */
  tagSpace: {
    inlineBody: false,
    zoomImage: false,
    openAttachment: false,
    copySelection: false,
    cardMenu: false,
    mount: "keep-alive",
  },
  /**
   * 小记卡片富预览（列表内嵌）：整条卡片只读；图片**单击**开大图（Q02：打开后换原图）；
   * 视口闩锁挂载（进入一次常驻）；待办勾选是唯一例外交互（由 QuickNotePreview 自己处理，不走本策略）。
   */
  quickNoteCard: {
    inlineBody: true,
    zoomImage: { intent: "original" },
    openAttachment: false,
    copySelection: false,
    cardMenu: false,
    mount: "reveal-latch",
  },
} as const;
