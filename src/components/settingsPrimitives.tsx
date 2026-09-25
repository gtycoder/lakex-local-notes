/**
 * 设置页版式原语（桌面/移动端共用，精仿思源）。
 * 类名沿用思源（.b3-label / .b3-text-field / .b3-select / .b3-switch / .b3-button / .b3-list-item），
 * 定义已随 W2 删源收编到 src/styles/compat.css（骨架）与 src/styles/kit.css（规格），值走 --lake-*。
 * 从 SettingsPanel 抽出：桌面 SettingsPanel 与移动 SettingsDrawer 共用同一套版式原语。
 */
import type { ChangeEvent, ReactNode } from "react";

export function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="config-group">
      <h4 className="config-title">{icon}{title}</h4>
      <div className="config-items">{children}</div>
    </section>
  );
}

/** 标准行：左侧标题+说明，右侧控件（不拉伸）。 */
export function Item({ itemId, name, desc, pathDesc, children }: { itemId?: string; name: string; desc?: string; pathDesc?: boolean; children?: ReactNode }) {
  return (
    <div className={"b3-label config-item" + (pathDesc ? " item--path" : "")} data-set-id={itemId}>
      <div className="config-item__main">
        <div className="config-name">{name}</div>
        {desc && <div className="b3-label__text">{desc}</div>}
      </div>
      {children && (<><span className="fn__space" /><div className="config-item__ctl">{children}</div></>)}
    </div>
  );
}

/** 整块行：标题 + 说明 + 全宽内容（按钮组、统计、只读数据框）。 */
export function Block({ itemId, name, desc, children }: { itemId?: string; name?: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="config-block" data-set-id={itemId}>
      {name && <div className="config-block__name">{name}</div>}
      {desc && <div className="b3-label__text">{desc}</div>}
      {children}
    </div>
  );
}

/** 开关行（思源 .b3-switch）。 */
export function Switch({ itemId, name, desc, checked, disabled, onChange }: { itemId?: string; name: string; desc?: string; checked: boolean; disabled?: boolean; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="b3-label config-item" data-set-id={itemId}>
      <div className="config-item__main">
        <div className="config-name">{name}</div>
        {desc && <div className="b3-label__text">{desc}</div>}
      </div>
      <span className="fn__space" />
      <input className="b3-switch fn__flex-center" type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

/** 快捷键行：说明在左，键位在右。 */
export function Shortcut({ itemId, name, keys }: { itemId?: string; name: string; keys: string }) {
  return (
    <div className="b3-label config-item" data-set-id={itemId}>
      <div className="config-item__main"><div className="config-name">{name}</div></div>
      <span className="fn__space" />
      <div className="config-item__ctl"><kbd className="fn__kbd">{keys}</kbd></div>
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
      className="b3-text-field fn__size200"
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onSave(Math.max(floor, Number(e.target.value) || fallback))}
    />
  );
}

/** 文本设置项（S3 配置等；wide = 比思源默认 200px 更宽，便于看长 URL）。 */
export function TextField({ label, value, onSave, type = "text", placeholder, wide }: { label: string; value: string; onSave: (v: string) => void; type?: "text" | "password"; placeholder?: string; wide?: boolean }) {
  return (
    <input
      className={"b3-text-field" + (wide ? " input--wide" : " fn__size200")}
      type={type}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onSave(e.target.value)}
    />
  );
}
