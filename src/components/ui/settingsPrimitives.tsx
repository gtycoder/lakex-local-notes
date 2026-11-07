/**
 * 桌面设置页版式原语。
 * 类名全部是自有 ln-* 原语（.ln-label / .ln-text-field / .ln-list-item / .ln-btn / .ln-switch），
 * 定义在 src/styles/compat.css（版式骨架）与 src/styles/kit.css（控件规格），值走 --lake-*。
 * SettingsPanel使用这些原语；移动端版式由mobile/ui/settingsPrimitives独立提供。
 */
import { Children, isValidElement, useId, useEffect, useState, type ReactNode } from "react";

import { SettingFieldContext, useSettingField } from "./fieldAccessibility";

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
  const id = useId();
  const nameId = `${id}-name`, descId = `${id}-desc`;
  const describedBy = desc ? descId : undefined;
  const accessibility = { "aria-labelledby": nameId, "aria-describedby": describedBy, "aria-invalid": false };
  return (
    <SettingFieldContext.Provider value={accessibility}>
    <div className={"ln-label config-item" + (pathDesc ? " item--path" : "")} data-set-id={itemId} role="group" {...accessibility}>
      <div className="config-item__main">
        <div id={nameId} className="config-name">{name}</div>
        {desc && <div id={descId} className="ln-label__text">{desc}</div>}
      </div>
      {children && (<><span className="ln-spacer" /><div className="config-item__ctl">{children}</div></>)}
    </div>
    </SettingFieldContext.Provider>
  );
}

/** 表单行：标题 + 说明在左、控件在右的**单行**版式（用户 261007 定稿：短配置不再堆叠）。控件列伸展、输入/下拉铺满。
 *  error = 该字段的校验/连接错误，自动折到下一行整宽（走 .config-item__error）。 */
export function Field({ itemId, name, desc, pathDesc, error, children }: { itemId?: string; name: ReactNode; desc?: ReactNode; pathDesc?: boolean; error?: ReactNode; children?: ReactNode }) {
  const id = useId();
  const nameId = `${id}-name`, descId = `${id}-desc`, errorId = `${id}-error`;
  const describedBy = [desc ? descId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const accessibility = { "aria-labelledby": nameId, "aria-describedby": describedBy, "aria-invalid": Boolean(error) };
  return (
    <SettingFieldContext.Provider value={accessibility}>
    <div className={"ln-label config-item config-item--field" + (pathDesc ? " item--path" : "")} data-set-id={itemId} role="group" {...accessibility}>
      <div className="config-item__main">
        <div id={nameId} className="config-name">{name}</div>
        {desc && <div id={descId} className="ln-label__text">{desc}</div>}
      </div>
      {children && <div className="config-item__ctl">{children}</div>}
      {error && <div id={errorId} className="config-item__error">{error}</div>}
    </div>
    </SettingFieldContext.Provider>
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
export function Switch({ itemId, name, desc, note, alert, checked, disabled, onChange }: { itemId?: string; name: string; desc?: string; note?: ReactNode; /** 点击被拒时的行内提示（role=status，屏幕阅读器可感知；走既有 .config-note 单一来源）。 */ alert?: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  const describedBy = [desc ? `${id}-desc` : null, note ? `${id}-note` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="ln-label config-item" data-set-id={itemId}>
      <div className="config-item__main">
        <div className="config-name">{name}</div>
        {desc && <div id={`${id}-desc`} className="ln-label__text">{desc}</div>}
        {note && <div id={`${id}-note`} className="config-note">{note}</div>}
        {alert && <div className="config-note" role="status" aria-live="polite">{alert}</div>}
      </div>
      <span className="ln-spacer" />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        aria-describedby={describedBy}
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
  return <div className="ln-segment" role="group" aria-label={ariaLabel}>{children}</div>;
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
    <input {...accessibility}
      className="ln-text-field settings-text-field ln-w-200"
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
  );
}

/** 文本设置项（S3 配置等）。放在 Field 里，宽度由行的布局给（铺满右侧控件列），不再各自定宽。 */
export function TextField({ label, value, onSave, type = "text", placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: "text" | "password"; placeholder?: string }) {
  const accessibility = useSettingField();
  return (
    <input {...accessibility}
      className="ln-text-field settings-text-field"
      type={type}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onSave(e.target.value)}
    />
  );
}
