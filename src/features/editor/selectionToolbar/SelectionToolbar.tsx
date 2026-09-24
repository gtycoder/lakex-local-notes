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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, Copy, Crop, Download, Layers, Link2,
  MoveVertical, Palette, RotateCw, Scaling, Trash2, Type,
} from "lucide-react";
import { native } from "../../../lib/native";
import { CONVERT_ITEMS, FONT_SIZE_OPTIONS, PARAGRAPH_STYLES } from "../editorCommands";
import type { LakeEditorInstance } from "../lakeRuntime";
import { IMAGE_STYLE_OPTIONS, enterImageCrop, readImageMeta } from "./imageCardOps";
import { KEmbedIcon, KIcon, KLinkEditor, KToolbarButton } from "./kernelUiAtoms";
import { LakeColorBoard } from "./LakeColorBoard";
import {
  currentColor, normalTextColor, paletteDefaultValue, persistentColor, rememberColor, type ColorVariant,
} from "./colorMemory";
import { colorApplyCommand, computeToolbarPosition, imageSizeWidth, parseAssetRef, TOOLBAR_MARGIN, type ImageSizePreset } from "./selectionToolbarModel";
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
function KColorButton({ label, variant, color, active, onApply, onOpen }: {
  label: string; variant: ColorVariant; color: string; active?: boolean;
  onApply: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <span className="selection-toolbar__colorbtn">
      <KToolbarButton name="color" checked={active} className="ne-ui-toolbar-color-show-button" title={label} onClick={onApply}>
        <KEmbedIcon variant={variant} color={color} />
      </KToolbarButton>
      <KToolbarButton name="colorDropdown" caret caretClass="ne-ui-toolbar-color-dropdown-arrow" className="ne-ui-toolbar-color-dropdown-button ant-dropdown-trigger" title={label} onClick={onOpen} />
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

function KMenuItem({ label, icon, selected, shortcut, labelClass, onClick }: {
  label: string; icon?: string; selected?: boolean; shortcut?: string; labelClass?: string; onClick?: () => void;
}) {
  return (
    <li role="menuitem" className={"ant-dropdown-menu-item ne-ui-select-item" + (selected ? " ant-dropdown-menu-item-selected" : "")} onClick={onClick}>
      <div className="ne-ui-select-item-check-icon">{icon ? <KIcon type={icon} /> : selected ? <KIcon type="check" /> : null}</div>
      <div className="ne-ui-select-item-label">
        <div className="ne-ui-select-content">
          <span className={labelClass ?? "ne-ui-item-content"}>{label}</span>
          {shortcut ? <span className="ne-ui-command-style">{shortcut}</span> : null}
        </div>
      </div>
    </li>
  );
}


/** 图片形态沿用自有按钮（图片浮栏风格此前已按云端语雀定稿）。 */
function IconButton({ label, active, disabled, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"selection-toolbar__btn" + (active ? " is-active" : "")}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SelectionToolbar({ editor, container, noteId }: {
  editor: LakeEditorInstance; container: HTMLElement; noteId: string;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  /** 弹层开着 ⇒ 冻结浮栏刷新（见 useSelectionToolbar.refreshNow）。 */
  const holdRef = useRef(false);
  holdRef.current = menu !== null;
  const { target, state, run, refresh, toolbarRef } = useSelectionToolbar(editor, container, holdRef);
  const [draft, setDraft] = useState("");
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
    if (menu === "convert") {
      return (
        <KMenu menu="convert">
          {CONVERT_ITEMS.map((item) => (
            <KMenuItem key={item.name} label={item.label} icon={item.icon} onClick={() => pick(item.name, undefined)} />
          ))}
        </KMenu>
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
  const DROPDOWN = "ant-dropdown-trigger ne-ui-toolbar-dropdown-button ne-toolbar-widget ne-ui-toolbar-arrow-button";
  // 段落样式/字号是「纯按钮 + 自锚定菜单」（不是内核 Select）⇒ 用内核标准工具条按钮类
  // .ne-ui-toolbar-button（已定义 26×26 / padding:0，单一起源），不再自写尺寸覆盖。
  const VALUE = "ant-dropdown-trigger ne-ui-toolbar-button ne-toolbar-widget";

  const renderText = () => {
    const styleLabel = PARAGRAPH_STYLES.find((b) => b.value === state.style)?.label ?? "T";
    /** H1–H6 两个字形在 26px 按钮里偏大 ⇒ 只把标题符号收小（T 与字号数值保持 17px，用户 260924 口径）。 */
    const headingStyle = /^h[1-6]$/.test(state.style);
    const sizeLabel = String(state.fontSize ?? 15);   // 260924 用户口径：字号只显示数值（如 16），不带 px
    return (
      <>
        <KToolbarButton name="clearFormat" icon="editor-clearFormat" title="清除格式" className="ne-ui-toolbar-button ne-ui-toolbar-clear-format ne-toolbar-widget" onClick={() => run("clearFormat")} />
        <span className="selection-toolbar__sep" />
        <KToolbarButton name="format" title="段落样式" checked={menu === "style"} className={VALUE + " ne-ui-toolbar-format"} onClick={(e) => toggleMenu("style", e.currentTarget)}>
          <div className={"ne-ui-toolbar-select-value" + (headingStyle ? " selection-toolbar__value--heading" : "")}>{styleLabel}</div>
        </KToolbarButton>
        {/* 内核 getUIState：字号按钮 disabled = !queryCommandEnabled('fontsize')（标题是固定样式 ⇒ 不可调）。 */}
        <KToolbarButton name="fontsize" title="字号" disabled={!canCommand("fontsize")} checked={menu === "fontsize"} className={VALUE + " ne-ui-toolbar-fontsize"} onClick={(e) => toggleMenu("fontsize", e.currentTarget)}>
          <div className="ne-ui-toolbar-select-value">{sizeLabel}</div>
        </KToolbarButton>
        <span className="selection-toolbar__sep" />
        <KToolbarButton name="bold" icon="bold" checked={state.marks.bold} title="加粗" className={TOGGLE} onClick={() => run("bold")} />
        <KToolbarButton name="italic" icon="italic" checked={state.marks.italic} title="倾斜" className={TOGGLE} onClick={() => run("italic")} />
        <KToolbarButton name="strikethrough" icon="strikethrough" checked={state.marks.strikethrough} title="中划线" className={TOGGLE} onClick={() => run("strikethrough")} />
        <KToolbarButton name="underline" icon="underline" checked={state.marks.underline} title="下划线" className={TOGGLE} onClick={() => run("underline")} />
        <span className="selection-toolbar__sep" />
        <KColorButton label="文字颜色" variant="text" color={currentColor(editor, "text")} active={menu === "color" || Boolean(state.color)} onApply={() => applyCurrentColor("text")} onOpen={(e) => toggleMenu("color", e.currentTarget)} />
        <KColorButton label="背景色" variant="bg" color={currentColor(editor, "bg")} active={menu === "bgcolor" || Boolean(state.bgColor)} onApply={() => applyCurrentColor("bg")} onOpen={(e) => toggleMenu("bgcolor", e.currentTarget)} />
        <span className="selection-toolbar__sep" />
        <KToolbarButton name="moremark" icon="t-moremark" caret checked={menu === "convert"} title="转为" className={DROPDOWN} onClick={(e) => toggleMenu("convert", e.currentTarget)} />
        {/* 内核 link-toolbar-descriptor.getUIState：disabled = !link && !insertLink（选区里已有链接时两个都不可用）。 */}
        <KToolbarButton name="link" icon="editor-link" disabled={!canCommand("link") && !canCommand("insertLink")} checked={menu === "txtlink"} title="超链接" className={DROPDOWN} onClick={(e) => openLinkEditor(e.currentTarget)} />
      </>
    );
  };

  const renderImage = (t: ImageTarget) => {
    const asset = parseAssetRef(t.src);
    const meta = readImageMeta(t.cardEl);
    const apply = (data: Record<string, unknown>) => { run("updateImageData", t.cardId, data); setMenu(null); };
    const batch = (patch: Record<string, unknown>) => { run("cardBatchApply", "image", patch); setMenu(null); };
    const sizeItem = (p: ImageSizePreset, label: string) => (
      <button key={p} type="button" role="menuitem" className="selection-toolbar__item" onClick={() => apply({ width: imageSizeWidth(p, meta.originalWidth) })}>{label}</button>
    );
    return (
      <>
        <IconButton label="裁剪" onClick={() => { enterImageCrop(t.cardEl); refresh(); }}><Crop size={15} /></IconButton>
        <IconButton label="旋转 90°" onClick={() => apply({ rotation: ((meta.rotation || 0) + 90) % 360 })}><RotateCw size={15} /></IconButton>
        <IconButton label="宽高" active={menu === "imgsize"} onClick={(e) => openWithDraft("imgsize", meta.width ? String(meta.width) : "", e.currentTarget)}><Scaling size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label="链接" active={menu === "imglink" || Boolean(meta.link)} onClick={(e) => openWithDraft("imglink", meta.link, e.currentTarget)}><Link2 size={15} /></IconButton>
        <IconButton label="描述" active={menu === "imgtitle" || Boolean(meta.title)} onClick={(e) => openWithDraft("imgtitle", meta.title, e.currentTarget)}><Type size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label="对齐" active={menu === "imgalign"} onClick={(e) => toggleMenu("imgalign", e.currentTarget)}><AlignLeft size={15} /></IconButton>
        <IconButton label="样式" active={menu === "imgstyle"} onClick={(e) => toggleMenu("imgstyle", e.currentTarget)}><Palette size={15} /></IconButton>
        <IconButton label="边距" active={menu === "imgmargin"} onClick={(e) => toggleMenu("imgmargin", e.currentTarget)}><MoveVertical size={15} /></IconButton>
        <IconButton label="批量应用（同步样式/宽度到全文）" active={menu === "imgbatch"} onClick={(e) => toggleMenu("imgbatch", e.currentTarget)}><Layers size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label={asset ? "复制图片" : "复制（非本机资源不可用）"} disabled={!asset} onClick={() => { if (asset) void native.copyAssetImage(asset.noteId, asset.filename); }}><Copy size={15} /></IconButton>
        <IconButton label={asset ? "另存为" : "下载（非本机资源不可用）"} disabled={!asset} onClick={() => { if (asset) void native.saveAssetAs(asset.noteId, asset.filename, asset.filename); }}><Download size={15} /></IconButton>
        <IconButton label="删除图片" onClick={() => { run("deleteCard", t.cardId); setMenu(null); }}><Trash2 size={15} /></IconButton>

        {menu === "imgsize" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgsize">
            <div className="selection-toolbar__menu--row">{sizeItem("small", "小")}{sizeItem("medium", "中")}{sizeItem("large", "大")}{sizeItem("original", "原始")}</div>
            <div className="selection-toolbar__row">
              <input className="selection-toolbar__input" type="number" min="16" placeholder="宽度 px" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const n = Number(draft); if (n > 0) apply({ width: Math.round(n) }); } }} />
              <button type="button" className="selection-toolbar__apply" onClick={() => { const n = Number(draft); if (n > 0) apply({ width: Math.round(n) }); }}>应用</button>
            </div>
          </div>
        )}
        {menu === "imglink" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imglink">
            <div className="selection-toolbar__row">
              <input className="selection-toolbar__input" type="text" placeholder="https://…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply({ link: draft.trim(), linkTarget: draft.trim() ? "_blank" : "" }); }} />
              <button type="button" className="selection-toolbar__apply" onClick={() => apply({ link: draft.trim(), linkTarget: draft.trim() ? "_blank" : "" })}>应用</button>
            </div>
            <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => apply({ link: "", linkTarget: "" })}>移除链接</button>
          </div>
        )}
        {menu === "imgtitle" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgtitle">
            <div className="selection-toolbar__row">
              <input className="selection-toolbar__input" type="text" placeholder="图片描述" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply({ title: draft, showTitle: draft.length > 0 }); }} />
              <button type="button" className="selection-toolbar__apply" onClick={() => apply({ title: draft, showTitle: draft.length > 0 })}>应用</button>
            </div>
            <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => apply({ showTitle: !meta.showTitle })}>{meta.showTitle ? "隐藏描述" : "显示描述"}</button>
          </div>
        )}
        {menu === "imgalign" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgalign">
            <button type="button" role="menuitem" className={"selection-toolbar__item" + (meta.style === "left" ? " is-active" : "")} onClick={() => apply({ style: "left" })}><AlignLeft size={15} /> 左对齐</button>
            <button type="button" role="menuitem" className={"selection-toolbar__item" + (meta.style === "center" ? " is-active" : "")} onClick={() => apply({ style: "center" })}><AlignCenter size={15} /> 居中</button>
            <button type="button" role="menuitem" className={"selection-toolbar__item" + (meta.style === "right" ? " is-active" : "")} onClick={() => apply({ style: "right" })}><AlignRight size={15} /> 右对齐</button>
            <button type="button" role="menuitem" className={"selection-toolbar__item" + (meta.style === "none" ? " is-active" : "")} onClick={() => apply({ style: "none" })}>默认</button>
          </div>
        )}
        {menu === "imgmargin" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgmargin">
            <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => apply({ margin: { top: true, bottom: true } })}>默认间距</button>
            <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => apply({ margin: { top: false, bottom: false } })}>紧凑（无间距）</button>
          </div>
        )}
        {menu === "imgstyle" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgstyle">
            {IMAGE_STYLE_OPTIONS.map((s) => (
              <button key={s.value} type="button" role="menuitem" className={"selection-toolbar__item" + (meta.style === s.value ? " is-active" : "")} onClick={() => apply({ style: s.value })}>{meta.style === s.value ? "✓ " : "　"}{s.label}</button>
            ))}
          </div>
        )}
        {menu === "imgbatch" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgbatch">
            <div className="selection-toolbar__menu-label">批量应用格式：对本文档的图片一键应用样式和宽度</div>
            <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => batch({ style: meta.style })}>同步图片样式到全文</button>
            <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => batch({ width: meta.width || imageSizeWidth("medium", meta.originalWidth) })}>同步图片宽度到全文</button>
          </div>
        )}
      </>
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
