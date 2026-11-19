/**
 * 视频「宽度」弹窗（261119 用户第三轮点单：「视频的工具栏弹窗做的不好，都有现成的图片宽高的样板了，
 * 照着做就行了」⇒ **逐像素照抄图片工具条「宽高」弹窗**，样板 = SelectionToolbar renderImage 的
 * imgsize 分支 .selection-toolbar__cardpop 白面板）。
 *
 * 本组件 = 图片 imgsize 面板的**宽度单列变体**：内容一行「宽 [值] %」+ 下方 25/50/75/100 预设档条；
 * 表面/内距/圆角/阴影/输入尺寸字号/预设档条几何全部与图片弹窗同款 —— 实现上直接渲染共享样板组件
 * MediaSizePop（imgsize 用宽+高两列、视频用宽单列，同一交互语义全仓一套视觉，以后不会再漂）。
 *
 * 与样板一致：**没有「应用」按钮、没有可见说明脚注**。语义提示「100% 表示铺满正文栏（非视频原始像素），
 * 也可拖动视频左右边缘」放在输入框 title（全局拦截器 NativeTitleTips 转 .ln-tip 悬停气泡）——信息不丢、
 * 形态与样板一致。
 *
 * 提交语义与图片宽高弹窗逐字同一份代码（MediaSizePop 收口）：Enter 提交（IME 判据）/ 预设档点选即应用并
 * 收起（收起在 SelectionToolbar 的 apply → setMenu(null)）/ Esc 关闭与定位沿用 SelectionToolbar 既有机制
 * （useSelectionToolbar 文档级 Esc + placePopoverPosition + clampToEditorArea），不在这里自估高度自夹。
 * 范围钳制单一来源 = videoCardOps.normalizeVideoWidth（__videoWidth 10–100，零变化）。
 */
import { type CSSProperties } from "react";
import { VIDEO_WIDTH_PRESETS } from "../videoCardOps";
import { MediaSizePop } from "./MediaSizePop";

export function VideoSizeMenu({ widthPercent, draft, onDraftChange, onApplyWidth, onApplyPreset, style, surfaceRef }: {
  /** 当前生效的正文宽度百分比（预设档选中态按它判定）。 */
  widthPercent: number;
  /** 宽度输入框草稿（打开弹层时预填当前值；提交语义在调用方）。 */
  draft: string;
  onDraftChange: (value: string) => void;
  onApplyWidth: () => void;
  onApplyPreset: (widthPercent: number) => void;
  /** 浮层坐标（placePopoverPosition 实测结果；未定位前由调用方给屏外占位）。 */
  style?: CSSProperties;
  surfaceRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <MediaSizePop
      menu="videosize"
      style={style}
      surfaceRef={surfaceRef}
      fields={[{
        label: "宽",
        value: draft,
        onChange: onDraftChange,
        onSubmit: onApplyWidth,
        min: 10,
        max: 100,
        step: 1,
        suffix: "%",
        title: "100% 表示铺满正文栏（非视频原始像素），也可拖动视频左右边缘",
        ariaLabel: "正文宽度百分比",
      }]}
      presets={VIDEO_WIDTH_PRESETS}
      scalePct={widthPercent}
      onScale={onApplyPreset}
    />
  );
}
