/**
 * 小记卡片的**内核只读视图**（兜底渲染，261010 用户定稿方向）。
 *
 * 为什么需要：小记正文是标准 lake 标记，而内核的格式集合是**开放的** —— 内核每加一种卡，
 * 自研快路径解析器就欠一笔债（日期/表情只是第一笔）。所以这里把"格式覆盖度"这个问题
 * **还给内核**：只要快路径判不出来，整条卡片就由内核自己的只读渲染器画。
 * ⇒ 不存在"我们没实现所以显示不出来"的格式（格式全量 = 内核全量）。
 *
 * 代价可控的两个前提：
 * ① 只有快路径判不出来的正文才走这里（普通文字小记 = 零内核实例，移动端冷开不受影响）；
 * ② 只给**进入视口**的卡片挂实例（提前 400px 预挂载）；**进入一次后常驻**
 *    （直到卡片本身卸载）—— 261111 用户报「向下滚动时闪屏」：原先离开视口即 destroy，滚回去又
 *    create，来回滚每次都白一下（实例创建 ≈80ms，且首帧是白的）。现在一次挂载常驻，
 *    代价 = 已看过的卡片各留一个只读实例；列表 >24 条走窗口化，行卸载时实例随之释放。
 *
 * 261112 R1：实例创建 / 正文注入 / 视口闩锁 / 销毁已收口到
 * src/features/preview/useReadOnlyKernelViewer（mount="reveal-latch"），本组件只剩版式与 prefs。
 *
 * 与编辑态的关系：同一份正文、同一个内核，只是 viewer 模式（只读）——
 * 预览与编辑不再有两套渲染口径（旧的自研解析器就是第二套，必然漂移）。
 */
import { useRef } from "react";
import { useReadOnlyKernelViewer } from "../preview/useReadOnlyKernelViewer";
// ⚠️ 不要在这里 JS import 内核样式（261021 事故）：桌面入口 src/styles/index.css 已用
// @import "@dlient/lakex-doc-react/style.css" layer(legacy) 引入；JS import 出来的样式表**无法分层**，
// 会以未分层身份落进文档，而未分层普通声明压过**全部** @layer 规则
// （实测：antd base 的 body 字体 + button{margin:0} 让设置面板 × 偏离右上、全站 UI 字体变系统栈）。
// 护栏：src/styles/cssLayers.test.ts「vendor 内核 CSS 只能经入口分层引入」。

/** 视口预挂载余量：提前这么多像素建实例，滚到时已渲染好（避免滚动途中出现白块）。 */
const PREMOUNT_MARGIN_PX = 400;

interface QuickNoteKernelPreviewProps {
  /** 内核形态正文（与 .lake 同构）。 */
  body: string;
  /** 小记 id：内核解析正文里的资源/卡片时要用（与编辑态同一个 id）。 */
  noteId: string;
}

export function QuickNoteKernelPreview({ body, noteId }: QuickNoteKernelPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  useReadOnlyKernelViewer({
    hostRef,
    /** 内容身份 = 小记 id：正文晚到/被编辑时只 setDocument，不重建实例。 */
    key: noteId,
    body,
    noteId,
    mount: "reveal-latch",
    revealRootMarginPx: PREMOUNT_MARGIN_PX,
    prefs: {
      // 与编辑态同款：小记没有 Lake 自己的滚动容器，虚拟渲染会量错视口（260919 踩坑）；阅读态也不需要大纲。
      disableNativeToc: true,
      disableVirtualRendering: true,
      // 卡片预览的字号与快路径对齐（261111 用户报「预览有的字大有的字小」）：
      // prefs.fontSize 会写进挂载点内联 font-size，内核正文/标题随之缩放（默认 18 ⇒ 卡片里明显偏大）。
      fontSize: 14,
    },
  });
  return <div className="quick-note-kernel-preview" ref={hostRef} data-note-id={noteId} />;
}
