/**
 * 多维表单元格与浮层控件（v1）。
 *
 * 设计约束（AGENTS.md §3 #14）：视觉走 --lake-* 令牌 + 本目录 bitableEditor.css，
 * 组件里**不写静态内联样式**；仅浮层定位这类动态坐标用 inline style（与 Sidebar 右键菜单同做法）。
 * 单元格值按 fieldId 存，编辑通过 onChange(value) 回传，由 BitableEditor 统一写 doc。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { Popover as OverlayPopover } from "../../components/ui/Overlay";
import { Popover, isInsideDialog } from "../../components/ui/ColorPalette";
import { BitableRelationPicker } from "./BitableRelationPicker.js";
import { ArrowLeftRight, Calendar, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Clock, Download, Gauge, Hash, HelpCircle, Image as ImageIcon, Link, Link2, Maximize2, Paperclip, Pencil, Plus, Search, Sparkles, SquareCheck, Star, Tags, TextQuote, Type, X } from "lucide-react";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { placePopoverPosition } from "../../hooks/topMenuPosition";
import { extOf, isImageExtension } from "../../core/assetNaming.js";
import { bitableAssetUrl } from "./bitableAssetUrl.js";
import { FileKindIcon } from "./FileKindIcon.js";
import type { AiCellRunState } from "./useAiFieldGeneration.js";
import "./bitableFieldCells.css";
import "./bitableAiField.css";
import "./bitableMarkdown.css";
import "./bitableExpandPreview.css";
import { MarkdownView, markdownToPlainText } from "../../components/ui/markdown/MarkdownView";
import { native } from "../../lib/native.js";
import { ATTACHMENT_GRID, BITABLE_FIELD_TYPES, BITABLE_FIELD_TYPE_LABEL, BITABLE_PROGRESS_MAX, BITABLE_RATING_MAX, BITABLE_STAT_LABEL, aiPromptFieldNames, attachmentGridColumns, bitableAttachments, bitableDisplayValue, bitableFieldText, bitableRecordTitle, computeColumnStat, isKnownFieldType, localDateString, optionChipStyle, relationRecordIds, relationTargetRecords, relationTargetTable, statDisplayText, type BitableAttachment, type BitableDisplayContext, type BitableField, type BitableFieldOption, type BitableRecord, type BitableStatType } from "../../core/bitableDoc.js";
import { readOnlyBoolean, readOnlyLink, readOnlyProgress, readOnlyRating } from "../../core/bitableReadOnly.js";
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
    case "relationOneWay": return <Link2 size={size} />;
    case "relationTwoWay": return <ArrowLeftRight size={size} />;
    case "ai": return <Sparkles size={size} />;
    case "markdown": return <TextQuote size={size} />;
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
        <button type="button" className={"bt-menu-item ln-menu__item" + (unknown === value ? " is-selected" : "")} disabled={disabled} onClick={() => onPick(unknown)}>
          <FieldTypeIcon type={unknown} /><span className="bt-menu-label ln-ellipsis">{unknown}（未知）</span><Check size={14} />
        </button>
      )}
      {BITABLE_FIELD_TYPES.map((type) => (
        <button key={type} type="button" role="option" aria-selected={type === value}
          className={"bt-menu-item ln-menu__item" + (type === value ? " is-selected" : "")} disabled={disabled} onClick={() => onPick(type)}>
          <FieldTypeIcon type={type} /><span className="bt-menu-label ln-ellipsis">{BITABLE_FIELD_TYPE_LABEL[type]}</span>
          {type === value && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}

/**
 * 字段类型**弹出选择器**（编辑字段弹窗用）：触发器只占一行（当前类型图标 + 名称 + ▾），点开才出 2 列网格。
 * 与「新增字段」快捷面板共用同一个 {@link FieldTypeGrid}（单一来源），只是收进浮层、不再在弹窗里撑开一大块版面。
 */
export function FieldTypeSelect({ value, disabled, onPick }: { value: string; disabled?: boolean; onPick: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const label = isKnownFieldType(value) ? BITABLE_FIELD_TYPE_LABEL[value] : value + "（未知）";
  return (
    <div className="bt-select">
      <button ref={anchorRef} type="button" className="bt-select-trigger" aria-expanded={open} aria-haspopup="listbox" disabled={disabled}
        onClick={() => setOpen((v) => !v)}>
        <FieldTypeIcon type={value} />
        <span className="bt-field-name ln-ellipsis">{label}</span>
        <ChevronDown size={14} />
      </button>
      <Popover open={open} anchor={anchorRef.current} onClose={() => setOpen(false)} width={300} align="start">
        <FieldTypeGrid value={value} disabled={disabled} onPick={(picked) => { onPick(picked); setOpen(false); }} />
      </Popover>
    </div>
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

/**
 * hover 名称气泡（用户 260930）——**一个来源**：单元格 chip 与展开面板的文件名共用。
 * 表面用 kit 的 `.ln-tip`、定位用 `usePopoverPosition`（`position: fixed` ⇒ 不被 `.bt-grid-wrap` 的滚动容器裁切）。
 *
 * `whenTruncated`：**有文字**的地方（面板里的文件名）只在**真的被省略**时才弹（用户：「有可能看不全，
 * 也加一个弹窗展示完整名称」）；图标上没有文字、名称只能靠气泡读，所以永远弹。
 */
function useNameTip() {
  const [tip, setTip] = useState<{ name: string; anchor: HTMLElement } | null>(null);
  const { surfaceRef, style } = usePopoverPosition({ open: Boolean(tip), anchor: tip?.anchor ?? null, gap: 6 });
  const show = (name: string, anchor: HTMLElement, whenTruncated = false) => {
    if (whenTruncated && anchor.scrollWidth <= anchor.clientWidth) { setTip(null); return; }
    setTip({ name, anchor });
  };
  const hide = () => setTip(null);
  const surface = tip
    ? <span ref={surfaceRef} className="ln-tip bt-file-tip" style={style ?? undefined} role="tooltip">{tip.name}</span>
    : null;
  return { surface, show, hide };
}

/**
 * 附件值展示（**唯一一套**）：附件字段 = 类型图标、图片字段 = 缩略图，两者都带 hover 名称气泡；
 * 点一下 = 预览本格图片 / 用系统应用打开该文件。
 *
 * 调用方：表格单元格与记录详情/表单的 `AttachmentCell`、**关联字段选择器整表**（用户 260930：
 * 「这两处不是同一套代码吗？能做成一套吗？」⇒ 选择器不再自己养一套「📎 文件名」chip）。
 * **没有删除按钮**：行内格子太窄，删除只在展开面板的卡片上做（点单元格 = 选中并出现「+」）。
 */
export function AttachmentChipList({ noteId, attachments, onOpen, onOpenImages, imageOnly = false }: {
  noteId: string;
  attachments: BitableAttachment[];
  onOpen: (attachment: BitableAttachment) => void;
  /** 点图片：预览**该单元格内**的全部图片（用户 260928：两列图片就是两类，绝不跨列合并）。 */
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
  /**
   * 图片字段 = 缩略图（这个字段的语义就是看图）；**附件字段 = 文档类型图标**（用户 260930：
   * 「附件不展示名称和预览了，直接展示文档类型」）。两种字段共用本组件，靠这个开关分叉。
   */
  imageOnly?: boolean;
}) {
  /** hover 名称气泡：图标上没有文字，名称只能这样看（图 2）。一个 chip 列表共用一个表面。 */
  const tip = useNameTip();
  const chipUrlOf = (file: string) => bitableAssetUrl(noteId, file, ATTACHMENT_CHIP_PX);
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
      {/* hover 名称气泡两种字段**共用**（用户 260930：「图片有一个改动，鼠标放上去展示名称可以和附件一样」）：
          图片格是缩略图、附件格是类型图标，但「鼠标停上去看名称」是同一个交互 ⇒ 同一套实现。 */}
      {attachments.map(({ file, name }) => (
        <div key={file} className={"bt-attachment-chip" + (imageOnly ? "" : " is-icon")}
          /* 名字不常驻（用户 260930：卡片也只出图标/缩略图）⇒ 气泡是唯一能看到名字的地方，永远弹 */
          onMouseEnter={(event) => tip.show(name, event.currentTarget)}
          onMouseLeave={tip.hide}>
          {imageOnly
            ? <img src={chipUrlOf(file)} alt={name} loading="lazy" onClick={() => openByFile(file)} />
            : (
              /* 名称不是丢了、而是挪到 hover 气泡里（`aria-label` 保可读；不再是常驻文字） */
              <button type="button" className="bt-file-chip ln-iconbtn ln-iconbtn--compact" aria-label={name} onClick={() => openByFile(file)}>
                <FileKindIcon name={name} />
              </button>
            )}
        </div>
      ))}
      {tip.surface}
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
    if (readOnly || files.length === 0) return;
    const { accepted, rejected } = splitImageFiles(files, imageOnly);
    setRejectNote(rejected > 0 ? IMAGE_ONLY_HINT + "，已忽略 " + rejected + " 个" : null);
    if (accepted.length > 0) onUpload(accepted);
  };
  const chips = <AttachmentChipList noteId={noteId} attachments={attachments} onOpen={onOpen} onOpenImages={onOpenImages} imageOnly={imageOnly} />;
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
        if (readOnly) return;
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
      {rejectNote && <span className="bt-cell-muted ln-ellipsis" role="status">{rejectNote}</span>}
      {attachments.length === 0 && readOnly && <span className="bt-cell-muted ln-ellipsis">—</span>}
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
  /** 文件名的 hover 全名气泡（与单元格 chip 同一套实现；名字被省略号截掉时才有意义）。 */
  const tip = useNameTip();
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
      // 与其它浮层同一条口径：下方放不下翻上方（贴底的附件格不再被裁）
      setPos(placePopoverPosition(r, { width: window.innerWidth, height: window.innerHeight }, { width: w, height: sizeRef.current.h }, 4, { margin: 8 }));
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
  const thumbOf = (file: string) => bitableAssetUrl(noteId, file, ATTACHMENT_CARD_PX);
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
        {rejectNote && <div className="bt-cell-muted ln-ellipsis" role="status">{rejectNote}</div>}
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
                    <div className="bt-attach-card-file" title="点击预览，按住拖动排序" onClick={() => openByFile(file)}>
                      {/* 附件字段 = 大号**类型图标**（用户 260930）；图片字段仍是缩略图（那个字段就是看图）。 */}
                      {imageOnly
                        ? (isImageExtension(extOf(file))
                          ? <img className="ln-imgfill" src={thumbOf(file)} alt={name} loading="lazy" draggable={false} />
                          : <span className="bt-attach-card-ext">{(extOf(file) || "file").toUpperCase()}</span>)
                        : <span className="bt-attach-card-kind"><FileKindIcon name={name} size={46} /></span>}
                      {!readOnly && (
                        <button type="button" className="bt-attach-card-remove ln-iconbtn ln-iconbtn--compact" aria-label={"移除 " + name} title="删除"
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
                          // 名称可能被省略号截掉（用户 260930）：hover 出**同一个**名称气泡显示全名。
                          // 这里有文字 ⇒ 只在真被截断时才弹（没截断弹出来是同义重复）。
                          <span className="bt-attach-card-name" onClick={() => openByFile(file)}
                            onMouseEnter={(event) => tip.show(name, event.currentTarget, true)}
                            onMouseLeave={tip.hide}>{name}</span>
                        )}
                      {!readOnly && renameFile !== file && (
                        <button type="button" className="bt-attach-card-icon ln-iconbtn ln-iconbtn--compact" title="编辑名称" aria-label={"编辑名称 " + name}
                          onClick={() => setRenameFile(file)}><Pencil size={14} /></button>
                      )}
                      <button type="button" className="bt-attach-card-icon ln-iconbtn ln-iconbtn--compact" title="下载" aria-label={"下载 " + name}
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
      {tip.surface}
    </OverlayPopover>
  );
}

/** 文本单元格：内联编辑 + 右侧「扩大」按钮 → 贴单元格的可拖动/可缩放浮窗展开全文（对齐钉钉式）。 */
/** Picker-only scalar presentation avoids input value trackers; edit/locked-grid copy behaviour stays unchanged. */
function scalarDisplay(text: string) {
  return <span className="bt-cell-input bt-cell-input--display"><span className="ln-ellipsis">{text}</span></span>;
}
function TextCell({ value, readOnly, onChange, readOnlyScalarDisplay }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void; readOnlyScalarDisplay?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return (
    <div className="bt-text-cell">
      {readOnly && readOnlyScalarDisplay ? scalarDisplay(text) :
        <input className="bt-cell-input" value={text} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />}
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

/**
 * 展开浮窗尺寸记忆（261004 用户要求；存本地 localStorage，与「侧栏宽度 / 数据表栏宽」同款做法）：
 * 文本格与 AI/Markdown 格**各记一份**，只记大小、不记位置。键 = lakex-local-notes-v3.bitable-expand-size。
 */
const BT_EXPAND_SIZE_KEY = "lakex-local-notes-v3.bitable-expand-size";
type ExpandRemember = "text" | "md";
function loadExpandSize(kind: ExpandRemember): { w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(BT_EXPAND_SIZE_KEY);
    if (!raw) return null;
    const entry = (JSON.parse(raw) as Record<string, { w?: unknown; h?: unknown } | undefined>)[kind];
    const w = typeof entry?.w === "number" ? entry.w : 0;
    const h = typeof entry?.h === "number" ? entry.h : 0;
    if (w < 240 || h < 160) return null;
    return { w: Math.min(w, Math.max(240, window.innerWidth - 16)), h: Math.min(h, Math.max(160, window.innerHeight - 16)) };
  } catch { return null; }
}
function saveExpandSize(kind: ExpandRemember, size: { w: number; h: number }) {
  try {
    const raw = localStorage.getItem(BT_EXPAND_SIZE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    all[kind] = { w: Math.round(size.w), h: Math.round(size.h) };
    localStorage.setItem(BT_EXPAND_SIZE_KEY, JSON.stringify(all));
  } catch { /* 本地记忆失败不影响功能 */ }
}

/**
 * 贴单元格展开浮窗的**共用壳**（261004 抽出）：定位（贴单元格下方、贴底翻上方）+ 拖拽（头部）+
 * 缩放（右下角）+ 关闭按钮。文本格与 Markdown 格共用同一套几何/交互（单一来源，不再各写一份）。
 */
function ExpandPanel({ anchor, head, body, remember, onClose }: { anchor: HTMLElement; head: ReactNode; body: ReactNode; remember: ExpandRemember; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState(() => loadExpandSize(remember) ?? { w: 400, h: 260 });
  // 定位读**当前**尺寸，但不能把它写进 effect 依赖（拖动缩放会改 size，却不应触发重新定位）。
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useLayoutEffect(() => {
    const fit = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      // 用**真实渲染尺寸**定位，并把尺寸本身收进视口（261006 用户：「单元格展开需要适配边界」）。
      // 旧实现横向只按占位宽 400 夹取，而实际宽度是「记住的尺寸」⇒ 尺寸越宽越往右溢出视口。
      const width = Math.max(240, Math.min(sizeRef.current.w, viewport.width - 16));
      const height = Math.max(160, Math.min(sizeRef.current.h, viewport.height - 16));
      if (width !== sizeRef.current.w || height !== sizeRef.current.h) setSize({ w: width, h: height });
      setPos(placePopoverPosition(anchor.getBoundingClientRect(), viewport, { width, height }, 4, { margin: 8 }));
    };
    fit();
    // 窗口尺寸变化会改变可用边界 ⇒ 重新适配（与 usePopoverPosition 的 resize 同口径）。
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // 只在**打开 / 换锚点**时定位一次：拖动缩放（size 变化）不得重算，否则会把用户拖到的位置弹回锚点默认位（261004 用户实测修复；
    // 该缺陷在 HEAD 的文本格展开浮窗就存在——定位依赖里带了 size.h——抽共用壳时被原样继承到 Markdown / AI 面板）。
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
    // 最新尺寸记在闭包里（不能读 state/ref：pointerup 可能先于这一批渲染到达）
    let next = { ...size };
    const onMove = (ev: PointerEvent) => {
      next = { w: Math.max(240, base.w + (ev.clientX - startX)), h: Math.max(160, base.h + (ev.clientY - startY)) };
      setSize(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      saveExpandSize(remember, next); // 松手即记（拖拽过程不写盘）
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  if (!pos) return null;
  return (
    <OverlayPopover className="bt-text-expand" raised={isInsideDialog(anchor)} onDismiss={onClose} surfaceRef={panelRef} ignoreOutside={(t) => anchor.contains(t)} style={{ left: pos.left, top: pos.top, width: size.w, height: size.h }}>
      <header className="bt-text-expand-head" onPointerDown={startDrag}>
        {head}
        <button type="button" className="bt-icon-btn" aria-label="关闭" title="关闭" onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={14} /></button>
      </header>
      {body}
      <div className="bt-text-expand-resize" onPointerDown={startResize} title="拖动调整大小" />
    </OverlayPopover>
  );
}

/** 文本格展开：贴单元格浮窗（头部「展开编辑」），正文直接改单元格值。 */
function TextExpandPopover({ anchor, value, readOnly, onChange, onClose }: TextExpandPopoverProps) {
  return (
    <ExpandPanel anchor={anchor} remember="text" onClose={onClose}
      head={<span>展开编辑</span>}
      body={<textarea className="bt-text-expand-body" autoFocus value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />}
    />
  );
}

/**
 * Markdown / AI 字段展开：**编辑 / 预览** 双模（对齐钉钉）；只读默认预览。
 * 可写时：**AI 字段默认预览**（用户 261006：AI 结果先看效果，要改再点「编辑」）、Markdown 字段默认编辑。
 */
function MarkdownExpandPopover({ anchor, title, value, readOnly, isAi, onChange, onRegenerate, onClose }: {
  anchor: HTMLElement;
  /** 面板标题（字段名）。 */
  title: string;
  value: string;
  readOnly: boolean;
  /** AI 字段（默认进预览）；Markdown 字段默认进编辑。 */
  isAi: boolean;
  onChange: (value: string) => void;
  /** AI 字段：头部的「重新生成」（Markdown 字段不传）。 */
  onRegenerate?: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">(() => (readOnly || isAi ? "preview" : "edit"));
  return (
    <ExpandPanel anchor={anchor} remember="md" onClose={onClose}
      head={(
        <>
          <span className="bt-md-expand-title ln-ellipsis" title={title}>{title}</span>
          {/* 「编辑 / 预览」= kit 的分段控件原语 ln-segment（原语清单第 13 件）；按钮 = bitable 既有 bt-secondary */}
          <span className="bt-md-expand-actions">
            <span className="ln-segment" role="group" aria-label="编辑或预览">
              <button type="button" className={"ln-segment__item" + (mode === "edit" ? " is-active" : "")}
                disabled={readOnly} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMode("edit")}>编辑</button>
              <button type="button" className={"ln-segment__item" + (mode === "preview" ? " is-active" : "")}
                onPointerDown={(event) => event.stopPropagation()} onClick={() => setMode("preview")}>预览</button>
            </span>
            {onRegenerate && (
              <button type="button" className="bt-secondary" disabled={readOnly}
                onPointerDown={(event) => event.stopPropagation()} onClick={onRegenerate}>
                <Sparkles size={12} />重新生成
              </button>
            )}
          </span>
        </>
      )}
      body={mode === "edit" && !readOnly ? (
        <textarea className="bt-text-expand-body bt-md-expand-editor" autoFocus value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <div className="bt-text-expand-body bt-md-expand-preview">
          {value.trim() ? <MarkdownView source={value} /> : <p className="bt-md-expand-empty">（空）</p>}
        </div>
      )}
    />
  );
}

/**
 * Markdown 字段单元格（261004）：单元格 = **去标记的单行预览**（行高不变、截断）；
 * 悬停「展开」→ 编辑/预览浮窗（只读时只能预览）。**AI 字段复用本组件**（另传 onRegenerate）。
 */
export function MarkdownCell({ field, value, readOnly, onChange, onRegenerate }: {
  field: BitableField;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  /** AI 字段：展开面板头部的「重新生成」（Markdown 字段不传）。 */
  onRegenerate?: () => void;
}) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const preview = markdownToPlainText(text);
  return (
    <div className="bt-md-cell">
      <span className="bt-md-cell-preview ln-ellipsis" title={preview || undefined}>{preview || "—"}</span>
      <button
        type="button"
        className="bt-expand-btn"
        title="展开（编辑 / 预览）"
        aria-label="展开编辑与预览"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget); }}
      >
        <Maximize2 size={12} />
      </button>
      {anchor && (
        <MarkdownExpandPopover anchor={anchor} title={field.name} value={text} readOnly={readOnly}
          isAi={field.type === "ai"} onChange={(next) => onChange(next)} onRegenerate={onRegenerate} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}




/** 261008：统一选色盘 + 锚定浮层原语移到了共用组件；这里 re-export 保持既有调用点不变。 */
export { ColorPalette, Popover } from "../../components/ui/ColorPalette";

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
  const menuId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    const onOtherOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== menuId) setOpen(false);
    };
    window.addEventListener("bt-select-menu-open", onOtherOpen);
    return () => window.removeEventListener("bt-select-menu-open", onOtherOpen);
  }, [menuId]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target) || target.closest(`[data-select-menu-id="${menuId}"]`)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuId, open]);
  return (
    <div ref={rootRef} className="bt-select">
      <button ref={anchorRef} type="button" className="bt-select-trigger" aria-expanded={open} disabled={disabled}
        onClick={() => {
          const next = !open;
          if (next) window.dispatchEvent(new CustomEvent("bt-select-menu-open", { detail: menuId }));
          setOpen(next);
        }}>
        <span className={current ? undefined : "bt-select-placeholder"}>{current ? current.label : (value || placeholder || "")}</span><ChevronDown size={14} />
      </button>
      <Popover open={open} anchor={anchorRef.current} onClose={() => setOpen(false)} width={260} align="start">
        <div className="bt-panel" data-select-menu-id={menuId}>
          {options.map((option) => (
            <button key={option.value} type="button" className={"bt-menu-item ln-menu__item" + (option.value === value ? " is-selected" : "")}
              onClick={() => { onChange(option.value); setOpen(false); }}>
              <span className="bt-menu-label ln-ellipsis">{option.label}</span>
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
  const fmt = (d: number) => localDateString(new Date(year, month, d));
  const pickToday = () => { onChange(localDateString(new Date())); setOpen(false); };
  return (
    <div className="bt-date-cell">
      <button ref={anchorRef} type="button" className={"bt-date-trigger" + (text ? "" : " is-empty")} disabled={readOnly} onClick={() => setOpen((v) => !v)}>
        <span className="ln-ellipsis">{text || "请选择日期"}</span><Calendar size={13} />
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
      <input type="checkbox" checked={readOnlyBoolean(value) === true} disabled={readOnly} aria-label="布尔值"
        onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/** 链接格：URL 文本可编辑 + ↗ 用**系统浏览器**打开（桌面 window.open → 主进程 shell.openExternal）。 */
/**
 * 链接格（260929 对齐云端）：格子**展示文本**、右端一枚 🔗 图标；点图标用**本地浏览器**打开；
 * 双击格子进入编辑（输入 URL，Enter/失焦提交、Esc 取消）。
 *
 * 刻意**不做常驻输入框**：常驻输入框在选中时 `:focus` 的 2px 焦点环会和单元格自己的 2px 选中环
 * 叠成「两层边框」（用户 260929 报的就是这个）；另外空值时会一直显示 `https://` 占位，看着像输入框而不像值。
 */
function LinkCell({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const { text, href: openHref } = readOnlyLink(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const openable = openHref !== null;
  const commit = () => { onChange(draft.trim()); setEditing(false); };
  if (editing && !readOnly) {
    return (
      <span className="bt-link-cell">
        <input className="bt-cell-input" autoFocus value={draft} placeholder="https://" aria-label="链接"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commit(); }
            if (event.key === "Escape") { event.stopPropagation(); setDraft(text); setEditing(false); }
          }} />
      </span>
    );
  }
  return (
    <span className="bt-link-cell"
      onDoubleClick={() => { if (!readOnly) { setDraft(text); setEditing(true); } }}>
      <span className="bt-link-text ln-ellipsis" title={text || undefined}>{text}</span>
      {openable && (
        <button type="button" className="bt-link-open" title="用系统浏览器打开" aria-label="打开链接"
          onClick={(event) => { event.stopPropagation(); window.open(text.trim(), "_blank", "noopener"); }}>
          <Link2 size={13} />
        </button>
      )}
    </span>
  );
}

/**
 * 列统计格（**分组头与底部汇总行共用**，对齐云端 chip）：白底 + 1px 极浅边框 + 内容右对齐 + ▾。
 * 未配置统计时内容 **opacity:0，仅 hover 显形**（云端口径：默认空白、不打扰，也不出现「统计」字样）；
 * 点它打开该列的汇总方式选择器（选项严格按字段类型，来自 `statsForField`）。
 */
export function StatCell({ field, records, stat, readOnly, onPick }: {
  field: BitableField;
  records: BitableRecord[];
  stat?: BitableStatType;
  readOnly: boolean;
  onPick: (anchor: HTMLElement) => void;
}) {
  return (
    <button type="button" className={"bt-stat" + (stat ? " has-stat" : "")} disabled={readOnly}
      title={stat ? BITABLE_STAT_LABEL[stat] : "选择汇总方式"}
      onClick={(event) => { event.stopPropagation(); onPick(event.currentTarget); }}>
      <span className="bt-stat-text ln-ellipsis">{stat ? statDisplayText(stat, computeColumnStat(field, records, stat)) : "统计"}</span>
      <ChevronDown size={12} className="bt-stat-caret" />
    </button>
  );
}

/** 评分：固定 5 星；再点当前星级 = 清零（对齐云端）。 */
function RatingCell({ value, readOnly, onChange }: { value: unknown; readOnly: boolean; onChange: (value: unknown) => void }) {
  const current = readOnlyRating(value);
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
  const pct = readOnlyProgress(value);
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
  /** Relation picker has display-only text/numbers, not hundreds of focusable readonly inputs. */
  readOnlyScalarDisplay?: boolean;
  field: BitableField;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  onAddOption: (name: string) => void;
  /** 附件 / 图片格子的渲染入口；入参 = 该字段是否只接受图片（image 字段）。 */
  renderAttachment?: (imageOnly: boolean) => ReactNode;
  /** 记录（系统时间字段取值用；表单草稿没有记录时为 undefined）。 */
  record?: BitableRecord;
  /** 关联解析上下文（同一文档的 tables）；关联字段展示必需，其余字段忽略。 */
  ctx?: BitableDisplayContext;
  /** 关联字段：所在文档 id（选择器里渲染图片缩略图要拼资源 URL；缺省时选择器退化为纯文本）。 */
  noteId?: string;
  /** 关联字段：点选择器里的缩略图 → 预览**该单元格**的图片（与表格/画册同一条 Lightbox）。 */
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
  /** AI 字段：该格的运行态（生成中 / 失败）；缺省 = 空闲（有值或空值）。 */
  aiState?: AiCellRunState;
  /** AI 字段：请求生成 / 重新生成；缺省时该格只展示快照文本（记录详情 / 表单 / 关联选择器等入口）。 */
  onAiGenerate?: () => void;
  /** AI 字段：停止**本格**正在进行的生成（用户 261008）；缺省时「生成中」只作状态展示。 */
  onAiStop?: () => void;
}

/**
 * 关联单元格：展示目标记录**主字段**的紧凑 chip；点开是**全局大弹窗**（BitableRelationPicker）：
 * 两个 tab（所有可关联记录 / 已选 N 条）+ 搜索 + 筛选/排序 + 目标表整表；**没有「添加记录」**（用户 260929）。
 * 值只存目标记录 id，**选择器只改本机草稿、点「确认」才写正文**（取消 / 搜索 / 重复选择都不落盘）。
 * 目标记录 / 目标表已删 → 失效占位，内部 id 原样保留（恢复后自动重现，不级联删字段）。
 */
export function RelationCell({ field, value, readOnly, ctx, onChange, noteId, onOpenImages }: {
  field: BitableField;
  value: unknown;
  readOnly: boolean;
  ctx?: BitableDisplayContext;
  onChange: (value: unknown) => void;
  noteId?: string;
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const target = relationTargetTable(ctx, field);
  const committed = relationRecordIds(value);
  /** 目标表被删 / 未配置：没有任何可编辑入口，只留失效或空占位。 */
  if (!target) {
    return <span className="bt-cell-relation ln-ellipsis" title="关联的目标数据表不存在（关联 id 仍保留）">{committed.length > 0 ? "关联已失效" : "—"}</span>;
  }
  const titleOf = (record: BitableRecord) => bitableRecordTitle(target, record, ctx);
  return (
    <div className="bt-option-cell">
      <button type="button" className={"bt-option-trigger" + (committed.length ? "" : " is-empty")}
        disabled={readOnly} aria-haspopup="dialog" aria-expanded={open}
        title={readOnly ? "关联记录（只读）" : "点击选择关联记录"}
        onClick={() => setOpen(true)}>
        <span className="bt-option-label">
          {relationTargetRecords(ctx, field, value).map((record) => <span key={record.id} className="bt-option-chip" title={titleOf(record)}>{titleOf(record)}</span>)}
          {committed.length === 0 && <span className="bt-option-placeholder">请选择</span>}
        </span>
        <ChevronDown size={12} className="bt-option-caret" />
      </button>
      {open && (
        <BitableRelationPicker field={field} value={value} ctx={ctx} noteId={noteId} onOpenImages={onOpenImages}
          onCancel={() => setOpen(false)}
          onConfirm={(ids) => { onChange(ids); setOpen(false); }} />
      )}
    </div>
  );
}

/**
 * AI 字段单元格（261003；261004 起按 **Markdown** 口径）：值 = 文本快照。
 * - 未配置（命令里没有字段变量）→ 提示去「编辑列」配置；
 * - 空值 → 「AI 生成」按钮；生成中 → 状态；失败 → 重试；
 * - 有值 → 复用 {@link MarkdownCell}（单行预览 +「展开」编辑/预览；面板头部带「重新生成」，可手动编辑）。
 * 只读 / 没有生成回调（记录详情、表单、关联选择器、历史快照）→ 只展示预览。
 */
export function AiFieldCell({ field, value, readOnly, state, onGenerate, onStop, onChange }: {
  field: BitableField;
  value: unknown;
  readOnly: boolean;
  state?: AiCellRunState;
  onGenerate?: () => void;
  /** 停止本格生成（用户 261008）：给了才在「生成中」旁出「停止」。 */
  onStop?: () => void;
  /** 手动编辑（展开面板里改完写回；与 MD 字段同一路径）。 */
  onChange: (value: unknown) => void;
}) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const configured = aiPromptFieldNames(field.ai?.prompt ?? "").length > 0;
  const canGenerate = !readOnly && Boolean(onGenerate) && configured;
  if (!configured) {
    return <span className="bt-cell-ai is-unconfigured ln-ellipsis" title="AI 字段未配置完整：请在「编辑列」里写命令，并用「插入字段」加入字段变量">未配置</span>;
  }
  if (state?.status === "running") {
    // 「生成中」旁边给「停止」（用户 261008）：语义 = 只停这一格，按完回到「AI 生成 / 重新生成」。
    // 视觉复用既有的 .bt-cell-ai-action（无新增 CSS）。
    return (
      <span className="bt-cell-ai is-running" aria-label="生成中">
        <span className="bt-cell-ai-dot" aria-hidden />生成中…
        {onStop && <button type="button" className="bt-cell-ai-action" title="停止本次生成" onClick={onStop}>停止</button>}
      </span>
    );
  }
  if (state?.status === "failed") {
    if (!canGenerate) return <span className="bt-cell-ai is-failed" title={state.error ?? "生成失败"}>生成失败</span>;
    return <button type="button" className="bt-cell-ai-action" title={state.error ?? "生成失败"} onClick={onGenerate}>生成失败，重试</button>;
  }
  if (!text) {
    if (!canGenerate) return <span className="bt-cell-ai is-empty">—</span>;
    return <button type="button" className="bt-cell-ai-action" title="按字段里配置的命令生成" onClick={onGenerate}><Sparkles size={13} />AI 生成</button>;
  }
  return <MarkdownCell field={field} value={value} readOnly={readOnly} onChange={onChange} onRegenerate={canGenerate ? onGenerate : undefined} />;
}

/** 按字段类型分派单元格编辑器（未知类型只读展示、不清空）。 */
export function CellEditor({ field, value, readOnly, readOnlyScalarDisplay, onChange, onAddOption, renderAttachment, record, ctx, noteId, onOpenImages, aiState, onAiGenerate, onAiStop }: CellEditorProps) {
  if (!isKnownFieldType(field.type)) {
    return <span className="bt-cell-unknown ln-ellipsis" title="未知字段类型（只读展示）">{bitableDisplayValue(field, value) || "—"}</span>;
  }
  switch (field.type) {
    case "text":
      return <TextCell value={value} readOnly={readOnly} onChange={onChange} readOnlyScalarDisplay={readOnlyScalarDisplay} />;
    case "number":
      if (readOnly && readOnlyScalarDisplay) return scalarDisplay(value == null || value === "" ? "" : String(value));
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
      return renderAttachment ? <>{renderAttachment(field.type === "image")}</> : <span className="bt-cell-muted ln-ellipsis">—</span>;
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
      return <span className="bt-cell-muted ln-ellipsis">{record ? (bitableFieldText(record, field, ctx) || "—") : "—"}</span>;
    case "relationOneWay":
    case "relationTwoWay":
      return <RelationCell field={field} value={value} readOnly={readOnly} ctx={ctx} onChange={onChange}
        noteId={noteId} onOpenImages={onOpenImages} />;
    case "ai":
      return <AiFieldCell field={field} value={value} readOnly={readOnly} state={aiState} onGenerate={onAiGenerate} onStop={onAiStop} onChange={onChange} />;
    case "markdown":
      return <MarkdownCell field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    default:
      return <span className="bt-cell-unknown ln-ellipsis">{bitableDisplayValue(field, value) || "—"}</span>;
  }
}
