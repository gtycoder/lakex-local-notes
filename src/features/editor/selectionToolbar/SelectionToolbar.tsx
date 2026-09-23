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
import { LakeColorBoard } from "./LakeColorBoard";
import { computeToolbarPosition, imageSizeWidth, parseAssetRef, TOOLBAR_MARGIN, type ImageSizePreset } from "./selectionToolbarModel";
import { useSelectionToolbar, type ImageTarget } from "./useSelectionToolbar";

/** 内核图标（sprite）：与固定工具栏同一套 ne-icon + #icon-*。 */
function KIcon({ name }: { name: string }) {
  return (
    <div className={"ne-icon ne-icon-kitchen ne-icon-" + name} data-name={name}>
      <svg className="ne-icon-symbol" aria-hidden="true"><use xlinkHref={"#icon-" + name} /></svg>
    </div>
  );
}

/** 内核工具栏普通按钮（清除格式 / 超链接等）。 */
function KToolButton({ label, icon, onClick, disabled }: { label: string; icon: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled}
      className="ant-btn ne-ui-toolbar-button ne-toolbar-widget ne-ui-t-button" onClick={onClick}>
      <KIcon name={icon} />
    </button>
  );
}

/** 内核工具栏开关按钮（B/I/S/U）；active 用内核 .checked。 */
function KToggleButton({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active || undefined}
      className={"ant-btn ant-btn-default ne-toolbar-widget ne-ui-toolbar-status-button ne-ui-toolbar-toggle-button ne-ui-t-button" + (active ? " checked" : "")}
      onClick={onClick}>
      <KIcon name={icon} />
    </button>
  );
}

/** 内核工具栏下拉触发按钮（段落样式 / 字号 / 颜色 / 转为 / 超链接）。 */
function KDropdownButton({ label, icon, active, onClick, extra, children }: {
  label: string; icon?: string; active?: boolean; onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void; extra?: string; children?: ReactNode;
}) {
  return (
    <button type="button" title={label} aria-label={label}
      className={"ant-btn ant-dropdown-trigger ne-ui-toolbar-dropdown-button ne-toolbar-widget ne-ui-toolbar-arrow-button ne-ui-t-button" + (active ? " checked" : "") + (extra ? " " + extra : "")}
      onClick={onClick}>
      {icon ? <KIcon name={icon} /> : null}
      {children}
    </button>
  );
}

/** 内核下拉菜单（ant-dropdown-menu + ne-ui-select-*），与固定工具栏一致。 */
function KMenu({ menu, children }: { menu: string; children: ReactNode }) {
  return (
    <div className="selection-toolbar__kmenu" data-menu={menu}>
      <ul className="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light ne-ui-select-menu" role="menu">{children}</ul>
    </div>
  );
}

function KMenuItem({ label, icon, selected, shortcut, fontSize, onClick }: {
  label: string; icon?: string; selected?: boolean; shortcut?: string; fontSize?: number; onClick?: () => void;
}) {
  return (
    <li role="menuitem" style={fontSize ? { fontSize: fontSize } : undefined} className={"ant-dropdown-menu-item ne-ui-select-item" + (selected ? " ant-dropdown-menu-item-selected" : "")} onClick={onClick}>
      <div className="ne-ui-select-item-check-icon">{icon ? <KIcon name={icon} /> : selected ? <KIcon name="check" /> : null}</div>
      <div className="ne-ui-select-item-label">
        <div className="ne-ui-select-content">
          <span className="ne-ui-item-content">{label}</span>
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
  const { target, state, run, refresh, toolbarRef } = useSelectionToolbar(editor, container);
  const [menu, setMenu] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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
    if (keyRef.current !== key) { keyRef.current = key; setMenu(null); setDraft(""); }
  }, [key]);

  const pick = useCallback((name: string, value: unknown) => { run(name, value); setMenu(null); }, [run]);

  /** 打开/切换菜单；记录触发按钮的左偏移，子菜单以该「主菜单项」定位。 */
  const toggleMenu = useCallback((m: string, trigger?: HTMLElement | null) => {
    if (trigger) setMenuAnchor(trigger.offsetLeft);
    setMenuLeft(null);
    setMenu((current) => (current === m ? null : m));
  }, []);
  const openWithDraft = useCallback((m: string, value: string, trigger?: HTMLElement | null) => {
    if (trigger) setMenuAnchor(trigger.offsetLeft);
    setMenuLeft(null);
    setDraft(value);
    setMenu((current) => (current === m ? null : m));
  }, []);

  const canCommand = (name: string): boolean => {
    try { return editor.queryCommandEnabled?.(name) === true; } catch { return false; }
  };

  /** 文字链接：有选区走 link（包住选区），否则走 insertLink（在光标处插入）。 */
  const applyTextLink = useCallback(() => {
    const url = draft.trim();
    if (!url) return;
    if (canCommand("link")) run("link", url, true, true);
    else if (canCommand("insertLink")) run("insertLink", String(window.getSelection() ?? "").trim() || "链接", url, true, true);
    setMenu(null);
  }, [draft, run]);

  if (!target) return null;

  const renderTextMenu = () => {
    if (menu === "style") {
      return (
        <KMenu menu="style">
          {PARAGRAPH_STYLES.map((b) => (
            <KMenuItem key={b.value} label={b.label} selected={state.style === b.value} shortcut={b.keys}
              fontSize={b.value === "h1" ? 24 : b.value === "h2" ? 20 : b.value === "h3" ? 16 : b.value === "h4" ? 14 : b.value === "h5" ? 13 : b.value === "h6" ? 12 : undefined}
              onClick={() => pick("style", b.value)} />
          ))}
        </KMenu>
      );
    }
    if (menu === "fontsize") {
      return (
        <KMenu menu="fontsize">
          {FONT_SIZE_OPTIONS.map((v) => (
            <KMenuItem key={v} label={v + "px"} selected={state.fontSize === v} onClick={() => pick("fontsize", v)} />
          ))}
        </KMenu>
      );
    }
    if (menu === "color" || menu === "bgcolor") {
      const isColor = menu === "color";
      return (
        <div className="selection-toolbar__colorpop ne-ui-toolbar-color-picker-overlay" data-menu={menu}>
          <LakeColorBoard
            variant={isColor ? "text" : "bg"}
            value={isColor ? state.color : state.bgColor}
            onSelect={(c) => { if (c) pick(isColor ? "color" : "bgColor", c); else pick(isColor ? "clearColor" : "clearBgColor", undefined); }}
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
          <div className="selection-toolbar__row">
            <input className="selection-toolbar__input" type="text" placeholder="https://…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyTextLink(); }} />
            <button type="button" className="selection-toolbar__apply" onClick={applyTextLink}>应用</button>
          </div>
          <button type="button" className="selection-toolbar__item" onClick={() => { run("unlink"); setMenu(null); }}>移除链接</button>
        </div>
      );
    }
    return null;
  };

  const renderText = () => {
    const styleLabel = PARAGRAPH_STYLES.find((b) => b.value === state.style)?.label ?? "正文";
    const sizeLabel = (state.fontSize ?? 16) + "px";
    return (
      <>
        <KToolButton label="清除格式" icon="editor-clearFormat" onClick={() => run("clearFormat")} />
        <span className="selection-toolbar__sep" />
        <KDropdownButton label="段落样式" active={menu === "style"} extra="ne-ui-toolbar-select-button ne-ui-toolbar-format" onClick={(e) => toggleMenu("style", e.currentTarget)}>
          <span className="selection-toolbar__trigger-label">{styleLabel}</span>
          <span className="ne-ui-toolbar-status-dropdown-arrow" />
        </KDropdownButton>
        <KDropdownButton label="字号" active={menu === "fontsize"} extra="ne-ui-toolbar-select-button ne-ui-toolbar-fontsize" onClick={(e) => toggleMenu("fontsize", e.currentTarget)}>
          <span className="selection-toolbar__trigger-label">{sizeLabel}</span>
          <span className="ne-ui-toolbar-status-dropdown-arrow" />
        </KDropdownButton>
        <span className="selection-toolbar__sep" />
        <KToggleButton label="加粗" icon="bold" active={state.marks.bold} onClick={() => run("bold")} />
        <KToggleButton label="倾斜" icon="italic" active={state.marks.italic} onClick={() => run("italic")} />
        <KToggleButton label="中划线" icon="strikethrough" active={state.marks.strikethrough} onClick={() => run("strikethrough")} />
        <KToggleButton label="下划线" icon="underline" active={state.marks.underline} onClick={() => run("underline")} />
        <span className="selection-toolbar__sep" />
        <KDropdownButton label="文字颜色" icon="editor-color" active={menu === "color" || Boolean(state.color)} onClick={(e) => toggleMenu("color", e.currentTarget)} />
        <KDropdownButton label="背景色" icon="editor-bgColor" active={menu === "bgcolor" || Boolean(state.bgColor)} onClick={(e) => toggleMenu("bgcolor", e.currentTarget)} />
        <span className="selection-toolbar__sep" />
        <KDropdownButton label="转为" icon="t-moremark" active={menu === "convert"} onClick={(e) => toggleMenu("convert", e.currentTarget)} />
        <KDropdownButton label="超链接" icon="editor-link" active={menu === "txtlink"} onClick={(e) => openWithDraft("txtlink", "", e.currentTarget)} />
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
      onMouseDown={(event) => event.preventDefault()}
    >
      {target.kind === "text" ? renderText() : renderImage(target)}
      {target.kind === "text" ? renderTextMenu() : null}
    </div>
  );
}
