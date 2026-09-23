/**
 * 桌面编辑态「浮动工具栏」（选区气泡）——两种形态（触发见 useSelectionToolbar）：
 *   · 文字选区：正文样式 / 字号 / B I S U / 行内代码 / 字体色 / 对齐 / 更多（背景色·引用·清除格式）
 *   · 图片选中：裁剪(待接入) / 旋转 / 宽高 / 链接 / 描述 / 对齐 / 边距 / 复制 / 下载 / 删除
 *
 * 规则（docs/FLOATING-TOOLBAR-DESIGN-260919.md + LAKEX-CONTRACT §5.10）：
 *   - 全部走内核原生命令（execCommand / queryCommandValue / updateImageData），不碰模型文件。
 *   - 容器 onMouseDown preventDefault：点按钮不丢选区（与块菜单/移动 dock 同一套经验）。
 *   - 定位自算（computeToolbarPosition），不依赖内核内部件；表格 / 代码块内不出现。
 *   - 「链接」文字命令内核未验通（禁止静默 no-op）；图片的 link/title/margin/rotation/crop 走
 *     updateImageData（260924 实测有效）。裁剪的交互态入口、样式子项、批量语义待确认，先置灰。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ALargeSmall, AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Code, Copy, Crop, Download,
  Eraser, Italic, Link2, MoreHorizontal, MoveVertical, Palette, Quote, RotateCw, Scaling,
  Strikethrough, Trash2, Type, Underline,
} from "lucide-react";
import { native } from "../../../lib/native";
import { FONT_SIZE_OPTIONS, STYLE_BLOCKS } from "../editorCommands";
import type { LakeEditorInstance } from "../lakeRuntime";
import { computeToolbarPosition, imageSizeWidth, parseAssetRef, TOOLBAR_MARGIN, type ImageSizePreset } from "./selectionToolbarModel";
import { useSelectionToolbar, type ImageTarget } from "./useSelectionToolbar";

/** 正文颜色 / 背景色板：内核 color / bgColor 命令的实参（文档内容色，非 UI 主题色）。 */
const TEXT_COLORS = ["#1f2329", "#646a73", "#d83931", "#de7802", "#ffc60a", "#2ea121", "#245bdb", "#6425d0"];
const BG_COLORS = ["#fff3c1", "#d9f2d0", "#d4e8ff", "#ffded6", "#f0f0f2"];

function IconButton({ label, active, disabled, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode;
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

interface ImageCardData {
  getOriginalWidth?: () => number;
  getUserWidth?: () => number;
  getRotation?: () => number;
  getStyle?: () => string;
  getLink?: () => string;
  getTitle?: () => string;
  showTitle?: () => boolean;
}
interface ImageMeta {
  originalWidth: number; width: number; rotation: number; style: string; link: string; title: string; showTitle: boolean;
}

/** 从内核图片卡实例读当前状态（priority: cardData getters → DOM 回退）。 */
function readImageMeta(cardEl: HTMLElement): ImageMeta {
  const ref = (cardEl as unknown as { _neRef?: { _virtualNode?: { _instance?: unknown }; _instance?: unknown } })._neRef;
  const inst = (ref?._virtualNode?._instance ?? ref?._instance) as { cardData?: ImageCardData; _cardData?: ImageCardData } | undefined;
  const cd = inst?.cardData ?? inst?._cardData;
  const img = cardEl.querySelector("img");
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    originalWidth: num(cd?.getOriginalWidth?.()) ?? img?.naturalWidth ?? 320,
    width: num(cd?.getUserWidth?.()) ?? num(img?.clientWidth) ?? 0,
    rotation: num(cd?.getRotation?.()) ?? 0,
    style: (cd?.getStyle?.() as string) || "none",
    link: (cd?.getLink?.() as string) || "",
    title: (cd?.getTitle?.() as string) || "",
    showTitle: cd?.showTitle?.() === true,
  };
}

export function SelectionToolbar({ editor, container, noteId }: {
  editor: LakeEditorInstance; container: HTMLElement; noteId: string;
}) {
  const { target, state, run, toolbarRef } = useSelectionToolbar(editor, container);
  const [menu, setMenu] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const keyRef = useRef<string>("none");

  // 目标或菜单变化后重新测量定位（菜单会更宽/更高）。
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!target || !el) { setPos(null); return; }
    const size = el.getBoundingClientRect();
    // 顶界 = 内核固定工具栏底边（sticky，会盖住选区上方的浮框）⇒ 空间不够就翻到选区下方。
    const chrome = document.querySelector(".ne-ui-toolbar");
    const host = container.getBoundingClientRect();
    const topLimit = Math.max(chrome ? chrome.getBoundingClientRect().bottom : 0, host.top + TOOLBAR_MARGIN);
    const p = computeToolbarPosition(target.rect, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }, topLimit);
    // 左右不越出编辑器内容区（否则会盖到左侧目录栏，点不到）。
    let left = p.left;
    const minLeft = host.left + TOOLBAR_MARGIN;
    const maxLeft = host.right - size.width - TOOLBAR_MARGIN;
    if (maxLeft >= minLeft) left = Math.min(Math.max(left, minLeft), maxLeft);
    setPos({ left, top: p.top });
  }, [target, menu, toolbarRef, container]);

  const key = target ? target.kind + ":" + Math.round(target.rect.top) + ":" + Math.round(target.rect.left) : "none";
  useEffect(() => {
    if (keyRef.current !== key) { keyRef.current = key; setMenu(null); setDraft(""); }
  }, [key]);

  const pick = useCallback((name: string, value: unknown) => { run(name, value); setMenu(null); }, [run]);

  if (!target) return null;

  const renderMenu = () => {
    if (menu === "style") {
      return (
        <div className="selection-toolbar__menu" role="menu" data-menu="style">
          {STYLE_BLOCKS.map((b) => (
            <button key={b.value} type="button" role="menuitem" className={"selection-toolbar__item" + (state.style === b.value ? " is-active" : "")} onClick={() => pick("style", b.value)}>{b.label}</button>
          ))}
        </div>
      );
    }
    if (menu === "fontsize") {
      return (
        <div className="selection-toolbar__menu selection-toolbar__menu--grid" role="menu" data-menu="fontsize">
          {FONT_SIZE_OPTIONS.map((v) => (
            <button key={v} type="button" role="menuitem" className={"selection-toolbar__item" + (state.fontSize === v ? " is-active" : "")} onClick={() => pick("fontsize", v)}>{v}</button>
          ))}
        </div>
      );
    }
    if (menu === "color") {
      return (
        <div className="selection-toolbar__menu selection-toolbar__menu--swatch" role="menu" data-menu="color">
          {TEXT_COLORS.map((c) => (
            <button key={c} type="button" role="menuitem" aria-label={"字体色 " + c} className="selection-toolbar__swatch" style={{ background: c }} onClick={() => pick("color", c)} />
          ))}
        </div>
      );
    }
    if (menu === "align") {
      return (
        <div className="selection-toolbar__menu" role="menu" data-menu="align">
          <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => pick("alignment", "left")}><AlignLeft size={15} /> 左对齐</button>
          <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => pick("alignment", "center")}><AlignCenter size={15} /> 居中</button>
          <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => pick("alignment", "right")}><AlignRight size={15} /> 右对齐</button>
        </div>
      );
    }
    if (menu === "more") {
      return (
        <div className="selection-toolbar__menu" role="menu" data-menu="more">
          <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => pick("quote", undefined)}><Quote size={15} /> 引用</button>
          <button type="button" role="menuitem" className="selection-toolbar__item" onClick={() => pick("clearFormat", undefined)}><Eraser size={15} /> 清除格式</button>
          <div className="selection-toolbar__menu-label">背景色</div>
          <div className="selection-toolbar__menu--swatch">
            {BG_COLORS.map((c) => (
              <button key={c} type="button" role="menuitem" aria-label={"背景色 " + c} className="selection-toolbar__swatch" style={{ background: c }} onClick={() => pick("bgColor", c)} />
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const renderText = () => {
    const styleLabel = STYLE_BLOCKS.find((b) => b.value === state.style)?.label ?? "正文";
    const alignValue = state.alignment || "left";
    return (
      <>
        <button type="button" className="selection-toolbar__text" onClick={() => setMenu(menu === "style" ? null : "style")} title="段落样式"><Type size={14} />{styleLabel}<ChevronDown size={12} /></button>
        <button type="button" className="selection-toolbar__text" onClick={() => setMenu(menu === "fontsize" ? null : "fontsize")} title="字号"><ALargeSmall size={14} />{state.fontSize ?? "字号"}<ChevronDown size={12} /></button>
        <span className="selection-toolbar__sep" />
        <IconButton label="加粗" active={state.marks.bold} onClick={() => run("bold")}><Bold size={15} /></IconButton>
        <IconButton label="斜体" active={state.marks.italic} onClick={() => run("italic")}><Italic size={15} /></IconButton>
        <IconButton label="删除线" active={state.marks.strikethrough} onClick={() => run("strikethrough")}><Strikethrough size={15} /></IconButton>
        <IconButton label="下划线" active={state.marks.underline} onClick={() => run("underline")}><Underline size={15} /></IconButton>
        <IconButton label="行内代码" active={state.marks.code} onClick={() => run("code")}><Code size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label="字体颜色" active={Boolean(state.color)} onClick={() => setMenu(menu === "color" ? null : "color")}><Palette size={15} /></IconButton>
        <IconButton label="对齐" active={alignValue !== "left"} onClick={() => setMenu(menu === "align" ? null : "align")}><AlignLeft size={15} /></IconButton>
        <IconButton label="更多" active={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}><MoreHorizontal size={15} /></IconButton>
      </>
    );
  };

  const renderImage = (t: ImageTarget) => {
    const asset = parseAssetRef(t.src);
    const meta = readImageMeta(t.cardEl);
    const apply = (data: Record<string, unknown>) => { run("updateImageData", t.cardId, data); setMenu(null); };
    const openWithDraft = (m: string, value: string) => { setDraft(value); setMenu(menu === m ? null : m); };
    const sizeItem = (p: ImageSizePreset, label: string) => (
      <button key={p} type="button" role="menuitem" className="selection-toolbar__item" onClick={() => apply({ width: imageSizeWidth(p, meta.originalWidth) })}>{label}</button>
    );
    const applyDraft = (fn: (v: string) => void) => { fn(draft); };
    return (
      <>
        <IconButton label="裁剪（交互态入口待接入）" disabled><Crop size={15} /></IconButton>
        <IconButton label="旋转 90°" onClick={() => apply({ rotation: ((meta.rotation || 0) + 90) % 360 })}><RotateCw size={15} /></IconButton>
        <IconButton label="宽高" active={menu === "imgsize"} onClick={() => openWithDraft("imgsize", meta.width ? String(meta.width) : "")}><Scaling size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label="链接" active={menu === "imglink" || Boolean(meta.link)} onClick={() => openWithDraft("imglink", meta.link)}><Link2 size={15} /></IconButton>
        <IconButton label="描述" active={menu === "imgtitle" || Boolean(meta.title)} onClick={() => openWithDraft("imgtitle", meta.title)}><Type size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label="对齐" active={menu === "imgalign"} onClick={() => setMenu(menu === "imgalign" ? null : "imgalign")}><AlignLeft size={15} /></IconButton>
        <IconButton label="边距" active={menu === "imgmargin"} onClick={() => setMenu(menu === "imgmargin" ? null : "imgmargin")}><MoveVertical size={15} /></IconButton>
        <span className="selection-toolbar__sep" />
        <IconButton label={asset ? "复制图片" : "复制（非本机资源不可用）"} disabled={!asset} onClick={() => { if (asset) void native.copyAssetImage(asset.noteId, asset.filename); }}><Copy size={15} /></IconButton>
        <IconButton label={asset ? "另存为" : "下载（非本机资源不可用）"} disabled={!asset} onClick={() => { if (asset) void native.saveAssetAs(asset.noteId, asset.filename, asset.filename); }}><Download size={15} /></IconButton>
        <IconButton label="删除图片" onClick={() => { run("deleteCard", t.cardId); setMenu(null); }}><Trash2 size={15} /></IconButton>

        {menu === "imgsize" && (
          <div className="selection-toolbar__menu" role="menu" data-menu="imgsize">
            <div className="selection-toolbar__menu--row">{sizeItem("small", "小")}{sizeItem("medium", "中")}{sizeItem("large", "大")}{sizeItem("original", "原始")}</div>
            <div className="selection-toolbar__row">
              <input className="selection-toolbar__input" type="number" min="16" placeholder="宽度 px" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const n = Number(draft); if (n > 0) applyDraft(() => apply({ width: Math.round(n) })); } }} />
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
      </>
    );
  };

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      data-kind={target.kind}
      role="toolbar"
      aria-label={target.kind === "text" ? "文字格式工具栏" : "图片工具栏"}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {target.kind === "text" ? renderText() : renderImage(target)}
      {renderMenu()}
    </div>
  );
}
