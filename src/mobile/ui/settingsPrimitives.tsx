/**
 * 移动端设置页版式原语（P4，261012）—— **移动端自建**，不复用桌面 components/ui/settingsPrimitives。
 *
 * 口径（docs/MOBILE-TECH-STACK.md §一/§九 · MOBILE-UI-REDESIGN §6 P4/P6）：
 *   · 类名走 mb-set-*（移动端自有），几何按触屏密度（行 ≥44/48、字号 7 档、内距 16）；
 *   · **契约保持不变**：每个可搜索行仍带 data-set-id={itemId} ⇒ desktop/mobile 共用的
 *     src/components/model/settingsSearch.ts 的 SETTING_ITEMS 继续有效（漂移有单测卡住）；
 *   · 只共享「设置项语义/搜索索引」这类逻辑，不共享样式与组件（用户 261012 定稿）。
 * 结构：Group > (title + Section > 行…)；行 = Item / Field / Block / Switch / Shortcut；
 *       控件 = TextField / NumField（.mb-input 内嵌 input）；Seg（.mb-segment）。
 */
import { Children, isValidElement, type ReactNode } from "react";

export function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-set-group">
      <h4 className="mb-set-title">{icon}{title}</h4>
      <div className="mb-set-items">
        {Children.toArray(children).some((child) => isValidElement(child) && child.type === Section)
          ? children
          : <Section>{children}</Section>}
      </div>
    </section>
  );
}

/** 分组内的一段：可选标题条 + 一张卡片。 */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-set-section">
      {title && <div className="mb-set-section__title">{title}</div>}
      {children}
    </div>
  );
}

/** 标准行：左标题(+说明)，右控件。 */
export function Item({ itemId, name, desc, pathDesc, children }: { itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; children?: ReactNode }) {
  return (
    <div className={"mb-set-item" + (pathDesc ? " mb-set-item--path" : "")} data-set-id={itemId}>
      <div className="mb-set-item__main">
        <div className="mb-set-name">{name}</div>
        {desc && <div className="mb-set-item__desc">{desc}</div>}
      </div>
      {children && (<><span className="mb-spacer" /><div className="mb-set-item__ctl">{children}</div></>)}
    </div>
  );
}

/** 表单行：标题+说明在左、控件在右；error 折整行。 */
export function Field({ itemId, name, desc, pathDesc, error, children }: { itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; error?: ReactNode; children?: ReactNode }) {
  return (
    <div className={"mb-set-item mb-set-item--field" + (pathDesc ? " mb-set-item--path" : "")} data-set-id={itemId}>
      <div className="mb-set-item__main">
        <div className="mb-set-name">{name}</div>
        {desc && <div className="mb-set-item__desc">{desc}</div>}
      </div>
      {children && <div className="mb-set-item__ctl">{children}</div>}
      {error && <div className="mb-set-item__error">{error}</div>}
    </div>
  );
}

/** 整块行：标题 + 说明 + 全宽内容。 */
export function Block({ itemId, name, desc, children }: { itemId?: string; name?: string; desc?: string; children: ReactNode }) {
  return (
    <div className="mb-set-block" data-set-id={itemId}>
      {name && <div className="mb-set-block__name">{name}</div>}
      {desc && <div className="mb-set-item__desc">{desc}</div>}
      {children}
    </div>
  );
}

/** 开关行（触屏 44 命中区；开关本体 46×28）。 */
export function Switch({ itemId, name, desc, note, checked, disabled, onChange }: { itemId?: string; name: string; desc?: string; note?: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="mb-set-item" data-set-id={itemId}>
      <div className="mb-set-item__main">
        <div className="mb-set-name">{name}</div>
        {desc && <div className="mb-set-item__desc">{desc}</div>}
        {note && <div className="mb-set-item__note">{note}</div>}
      </div>
      <span className="mb-spacer" />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        disabled={disabled}
        className="mb-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="mb-switch__knob" />
      </button>
    </div>
  );
}

/** 快捷键行：说明在左，键位在右。 */
export function Shortcut({ itemId, name, keys }: { itemId?: string; name: string; keys: string }) {
  return (
    <div className="mb-set-item" data-set-id={itemId}>
      <div className="mb-set-item__main"><div className="mb-set-name">{name}</div></div>
      <span className="mb-spacer" />
      <div className="mb-set-item__ctl"><kbd className="mb-kbd">{keys}</kbd></div>
    </div>
  );
}

/** 互斥选项组（主题等）：子项用 .mb-segment__item。 */
export function Seg({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return <div className="mb-segment" role="group" aria-label={ariaLabel}>{children}</div>;
}

/** 数字设置项：保留「空值回退默认 + 下限钳制」语义。 */
export function NumField({ label, value, min, max, floor, fallback, onSave }: { label: string; value: number; min: number; max: number; floor: number; fallback: number; onSave: (n: number) => void }) {
  return (
    <span className="mb-input mb-input--num">
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onSave(Math.max(floor, Number(e.target.value) || fallback))}
      />
    </span>
  );
}

/** 文本设置项（S3 配置等）：宽度由行的控件列给。 */
export function TextField({ label, value, onSave, type = "text", placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: "text" | "password"; placeholder?: string }) {
  return (
    <span className="mb-input">
      <input type={type} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onSave(e.target.value)} />
    </span>
  );
}
