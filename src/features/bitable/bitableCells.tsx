/**
 * 多维表单元格与浮层控件（v1）。
 *
 * 设计约束（AGENTS.md §3 #14）：视觉走已有 --b3-* 令牌 + 本目录 bitableEditor.css，
 * 组件里**不写静态内联样式**；仅浮层定位这类动态坐标用 inline style（与 Sidebar 右键菜单同做法）。
 * 单元格值按 fieldId 存，编辑通过 onChange(value) 回传，由 BitableEditor 统一写 doc。
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { Popover as OverlayPopover } from "../../components/ui/Overlay";
import { Calendar, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Clock, Download, ExternalLink, Gauge, Hash, HelpCircle, Image as ImageIcon, Link, Link2, Maximize2, Paperclip, Pencil, Plus, Search, SquareCheck, Star, Tags, Type, X } from "lucide-react";
import { ASSET_ORIGIN, assetThumbWidthForCss, withAssetAccessToken } from "../../lib/assetPort.js";
import { withAssetWidth } from "../../core/assetUrl.js";
import { extOf, isImageExtension } from "../../core/assetNaming.js";
import "./bitableFieldCells.css";
import { native } from "../../lib/native.js";
import { ATTACHMENT_GRID, BITABLE_FIELD_TYPES, BITABLE_FIELD_TYPE_LABEL, BITABLE_OPTION_PALETTE, BITABLE_PROGRESS_MAX, BITABLE_RATING_MAX, attachmentGridColumns, bitableAttachments, bitableDisplayValue, bitableFieldText, isKnownFieldType, localDateString, optionChipStyle, optionColorHex, type BitableAttachment, type BitableField, type BitableFieldOption, type BitableRecord } from "../../core/bitableDoc.js";
import type { CSSProperties } from "react";

/** 图片字段只收图片：`accept` 只约束「选文件」，拖拽/粘贴必须自己拦，否则会静默写进非图片。
 *  返回「可上传的」与「被拒数量」——拒绝要有可见提示，绝不静默丢弃。 */
function splitImageFiles(files: File[], imageOnly: boolean): { accepted: File[]; rejected: number } {
  if (!imageOnly) return { accepted: files, rejected: 0 };
  const accepted = files.filter((file) => isImageExtension(extOf(file.name)) || file.type.startsWith("image/"));
  return { accepted, rejected: files.length - accepted.length };
}

const IMAGE_ONLY_HINT = "只接受图片文件";

/** 字段类型图标（未知类型给 HelpCircle）。 */
export function FieldTypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  switch (type) {
    case "text": return <Type size={size} />;
    case "number": return <Hash size={size} />;
    case "select": return <CircleDot size={size} />;
    case "multiSelect": return <Tags size={size} />;
    case "date": return <Calendar size={size} />;
    case "attachment": return <Paperclip size={size} />;
    case "image": return <ImageIcon size={size} />;
    case "boolean": return <SquareCheck size={size} />;
    case "link": return <Link size={size} />;
    case "rating": return <Star size={size} />;
    case "progress": return <Gauge size={size} />;
    case "createdTime": return <CalendarClock size={size} />;
    case "updatedTime": return <Clock size={size} />;
    case "relation": return <Link2 size={size} />;
    default: return <HelpCircle size={size} />;
  }
}

/**
 * 字段类型选择：**2 列网格**（对齐云端版式，用户 260928），**不分「基础 / 高级」组**。
 * 新增字段面板与字段编辑弹窗共用；传 `value` 时给当前类型打勾（未知类型也会占一格，保证不丢）。
 */
export function FieldTypeGrid({ value, disabled, onPick }: { value?: string; disabled?: boolean; onPick: (type: string) => void }) {
  const unknown = value && !isKnownFieldType(value) ? value : null;
  return (
    <div className="bt-type-grid" role="listbox" aria-label="字段类型">
      {unknown && (
        <button type="button" className={"bt-menu-item" + (unknown === value ? " is-selected" : "")} disabled={disabled} onClick={() => onPick(unknown)}>
          <FieldTypeIcon type={unknown} /><span className="bt-menu-label">{unknown}（未知）</span><Check size={14} />
        </button>
      )}
      {BITABLE_FIELD_TYPES.map((type) => (
        <button key={type} type="button" role="option" aria-selected={type === value}
          className={"bt-menu-item" + (type === value ? " is-selected" : "")} disabled={disabled} onClick={() => onPick(type)}>
          <FieldTypeIcon type={type} /><span className="bt-menu-label">{BITABLE_FIELD_TYPE_LABEL[type]}</span>
          {type === value && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}

/** 锚点是否位于某个对话框/抽屉表面内（决定嵌套浮层是否抬到对话框之上）。 */
function isInsideDialog(el: HTMLElement | null | undefined): boolean {
  return !!el?.closest(".ln-dialog");
}

export interface PopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  /** 无锚点元素的场合（列头右键菜单）：直接给视口坐标，浮层左上角落在这里。 */
  at?: { x: number; y: number } | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
}

/** 锚定浮层：portal 到 body，避免被表格 overflow 裁剪；外点/Esc 关闭。
 *  表面走 Overlay 原语的 .ln-popover（单一来源）；.bt-popover 只留内容尺寸。
 *  锚点在对话框/抽屉内时抬层，避免被对话框表面盖住。
 *  锚点可为 null 而改用 at 坐标（列头右键菜单没有稳定锚点元素）。 */
export function Popover({ open, anchor, at, onClose, children, width = 240, align = "start" }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; top: number } | null>(null);
  // 只依赖 at 的两个分量：调用方常写内联对象，依赖对象身份会在 setState → 重排 → 再 setState 里打转
  const atX = at?.x; const atY = at?.y;
  useLayoutEffect(() => {
    if (!open) return;
    if (atX !== undefined && atY !== undefined) {
      setStyle({
        left: Math.max(8, Math.min(atX, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(atY, window.innerHeight - 48)),
      });
      return;
    }
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = align === "end" ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    const top = Math.min(r.bottom + 4, window.innerHeight - 48);
    setStyle({ left, top });
  }, [open, anchor, atX, atY, width, align]);
  if (!open || !style) return null;
  return (
    <OverlayPopover className="bt-popover" raised={isInsideDialog(anchor)} onDismiss={onClose} surfaceRef={panelRef} ignoreOutside={(t) => !!anchor?.contains(t)} style={{ left: style.left, top: style.top, width }}>
      {children}
    </OverlayPopover>
  );
}

interface OptionPickerProps {
  field: BitableField;
  value: unknown;
  multiple: boolean;
  disabled?: boolean;
  onToggle: (optionId: string) => void;
  onAddOption: (name: string) => void;
}

/** 单选/多选下拉：可搜索、可新建选项（对齐云端）。仅本文件的 CellEditor 用。 */
function OptionPicker({ field, value, multiple, disabled, onToggle, onAddOption }: OptionPickerProps) {
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
/** 展开面板里附件卡片的缩略图档位依据（CSS 显示边长，取档位时自动乘 DPR）。 */
const ATTACHMENT_CARD_PX = 150;
/** 面板内「拖动排序」用的私有拖拽类型：内部拖拽不能被当成"拖入文件"（否则会触发上传/投放高亮）。 */
const BT_ATTACH_DRAG_MIME = "application/x-lake-bitable-attachment";

function isInternalAttachmentDrag(event: { dataTransfer?: DataTransfer | null }): boolean {
  const types = event.dataTransfer?.types;
  return !!types && [...types].includes(BT_ATTACH_DRAG_MIME);
}

/** 展示名拆成「主名 + 扩展名（含点）」。改名**只改主名**：`.xxx` 是文件格式，固定不动
 *  （260928 用户要求「编辑名称的时候不能改格式，直接编辑名称」）。
 *  展示名里没有 `.xxx`（或本身就是 `.xxx`）时返回整名 + 空后缀，那一格照旧整名可编辑。 */
function splitAttachmentName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: "" };
}

/** 预览层（附件浮层 / 图片 Lightbox）是独立 portal：点它不算「面板外」，Esc 也该先关它。 */
const PREVIEW_LAYER_SELECTOR = ".attachment-preview, .image-lightbox";
function inPreviewLayer(target?: Node | null): boolean {
  return !!target && target instanceof Element && !!target.closest(PREVIEW_LAYER_SELECTOR);
}
function previewLayerOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector(PREVIEW_LAYER_SELECTOR);
}

/**
 * 展开面板的自适应尺寸：列数看附件多少（见 `attachmentGridColumns`），默认最多 3 行，
 * 再多由投放区自己滚动（面板不会无限长高/变宽）；空态只留虚线提示 + 添加按钮的位置。
 */
function attachmentPanelSize(count: number, measuredCardHeight?: number): { w: number; h: number } {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));
  const viewportW = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  if (count <= 0) return { w: clamp(420, 280, viewportW - 24), h: clamp(220, 200, viewportH - 24) };
  const { cardWidth, cardHeight, gap, maxRows } = ATTACHMENT_GRID;
  const cardH = measuredCardHeight && measuredCardHeight > 0 ? measuredCardHeight : cardHeight;
  const cols = attachmentGridColumns(count);
  const rows = Math.min(maxRows, Math.ceil(count / cols));
  // 宽 = 卡片列 + 列距 + 左右留白（body 10×2 + 投放区 2×2 + 边框 2 + 常驻滚动条槽 ~15 + 余量）
  // 留白必须把滚动条算进去：投放区一旦滚动（>3 行）会吃掉宽度，否则列数会莫名少一列。
  const w = cols * cardWidth + (cols - 1) * gap + 52;
  // 高 = 标题栏 33 + body 上下留白 20 + 卡片可见行 + 行距 + 与添加按钮的间距 8 + 添加按钮 38
  const h = 33 + 20 + rows * cardH + (rows - 1) * gap + 8 + 38;
  return { w: clamp(w, 280, viewportW - 24), h: clamp(h, 200, viewportH - 24) };
}

/** 行单元格里的附件 chip 列表。**没有删除按钮**：行内格子太窄，删除只在展开面板的卡片上做
 *  （点单元格 = 选中并出现「+」，点 chip = 预览，两者都不需要在行内放 ×）。 */
function AttachmentChipList({ noteId, attachments, onOpen, onOpenImages }: {
  noteId: string;
  attachments: BitableAttachment[];
  onOpen: (attachment: BitableAttachment) => void;
  /** 点图片：预览**该单元格内**的全部图片（用户 260928：两列图片就是两类，绝不跨列合并）。 */
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
}) {
  const urlOf = (file: string) => withAssetAccessToken(ASSET_ORIGIN + "/" + noteId + "/" + file);
  const chipUrlOf = (file: string) => withAssetWidth(urlOf(file), assetThumbWidthForCss(ATTACHMENT_CHIP_PX));
  /** 预览范围 = 本单元格内的图片（顺序 = 单元格内顺序）；非图片仍走系统打开。 */
  const openByFile = (file: string) => {
    const item = attachments.find((a) => a.file === file);
    if (!item) return;
    const images = attachments.filter((a) => isImageExtension(extOf(a.file)));
    const index = images.indexOf(item);
    if (index >= 0 && onOpenImages) onOpenImages(images, index);
    else onOpen(item);
  };
  return (
    <>
      {attachments.map(({ file, name }) => (
        <div key={file} className="bt-attachment-chip" title={name}>
          {isImageExtension(extOf(file))
            ? <img src={chipUrlOf(file)} alt={name} loading="lazy" onClick={() => openByFile(file)} />
            : <button type="button" className="bt-attachment-name" onClick={() => openByFile(file)}>{name}</button>}
        </div>
      ))}
    </>
  );
}

export interface AttachmentCellProps {
  noteId: string;
  value: unknown;
  readOnly: boolean;
  onUpload: (files: File[]) => void;
  /** 入参是**磁盘名**（`BitableAttachment.file`）。 */
  onRemove: (file: string) => void;
  /** 打开该附件（磁盘名定位文件、展示名用于预览标题）。 */
  onOpen: (attachment: BitableAttachment) => void;
  /** 展开面板里拖拽排序后的新顺序（磁盘名数组）。 */
  onReorder: (files: string[]) => void;
  /** 改附件的展示名（磁盘名不变）。 */
  onRename: (file: string, name: string) => void;
  /** 记录详情抽屉里常驻编辑态（表格里是点一下才进编辑态）。 */
  alwaysActive?: boolean;
  /** 图片字段：只接受图片（选文件 / 拖拽 / 粘贴三条路都拦）。 */
  imageOnly?: boolean;
  /** 点图片预览：入参 = **本单元格内**的图片 + 下标（不含其它列）。 */
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
}

/** 「图片和附件」单元格：值是 `{ file, name }[]`（磁盘名 + 展示名，走现有资产管线）。
 *  表格：默认正常显示，**点一下**进编辑态；记录详情：常驻编辑态（alwaysActive）。
 *  编辑态 = **独立「+」按钮**（选文件）+ **独立提示文案**（点它/空白聚焦本区，可直接 Cmd+V 粘贴）+ 附件；
 *  整个区域是粘贴 / 拖拽投放目标。缩略图按 `ATTACHMENT_CHIP_PX` 取 `?w=` 档位，放大预览走原图。
 *  右侧「⤢」= 展开面板（行单元格太窄放不下附件列表时用）。 */
export function AttachmentCell({ noteId, value, readOnly, onUpload, onRemove, onOpen, onReorder, onRename, alwaysActive = false, imageOnly = false, onOpenImages }: AttachmentCellProps) {
  const attachments = bitableAttachments(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(alwaysActive);
  const [dropActive, setDropActive] = useState(false);
  const [expandAnchor, setExpandAnchor] = useState<HTMLElement | null>(null);
  /** 被拒文件的可见提示（图片字段收到非图片时）——绝不静默丢弃。 */
  const [rejectNote, setRejectNote] = useState<string | null>(null);
  const takeFiles = (list: FileList | File[] | null | undefined) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    const { accepted, rejected } = splitImageFiles(files, imageOnly);
    setRejectNote(rejected > 0 ? IMAGE_ONLY_HINT + "，已忽略 " + rejected + " 个" : null);
    if (accepted.length > 0) onUpload(accepted);
  };
  const chips = <AttachmentChipList noteId={noteId} attachments={attachments} onOpen={onOpen} onOpenImages={onOpenImages} />;
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
        // 点中 chip（缩略图/文件名）只走预览，**不算选中单元格**（要区分开）；
        // 点空白处或右侧「⤢ 展开」才算选中 → 「+」自动出来。
        if (readOnly || active) return;
        if ((event.target as HTMLElement).closest(".bt-attachment-chip")) return;
        setActive(true);
      }}
      onDoubleClick={(event) => {
        // 双击单元格 = 打开展开面板（快捷键式入口；⤢ 按钮仍然可用）
        if (readOnly) return;
        if ((event.target as HTMLElement).closest(".bt-expand-btn")) return;
        setExpandAnchor(cellRef.current);
      }}
      onPaste={(event) => {
        const items = event.clipboardData?.items;
        const picked: File[] = [];
        if (items) for (const item of items) if (item.kind === "file") { const f = item.getAsFile(); if (f) picked.push(f); }
        if (picked.length > 0) { event.preventDefault(); if (!readOnly) setActive(true); takeFiles(picked); }
      }}
      onDragOver={(event) => { if (readOnly || isInternalAttachmentDrag(event)) return; event.preventDefault(); setDropActive(true); }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => { if (readOnly || isInternalAttachmentDrag(event)) return; event.preventDefault(); setDropActive(false); setActive(true); takeFiles(event.dataTransfer?.files); }}>
      {active && !readOnly ? (
        <div className="bt-attachment-editor">
          <button type="button" className="bt-attachment-plus" aria-label={imageOnly ? "选择图片" : "选择图片或附件"} title={imageOnly ? "选择图片" : "选择图片或附件"}
            onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}><Plus size={18} /></button>
          {attachments.length === 0 && (
            <span className="bt-attachment-hint" onClick={(event) => { event.stopPropagation(); cellRef.current?.focus(); }}>粘贴或拖拽至此</span>
          )}
          {chips}
        </div>
      ) : (
        chips
      )}
      {!readOnly && (
        <button type="button" className="bt-expand-btn" title="展开附件" aria-label="展开附件"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const el = event.currentTarget;
            // 点「展开」= 选中该单元格（加号自动出来），同时开/关面板
            setActive(true);
            setExpandAnchor((prev) => (prev ? null : el));
          }}>
          <Maximize2 size={12} />
        </button>
      )}
      {!readOnly && (
        <input ref={inputRef} type="file" multiple accept={imageOnly ? "image/*" : undefined} className="bt-hidden-input"
          onChange={(event) => { takeFiles(event.target.files); event.target.value = ""; }} />
      )}
      {rejectNote && <span className="bt-cell-muted" role="status">{rejectNote}</span>}
      {attachments.length === 0 && readOnly && <span className="bt-cell-muted">—</span>}
      {expandAnchor && (
        <AttachmentExpandPopover
          anchor={expandAnchor}
          noteId={noteId}
          attachments={attachments}
          readOnly={readOnly}
          imageOnly={imageOnly}
          onOpenImages={onOpenImages}
          onUpload={onUpload}
          onRemove={onRemove}
          onOpen={onOpen}
          onReorder={onReorder}
          onRename={onRename}
          onClose={() => setExpandAnchor(null)}
        />
      )}
    </div>
  );
}

interface AttachmentExpandPopoverProps {
  anchor: HTMLElement;
  noteId: string;
  attachments: BitableAttachment[];
  readOnly: boolean;
  /** 图片字段：展开面板的入口同样只收图片。 */
  imageOnly?: boolean;
  /** 展开面板里点图片：同样只预览本单元格内的图片。 */
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
  onUpload: (files: File[]) => void;
  onRemove: (file: string) => void;
  onOpen: (attachment: BitableAttachment) => void;
  onReorder: (files: string[]) => void;
  onRename: (file: string, name: string) => void;
  onClose: () => void;
}

/** 附件展开面板（贴单元格浮窗，可拖动/缩放）：
 *  上半 = 拖拽 / 粘贴投放区：空态给虚线提示，有附件时是**卡片网格**；下半 = 「＋ 添加本地文件」。
 *  卡片 = 附件区（右上角 × 删除）+ 名称行（名称可编辑 + 下载）；**没有悬停工具**：
 *  点击卡片 = 预览，按住拖动 = 排序（原生 draggable，不移动则仍是点击）。
 *
 *  投放区必须自己 `stopPropagation`：面板是 Overlay 的 portal，但 React 事件仍沿 **React 树**
 *  冒泡回单元格，而单元格本身也接了 paste/drop ⇒ 不截断的话一次粘贴会上传两遍（实测过）。
 *
 *  打开即聚焦投放区：面板是 portal，焦点不在 `.bt-attachment-cell` 里，
 *  表格的全局 Cmd+V 处理器会 `preventDefault` 掉原生 paste（"拖拽行、粘贴不行"的真因）。 */
function AttachmentExpandPopover({ anchor, noteId, attachments, readOnly, imageOnly = false, onOpenImages, onUpload, onRemove, onOpen, onReorder, onRename, onClose }: AttachmentExpandPopoverProps) {
  /** 图片字段收到非图片时的可见提示（与单元格同一口径）。 */
  const [rejectNote, setRejectNote] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState(() => attachmentPanelSize(attachments.length));
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [dropActive, setDropActive] = useState(false);
  const [dragFile, setDragFile] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ file: string; after: boolean } | null>(null);
  const [renameFile, setRenameFile] = useState<string | null>(null);
  // 附件增减后重新自适应；卡片高度**实测**再算（常量会随 CSS 漂移）。
  // 用户手动缩放过的尺寸会被下一次自适应覆盖——这是「自适应」的预期语义。
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const card = grid?.firstElementChild as HTMLElement | null | undefined;
    const measured = card ? card.getBoundingClientRect().height : 0;
    setSize(attachmentPanelSize(attachments.length, measured));
  }, [attachments.length]);
  useLayoutEffect(() => {
    // 贴在**单元格**下沿（不是按钮）：面板里加完附件单元格会变高，位置必须跟着走，
    // 否则面板会盖住自己的 ⤢ 按钮（实测踩到过：elementFromPoint 命中面板而不是按钮）。
    const host = (anchor.closest(".bt-attachment-cell") as HTMLElement | null) ?? anchor;
    const measure = () => {
      const r = host.getBoundingClientRect();
      const w = Math.min(sizeRef.current.w, Math.max(280, window.innerWidth - 24));
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
      const top = Math.min(Math.max(8, r.bottom + 4), Math.max(8, window.innerHeight - sizeRef.current.h - 8));
      setPos({ left, top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
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
    const onMove = (ev: PointerEvent) => setSize({ w: Math.max(280, base.w + (ev.clientX - startX)), h: Math.max(200, base.h + (ev.clientY - startY)) });
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const takeFiles = (list: FileList | File[] | null | undefined) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    const { accepted, rejected } = splitImageFiles(files, imageOnly);
    setRejectNote(rejected > 0 ? IMAGE_ONLY_HINT + "，已忽略 " + rejected + " 个" : null);
    if (accepted.length > 0) onUpload(accepted);
  };
  const thumbOf = (file: string) => withAssetWidth(withAssetAccessToken(ASSET_ORIGIN + "/" + noteId + "/" + file), assetThumbWidthForCss(ATTACHMENT_CARD_PX));
  /** 展开面板里点图片：预览范围同样限定在本单元格的图片（不跨列）。 */
  const openByFile = (file: string) => {
    const item = attachments.find((a) => a.file === file);
    if (!item) return;
    const images = attachments.filter((a) => isImageExtension(extOf(a.file)));
    const index = images.indexOf(item);
    if (index >= 0 && onOpenImages) onOpenImages(images, index);
    else onOpen(item);
  };
  /** 卡片列表带上「主名 / 扩展名」拆分（改名只改主名，见 splitAttachmentName）。 */
  const namedAttachments = attachments.map((a) => ({ ...a, ...splitAttachmentName(a.name) }));
  /** 拖拽排序：把 dragged 插到 target 前/后（先移出再按目标位置插入）。 */
  const applyReorder = (dragged: string, target: string, after: boolean) => {
    const rest = attachments.map((a) => a.file).filter((f) => f !== dragged);
    const at = rest.indexOf(target);
    if (at < 0) return;
    rest.splice(after ? at + 1 : at, 0, dragged);
    onReorder(rest);
  };
  useEffect(() => { dropRef.current?.focus({ preventScroll: true }); }, []);
  if (!pos) return null;
  return (
    <OverlayPopover
      className="bt-attach-expand"
      raised={isInsideDialog(anchor)}
      // 预览开着时不关面板（否则每看一次附件都要重新展开）；Esc 也先留给预览层
      onDismiss={() => { if (!previewLayerOpen()) onClose(); }}
      surfaceRef={panelRef}
      ignoreOutside={(t) => anchor.contains(t) || inPreviewLayer(t) || previewLayerOpen()}
      style={{ left: pos.left, top: pos.top, width: size.w, height: size.h }}
    >
      <header className="bt-attach-expand-head" onPointerDown={startDrag}>
        <span>附件</span>
        <button type="button" className="bt-icon-btn" aria-label="关闭" title="关闭" onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={14} /></button>
      </header>
      <div className="bt-attach-expand-body">
        {rejectNote && <div className="bt-cell-muted" role="status">{rejectNote}</div>}
        <div
          ref={dropRef}
          className={"bt-attach-dropzone" + (attachments.length > 0 ? " has-items" : "") + (dropActive ? " is-drop-active" : "")}
          tabIndex={readOnly ? undefined : 0}
          onPaste={(event) => {
            event.stopPropagation();
            const items = event.clipboardData?.items;
            const picked: File[] = [];
            if (items) for (const item of items) if (item.kind === "file") { const f = item.getAsFile(); if (f) picked.push(f); }
            if (picked.length > 0) { event.preventDefault(); if (!readOnly) takeFiles(picked); }
          }}
          onDragOver={(event) => {
            event.stopPropagation();
            if (readOnly || isInternalAttachmentDrag(event)) return; // 卡片内部排序不当作"拖入文件"
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={(event) => { event.stopPropagation(); setDropActive(false); }}
          onDrop={(event) => {
            event.stopPropagation();
            if (readOnly || isInternalAttachmentDrag(event)) return;
            event.preventDefault();
            setDropActive(false);
            takeFiles(event.dataTransfer?.files);
          }}
        >
          {attachments.length === 0
            ? <div className="bt-attach-dropzone-hint">粘贴或拖拽至这里上传</div>
            : (
              <div className="bt-attach-grid" ref={gridRef}>
                {namedAttachments.map(({ file, name, base, ext }) => (
                  <div
                    key={file}
                    className={
                      "bt-attach-card"
                      + (dragFile === file ? " is-dragging" : "")
                      + (dropHint && dropHint.file === file ? (dropHint.after ? " is-drop-after" : " is-drop-before") : "")
                    }
                    draggable={!readOnly && renameFile !== file}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(BT_ATTACH_DRAG_MIME, file);
                      event.dataTransfer.effectAllowed = "move";
                      setDragFile(file);
                    }}
                    onDragEnd={() => { setDragFile(null); setDropHint(null); }}
                    onDragOver={(event) => {
                      // 用 dataTransfer.types 判定内部拖拽：dragover 阶段拿不到数据、也拿不到最新 state，
                      // 但必须 preventDefault 才会触发 drop（否则拖到一半松手什么也不会发生）。
                      if (readOnly || !isInternalAttachmentDrag(event)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setDropHint({ file, after: event.clientX > rect.left + rect.width / 2 });
                    }}
                    onDrop={(event) => {
                      // 从 dataTransfer 取被拖的条目（不依赖 React state：拖拽期间状态可能还没提交）
                      const dragged = event.dataTransfer.getData(BT_ATTACH_DRAG_MIME) || dragFile;
                      if (readOnly || !dragged || dragged === file) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      applyReorder(dragged, file, event.clientX > rect.left + rect.width / 2);
                      setDragFile(null);
                      setDropHint(null);
                    }}
                  >
                    {/* 上：附件区 —— 点击预览，按住拖动排序（原生 draggable，不移动就仍是点击） */}
                    <div className="bt-attach-card-file" title="点击预览 · 按住拖动排序" onClick={() => openByFile(file)}>
                      {isImageExtension(extOf(file))
                        ? <img src={thumbOf(file)} alt={name} loading="lazy" draggable={false} />
                        : <span className="bt-attach-card-ext">{(extOf(file) || "file").toUpperCase()}</span>}
                      {!readOnly && (
                        <button type="button" className="bt-attach-card-remove" aria-label={"移除 " + name} title="删除"
                          onClick={(event) => { event.stopPropagation(); onRemove(file); }}><X size={13} /></button>
                      )}
                    </div>
                    {/* 下：名称（可编辑）+ 下载 */}
                    <div className="bt-attach-card-meta">
                      {renameFile === file
                        ? (
                          <span className="bt-attach-card-rename">
                            <input
                              className="bt-attach-card-rename-input"
                              defaultValue={base}
                              autoFocus
                              aria-label="附件名称"
                              onKeyDown={(event) => {
                                // Enter/blur 提交：只取输入框里的主名，扩展名原样拼回（输入框里改不到格式）
                                if (event.key === "Enter") { onRename(file, (event.currentTarget.value.trim() || base) + ext); setRenameFile(null); }
                                if (event.key === "Escape") setRenameFile(null);
                              }}
                              onBlur={(event) => { onRename(file, (event.currentTarget.value.trim() || base) + ext); setRenameFile(null); }}
                            />
                            {ext && <span className="bt-attach-card-rename-ext">{ext}</span>}
                          </span>
                        )
                        : (
                          <span className="bt-attach-card-name" title={name} onClick={() => openByFile(file)}>{name}</span>
                        )}
                      {!readOnly && renameFile !== file && (
                        <button type="button" className="bt-attach-card-icon" title="编辑名称" aria-label={"编辑名称 " + name}
                          onClick={() => setRenameFile(file)}><Pencil size={14} /></button>
                      )}
                      <button type="button" className="bt-attach-card-icon" title="下载" aria-label={"下载 " + name}
                        onClick={() => { void native.saveAssetAs(noteId, file, name).catch((error) => reportNativeActionError("下载附件", error)); }}><Download size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
        {!readOnly && (
          <button type="button" className="bt-attach-add" onClick={() => inputRef.current?.click()}><Plus size={16} />添加本地文件</button>
        )}
      </div>
      {!readOnly && (
        <input ref={inputRef} type="file" multiple accept={imageOnly ? "image/*" : undefined} className="bt-hidden-input"
          onChange={(event) => { takeFiles(event.target.files); event.target.value = ""; }} />
      )}
      <div className="bt-attach-expand-resize" onPointerDown={startResize} title="拖动调整大小" />
    </OverlayPopover>
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
  const pickToday = () => { onChange(localDateString(new Date())); setOpen(false); };
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

/** 布尔格：单复选框（字段默认值可选是/否）。 */
function BooleanCell({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  return (
    <label className="bt-bool-cell">
      <input type="checkbox" checked={value === true} disabled={readOnly} aria-label="布尔值"
        onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/** 链接格：URL 文本可编辑 + ↗ 用**系统浏览器**打开（桌面 window.open → 主进程 shell.openExternal）。 */
function LinkCell({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const text = typeof value === "string" ? value : "";
  const openable = /^https?:\/\//i.test(text.trim());
  return (
    <span className="bt-link-cell">
      <input className="bt-cell-input" value={text} readOnly={readOnly} placeholder="https://" aria-label="链接"
        onChange={(event) => onChange(event.target.value)} />
      {openable && (
        <button type="button" className="bt-link-open" title="用系统浏览器打开" aria-label="打开链接"
          onClick={(event) => { event.stopPropagation(); window.open(text.trim(), "_blank", "noopener"); }}>
          <ExternalLink size={13} />
        </button>
      )}
    </span>
  );
}

/** 评分：固定 5 星；再点当前星级 = 清零（对齐云端）。 */
function RatingCell({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const current = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(value))) : 0;
  return (
    <span className="bt-rating" role="radiogroup" aria-label="评分">
      {Array.from({ length: BITABLE_RATING_MAX }, (_, index) => (
        <button key={index} type="button" role="radio" aria-checked={index + 1 === current} aria-label={(index + 1) + " 星"}
          className={"bt-star" + (index < current ? " is-on" : "")} disabled={readOnly}
          onClick={(event) => { event.stopPropagation(); onChange(current === index + 1 ? 0 : index + 1); }}>
          <Star size={14} fill="currentColor" />
        </button>
      ))}
    </span>
  );
}

/** 进度：0–100 进度条（**可按压拖动**，对齐云端）；只由「条 + 百分比」表达，不再有数值输入框。
 *  鼠标/触摸 = 拖动跟手；键盘 = ←/↓ −1、→/↑ +1、PageUp/Down ±10、Home/End 两端、Delete/Backspace 清空。
 *  颜色取字段配置，缺省主题强调色。 */
function ProgressCell({ field, value, readOnly, onChange }: { field: BitableField; value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const raw = typeof value === "number" ? value : Number(value);
  const pct = Number.isFinite(raw) ? Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(raw))) : 0;
  const color = typeof field.progressColor === "string" ? field.progressColor : undefined;
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const style = { "--bt-progress": pct + "%", ...(color ? { "--bt-progress-color": color } : {}) } as CSSProperties;
  /** 进度条拖动：按下即跟手（点轨道任意处直接跳值），松手结束；只读态不接指针。 */
  const startDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    const track = trackRef.current;
    if (!track) return;
    event.preventDefault();
    event.stopPropagation();
    const apply = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      onChange(Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(((clientX - rect.left) / rect.width) * BITABLE_PROGRESS_MAX))));
    };
    apply(event.clientX);
    const onMove = (ev: PointerEvent) => apply(ev.clientX);
    const onUp = () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
  /** 键盘可达（拖动是鼠标/触摸路径）：按语义键步进；Delete/Backspace 清空（有值 → 空值）。 */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    const step = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1
        : event.key === "PageDown" ? -10
          : event.key === "PageUp" ? 10
            : null;
    let next: number | null = null;
    if (step !== null) next = pct + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = BITABLE_PROGRESS_MAX;
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); onChange(""); return; }
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(next))));
  };
  return (
    <span className="bt-progress-cell">
      <span ref={trackRef} className={"bt-progress" + (readOnly ? " is-readonly" : "")} style={style}
        onPointerDown={startDrag} onKeyDown={onKeyDown} role="slider" tabIndex={readOnly ? -1 : 0}
        aria-label="进度" aria-valuemin={0} aria-valuemax={BITABLE_PROGRESS_MAX} aria-valuenow={pct} aria-valuetext={pct + "%"}
        aria-readonly={readOnly || undefined} title={readOnly ? undefined : "拖动调整进度（←/→ 微调，Delete 清空）"}>
        <span className="bt-progress-bar" />
        <span className="bt-progress-thumb" />
      </span>
      <span className="bt-progress-value">{pct}%</span>
    </span>
  );
}

export interface CellEditorProps {
  field: BitableField;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  onAddOption: (name: string) => void;
  /** 附件 / 图片格子的渲染入口；入参 = 该字段是否只接受图片（image 字段）。 */
  renderAttachment?: (imageOnly: boolean) => ReactNode;
  /** 记录（系统时间字段取值用；表单草稿没有记录时为 undefined）。 */
  record?: BitableRecord;
}

/** 按字段类型分派单元格编辑器（未知类型只读展示、不清空）。 */
export function CellEditor({ field, value, readOnly, onChange, onAddOption, renderAttachment, record }: CellEditorProps) {
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
    case "image":
      return renderAttachment ? <>{renderAttachment(field.type === "image")}</> : <span className="bt-cell-muted">—</span>;
    case "boolean":
      return <BooleanCell value={value} readOnly={readOnly} onChange={onChange} />;
    case "link":
      return <LinkCell value={value} readOnly={readOnly} onChange={onChange} />;
    case "rating":
      return <RatingCell value={value} readOnly={readOnly} onChange={onChange} />;
    case "progress":
      return <ProgressCell field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "createdTime":
    case "updatedTime":
      return <span className="bt-cell-muted">{record ? (bitableFieldText(record, field) || "—") : "—"}</span>;
    case "relation":
      return <span className="bt-cell-relation" title="关联字段 v1 只占位、单元格不可填值">关联（暂不可填）</span>;
    default:
      return <span className="bt-cell-unknown">{bitableDisplayValue(field, value) || "—"}</span>;
  }
}
