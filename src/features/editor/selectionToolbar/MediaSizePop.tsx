/**
 * 媒体「尺寸」白卡弹窗（.selection-toolbar__cardpop）—— **样板本体单一来源**（261119 用户第三轮点单：
 * 「视频的工具栏弹窗做的不好，都有现成的图片宽高的样板了，照着做就行了」⇒ 逐像素照抄图片「宽高」弹窗）。
 *
 * 图片 imgsize（宽 + 高两列）与视频 videosize（宽单列）是**同一面板的两个变体**，共用本组件：
 *   · 表面 = .selection-toolbar__cardpop（白面板：12px 内距 / gap 10 / 1px 边 / 圆角 / 阴影，selectionToolbar.css）；
 *   · 输入行 = .selection-toolbar__inputrow > .ne-card-toolbar-input + .ne-card-toolbar-input-title（同一条共享规则）；
 *   · 预设档 = .ln-segment > .ln-segment__item（kit.css 分段控件，25/50/75/100）。
 * 几何零自定：视频变体不新增任何类/规则，「同一交互语义全仓一套视觉」靠共用本组件保证，不再漂。
 *
 * 提交语义 = **与图片宽高弹窗逐字同一份代码**（用户：「看 imgsize 怎么提交就怎么提交」）：
 * 输入框 Enter 提交（isImeConfirming 判据，IME 组合期回车不提交）；25/50/75/100 点选即应用，
 * 收起由调用方的应用语义负责（SelectionToolbar 的 apply → setMenu(null)）。范围钳制不在组件里做
 * （视频 = videoCardOps.normalizeVideoWidth 10–100 单一来源；图片交内核）。
 *
 * 语义提示走输入框 `title`（全局拦截器 NativeTitleTips 会换成 .ln-tip 悬停气泡）——信息不丢、
 * 形态与样板一致（样板没有可见说明脚注）。
 */
import { Fragment, type CSSProperties } from "react";
import { isImeConfirming } from "../../../core/ime";

/** 尺寸字段 = 「标签 + 数字输入（+ 后缀标签）」；宽/高由调用方按变体给。 */
export interface MediaSizeField {
  /** 输入框前标签（图片「宽」/「高」，视频「宽」）。 */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter 提交（IME 判据在本组件统一收口）。 */
  onSubmit: () => void;
  /** 数字输入范围/步长（功能参数由调用方给，组件不自钳）。 */
  min?: number;
  max?: number;
  step?: number;
  /** 后缀标签（视频「%」）。 */
  suffix?: string;
  /** 语义提示（原生 title → 全局 .ln-tip 气泡）。 */
  title?: string;
  ariaLabel?: string;
}

export function MediaSizePop({ menu, style, surfaceRef, fields, presets, scalePct, onScale }: {
  /** data-menu 标记（imgsize / videosize）。 */
  menu: string;
  /** 浮层坐标（placePopoverPosition + clampToEditorArea 实测结果；未定位前由调用方给屏外占位）。 */
  style?: CSSProperties;
  surfaceRef?: (el: HTMLElement | null) => void;
  fields: MediaSizeField[];
  /** 预设档（图片/视频同款 25/50/75/100）。 */
  presets: readonly number[];
  /** 预设档选中态（按当前生效值判定）。 */
  scalePct: number;
  /** 预设档点选 = 即应用（收起由调用方负责）。 */
  onScale: (pct: number) => void;
}) {
  return (
    <div ref={surfaceRef} style={style} className="selection-toolbar__cardpop" data-menu={menu}>
      <div className="selection-toolbar__inputrow">
        {fields.map((f, i) => (
          <Fragment key={i}>
            <span className="ne-card-toolbar-input-title">{f.label}</span>
            <input
              className="ne-card-toolbar-input"
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={f.value}
              title={f.title}
              aria-label={f.ariaLabel}
              onChange={(e) => f.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isImeConfirming(e)) { e.preventDefault(); f.onSubmit(); } }}
            />
            {f.suffix ? <span className="ne-card-toolbar-input-title">{f.suffix}</span> : null}
          </Fragment>
        ))}
      </div>
      <div className="ln-segment selection-toolbar__scale">
        {presets.map((p) => (
          <button key={p} type="button" className={"ln-segment__item" + (scalePct === p ? " is-active" : "")} onClick={() => onScale(p)}>{p}%</button>
        ))}
      </div>
    </div>
  );
}
