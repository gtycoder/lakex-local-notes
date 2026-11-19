/**
 * 视频卡「宽度」弹层（261119 用户终裁：「视频宽度弹窗还是使用内核风格吧，就和图片的风格保持一致就行了」）。
 *
 * **卡工具条内核家族表面，例外于 ln-* 单一来源**（AGENTS §3#14 的 ln-* 偏好被该用户裁决明确覆盖：
 * 本弹窗与图片卡工具条的下拉菜单同族，家族内只认内核类，不混用 kit 原语）。逐项复用同一对组件/类名
 * （cardMenu.tsx = 卡工具条家族单一来源，与 SelectionToolbar.renderImage 的二级菜单同组件）：
 *   · 表面 = CardMenu（.ant-dropdown-menu + .ne-card-toolbar-select-menu：5px 圆角 / 无 hairline /
 *     内核阴影，全部来自 vendored lakex-doc.css / antd.css，本文件零表面视觉）；
 *   · 预设档 = CardMenuItem（30px 行 / 14px 标签 / 30px 对勾槽；选中 = .ant-dropdown-menu-item-selected
 *     翻出对勾 + aria-pressed；focusable 让行保持 Tab 可达、Enter/Space 激活）；
 *   · 宽度输入 = 图片弹窗同型 .selection-toolbar__inputrow > .ne-card-toolbar-input（30px 高 / 1px 边，
 *     与改造前该弹窗的输入样式同一条共享规则）+ .ne-card-toolbar-input-title 标签；
 *   · 「应用」= 内核按钮 KButton（button.ant-btn，内核链接弹层「确定」同款；不引入 ln-btn）；
 *   · 说明文案 = 12px 菜单脚注（.selection-toolbar__video-note），一句讲清百分比语义与拖拽入口。
 *
 * 功能不变：宽度百分比输入（Enter 或「应用」提交，IME 判据）/ 25-50-75-100 预设档（点选即应用并收起）/
 * 说明文案；Esc 关闭与定位沿用 SelectionToolbar 既有机制（placePopoverPosition + clampToEditorArea 实测
 * 坐标经 style 传入，surfaceRef 回传实测尺寸），不在这里自估高度自夹。
 */
import { type CSSProperties } from "react";
import { isImeConfirming } from "../../../core/ime";
import { VIDEO_WIDTH_PRESETS } from "../videoCardOps";
import { CardMenu, CardMenuItem } from "./cardMenu";
import { KButton } from "./kernelUiAtoms";

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
    <CardMenu menu="videosize" style={style} surfaceRef={surfaceRef}>
      {/* 输入行（图片弹窗同型输入）：宽度 + 百分比输入 + 「应用」。 */}
      <li role="none" className="selection-toolbar__inputrow selection-toolbar__videorow">
        <span className="ne-card-toolbar-input-title">宽度</span>
        <input
          className="ne-card-toolbar-input"
          type="number"
          min="10"
          max="100"
          step="1"
          value={draft}
          aria-label="正文宽度百分比"
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeConfirming(e)) {
              e.preventDefault();
              onApplyWidth();
            }
          }}
        />
        <span className="ne-card-toolbar-input-title">%</span>
        <KButton onClick={onApplyWidth}>应用</KButton>
      </li>
      {VIDEO_WIDTH_PRESETS.map((pct) => {
        const selected = widthPercent === pct;
        return (
          <CardMenuItem
            key={pct}
            label={`${pct}%`}
            selected={selected}
            ariaPressed={selected}
            focusable
            onClick={() => onApplyPreset(pct)}
          />
        );
      })}
      <li role="none" className="selection-toolbar__video-note">100% 表示铺满正文栏（非视频原始像素），也可直接拖动视频左右边缘。</li>
    </CardMenu>
  );
}
