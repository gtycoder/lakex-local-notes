/**
 * 移动端表格 chrome 组件（261020 P1）：公式栏 / 一级 dock / 底部面板 / 页签缩放栏 / 阅读态轻工具条。
 *
 * - 视觉复用移动端文档 dock 的原语（**.med-f-* 面板卡片/按钮**，见 editor-dock.css；该文件由
 *   mobile/main.tsx 全局引入，本页一定有）与 kit 令牌；
 * - 面板外壳照文档 `.med-panel / .med-panel-inner` 的口径：**固定占键盘区高度**、内容在内部滚动（多则滚、少则留白）；
 * - 本文件只负责"长什么样、点了回调谁"，动作语义在 MobileUsheetViewer（走 Univer facade）；
 * - 数据/清单全部来自 usheetChromeModel（单一来源），组件内不写第二份。
 */
import {
  ChevronDown, List, Minus, MoreHorizontal, Plus, Redo2, Undo2, Bold as BoldIcon, X,
  Italic, Underline, Strikethrough, Eraser, Keyboard, KeyboardOff, AlignLeft, AlignCenter, AlignRight,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  USHEET_DOCK, USHEET_FILL_COLORS, USHEET_FILL_SOLID, USHEET_FONT_SIZES, USHEET_INSERT_GROUPS,
  USHEET_MORE_GROUPS, USHEET_NUMFMT_ITEMS, USHEET_TEXT_COLORS, type UsheetPanelId,
} from "./usheetChromeModel";

export interface UsheetSheetTab {
  id: string;
  name: string;
}

/** 顶部公式栏：地址（40 宽）+ 显示值；21px，与表格网格同一行高节奏。 */
export function UsheetFormulaBar({ address, value }: { address: string; value: string }) {
  return (
    <div className="ush-formula" data-prevent-swipe aria-label="公式栏">
      <span className="ush-formula__ref">{address}</span>
      <span className="ush-formula__value">{value}</span>
    </div>
  );
}

export interface UsheetDockProps {
  activePanel: UsheetPanelId | null;
  /** 软键盘是否弹起（⌨ 键双态图标：开着 = 收起，关着 = 展开）。 */
  keyboardOpen: boolean;
  boldActive: boolean;
  numfmtLabel: string;
  canUndo: boolean;
  canRedo: boolean;
  onPanel: (panel: UsheetPanelId) => void;
  onBold: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onKeyboard: () => void;
}

/** 一级 dock：与文档 dock 同尺寸（49×44 / 图标 20 / 固定 ⌨ 尾键）；展开的类别键变 ×（文档同款）。 */
export function UsheetDock({ activePanel, keyboardOpen, boldActive, numfmtLabel, canUndo, canRedo, onPanel, onBold, onUndo, onRedo, onKeyboard }: UsheetDockProps) {
  return (
    <div className="ush-dock" data-prevent-swipe role="toolbar" aria-label="表格工具">
      <div className="ush-dock__scroll">
        {USHEET_DOCK.map((item) => {
          const isPanelOpen = item.kind === "panel" && activePanel === item.panel;
          const isActive = isPanelOpen || (item.action === "bold" && boldActive);
          const disabled = (item.action === "undo" && !canUndo) || (item.action === "redo" && !canRedo);
          // 展开态 = ×（与文档 dock 的 ＋/Aa/⋯ 一致）：再点一次 = 关面板并放回键盘
          const content: ReactNode = isPanelOpen
            ? <X size={21} />
            : item.text
              ? <span className={"ush-dock__text" + (item.id === "numfmt" ? " ush-dock__text--numfmt" : "")}>{item.id === "numfmt" ? numfmtLabel : item.text}</span>
              : item.action === "bold" ? <BoldIcon size={20} /> : item.action === "undo" ? <Undo2 size={20} /> : item.action === "redo" ? <Redo2 size={20} /> : item.id === "insert" ? <Plus size={21} /> : <MoreHorizontal size={21} />;
          return (
            <button
              key={item.id}
              type="button"
              className={"ush-dock__btn" + (isActive ? " is-active" : "") + (item.text ? " is-text" : "")}
              aria-label={item.label}
              aria-pressed={item.kind === "panel" ? isPanelOpen : undefined}
              disabled={disabled}
              onClick={() => {
                if (item.kind === "panel" && item.panel) onPanel(item.panel);
                else if (item.action === "bold") onBold();
                else if (item.action === "undo") onUndo();
                else if (item.action === "redo") onRedo();
              }}
            >{content}</button>
          );
        })}
      </div>
      <button type="button" className="ush-dock__btn ush-dock__btn--kb" aria-label={keyboardOpen ? "收起键盘" : "展开键盘"} onClick={onKeyboard}>
        {keyboardOpen ? <KeyboardOff size={21} /> : <Keyboard size={21} />}
      </button>
    </div>
  );
}

export interface UsheetPanelProps {
  panel: UsheetPanelId;
  /** 面板高度 = 捕获的键盘区高度（固定；内容多则内部滚，少则下方留白）。 */
  height: number;
  /** 是否展开中（收起过渡期为 false：内容播滑出/或被键盘盖住）。 */
  open: boolean;
  /** 收起过渡期（不再接受点击，避免误触到正在退场的面板）。 */
  closing: boolean;
  boldActive: boolean;
  italicActive: boolean;
  underlineActive: boolean;
  strikeActive: boolean;
  align: "left" | "center" | "right" | "general";
  fontSize: number | null;
  numfmtPattern: string;
  onAction: (id: string) => void;
}

/** 每行最多几项：412 宽下再多的中文标签就会被省略号吃掉（实测 9 项一行只剩「常…」）。 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** 一行卡片（**.med-f-row / .med-f-card**：与文档 Aa 面板同一套几何，卡宽按条目数分配）。 */
function PanelRow({ children }: { children: ReactNode }) {
  return (
    <div className="med-f-row">
      <div className="med-f-card" data-count={Array.isArray(children) ? children.length : undefined}>{children}</div>
    </div>
  );
}

/** 面板条目（**.med-f-btn**；生效态 = .med-f-on，与文档 Aa 面板同一口径）。 */
function PanelButton({ id, label, active, onAction, glyph }: { id: string; label: string; active?: boolean; onAction: (id: string) => void; glyph?: ReactNode }) {
  return (
    <button type="button" className={"med-f-btn" + (active ? " med-f-on" : "")} onClick={() => onAction(id)} aria-label={label} title={label}>
      {glyph ?? <span className="med-f-label">{label}</span>}
    </button>
  );
}

/** 面板外壳：`.ush-panel`（定高、不滚）+ `.ush-panel__inner`（内部滚动），口径同文档 `.med-panel`。 */
function PanelShell({ label, height, open, closing, children }: { label: string; height: number; open: boolean; closing: boolean; children: ReactNode }) {
  const style: CSSProperties | undefined = height > 0 ? { height } : undefined;
  return (
    <div className="ush-panel" data-prevent-swipe aria-label={label} style={style} data-open={open ? "1" : "0"} data-closing={closing ? "1" : undefined}>
      <div className="ush-panel__inner">{children}</div>
    </div>
  );
}

/** 二级面板（底部，内容复用文档 dock 的 .med-f-* 原语）。 */
export function UsheetPanel({ panel, height, open, closing, boldActive, italicActive, underlineActive, strikeActive, align, fontSize, numfmtPattern, onAction }: UsheetPanelProps) {
  if (panel === "font") {
    return (
      <PanelShell label="文字格式" height={height} open={open} closing={closing}>
        <PanelRow>
          <PanelButton id="bold" label="加粗" active={boldActive} onAction={onAction} glyph={<BoldIcon size={20} />} />
          <PanelButton id="italic" label="斜体" active={italicActive} onAction={onAction} glyph={<Italic size={20} />} />
          <PanelButton id="underline" label="下划线" active={underlineActive} onAction={onAction} glyph={<Underline size={20} />} />
          <PanelButton id="strike" label="删除线" active={strikeActive} onAction={onAction} glyph={<Strikethrough size={20} />} />
          <PanelButton id="clear-text" label="清除文字格式" onAction={onAction} glyph={<Eraser size={20} />} />
        </PanelRow>
        <PanelRow>
          <PanelButton id="align-left" label="左对齐" active={align === "left"} onAction={onAction} glyph={<AlignLeft size={20} />} />
          <PanelButton id="align-center" label="居中对齐" active={align === "center"} onAction={onAction} glyph={<AlignCenter size={20} />} />
          <PanelButton id="align-right" label="右对齐" active={align === "right"} onAction={onAction} glyph={<AlignRight size={20} />} />
        </PanelRow>
        {/* 字色 / 底色两行**不写标签**：与文档 Aa 面板一致（用户 261020：去掉这两处说明） */}
        <div className="med-f-row">
          <div className="med-f-card med-f-colors" data-count={USHEET_TEXT_COLORS.length + 1}>
            <button type="button" className="med-f-btn med-f-a" onClick={() => onAction("font-default")} aria-label="默认颜色" title="默认颜色">A</button>
            {USHEET_TEXT_COLORS.map((color) => (
              <button key={color} type="button" className="med-f-btn med-f-a" style={{ color }} onClick={() => onAction("font-" + color)} aria-label={"字色 " + color} title={"字色 " + color}>A</button>
            ))}
          </div>
        </div>
        <div className="med-f-row">
          <div className="med-f-card med-f-board">
            <div className="med-f-board-row">
              <button type="button" className="med-f-sw med-f-sw--none" onClick={() => onAction("fill-none")} aria-label="无填充" title="无填充" />
              {USHEET_FILL_COLORS.map((color) => (
                <button key={color} type="button" className="med-f-sw" style={{ background: color }} onClick={() => onAction("fill-" + color)} aria-label={"底色 " + color} title={"底色 " + color} />
              ))}
            </div>
            <div className="med-f-board-row">
              {USHEET_FILL_SOLID.map((color) => (
                <button key={color} type="button" className="med-f-sw" style={{ background: color }} onClick={() => onAction("fill-" + color)} aria-label={"底色 " + color} title={"底色 " + color} />
              ))}
            </div>
          </div>
        </div>
        {/* 字号放最底部：与文档 Aa 面板逐行同序（用户 261020 定）。 */}
        <div className="ush-panel__label">字号</div>
        <div className="med-f-row">
          <div className="med-f-card med-f-sizes" data-count={USHEET_FONT_SIZES.length}>
            {USHEET_FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={"med-f-btn" + (fontSize === size ? " med-f-on" : "")}
                aria-label={size + "px"}
                title={size + "px"}
                onClick={() => onAction("fontsize-" + size)}
              >{size}</button>
            ))}
          </div>
        </div>
      </PanelShell>
    );
  }
  if (panel === "numfmt") {
    return (
      <PanelShell label="数字格式" height={height} open={open} closing={closing}>
        <div className="ush-panel__label">数字格式</div>
        {chunk(USHEET_NUMFMT_ITEMS, 5).map((row) => (
          <PanelRow key={row[0].id}>
            {row.map((option) => (
              <PanelButton key={option.id} id={option.id} label={option.label} active={option.pattern === numfmtPattern} onAction={onAction} />
            ))}
          </PanelRow>
        ))}
        <div className="ush-panel__label">小数位</div>
        <PanelRow>
          <PanelButton id="decimal-dec" label="减少小数位" onAction={onAction} glyph={<span className="med-f-glyph">.0 −</span>} />
          <PanelButton id="decimal-inc" label="增加小数位" onAction={onAction} glyph={<span className="med-f-glyph">.0 +</span>} />
        </PanelRow>
      </PanelShell>
    );
  }
  if (panel === "insert") {
    return (
      <PanelShell label="插入" height={height} open={open} closing={closing}>
        {USHEET_INSERT_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="ush-panel__label">{group.label}</div>
            <PanelRow>
              {group.items.map((item) => <PanelButton key={item.id} id={item.id} label={item.label} onAction={onAction} />)}
            </PanelRow>
          </div>
        ))}
      </PanelShell>
    );
  }
  return (
    <PanelShell label="更多" height={height} open={open} closing={closing}>
      {USHEET_MORE_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="ush-panel__label">{group.label}</div>
          {chunk(group.items, 3).map((row) => (
            <PanelRow key={row[0].id}>
              {row.map((item) => <PanelButton key={item.id} id={item.id} label={item.label} onAction={onAction} />)}
            </PanelRow>
          ))}
        </div>
      ))}
    </PanelShell>
  );
}

export interface UsheetFooterProps {
  sheets: readonly UsheetSheetTab[];
  activeSheetId: string | null;
  zoomRatio: number;
  onSelectSheet: (sheetId: string) => void;
  onOpenSheetMenu: () => void;
  onZoom: (delta: number) => void;
}

/** 底部页签/缩放栏（32px）。 */
export function UsheetFooter({ sheets, activeSheetId, zoomRatio, onSelectSheet, onOpenSheetMenu, onZoom }: UsheetFooterProps) {
  return (
    <div className="ush-footer" data-prevent-swipe>
      <button type="button" className="ush-sheetmenu" aria-label="工作表" onClick={onOpenSheetMenu}><List size={16} /></button>
      <div className="ush-tabs" role="tablist" aria-label="工作表">
        {sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={sheet.id === activeSheetId}
            className={"ush-tab" + (sheet.id === activeSheetId ? " is-active" : "")}
            onClick={() => onSelectSheet(sheet.id)}
          >{sheet.name}{sheet.id === activeSheetId ? <ChevronDown size={12} /> : null}</button>
        ))}
      </div>
      <div className="ush-zoom" role="group" aria-label="缩放">
        <button type="button" className="ush-zoom__btn" aria-label="缩小" onClick={() => onZoom(-0.1)}><Minus size={16} /></button>
        <button type="button" className="ush-zoom__ratio" aria-label="重置缩放" onClick={() => onZoom(0)}>{Math.round(zoomRatio * 100)}%</button>
        <button type="button" className="ush-zoom__btn" aria-label="放大" onClick={() => onZoom(0.1)}><Plus size={16} /></button>
      </div>
    </div>
  );
}

export interface UsheetReadingBarProps {
  sheetName: string;
  zoomRatio: number;
  onOpenSheetMenu: () => void;
  onZoom: (delta: number) => void;
}

/** 阅读态轻工具条（40px，先只做工作表入口 + 缩放；用户 261020：先保留一条看观感）。 */
export function UsheetReadingBar({ sheetName, zoomRatio, onOpenSheetMenu, onZoom }: UsheetReadingBarProps) {
  return (
    <div className="ush-reading-bar" data-prevent-swipe role="toolbar" aria-label="表格阅读工具">
      <button type="button" className="ush-reading-bar__sheet" onClick={onOpenSheetMenu}>
        <List size={16} /><span className="mb-ellipsis">{sheetName}</span><ChevronDown size={12} />
      </button>
      <div className="ush-zoom" role="group" aria-label="缩放">
        <button type="button" className="ush-zoom__btn" aria-label="缩小" onClick={() => onZoom(-0.1)}><Minus size={16} /></button>
        <button type="button" className="ush-zoom__ratio" aria-label="重置缩放" onClick={() => onZoom(0)}>{Math.round(zoomRatio * 100)}%</button>
        <button type="button" className="ush-zoom__btn" aria-label="放大" onClick={() => onZoom(0.1)}><Plus size={16} /></button>
      </div>
    </div>
  );
}
