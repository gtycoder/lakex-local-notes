/**
 * 多维表单元格与浮层控件（v1）。
 *
 * 设计约束（AGENTS.md §3 #14）：视觉走已有 --b3-* 令牌 + 本目录 bitableEditor.css，
 * 组件里**不写静态内联样式**；仅浮层定位这类动态坐标用 inline style（与 Sidebar 右键菜单同做法）。
 * 单元格值按 fieldId 存，编辑通过 onChange(value) 回传，由 BitableEditor 统一写 doc。
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Popover as OverlayPopover } from "../../components/ui/Overlay";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Hash, HelpCircle, Link2, Maximize2, Paperclip, Plus, Search, Tags, Type, X } from "lucide-react";
import { ASSET_ORIGIN, assetThumbWidthForCss, withAssetAccessToken } from "../../lib/assetPort.js";
import { withAssetWidth } from "../../core/assetUrl.js";
import { BITABLE_OPTION_PALETTE, bitableDisplayValue, isKnownFieldType, optionChipStyle, optionColorHex, type BitableField, type BitableFieldOption } from "../../core/bitableDoc.js";

/** 字段类型图标（未知类型给 HelpCircle）。 */
export function FieldTypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  switch (type) {
    case "text": return <Type size={size} />;
    case "number": return <Hash size={size} />;
    case "select": return <CircleDot size={size} />;
    case "multiSelect": return <Tags size={size} />;
    case "date": return <Calendar size={size} />;
    case "attachment": return <Paperclip size={size} />;
    case "relation": return <Link2 size={size} />;
    default: return <HelpCircle size={size} />;
  }
}

/** 锚点是否位于某个对话框/抽屉表面内（决定嵌套浮层是否抬到对话框之上）。 */
function isInsideDialog(el: HTMLElement | null | undefined): boolean {
  return !!el?.closest(".ln-dialog");
}

export interface PopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
}

/** 锚定浮层：portal 到 body，避免被表格 overflow 裁剪；外点/Esc 关闭。
 *  表面走 Overlay 原语的 .ln-popover（单一来源）；.bt-popover 只留内容尺寸。
 *  锚点在对话框/抽屉内时抬层，避免被对话框表面盖住。 */
export function Popover({ open, anchor, onClose, children, width = 240, align = "start" }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = align === "end" ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    const top = Math.min(r.bottom + 4, window.innerHeight - 48);
    setStyle({ left, top });
  }, [open, anchor, width, align]);
  if (!open || !style) return null;
  return (
    <OverlayPopover className="bt-popover" raised={isInsideDialog(anchor)} onDismiss={onClose} surfaceRef={panelRef} ignoreOutside={(t) => !!anchor?.contains(t)} style={{ left: style.left, top: style.top, width }}>
      {children}
    </OverlayPopover>
  );
}

export interface OptionPickerProps {
  field: BitableField;
  value: unknown;
  multiple: boolean;
  disabled?: boolean;
  onToggle: (optionId: string) => void;
  onAddOption: (name: string) => void;
}

/** 单选/多选下拉：可搜索、可新建选项（对齐云端）。 */
export function OptionPicker({ field, value, multiple, disabled, onToggle, onAddOption }: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const options = field.options ?? [];
  const selected = new Set(Array.isArray(value) ? (value as string[]) : typeof value === "string" && value ? [value] : []);
  const filtered = query ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())) : options;
  const label = bitableDisplayValue(field, value);
  const close = () => { setOpen(false); setQuery(""); };
  const commitAdd = () => {
    const name = query.trim();
    if (!name) return;
    const existing = options.find((o) => o.name === name);
    if (existing) onToggle(existing.id);
    else onAddOption(name);
    setQuery("");
  };
  return (
    <div className="bt-option-cell">
      <button
        ref={anchorRef}
        type="button"
        className={"bt-option-trigger" + (label ? "" : " is-empty")}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="bt-option-label">
          {[...selected].map((id) => {
            const opt = options.find((o) => o.id === id);
            if (!opt) return null;
            return <span key={id} className="bt-option-chip" style={optionChipStyle(opt.color)}>{opt.name}</span>;
          })}
          {!label && <span className="bt-option-placeholder">请选择</span>}
        </span>
        <ChevronDown size={12} className="bt-option-caret" />
      </button>
      <Popover open={open} anchor={anchorRef.current} onClose={close} width={240} align="start">
        <div className="bt-option-search">
          <Search size={13} />
          <input
            autoFocus
            value={query}
            placeholder="搜索或新建选项"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") commitAdd(); }}
          />
        </div>
        <div className="bt-option-list" role="listbox" aria-multiselectable={multiple}>
          {filtered.map((opt: BitableFieldOption) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={selected.has(opt.id)}
              className={"bt-option-item" + (selected.has(opt.id) ? " is-selected" : "")}
              onClick={() => { onToggle(opt.id); if (!multiple) close(); }}
            >
              <span className="bt-option-chip" style={optionChipStyle(opt.color)}>{opt.name}</span>
              {selected.has(opt.id) && <Check size={13} />}
            </button>
          ))}
          {filtered.length === 0 && <div className="bt-popover-empty">无匹配选项</div>}
        </div>
        {query.trim() && !options.some((o) => o.name === query.trim()) && (
          <button type="button" className="bt-option-create" onClick={commitAdd}><Plus size={13} />新建「{query.trim()}」</button>
        )}
      </Popover>
    </div>
  );
}

/** 附件单元格里图片的显示边长（px）—— 必须与 `bitableEditor.css` 的 `.bt-attachment-chip img` 一致。 */
const ATTACHMENT_CHIP_PX = 26;

export interface AttachmentCellProps {
  noteId: string;
  value: unknown;
  readOnly: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (filename: string) => void;
  onOpen: (filename: string) => void;
  /** 记录详情抽屉里常驻编辑态（表格里是点一下才进编辑态）。 */
  alwaysActive?: boolean;
}

/** 「图片和附件」单元格：值是 assets/{noteId}/{filename} 的文件名数组，走现有资产管线。
 *  表格：默认正常显示，**点一下**进编辑态；记录详情：常驻编辑态（alwaysActive）。
 *  编辑态 = **独立「+」按钮**（选文件）+ **独立提示文案**（点它/空白聚焦本区，可直接 Cmd+V 粘贴）+ 附件；
 *  整个区域是粘贴 / 拖拽投放目标。缩略图按 `ATTACHMENT_CHIP_PX` 取 `?w=` 档位，放大预览走原图。 */
export function AttachmentCell({ noteId, value, readOnly, onUpload, onRemove, onOpen, alwaysActive = false }: AttachmentCellProps) {
  const files = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(alwaysActive);
  const [dropActive, setDropActive] = useState(false);
  const urlOf = (filename: string) => withAssetAccessToken(ASSET_ORIGIN + "/" + noteId + "/" + filename);
  const chipUrlOf = (filename: string) => withAssetWidth(urlOf(filename), assetThumbWidthForCss(ATTACHMENT_CHIP_PX));
  const isImage = (filename: string) => /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i.test(filename);
  const takeDropFiles = (list: FileList | null | undefined) => { if (list && list.length > 0) onUpload([...list]); };
  const chips = files.map((filename) => (
    <div key={filename} className="bt-attachment-chip" title={filename}>
      {isImage(filename)
        ? <img src={chipUrlOf(filename)} alt={filename} loading="lazy" onClick={() => onOpen(filename)} />
        : <button type="button" className="bt-attachment-name" onClick={() => onOpen(filename)}>{filename}</button>}
      {!readOnly && <button type="button" className="bt-attachment-remove" aria-label={"移除 " + filename} onClick={() => onRemove(filename)}>×</button>}
    </div>
  ));
  // 表格里点外部收起编辑态；抽屉常驻态不收起
  useEffect(() => {
    if (!active || alwaysActive) return;
    const onDown = (event: PointerEvent) => {
      const el = cellRef.current;
      if (el && !el.contains(event.target as Node)) { setActive(false); setDropActive(false); }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [active, alwaysActive]);
  return (
    <div ref={cellRef}
      className={"bt-attachment-cell" + (dropActive ? " is-drop-active" : "") + (active ? " is-editing" : "")}
      tabIndex={readOnly ? undefined : 0}
      onClick={(event) => {
        if (readOnly || active) return;
        if ((event.target as HTMLElement).closest(".bt-attachment-chip")) return;
        setActive(true);
      }}
      onPaste={(event) => {
        const items = event.clipboardData?.items;
        const picked: File[] = [];
        if (items) for (const item of items) if (item.kind === "file") { const f = item.getAsFile(); if (f) picked.push(f); }
        if (picked.length > 0) { event.preventDefault(); if (!readOnly) setActive(true); onUpload(picked); }
      }}
      onDragOver={(event) => { if (readOnly) return; event.preventDefault(); setDropActive(true); }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => { if (readOnly) return; event.preventDefault(); setDropActive(false); setActive(true); takeDropFiles(event.dataTransfer?.files); }}>
      {active && !readOnly ? (
        <div className="bt-attachment-editor">
          <button type="button" className="bt-attachment-plus" aria-label="选择图片或附件" title="选择图片或附件"
            onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}><Plus size={18} /></button>
          {files.length === 0 && (
            <span className="bt-attachment-hint" onClick={(event) => { event.stopPropagation(); cellRef.current?.focus(); }}>粘贴或拖拽至此</span>
          )}
          {chips}
        </div>
      ) : (
        chips
      )}
      {!readOnly && (
        <input ref={inputRef} type="file" multiple className="bt-hidden-input"
          onChange={(event) => { takeDropFiles(event.target.files); event.target.value = ""; }} />
      )}
      {files.length === 0 && readOnly && <span className="bt-cell-muted">—</span>}
    </div>
  );
}

/** 文本单元格：内联编辑 + 右侧「扩大」按钮 → 贴单元格的可拖动/可缩放浮窗展开全文（对齐钉钉式）。 */
function TextCell({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return (
    <div className="bt-text-cell">
      <input className="bt-cell-input" value={text} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
      {!readOnly && (
        <button
          type="button"
          className="bt-expand-btn"
          title="展开全部文本"
          aria-label="展开全部文本"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget); }}
        >
          <Maximize2 size={12} />
        </button>
      )}
      {anchor && (
        <TextExpandPopover anchor={anchor} value={text} readOnly={readOnly} onChange={onChange} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}

interface TextExpandPopoverProps {
  anchor: HTMLElement;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
}

/** 贴单元格浮窗：初始落在单元格下方，可拖动（标题栏）与缩放（右下角），正文直接改单元格值。 */
function TextExpandPopover({ anchor, value, readOnly, onChange, onClose }: TextExpandPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState({ w: 400, h: 260 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(400, Math.max(240, window.innerWidth - 24));
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
    const top = Math.min(Math.max(8, r.bottom + 4), Math.max(8, window.innerHeight - 260 - 8));
    setPos({ left, top });
  }, [anchor]);
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startX = event.clientX; const startY = event.clientY;
    const base = pos ?? { left: 0, top: 0 };
    const onMove = (ev: PointerEvent) => setPos({ left: base.left + (ev.clientX - startX), top: base.top + (ev.clientY - startY) });
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX; const startY = event.clientY;
    const base = { ...size };
    const onMove = (ev: PointerEvent) => setSize({ w: Math.max(240, base.w + (ev.clientX - startX)), h: Math.max(160, base.h + (ev.clientY - startY)) });
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  if (!pos) return null;
  return (
    <OverlayPopover className="bt-text-expand" raised={isInsideDialog(anchor)} onDismiss={onClose} surfaceRef={panelRef} ignoreOutside={(t) => anchor.contains(t)} style={{ left: pos.left, top: pos.top, width: size.w, height: size.h }}>
      <header className="bt-text-expand-head" onPointerDown={startDrag}>
        <span>展开编辑</span>
        <button type="button" className="bt-icon-btn" aria-label="关闭" title="关闭" onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={14} /></button>
      </header>
      <textarea className="bt-text-expand-body" autoFocus value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
      <div className="bt-text-expand-resize" onPointerDown={startResize} title="拖动调整大小" />
    </OverlayPopover>
  );
}

/** 颜色选择面板（图2：hover 出现色卡；点选即定色）。 */
export function ColorPalette({ anchor, value, onPick, onClose, onClear }: {
  anchor: HTMLElement;
  value?: string;
  onPick: (color: string) => void;
  onClose: () => void;
  /** 传了就显示「无颜色」清除项（列文字颜色用；选项颜色不传）。 */
  onClear?: () => void;
}) {
  const active = optionColorHex(value);
  return (
    <Popover open anchor={anchor} onClose={onClose} width={236} align="start">
      <div className="bt-color-palette">
        {BITABLE_OPTION_PALETTE.map((color) => (
          <button key={color} type="button" className="bt-color-swatch" style={{ backgroundColor: color }} aria-label={"颜色 " + color}
            onClick={() => { onPick(color); onClose(); }}>{active === color ? <Check size={12} /> : null}</button>
        ))}
        {onClear && (
          <button type="button" className="bt-color-swatch bt-color-swatch--clear" aria-label="无颜色" title="无颜色"
            onClick={() => { onClear(); onClose(); }}><X size={12} /></button>
        )}
      </div>
    </Popover>
  );
}

/** 通用下拉（替代原生 select，避免系统蓝高亮；对齐云端圆角浮层 + 勾选）。 */
export function SelectMenu({ value, options, disabled, onChange, placeholder }: {
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** 无匹配项时显示的占位（如分组面板的"选择一列进行分组"）。 */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <div className="bt-select">
      <button ref={anchorRef} type="button" className="bt-select-trigger" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <span className={current ? undefined : "bt-select-placeholder"}>{current ? current.label : (value || placeholder || "")}</span><ChevronDown size={14} />
      </button>
      <Popover open={open} anchor={anchorRef.current} onClose={() => setOpen(false)} width={260} align="start">
        <div className="bt-panel">
          {options.map((option) => (
            <button key={option.value} type="button" className={"bt-menu-item" + (option.value === value ? " is-selected" : "")}
              onClick={() => { onChange(option.value); setOpen(false); }}>
              <span className="bt-menu-label">{option.label}</span>
              {option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** 日期选择器（自研，对齐云端质感）：触发按钮 + 月历面板（上/下月、今天、清除）。 */
export function DatePicker({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const text = typeof value === "string" ? value : "";
  const [cursor, setCursor] = useState(() => {
    const d = text ? new Date(text + "T00:00:00") : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  });
  useEffect(() => {
    if (!text) return;
    const d = new Date(text + "T00:00:00");
    if (!Number.isNaN(d.getTime())) setCursor(d);
  }, [text]);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  const fmt = (d: number) => year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const pickToday = () => { const t = new Date(); onChange(t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0")); setOpen(false); };
  return (
    <div className="bt-date-cell">
      <button ref={anchorRef} type="button" className={"bt-date-trigger" + (text ? "" : " is-empty")} disabled={readOnly} onClick={() => setOpen((v) => !v)}>
        <span>{text || "请选择日期"}</span><Calendar size={13} />
      </button>
      <Popover open={open} anchor={anchorRef.current} onClose={() => setOpen(false)} width={264}>
        <div className="bt-date-panel">
          <div className="bt-date-head">
            <button type="button" className="bt-icon-btn" aria-label="上个月" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></button>
            <span>{year} 年 {month + 1} 月</span>
            <button type="button" className="bt-icon-btn" aria-label="下个月" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={14} /></button>
          </div>
          <div className="bt-date-week">{["日", "一", "二", "三", "四", "五", "六"].map((w) => <span key={w}>{w}</span>)}</div>
          <div className="bt-date-grid">
            {cells.map((d, i) => d === null
              ? <span key={"e" + i} className="bt-date-empty" />
              : <button key={d} type="button" className={"bt-date-day" + (text === fmt(d) ? " is-selected" : "")} onClick={() => { onChange(fmt(d)); setOpen(false); }}>{d}</button>)}
          </div>
          <div className="bt-date-foot">
            <button type="button" onClick={pickToday}>今天</button>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>清除</button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

export interface CellEditorProps {
  field: BitableField;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  onAddOption: (name: string) => void;
  renderAttachment?: () => ReactNode;
}

/** 按字段类型分派单元格编辑器（未知类型只读展示、不清空）。 */
export function CellEditor({ field, value, readOnly, onChange, onAddOption, renderAttachment }: CellEditorProps) {
  if (!isKnownFieldType(field.type)) {
    return <span className="bt-cell-unknown" title="未知字段类型（只读展示）">{bitableDisplayValue(field, value) || "—"}</span>;
  }
  switch (field.type) {
    case "text":
      return <TextCell value={value} readOnly={readOnly} onChange={onChange} />;
    case "number":
      return (
        <input
          className="bt-cell-input"
          type="number"
          value={value == null || value === "" ? "" : String(value)}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
        />
      );
    case "date":
      return <DatePicker value={value} readOnly={readOnly} onChange={onChange} />;
    case "select":
      return (
        <OptionPicker field={field} value={value} multiple={false} disabled={readOnly}
          onToggle={(id) => onChange(value === id ? "" : id)} onAddOption={onAddOption} />
      );
    case "multiSelect":
      return (
        <OptionPicker field={field} value={value} multiple disabled={readOnly}
          onToggle={(id) => {
            const current = Array.isArray(value) ? (value as string[]) : [];
            onChange(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
          }}
          onAddOption={onAddOption} />
      );
    case "attachment":
      return renderAttachment ? <>{renderAttachment()}</> : <span className="bt-cell-muted">—</span>;
    case "relation":
      return <span className="bt-cell-relation" title="关联字段 v1 只占位、单元格不可填值">关联（暂不可填）</span>;
    default:
      return <span className="bt-cell-unknown">{bitableDisplayValue(field, value) || "—"}</span>;
  }
}
