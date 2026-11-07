/**
 * 移动端设置页版式原语（P4，261012）—— **移动端自建**，不复用桌面 components/ui/settingsPrimitives。
 *
 * 口径（docs/MOBILE-TECH-STACK.md §一/§九 · docs/MOBILE-DESIGN §6 P4/P6）：
 *   · 类名走 mb-set-*（移动端自有），几何按触屏密度（行 ≥44/48、字号 7 档、内距 16）；
 *   · **契约保持不变**：每个可搜索行仍带 data-set-id={itemId} ⇒ desktop/mobile 共用的
 *     src/components/model/settingsSearch.ts 的 SETTING_ITEMS 继续有效（漂移有单测卡住）；
 *   · 只共享「设置项语义/搜索索引」这类逻辑，不共享样式与组件（用户 261012 定稿）。
 * 结构：Group > (title + Section > 行…)；行 = Item / Field / Block / Switch / Shortcut；
 *       控件 = TextField / NumField（.mb-input 内嵌 input）；Seg（.mb-segment）。
 * 行语义（261102 用户点单 3b 定稿）：Item = 左标签右控件（选择器/动作/短数字）；Field = **内容输入类**
 *       （标签+说明在上、控件占满下一行，全宽 —— S3 连接信息 / AI 接入等长值输入）；Block = 标题 + 全宽内容。
 */
import { Children, isValidElement, useId, useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { SettingFieldContext, useSettingField } from "./fieldAccessibility";

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
export function Item({ itemId, name, desc, pathDesc, icon, tone, value, children }: {
  itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; children?: ReactNode;
  /** v2（261107）：行首彩色图标块（预览稿 .set-ico 的等价物）；tone 缺省回落动态主色。 */
  icon?: ReactNode;
  /** 图标块取色（主色字面量只来自 theme/tone 调用方，不进入 CSS 文件）。 */
  tone?: string;
  /** 右侧当前值（选择器/开关旁的只读摘要；控件本身已显示值时可省略）。 */
  value?: ReactNode;
}) {
  const id = useId();
  const nameId = `${id}-name`, descId = `${id}-desc`;
  const describedBy = desc ? descId : undefined;
  const accessibility = { "aria-labelledby": nameId, "aria-describedby": describedBy, "aria-invalid": false };
  return (
    <SettingFieldContext.Provider value={accessibility}>
    <div className={"mb-set-item" + (pathDesc ? " mb-set-item--path" : "")} data-set-id={itemId} role="group" {...accessibility}>
      {icon && <span className="mb-set-item__icon" style={{ "--c": tone ?? "var(--mb-accent)" } as CSSProperties}>{icon}</span>}
      <div className="mb-set-item__main">
        <div id={nameId} className="mb-set-name">{name}</div>
        {desc && <div id={descId} className="mb-set-item__desc">{desc}</div>}
      </div>
      {value != null && <span className="mb-set-item__val">{value}</span>}
      {children && <div className="mb-set-item__ctl">{children}</div>}
    </div>
    </SettingFieldContext.Provider>
  );
}

/** 内容输入行：标题+说明在上、控件占满下一行（kit.css 的 --field 让 __ctl flex 1 1 100%）；
 *  error 折整行。选择器/开关/分段控件这类本来适合同行的行用 Item / Switch / Seg，不要套 Field。 */
export function Field({ itemId, name, desc, pathDesc, error, children }: { itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; error?: ReactNode; children?: ReactNode }) {
  const id = useId();
  const nameId = `${id}-name`, descId = `${id}-desc`, errorId = `${id}-error`;
  const describedBy = [desc ? descId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const accessibility = { "aria-labelledby": nameId, "aria-describedby": describedBy, "aria-invalid": Boolean(error) };
  return (
    <SettingFieldContext.Provider value={accessibility}>
    <div className={"mb-set-item mb-set-item--field" + (pathDesc ? " mb-set-item--path" : "")} data-set-id={itemId} role="group" {...accessibility}>
      <div className="mb-set-item__main">
        <div id={nameId} className="mb-set-name">{name}</div>
        {desc && <div id={descId} className="mb-set-item__desc">{desc}</div>}
      </div>
      {children && <div className="mb-set-item__ctl">{children}</div>}
      {error && <div id={errorId} className="mb-set-item__error">{error}</div>}
    </div>
    </SettingFieldContext.Provider>
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
export function Switch({ itemId, name, desc, note, icon, tone, checked, disabled, onChange }: {
  itemId?: string; name: string; desc?: string; note?: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
  /** v2：行首彩色图标块（与 Item 同一钩子）。 */
  icon?: ReactNode; tone?: string;
}) {
  const id = useId();
  const describedBy = [desc ? `${id}-desc` : null, note ? `${id}-note` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="mb-set-item" data-set-id={itemId}>
      {icon && <span className="mb-set-item__icon" style={{ "--c": tone ?? "var(--mb-accent)" } as CSSProperties}>{icon}</span>}
      <div className="mb-set-item__main">
        <div className="mb-set-name">{name}</div>
        {desc && <div id={`${id}-desc`} className="mb-set-item__desc">{desc}</div>}
        {note && <div id={`${id}-note`} className="mb-set-item__note">{note}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        aria-describedby={describedBy}
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
      <div className="mb-set-item__ctl"><kbd className="mb-kbd">{keys}</kbd></div>
    </div>
  );
}

/** 互斥选项组（主题等）：子项用 .mb-segment__item。 */
export function Seg({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return <div className="mb-segment" role="group" aria-label={ariaLabel}>{children}</div>;
}

/** 数字设置项：编辑期间只改 draft，失焦/Enter 才统一校验并提交；0 是合法值。 */
export function NumField({ label, value, min, max, floor, fallback, onSave, step = 1 }: { label: string; value: number; min: number; max: number; floor: number; fallback: number; onSave: (n: number) => void; step?: number | "any" }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = (): void => {
    const text = draft.trim();
    const parsed = text === "" ? fallback : Number(text);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(floor, parsed)) : fallback;
    setDraft(String(next));
    if (next !== value) onSave(next);
  };

  const accessibility = useSettingField();
  return (
    <span className="mb-input mb-input--num">
      <input {...accessibility}
        type="number"
        step={step}
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        data-escape-reset={draft !== String(value) ? "" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && draft !== String(value)) { e.preventDefault(); e.stopPropagation(); setDraft(String(value)); }
        }}
      />
    </span>
  );
}

/** 文本设置项（S3 配置等）：宽度由行的控件列给。 */
export function TextField({ label, value, onSave, type = "text", placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: "text" | "password"; placeholder?: string }) {
  const accessibility = useSettingField();
  return (
    <span className="mb-input">
      <input {...accessibility} type={type} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onSave(e.target.value)} />
    </span>
  );
}
