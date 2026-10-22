/**
 * 设置页版式原语（桌面/移动端共用，精仿思源）。
 * 类名全部是自有 ln-* 原语（.ln-label / .ln-text-field / .ln-list-item / .ln-btn / .ln-switch），
 * 定义在 src/styles/compat.css（版式骨架）与 src/styles/kit.css（控件规格），值走 --lake-*。
 * 从 SettingsPanel 抽出：桌面 SettingsPanel 与移动 SettingsDrawer 共用同一套版式原语。
 */
import { Children, isValidElement, type ReactNode } from "react";

export function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="config-group">
      <h4 className="config-title">{icon}{title}</h4>
      <div className="config-items">
        {/* 分组 =「标题 + 一张白卡」。若子项里已经显式用了 <Section>（多段分组，如 AI 的
            服务 / 凭据 / 模型与参数），就不再自动套一层，避免卡中卡 —— 每段 Section 自己是一张卡。 */}
        {Children.toArray(children).some((child) => isValidElement(child) && child.type === Section)
          ? children
          : <Section>{children}</Section>}
      </div>
    </section>
  );
}

/** 分组内的一段：可选标题条 + 一张白卡（表面/圆角/分隔在 styles/feature.css 的 .config-section）。 */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="config-section">
      {title && <div className="config-section__title">{title}</div>}
      {children}
    </div>
  );
}

/** 标准行：左侧标题+说明，右侧控件（不拉伸）。 */
export function Item({ itemId, name, desc, pathDesc, children }: { itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; children?: ReactNode }) {
  return (
    <div className={"ln-label config-item" + (pathDesc ? " item--path" : "")} data-set-id={itemId}>
      <div className="config-item__main">
        <div className="config-name">{name}</div>
        {desc && <div className="ln-label__text">{desc}</div>}
      </div>
      {children && (<><span className="ln-spacer" /><div className="config-item__ctl">{children}</div></>)}
    </div>
  );
}

/** 表单行：标题 + 说明在左、控件在右的**单行**版式（用户 261007 定稿：短配置不再堆叠）。控件列伸展、输入/下拉铺满。
 *  error = 该字段的校验/连接错误，自动折到下一行整宽（走 .config-item__error）。 */
export function Field({ itemId, name, desc, pathDesc, error, children }: { itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; error?: ReactNode; children?: ReactNode }) {
  return (
    <div className={"ln-label config-item config-item--field" + (pathDesc ? " item--path" : "")} data-set-id={itemId}>
      <div className="config-item__main">
        <div className="config-name">{name}</div>
        {desc && <div className="ln-label__text">{desc}</div>}
      </div>
      {children && <div className="config-item__ctl">{children}</div>}
      {error && <div className="config-item__error">{error}</div>}
    </div>
  );
}

/** 整块行：标题 + 说明 + 全宽内容（按钮组、统计、只读数据框）。 */
export function Block({ itemId, name, desc, children }: { itemId?: string; name?: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="config-block" data-set-id={itemId}>
      {name && <div className="config-block__name">{name}</div>}
      {desc && <div className="ln-label__text">{desc}</div>}
      {children}
    </div>
  );
}

/** 开关行（自有设计系统 COMPONENTS 09 / .ln-switch：button + role=switch + __knob）。
 *  note = 该开关的**行内提示**（走既有 .config-note 单一来源，与 Field 的 error 行同构）——
 *  用于"开启前必须知道"的说明（例：云同步的隐私数据提示：不加密上传 + 请确认桶为私有）。 */
export function Switch({ itemId, name, desc, note, checked, disabled, onChange }: { itemId?: string; name: string; desc?: string; note?: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="ln-label config-item" data-set-id={itemId}>
      <div className="config-item__main">
        <div className="config-name">{name}</div>
        {desc && <div className="ln-label__text">{desc}</div>}
        {note && <div className="config-note">{note}</div>}
      </div>
      <span className="ln-spacer" />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        disabled={disabled}
        className="ln-switch ln-flex-center"
        onClick={() => onChange(!checked)}
      >
        <span className="ln-switch__knob" />
      </button>
    </div>
  );
}

/** 快捷键行：说明在左，键位在右。 */
export function Shortcut({ itemId, name, keys }: { itemId?: string; name: string; keys: string }) {
  return (
    <div className="ln-label config-item" data-set-id={itemId}>
      <div className="config-item__main"><div className="config-name">{name}</div></div>
      <span className="ln-spacer" />
      <div className="config-item__ctl"><kbd className="ln-kbd">{keys}</kbd></div>
    </div>
  );
}

/** 互斥选项组（字号、主题）。 */
export function Seg({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return <div className="seg" role="group" aria-label={ariaLabel}>{children}</div>;
}

/** 数字设置项：保留原有"空值回退默认 + 下限钳制"语义。 */
export function NumField({ label, value, min, max, floor, fallback, onSave }: { label: string; value: number; min: number; max: number; floor: number; fallback: number; onSave: (n: number) => void }) {
  return (
    <input
      className="ln-text-field ln-w-200"
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onSave(Math.max(floor, Number(e.target.value) || fallback))}
    />
  );
}

/** 文本设置项（S3 配置等）。放在 Field 里，宽度由行的布局给（铺满右侧控件列），不再各自定宽。 */
export function TextField({ label, value, onSave, type = "text", placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: "text" | "password"; placeholder?: string }) {
  return (
    <input
      className="ln-text-field"
      type={type}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onSave(e.target.value)}
    />
  );
}
