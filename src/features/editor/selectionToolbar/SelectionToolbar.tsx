/**
 * 桌面编辑态「浮动工具栏」（选区气泡）——两种形态：
 *   · 文字选区（对齐内核固定工具栏的 Lake 风格，顺序 260924 用户定）：
 *     清除格式 · 段落样式(H1–6) · 字号 · 加粗 · 倾斜 · 中划线 · 下划线 · 文字颜色 · 背景色 · 转为 · 超链接
 *   · 图片选中：裁剪 / 旋转 / 宽高 / 链接 / 描述 / 对齐 / 样式 / 边距 / 批量应用 / 复制 / 下载 / 删除
 *
 * 规则：
 *   - 组件自研、能力全走内核：文字用 execCommand/queryCommandValue，图片用 updateImageData/
 *     cardBatchApply/deleteCard + 卡 UI setCro（原生能力），不自实现富文本或图片逻辑。
 *   - 文字形态复用内核固定工具栏的类名与图标 sprite（ant-btn / ne-ui-toolbar-* / ne-icon-*），
 *     不用第三方（钉钉）风格；active 态用内核的 .checked 类。
 *   - 容器 onMouseDown preventDefault：点按钮不丢选区；定位自算 + 避开固定工具栏；表格/代码块内不出现。
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { reportNativeActionError } from "../../../lib/nativeErrors";
import { native } from "../../../lib/native";
import { FONT_SIZE_OPTIONS, PARAGRAPH_STYLES, TOOLBAR_BLOCK_ITEMS } from "../editorCommands";
import type { LakeEditorInstance } from "../lakeRuntime";
import { IMAGE_STYLE_OPTIONS, enterImageCrop, readImageMeta, setImageSpacing } from "./imageCardOps";
import {
  IconImageAlign, IconImageBatch, IconImageCrop, IconImageLink, IconImageRotate,
  IconImageSize, IconImageSpacing, IconImageStyle, IconImageTitle,
} from "./imageIcons";
import { KCheckbox, KEmbedIcon, KIcon, KLinkEditor, KSwitch, KToolbarButton, kernelHotkey, useHoverTip } from "./kernelUiAtoms";
import { LakeColorBoard } from "./LakeColorBoard";
import {
  currentColor, normalTextColor, paletteDefaultValue, persistentColor, rememberColor, type ColorVariant,
} from "./colorMemory";
import { colorApplyCommand, computeToolbarPosition, imageSizeWidth, parseAssetRef, TOOLBAR_MARGIN } from "./selectionToolbarModel";
import { useSelectionToolbar, type ImageTarget } from "./useSelectionToolbar";

/** 链接合法性（首版，对齐固定栏「请输入正确的链接」）：有 scheme（http/https/mailto/tel）、以 / 或 # 开头，或形如域名。 */
function isValidLink(value: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value) || /^[^\s]+\.[^\s]+/.test(value);
}

/**
 * 内核原子件：图标/按钮/Select 一律直接调内核 FrameworkUiLib（见 ./kernelUiAtoms）。
 * 这里只保留内核原语覆盖不到的两件——颜色分裂按钮与自锚定菜单。
 */

/**
 * 内核颜色分裂按钮：本体（直接应用当前色）+ 独立三角区（开面板）——与固定栏同款两件事。
 * 图标用内核 EmbedIcon（动态下划线 = 当前色），不做成「两处都开面板」。
 */
function KColorButton({ label, variant, color, active, hotkey, onApply, onOpen }: {
  label: string; variant: ColorVariant; color: string; active?: boolean; hotkey?: string;
  onApply: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <span className="selection-toolbar__colorbtn">
      <KToolbarButton name="color" checked={active} className="ne-ui-toolbar-color-show-button" title={label} hotkey={hotkey} onClick={onApply}>
        <KEmbedIcon variant={variant} color={color} />
      </KToolbarButton>
      <KToolbarButton name="colorDropdown" caret caretClass="ne-ui-toolbar-color-dropdown-arrow" className="ne-ui-toolbar-color-dropdown-button ant-dropdown-trigger" title={label} hotkey={hotkey} onClick={onOpen} />
    </span>
  );
}

/** 内核下拉菜单（ant-dropdown-menu + ne-ui-select-*），与固定工具栏一致。 */
function KMenu({ menu, children }: { menu: string; children: ReactNode }) {
  return (
    // 字号菜单额外挂内核的 dropdown 类，让 .ne-ui-toolbar-fontsize-dropdown 规则也生效（与固定栏一致）。
    <div className={"selection-toolbar__kmenu" + (menu === "fontsize" ? " ne-ui-toolbar-fontsize-dropdown" : "")} data-menu={menu}>
      <ul className="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light ne-ui-select-menu" role="menu">{children}</ul>
    </div>
  );
}

function KMenuItem({ label, selected, shortcut, labelClass, onClick }: {
  label: string; selected?: boolean; shortcut?: string; labelClass?: string; onClick?: () => void;
}) {
  return (
    <li role="menuitem" className={"ant-dropdown-menu-item ne-ui-select-item" + (selected ? " ant-dropdown-menu-item-selected" : "")} onClick={onClick}>
      <div className="ne-ui-select-item-check-icon">{selected ? <KIcon type="check" /> : null}</div>
      <div className="ne-ui-select-item-label">
        <div className="ne-ui-select-content">
          <span className={labelClass ?? "ne-ui-item-content"}>{label}</span>
          {shortcut ? <span className="ne-ui-command-style">{shortcut}</span> : null}
        </div>
      </div>
    </li>
  );
}

/**
 * 图片浮栏：内核「卡片工具栏」条目（与云端图片工具栏同构、同一套 `.ne-card-toolbar-*` 类，
 * 样式全部来自内核 lakex-doc.css，非我们自造）。hover 说明用 portal 浮层（useHoverTip）。
 */
function CardItem({ tip, className, selected, disabled, onClick, children }: {
  tip: string; className: string; selected?: boolean; disabled?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void; children: ReactNode;
}) {
  const { onMouseEnter, onMouseLeave, tipNode } = useHoverTip(tip);
  return (
    <>
      <div
        role="button" tabIndex={0}
        aria-label={tip}
        aria-pressed={selected || undefined}
        className={className + (selected ? " selected" : "")}
        data-disabled={disabled ? "" : undefined}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick?.(e as unknown as ReactMouseEvent<HTMLDivElement>); } }}
      >
        {children}
      </div>
      {tipNode}
    </>
  );
}

/** 图片浮栏：内核卡片工具栏下拉菜单（云端同款 `.ne-card-toolbar-select-menu`）。 */
function CardMenu({ menu, children }: { menu: string; children: ReactNode }) {
  return (
    <div className="selection-toolbar__kmenu" data-menu={menu}>
      <ul className="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light ne-card-toolbar-select-menu" role="menu">{children}</ul>
    </div>
  );
}

function CardMenuItem({ label, icon, selected, onClick }: { label: string; icon?: string; selected?: boolean; onClick?: () => void }) {
  return (
    <li role="menuitem" className={"ant-dropdown-menu-item ne-card-toolbar-select-menu-item" + (selected ? " ant-dropdown-menu-item-selected" : "")} onClick={onClick}>
      <div className="ne-card-toolbar-check-icon"><KIcon type="check" /></div>
      <div className="ne-card-toolbar-select-item-content">
        {icon ? <div className="ne-card-toolbar-select-item-icon"><KIcon type={icon} /></div> : null}
        <div className="ne-card-toolbar-select-item-label">{label}</div>
      </div>
    </li>
  );
}


export function SelectionToolbar({ editor, container }: {
  editor: LakeEditorInstance; container: HTMLElement;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  /** 弹层开着 ⇒ 冻结浮栏刷新（见 useSelectionToolbar.refreshNow）。 */
  const holdRef = useRef(false);
  holdRef.current = menu !== null;
  const { target, state, run, refresh, toolbarRef } = useSelectionToolbar(editor, container, holdRef);
  const [draft, setDraft] = useState("");
  /** 宽高弹窗的「高」输入。 */
  const [draftH, setDraftH] = useState("");
  /** 链接弹窗「在当前页面打开」。 */
  const [linkSelf, setLinkSelf] = useState(false);
  /**
   * 边距开关**不关面板**（用户 260924）：面板开着时 `holdRef` 会冻结 `refresh()`，内核写完 spacing
   * 后组件不会重渲染、开关会停在旧值 ⇒ 这里强制一次渲染，让 `renderImage` 重读 `readImageMeta`。
   * （`[, forceRender]` 不用变量名，避免 `--noUnusedLocals` 报未读局部。）
   */
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  /** 链接编辑弹层：文本 / 链接地址（与内核 .ne-link-editor 的两个字段对应）。 */
  const [linkText, setLinkText] = useState("");
  const [linkSrc, setLinkSrc] = useState("");
  /** 打开弹层时暂存的编辑器选区：输入框会抢走 DOM 选区，确认前要还回去（内核弹层 closeCallback 亦然）。 */
  const linkRangeRef = useRef<Range | null>(null);
  const linkSelRef = useRef("");
  const [menuAnchor, setMenuAnchor] = useState(0);
  const [menuLeft, setMenuLeft] = useState<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const keyRef = useRef<string>("none");

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!target || !el) { setPos(null); return; }
    const size = el.getBoundingClientRect();
    const chrome = document.querySelector(".ne-ui-toolbar");
    const host = container.getBoundingClientRect();
    const topLimit = Math.max(chrome ? chrome.getBoundingClientRect().bottom : 0, host.top + TOOLBAR_MARGIN);
    const p = computeToolbarPosition(target.rect, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }, topLimit);
    let left = p.left;
    const minLeft = host.left + TOOLBAR_MARGIN;
    const maxLeft = host.right - size.width - TOOLBAR_MARGIN;
    if (maxLeft >= minLeft) left = Math.min(Math.max(left, minLeft), maxLeft);
    setPos({ left, top: p.top });
  }, [target, menu, toolbarRef, container]);

  // 子菜单定位：左侧贴触发按钮 offsetLeft，右侧越界则左移，保证不超出浮栏宽度。
  useLayoutEffect(() => {
    if (!menu) { setMenuLeft(null); return; }
    const root = toolbarRef.current;
    const el = root?.querySelector('[data-menu="' + menu + '"]') as HTMLElement | null;
    if (!root || !el) return;
    const rootW = root.getBoundingClientRect().width;
    const menuW = el.getBoundingClientRect().width;
    setMenuLeft(Math.max(0, Math.min(menuAnchor, Math.max(0, rootW - menuW))));
  }, [menu, menuAnchor, toolbarRef]);

  const key = target ? target.kind + ":" + Math.round(target.rect.top) + ":" + Math.round(target.rect.left) : "none";
  useEffect(() => {
    if (keyRef.current !== key) { keyRef.current = key; setMenu(null); setDraft(""); setLinkText(""); setLinkSrc(""); }
  }, [key]);

  const pick = useCallback((name: string, value: unknown) => { run(name, value); setMenu(null); }, [run]);

  /** 色彩命令的清除/应用语义（内核 descriptor 同款，见 colorApplyCommand）。 */
  const applyColorValue = useCallback((variant: ColorVariant, value: string) => {
    let currentBg: unknown;
    if (variant === "bg") {
      try { currentBg = editor.queryCommandValue?.("bgColor"); } catch { currentBg = undefined; }
    }
    const { command, arg } = colorApplyCommand(variant, {
      visual: value,
      persistent: persistentColor(editor, value),
      normalText: normalTextColor(editor),
      currentBg,
    });
    run(command, ...(arg === undefined ? [] : [arg]));
    setMenu(null);
  }, [editor, run]);

  /** A / 背景色「本体」：直接应用当前色（上次使用色 → 内核默认），不弹面板。 */
  const applyCurrentColor = useCallback((variant: ColorVariant) => {
    const value = currentColor(editor, variant);
    rememberColor(editor, variant, value);
    applyColorValue(variant, value);
  }, [editor, applyColorValue]);

  /** 调色板选中：记录「上次使用色」（与固定栏共用）后再应用。空串 = 默认/无填充行。 */
  const pickColorFromBoard = useCallback((variant: ColorVariant, raw: string) => {
    const value = raw || paletteDefaultValue(editor, variant);
    rememberColor(editor, variant, value);
    applyColorValue(variant, value);
  }, [editor, applyColorValue]);

  /** 取真实有盒子的触发元素：内核原子件外层是 display:contents 包裹（offsetLeft 恒为 0）。 */
  const anchorLeft = (trigger?: HTMLElement | null): number => {
    if (!trigger) return 0;
    const el = (trigger.querySelector("button") as HTMLElement | null) ?? trigger;
    return el.offsetLeft;
  };

  /** 打开/切换菜单；记录触发按钮的左偏移，子菜单以该「主菜单项」定位。 */
  const toggleMenu = useCallback((m: string, trigger?: HTMLElement | null) => {
    setMenuAnchor(anchorLeft(trigger));
    setMenuLeft(null);
    setMenu((current) => (current === m ? null : m));
  }, []);
  const openWithDraft = useCallback((m: string, value: string, trigger?: HTMLElement | null) => {
    setMenuAnchor(anchorLeft(trigger));
    setMenuLeft(null);
    setDraft(value);
    setMenu((current) => (current === m ? null : m));
  }, []);
  /** 打开内核样式的链接编辑弹层：文本预填当前选区、链接为空；同时暂存选区以便确认时还原。 */
  const openLinkEditor = useCallback((trigger?: HTMLElement | null) => {
    setMenuAnchor(anchorLeft(trigger));
    setMenuLeft(null);
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    linkRangeRef.current = range;
    linkSelRef.current = range ? range.toString().trim() : "";
    setLinkText(linkSelRef.current);
    setLinkSrc("");
    setMenu((current) => (current === "txtlink" ? null : "txtlink"));
  }, []);

  const canCommand = (name: string): boolean => {
    try { return editor.queryCommandEnabled?.(name) === true; } catch { return false; }
  };

  /** 文字链接：有选区走 link（包住选区），否则走 insertLink；文本被改过时走 insertLink。
   *  确认前先把选区/焦点还给编辑器 —— 弹层输入框获得焦点会让编辑器选区丢失，命令会静默无效。 */
  const applyTextLink = useCallback(() => {
    const url = linkSrc.trim();
    if (!url || !isValidLink(url)) return;
    const selected = linkSelRef.current;
    const text = linkText.trim();
    try {
      const sel = window.getSelection();
      if (sel && linkRangeRef.current) { sel.removeAllRanges(); sel.addRange(linkRangeRef.current); }
      editor.execCommand?.("focus");
    } catch { /* 还原失败则按当前选区尽力执行 */ }
    if (canCommand("link") && (!text || text === selected)) run("link", url, true, true);
    else if (canCommand("insertLink")) run("insertLink", text || selected || "链接", url, true, true);
    else if (canCommand("link")) run("link", url, true, true);
    setMenu(null);
  }, [editor, linkSrc, linkText, run]);

  if (!target) return null;

  const renderTextMenu = () => {
    if (menu === "style") {
      return (
        <KMenu menu="style">
          {PARAGRAPH_STYLES.map((b) => (
            <KMenuItem key={b.value} label={b.menuLabel} selected={state.style === b.value} shortcut={b.keys}
              labelClass={b.menuClass}
              onClick={() => pick("style", b.value)} />
          ))}
        </KMenu>
      );
    }
    if (menu === "fontsize") {
      return (
        <KMenu menu="fontsize">
          {FONT_SIZE_OPTIONS.map((v) => (
            <KMenuItem key={v} label={v + "px"} labelClass="ne-ui-font-size-item" selected={state.fontSize === v} onClick={() => pick("fontsize", v)} />
          ))}
        </KMenu>
      );
    }
    if (menu === "color" || menu === "bgcolor") {
      const variant: ColorVariant = menu === "color" ? "text" : "bg";
      return (
        <div className="selection-toolbar__colorpop ne-ui-toolbar-color-picker-overlay" data-menu={menu}>
          <LakeColorBoard
            variant={variant}
            value={variant === "text" ? state.color : state.bgColor}
            onSelect={(c) => pickColorFromBoard(variant, c)}
          />
        </div>
      );
    }
    if (menu === "txtlink") {
      return (
        <div className="selection-toolbar__popover" data-menu="txtlink">
          <KLinkEditor
            text={linkText}
            src={linkSrc}
            allowModifyText
            invalid={linkSrc.trim().length > 0 && !isValidLink(linkSrc.trim())}
            onChangeText={setLinkText}
            onChangeSrc={setLinkSrc}
            onConfirm={applyTextLink}
          />
        </div>
      );
    }
    return null;
  };

  /** 与固定工具栏逐类对齐（真身见 .ne-ui-toolbar 实测）：内核 ToolbarButton 自加 ant-btn/ne-ui-t-button。 */
  const TOGGLE = "ne-toolbar-widget ne-ui-toolbar-status-button ne-ui-toolbar-toggle-button";
  // 段落样式/字号是「纯按钮 + 自锚定菜单」（不是内核 Select）⇒ 用内核标准工具条按钮类
  // .ne-ui-toolbar-button（已定义 26×26 / padding:0，单一起源），不再自写尺寸覆盖。
  const VALUE = "ant-dropdown-trigger ne-ui-toolbar-button ne-toolbar-widget";

  const renderText = () => {
    const sizeLabel = String(state.fontSize ?? 15);   // 260924 用户口径：字号只显示数值（如 16），不带 px
    /** hover 说明 = 名称 + 内核快捷键（短，无 markdown 行；见 kernelUiAtoms.KTooltip）。 */
    const hot = (name: string) => kernelHotkey(editor, name);
    return (
      <>
        <KToolbarButton name="clearFormat" icon="editor-clearFormat" title="清除格式" hotkey={hot("clearFormat")} className="ne-ui-toolbar-button ne-ui-toolbar-clear-format ne-toolbar-widget" onClick={() => run("clearFormat")} />
        <span className="selection-toolbar__sep" />
        {/* 260924 续：标题按钮改用原「转为」的图标（内核「段落/块类型」editor-paragraph），不再显示 T/H1..H6 符号。 */}
        <KToolbarButton name="format" icon="editor-paragraph" title="段落样式" checked={menu === "style"} className={VALUE + " ne-ui-toolbar-format"} onClick={(e) => toggleMenu("style", e.currentTarget)} />
        {/* 内核 getUIState：字号按钮 disabled = !queryCommandEnabled('fontsize')（标题是固定样式 ⇒ 不可调）。 */}
        <KToolbarButton name="fontsize" title="字号" disabled={!canCommand("fontsize")} checked={menu === "fontsize"} className={VALUE + " ne-ui-toolbar-fontsize"} onClick={(e) => toggleMenu("fontsize", e.currentTarget)}>
          <div className="ne-ui-toolbar-select-value">{sizeLabel}</div>
        </KToolbarButton>
        <span className="selection-toolbar__sep" />
        <KToolbarButton name="bold" icon="bold" checked={state.marks.bold} title="加粗" hotkey={hot("bold")} className={TOGGLE} onClick={() => run("bold")} />
        <KToolbarButton name="italic" icon="italic" checked={state.marks.italic} title="倾斜" hotkey={hot("italic")} className={TOGGLE} onClick={() => run("italic")} />
        <KToolbarButton name="strikethrough" icon="strikethrough" checked={state.marks.strikethrough} title="中划线" hotkey={hot("strikethrough")} className={TOGGLE} onClick={() => run("strikethrough")} />
        <KToolbarButton name="underline" icon="underline" checked={state.marks.underline} title="下划线" hotkey={hot("underline")} className={TOGGLE} onClick={() => run("underline")} />
        <span className="selection-toolbar__sep" />
        <KColorButton label="文字颜色" variant="text" color={currentColor(editor, "text")} active={menu === "color" || Boolean(state.color)} hotkey={hot("color")} onApply={() => applyCurrentColor("text")} onOpen={(e) => toggleMenu("color", e.currentTarget)} />
        <KColorButton label="背景色" variant="bg" color={currentColor(editor, "bg")} active={menu === "bgcolor" || Boolean(state.bgColor)} hotkey={hot("bgColor")} onApply={() => applyCurrentColor("bg")} onOpen={(e) => toggleMenu("bgcolor", e.currentTarget)} />
        <span className="selection-toolbar__sep" />
        {/* 260924 续：原「转为」下拉已拆散 —— 每个块级转换各成一个独立按钮（顺序 = 有序/无序/待办/引用/行内代码）。 */}
        {TOOLBAR_BLOCK_ITEMS.map((item) => (
          <KToolbarButton key={item.name} name={item.name} icon={item.icon} title={item.label} hotkey={hot(item.name)}
            checked={item.kind === "mark" ? state.marks[item.name] : state.blocks[item.name]}
            disabled={state.itemDisabled[item.name]}
            className={TOGGLE} onClick={() => run(item.name)} />
        ))}
        {/* 内核 link-toolbar-descriptor.getUIState：disabled = !link && !insertLink（选区里已有链接时两个都不可用）。
            不用内核「下拉按钮」类：.ne-ui-toolbar-arrow-button 固定 42px，是给已去掉的三角预留的 ⇒ 用 26px 普通按钮。 */}
        <KToolbarButton name="link" icon="editor-link" disabled={!canCommand("link") && !canCommand("insertLink")} checked={menu === "txtlink"} title="超链接" hotkey={hot("link")} className="ne-ui-toolbar-button ne-toolbar-widget" onClick={(e) => openLinkEditor(e.currentTarget)} />
      </>
    );
  };

  const renderImage = (t: ImageTarget) => {
    const asset = parseAssetRef(t.src);
    const meta = readImageMeta(t.cardEl);
    const apply = (data: Record<string, unknown>) => { run("updateImageData", t.cardId, data); setMenu(null); };
    const batch = (patch: Record<string, unknown>) => { run("cardBatchApply", "image", patch); setMenu(null); };
    /** 对齐走**块级** alignment 命令（内核 ne-alignment；cardValue 没有 alignment 字段）。 */
    const align = (value: "left" | "center" | "right") => { run("alignment", value); setMenu(null); };
    /** 宽高弹窗：宽/高输入 + 百分比档位（对齐云端内容）。 */
    const displayH = meta.width && meta.originalWidth ? Math.round((meta.width * meta.originalHeight) / meta.originalWidth) : meta.originalHeight;
    const scalePct = meta.width && meta.originalWidth ? Math.round((meta.width / meta.originalWidth) * 100) : 100;
    const applyWidth = () => { const n = Number(draft); if (n > 0) apply({ width: Math.round(n) }); };
    const applyHeight = () => { const n = Number(draftH); if (n > 0) apply({ width: Math.round((n * meta.originalWidth) / meta.originalHeight) }); };
    const applyLink = () => apply({ link: draft.trim(), linkTarget: linkSelf ? "" : "_blank" });
    /** 边距 = 内核 card spacing 的两个开关（上/下）。 */
    const spacingTop = meta.spacing === "top" || meta.spacing === "both";
    const spacingBottom = meta.spacing === "bottom" || meta.spacing === "both";
    /** 边距：写内核后**保持面板打开**（可连续开上/下），只强制重渲染让两个开关读回新值。 */
    const setSpacing = (top: boolean, bottom: boolean) => { setImageSpacing(t.cardEl, top && bottom ? "both" : top ? "top" : bottom ? "bottom" : null); forceRender(); };
    /** 描述：**无弹窗** —— 打开卡片内联描述编辑框并聚焦（内核 `.ne-image-title-content`，云端同款）。 */
    const openTitleEditor = () => { apply({ showTitle: true }); window.setTimeout(() => { (t.cardEl.querySelector(".ne-image-title-content") as HTMLElement | null)?.focus(); }, 80); };
    return (
      <div className="ne-card-toolbar">
        {/* 与云端图片工具栏**同构同序**：旋转 · 裁剪 · 宽高 | 链接 · 描述 | 对齐 · 样式 · 边距 · 批量 |（末尾多一个 另存为）。
            类名全部是内核卡片工具栏的 `.ne-card-toolbar-*`（样式来自 vendored lakex-doc.css，非自造）；
            图标 1:1 取自云端 SVG（见 imageIcons.tsx）。 */}
        <CardItem tip="旋转 90°" className="ne-card-toolbar-item" onClick={() => apply({ rotation: ((meta.rotation || 0) + 90) % 360 })}><IconImageRotate /></CardItem>
        <CardItem tip="裁剪" className="ne-card-toolbar-item" onClick={() => { enterImageCrop(t.cardEl); refresh(); }}><IconImageCrop /></CardItem>
        <CardItem tip="宽高" className="ne-card-toolbar-dropdown-item ne-card-toolbar-dropdown-item-has-title ant-dropdown-trigger" selected={menu === "imgsize"} onClick={(e) => { setDraft(meta.width ? String(meta.width) : ""); setDraftH(String(displayH)); openWithDraft("imgsize", meta.width ? String(meta.width) : "", e.currentTarget); }}><IconImageSize /><span>宽高</span></CardItem>
        <div className="ne-ui-card-toolbar-divider" />
        <CardItem tip="链接" className="ne-card-toolbar-dropdown-item ant-dropdown-trigger" selected={menu === "imglink" || Boolean(meta.link)} onClick={(e) => { setLinkSelf(meta.linkSelf); openWithDraft("imglink", meta.link, e.currentTarget); }}><IconImageLink /></CardItem>
        <CardItem tip="描述" className="ne-card-toolbar-item ne-card-toolbar-item-has-title" selected={Boolean(meta.title)} onClick={() => openTitleEditor()}><IconImageTitle /><span>描述</span></CardItem>
        <div className="ne-ui-card-toolbar-divider" />
        <CardItem tip="对齐" className="ne-card-toolbar-select-item ant-dropdown-trigger" selected={menu === "imgalign"} onClick={(e) => toggleMenu("imgalign", e.currentTarget)}><IconImageAlign /><span className="ne-card-toolbar-arrow-down-icon" /></CardItem>
        <CardItem tip="样式" className="ne-card-toolbar-select-item ne-card-toolbar-select-item-has-title ant-dropdown-trigger" selected={menu === "imgstyle"} onClick={(e) => toggleMenu("imgstyle", e.currentTarget)}><IconImageStyle /><span>样式</span><span className="ne-card-toolbar-arrow-down-icon" /></CardItem>
        <CardItem tip="边距" className="ne-card-toolbar-dropdown-item ne-card-toolbar-dropdown-item-has-title ant-dropdown-trigger" selected={menu === "imgmargin"} onClick={(e) => toggleMenu("imgmargin", e.currentTarget)}><IconImageSpacing /><span>边距</span></CardItem>
        <CardItem tip="批量应用" className="ne-card-toolbar-select-item ant-dropdown-trigger" selected={menu === "imgbatch"} onClick={(e) => toggleMenu("imgbatch", e.currentTarget)}><IconImageBatch /><span className="ne-card-toolbar-arrow-down-icon" /></CardItem>
        <div className="ne-ui-card-toolbar-divider" />
        <CardItem tip="另存为" className="ne-card-toolbar-item" disabled={!asset} onClick={() => { if (asset) void native.saveAssetAs(asset.noteId, asset.filename, asset.filename).catch((error) => reportNativeActionError("另存图片", error)); }}><KIcon type="download" /></CardItem>

        {/* 宽高：宽/高输入 + 25/50/75/100% 档位（云端同内容） */}
        {menu === "imgsize" && (
          <div className="selection-toolbar__cardpop" data-menu="imgsize">
            <div className="selection-toolbar__inputrow">
              <span className="ne-card-toolbar-input-title">宽</span>
              <input className="ne-card-toolbar-input" type="number" min="16" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyWidth(); } }} />
              <span className="ne-card-toolbar-input-title">高</span>
              <input className="ne-card-toolbar-input" type="number" min="16" value={draftH} onChange={(e) => setDraftH(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyHeight(); } }} />
            </div>
            <div className="ln-segment selection-toolbar__scale">
              {[25, 50, 75, 100].map((p) => (
                <button key={p} type="button" className={"ln-segment__item" + (scalePct === p ? " is-active" : "")} onClick={() => apply({ width: Math.max(16, Math.round((meta.originalWidth * p) / 100)) })}>{p}%</button>
              ))}
            </div>
          </div>
        )}
        {/* 链接：网址输入 + 「在当前页面打开」 */}
        {menu === "imglink" && (
          <div className="selection-toolbar__cardpop" data-menu="imglink">
            <input className="ne-card-toolbar-input selection-toolbar__urlinput" type="text" placeholder="请输入网址" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }} />
            <label className="selection-toolbar__checkrow"><KCheckbox checked={linkSelf} onChange={setLinkSelf} />在当前页面打开</label>
          </div>
        )}
        {/* 边距：上/下两个开关（内核 card spacing） */}
        {menu === "imgmargin" && (
          <div className="selection-toolbar__cardpop" data-menu="imgmargin">
            <div className="selection-toolbar__switchrow"><span>为图片添加上边距</span><KSwitch checked={spacingTop} onChange={(v) => setSpacing(v, spacingBottom)} /></div>
            <div className="selection-toolbar__switchrow"><span>为图片添加下边距</span><KSwitch checked={spacingBottom} onChange={(v) => setSpacing(spacingTop, v)} /></div>
          </div>
        )}
        {menu === "imgalign" && (
          <CardMenu menu="imgalign">
            <CardMenuItem label="左对齐" icon="editor-alignmentLeft" selected={meta.alignment === "left"} onClick={() => align("left")} />
            <CardMenuItem label="居中对齐" icon="editor-alignmentCenter" selected={meta.alignment === "center"} onClick={() => align("center")} />
            <CardMenuItem label="右对齐" icon="editor-alignmentRight" selected={meta.alignment === "right"} onClick={() => align("right")} />
          </CardMenu>
        )}
        {menu === "imgstyle" && (
          <CardMenu menu="imgstyle">
            {IMAGE_STYLE_OPTIONS.map((s) => (
              <CardMenuItem key={s.value} label={s.label} selected={meta.style === s.value} onClick={() => apply({ style: s.value })} />
            ))}
          </CardMenu>
        )}
        {menu === "imgbatch" && (
          <CardMenu menu="imgbatch">
            <CardMenuItem label="同步图片样式到全文" onClick={() => batch({ style: meta.style })} />
            <CardMenuItem label="同步图片宽度到全文" onClick={() => batch({ width: meta.width || imageSizeWidth("medium", meta.originalWidth) })} />
          </CardMenu>
        )}
      </div>
    );
  };

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar lakex-default-theme"
      data-kind={target.kind}
      role="toolbar"
      aria-label={target.kind === "text" ? "文字格式工具栏" : "图片工具栏"}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden", "--menu-left": (menuLeft ?? menuAnchor) + "px" } as CSSProperties}
      onMouseDown={(event) => {
        // 默认 preventDefault 保选区（点按钮不丢编辑器选区）；但链接弹层的输入框必须能获得焦点，
        // 否则鼠标点不进输入框（用户 260924 报「输入即关闭 / 写不进去」的一部分）。
        const t = event.target as HTMLElement | null;
        if (t && t.closest("input, textarea, .ne-link-editor")) return;
        event.preventDefault();
      }}
    >
      {target.kind === "text" ? renderText() : renderImage(target)}
      {target.kind === "text" ? renderTextMenu() : null}
    </div>
  );
}
