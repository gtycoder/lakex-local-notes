/**
 * 桌面编辑态「浮动工具栏」（选区气泡）——两种形态：
 *   · 文字选区（对齐内核固定工具栏的 Lake 风格，顺序 260924 用户定）：
 *     清除格式 · 字号 · 加粗 · 倾斜 · 中划线 · 下划线 · 文字颜色 · 背景色 · 格式 · AI
 *     （「格式」= 260930 起把 段落样式(正文/标题1–6) + 有序/无序/待办/引用/行内代码/链接 并成
 *      **一个父入口 + 菜单**；父入口图标跟着当前块类型走，正文时是内核的「正文」图标）
 *   · 图片选中：裁剪 / 旋转 / 宽高 / 链接 / 描述 / 对齐 / 样式 / 边距 / 批量应用 / 复制 / 下载 / 删除
 *
 * 规则：
 *   - 组件自研、能力全走内核：文字用 execCommand/queryCommandValue，图片用 updateImageData/
 *     cardBatchApply/deleteCard + 卡 UI setCro（原生能力），不自实现富文本或图片逻辑。
 *   - 文字形态复用内核固定工具栏的类名与图标 sprite（ant-btn / ne-ui-toolbar-* / ne-icon-*），
 *     不用第三方（钉钉）风格；active 态用内核的 .checked 类。
 *   - 容器 onMouseDown preventDefault：点按钮不丢选区；定位自算 + 避开固定工具栏；表格/代码块内不出现。
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { reportNativeActionError } from "../../../lib/nativeErrors";
import { native } from "../../../lib/native";
import {
  FONT_SIZE_OPTIONS, TOOLBAR_BLOCK_TYPE_ITEMS, TOOLBAR_FORMAT_ITEMS, type ToolbarBlockTypeItem,
} from "../editorCommands";
import type { LakeEditorInstance } from "../lakeRuntime";
import { IMAGE_STYLE_OPTIONS, enterImageCrop, readImageMeta, setImageSpacing } from "./imageCardOps";
import {
  IconImageAlign, IconImageBatch, IconImageCrop, IconImageLink, IconImageRotate,
  IconImageSize, IconImageSpacing, IconImageStyle, IconImageTitle,
} from "./imageIcons";
import { KCheckbox, KEmbedIcon, KIcon, KLinkEditor, KSwitch, KToolbarButton, kernelHotkey, useHoverTip } from "./kernelUiAtoms";
import { AiTagIcon } from "../../ai/AiTagIcon";
import { AiAssistantDialog, AI_DIALOG_GAP } from "../../ai/AiAssistantDialog";
import { applyModelRange, captureModelRange, type CapturedModelRange } from "./aiModelSelection";
import { LakeColorBoard } from "./LakeColorBoard";
import {
  currentColor, normalTextColor, paletteDefaultValue, persistentColor, rememberColor, type ColorVariant,
} from "./colorMemory";
import { colorApplyCommand, computeToolbarPosition, imageSizeWidth, lineBoxRects, parseAssetRef, TOOLBAR_MARGIN, type SelectionRect } from "./selectionToolbarModel";
import { firstRangeRect, useSelectionToolbar, type ImageTarget } from "./useSelectionToolbar";
import { placePopoverBeside, placePopoverPosition } from "../../../hooks/topMenuPosition";

/** 取真实有盒子的触发元素：内核原子件外层是 display:contents 包裹（它的 rect 恒为 0×0，量不出锚点）。 */
function resolveTriggerEl(trigger?: HTMLElement | null): HTMLElement | null {
  return trigger ? ((trigger.querySelector("button") as HTMLElement | null) ?? trigger) : null;
}

/**
 * AI 结果一律转成**引用格式**落盘（用户 261004：「替换选区」「插入到选区后」都用引用）。
 * markdown 引用 = 每行前加 `> `；空行写成 `>`（引用续行），交给内核转成 <blockquote>。
 */
export function toQuoteMarkdown(text: string): string {
  return text.replace(/\r\n/g, "\n").split("\n").map((line) => (line.trim().length > 0 ? "> " + line : ">")).join("\n");
}

/**
 * AI 结果自动选中新内容时要认的**行级块**。
 * ⚠️ 插入前记集合、插入后取差集**必须用同一个选择器**，否则差集失真（会漏选或多选）。
 */
const SELECTABLE_BLOCKS = "ne-quote, ne-p, ne-h1, ne-h2, ne-h3, ne-h4, ne-h5, ne-h6, ne-tli, ne-oli, ne-alert, ne-collapse";

/** 引擎内当前所有可自动选中的行级块（插入前快照用）。 */
function blockSetOf(container: HTMLElement): Set<Element> {
  const engine = container.querySelector(".ne-engine");
  return new Set<Element>(engine ? Array.from(engine.querySelectorAll(SELECTABLE_BLOCKS)) : []);
}

/**
 * 插入完成后**自动选中刚插入的块**（用户 261004）。用 DOM 实现：内核模型选区捕获后可能已随渲染失效
 * （applyModelRange 实测返回 false —— 它内部自己吞掉异常），而新增块在 DOM 里是确定的
 * ⇒ 插入前后各取一次集合，差集就是新块。
 */
function selectNewBlocks(container: HTMLElement, before: Set<Element>): void {
  const engine = container.querySelector(".ne-engine");
  if (!engine) return;
  const fresh = Array.from(engine.querySelectorAll(SELECTABLE_BLOCKS))
    .filter((el) => !before.has(el));
  if (fresh.length === 0) return;
  try {
    const range = document.createRange();
    range.setStartBefore(fresh[0]);
    range.setEndAfter(fresh[fresh.length - 1]);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  } catch { /* 选区设置失败不影响已插入内容 */ }
}

/** 两个矩形列表是否近似相等：避免无意义的 state 更新 → 重渲染 → 闪（用户 261004：不许跳动）。 */
function sameRects(a: SelectionRect[] | null, b: SelectionRect[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((r, i) => Math.abs(r.left - b[i].left) < 0.5 && Math.abs(r.top - b[i].top) < 0.5
    && Math.abs(r.width - b[i].width) < 0.5 && Math.abs(r.height - b[i].height) < 0.5);
}


/**
 * 取**本编辑器**的内核固定工具栏（.ne-ui-toolbar）。
 *
 * 261005：原来在 document 全局找「第一个 height>0 的」——那是**几何猜可见**。而 261005 起非活动标签
 * 改用保留布局的方式隐藏（opacity+visibility），隐藏实例的 rect **不再是 0** ⇒ 那个启发式必然会拿错
 * （拿到别的标签的工具栏当顶界）。
 * 内核固定工具栏本来就在本编辑器挂载点内（.ne-ui-toolbar → .ne-ui → .ne-editor → .lake-editor-mount），
 * 直接在**自己的 container 里**取，天然正确（锁定时不存在 ⇒ 返回 null，回退到 host 顶边）。
 */
function chromeToolbarOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".ne-ui-toolbar");
}


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

/** 浮层未定位前先挂到屏外：layout effect 在浏览器绘制前就会写入实测坐标，所以用户看不到这一帧。 */
const OFFSCREEN: CSSProperties = { left: -9999, top: -9999, visibility: "hidden" };

/** 内核下拉菜单（ant-dropdown-menu + ne-ui-select-*），与固定工具栏一致。
 *  `sub` = 挂在某个菜单项里的**二级菜单**（贴该项右侧展开，见 .selection-toolbar__kmenu--sub）。 */
function KMenu({ menu, sub, surfaceRef, style, children }: { menu: string; sub?: boolean; surfaceRef?: (el: HTMLElement | null) => void; style?: CSSProperties; children: ReactNode }) {
  return (
    // 字号菜单额外挂内核的 dropdown 类，让 .ne-ui-toolbar-fontsize-dropdown 规则也生效（与固定栏一致）。
    <div ref={surfaceRef} style={style} className={"selection-toolbar__kmenu" + (sub ? " selection-toolbar__kmenu--sub" : "") + (menu === "fontsize" ? " ne-ui-toolbar-fontsize-dropdown" : "")} data-menu={menu}>
      <ul className="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light ne-ui-select-menu" role="menu">{children}</ul>
    </div>
  );
}

function KMenuItem({ label, icon, selected, disabled, shortcut, labelClass, onClick }: {
  label: string; icon?: string; selected?: boolean; disabled?: boolean; shortcut?: string; labelClass?: string; onClick?: () => void;
}) {
  return (
    <li
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={"ant-dropdown-menu-item ne-ui-select-item"
        + (selected ? " ant-dropdown-menu-item-selected" : "")
        + (disabled ? " ant-dropdown-menu-item-disabled" : "")}
      onClick={disabled ? undefined : onClick}
    >
      <div className="ne-ui-select-item-check-icon">{selected ? <KIcon type="check" /> : null}</div>
      <div className="ne-ui-select-item-label">
        <div className="ne-ui-select-content">
          <span className={labelClass ?? "ne-ui-item-content"}>
            {icon ? <span className="selection-toolbar__mi-icon"><KIcon type={icon} size={15} /></span> : null}
            {label}
          </span>
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
  /** AI 助手（P0）：点按钮时先冻结浮栏并抓住选区文本，再开对话框。 */
  const [aiOpen, setAiOpen] = useState(false);
  const aiSelectionRef = useRef("");
  /** 打开对话框会丢焦点 → 内核选区被折叠。这里克隆 DOM Range，替换前恢复，保证「替换」而不是「插入」。 */
  const aiRangeRef = useRef<Range | null>(null);
  /** 打开时选区的视口落点（面板贴选区悬浮，无遮罩）。 */
  const aiAtRef = useRef<{ x: number; y: number } | null>(null);
  /** 「插入 / 替换」刚写完正文并**自动选中了新内容** ⇒ 关闭面板时不要再把选区还原成原选区（会盖掉选中）。 */
  const aiKeepSelectionRef = useRef(false);
  /** 打开对话框前捕获的**内核模型选区**（替换用；模型态不随焦点丢失）。 */
  const aiModelRangeRef = useRef<CapturedModelRange | null>(null);
  /** 弹层开着 ⇒ 冻结浮栏刷新（见 useSelectionToolbar.refreshNow）。 */
  const holdRef = useRef(false);
  // AI 对话框开着时也冻结：它覆盖浮栏上方，选区的变化不应让浮栏跳动。
  holdRef.current = menu !== null || aiOpen;
  const { target, state, run, refresh, toolbarRef, targetRef } = useSelectionToolbar(editor, container, holdRef);
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
  /** 每次打开浮层自增：同一个菜单名换触发项再开时也要重新定位。 */
  const [menuSeq, setMenuSeq] = useState(0);
  /** 二级菜单（目前只有「标题」，见 blockformat 菜单）。 */
  const [subMenu, setSubMenu] = useState<string | null>(null);
  /** 打开浮层的触发元素（已解到真实按钮）：既当定位锚点，也供菜单项「链接」弹内核链接编辑层。 */
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  /** 主浮层 / 二级菜单的实测定位（fixed 坐标，由 placePopover* 单一来源算出）。 */
  const popoverRef = useRef<HTMLElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const subRef = useRef<HTMLElement | null>(null);
  const [subStyle, setSubStyle] = useState<CSSProperties | null>(null);
  const setPopoverRef = useCallback((el: HTMLElement | null) => { popoverRef.current = el; }, []);
  const setSubMenuRef = useCallback((el: HTMLElement | null) => { subRef.current = el; }, []);
  /**
   * 把 placePopover* 算出的**视口**坐标再夹进**编辑器区域**：浮栏的 z-index 低于目录栏/顶栏/大纲，
   * 只按视口夹会让菜单跑到目录栏下面被盖住（= 看不见，用户 260930 第 3 条要的正是"不能不可见"）。
   * 竖向还额外让开编辑器固定工具栏（.ne-ui-toolbar），否则翻到上方时会钻到它后面。
   */
  const clampToEditorArea = useCallback((point: { left: number; top: number }, size: { width: number; height: number }) => {
    const host = container.getBoundingClientRect();
    const chrome = chromeToolbarOf(container);
    const topLimit = Math.max(host.top, chrome ? chrome.getBoundingClientRect().bottom : 0) + TOOLBAR_MARGIN;
    const minLeft = host.left + TOOLBAR_MARGIN;
    const maxLeft = Math.max(minLeft, Math.min(window.innerWidth, host.right) - size.width - TOOLBAR_MARGIN);
    const maxTop = Math.max(topLimit, Math.min(window.innerHeight, host.bottom) - size.height - TOOLBAR_MARGIN);
    return {
      left: Math.round(Math.max(minLeft, Math.min(point.left, maxLeft))),
      top: Math.round(Math.max(topLimit, Math.min(point.top, maxTop))),
    };
  }, [container]);
  const keyRef = useRef<string>("none");

  /**
   * 浮栏挂在**滚动内容**（.ne-editor-wrap，position:relative+overflow:auto）里、用**内容坐标**定位：
   * 它随正文一起滚（合成器线程同步、零相对位移 ⇒ 快滚也不跳），并被滚动容器裁掉
   * （滚到顶界以上从固定工具栏下沿滑出，而不是盖在顶区）。因此**滚动时无需任何 JS 更新**。
   * 只在选区变化 / 内容尺寸变化 / 窗口缩放时定位；规则：始终放在选区上方（allowBelow=false）。
   */
  const placeToolbarNow = useCallback(() => {
    const el = toolbarRef.current;
    if (!el || holdRef.current) return;          // 浮层开着时冻结，与 hook 的 refresh 一致
    const t = targetRef.current;
    if (!t) return;
    const wrap = container.querySelector<HTMLElement>(".ne-editor-wrap");
    if (!wrap) return;                           // 内核滚动容器尚未就绪：先不显示（稍后会再定位）
    // 宿主确保在滚动容器内（首次挂载时 wrap 可能还没建好）
    const host = el.parentElement;
    if (host && host.parentElement !== wrap) wrap.appendChild(host);
    // 用**当前**选区 rect（而非 state 快照）：它与下面的 scrollTop 同一时刻读 ⇒ 内容坐标恒定，滚动不漂移
    const sel = window.getSelection();
    const rect = t.kind === "image"
      ? t.cardEl.getBoundingClientRect()
      : (sel && !sel.isCollapsed && sel.rangeCount > 0 ? firstRangeRect(sel.getRangeAt(0)) : null);
    if (!rect) return;
    const size = el.getBoundingClientRect();
    const p = computeToolbarPosition(rect, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }, TOOLBAR_MARGIN, false);
    const wr = wrap.getBoundingClientRect();
    // 水平仍夹在编辑区（wrap）内；再换算成 wrap 的**内容坐标**（+scrollLeft/scrollTop）
    let leftViewport = p.left;
    const minLeft = wr.left + TOOLBAR_MARGIN;
    const maxLeft = wr.right - size.width - TOOLBAR_MARGIN;
    if (maxLeft >= minLeft) leftViewport = Math.min(Math.max(leftViewport, minLeft), maxLeft);
    el.style.left = leftViewport - wr.left + wrap.scrollLeft + "px";
    el.style.top = p.top - wr.top + wrap.scrollTop + "px";
    el.style.visibility = "visible";
  }, [container, targetRef, toolbarRef]);

  // 挂载首帧 / 目标变化 / 菜单态变化后定位；缩放会改变 wrap 几何，需重算。滚动不需要（随内容滚）。
  useLayoutEffect(() => { placeToolbarNow(); }, [target, menu, placeToolbarNow]);
  useEffect(() => {
    window.addEventListener("resize", placeToolbarNow);
    return () => window.removeEventListener("resize", placeToolbarNow);
  }, [placeToolbarNow]);

  /**
   * 浮层定位（260930 用户第 3 条：所有这种「位置不固定」的弹窗都要做边缘适配）——
   * 统一走项目里的单一来源 `placePopoverPosition`（下方优先 → 放不下翻上方 → 夹进视口），
   * 和目录栏右键菜单同一套；不再用「只夹横向、还夹在浮栏宽度内」的土办法（那套贴窗口边照样被裁）。
   * 主浮层与二级菜单都改成 position:fixed + 实测坐标。
   */
  useLayoutEffect(() => {
    if (!menu) { setPopoverStyle(null); return; }
    const el = popoverRef.current;
    const trigger = menuTriggerRef.current;
    if (!el || !trigger) return;
    const placed = placePopoverPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: el.offsetWidth, height: el.offsetHeight },
      6,
      { margin: TOOLBAR_MARGIN },
    );
    setPopoverStyle(clampToEditorArea(placed, { width: el.offsetWidth, height: el.offsetHeight }));
  }, [menu, menuSeq, clampToEditorArea]);
  /** 二级菜单：贴所在行右侧展开；右侧放不下翻左侧、再夹进视口（placePopoverBeside 同款）。 */
  useLayoutEffect(() => {
    if (!subMenu) { setSubStyle(null); return; }
    const el = subRef.current;
    const row = el?.parentElement?.getBoundingClientRect();
    if (!el || !row) return;
    const placed = placePopoverBeside(
      row,
      { width: window.innerWidth, height: window.innerHeight },
      { width: el.offsetWidth, height: el.offsetHeight },
      2,
      { margin: TOOLBAR_MARGIN },
    );
    setSubStyle(clampToEditorArea(placed, { width: el.offsetWidth, height: el.offsetHeight }));
  }, [subMenu, menu, clampToEditorArea]);

  const key = target ? target.kind + ":" + Math.round(target.rect.top) + ":" + Math.round(target.rect.left) : "none";
  useEffect(() => {
    if (keyRef.current !== key) { keyRef.current = key; setMenu(null); setSubMenu(null); setDraft(""); setLinkText(""); setLinkSrc(""); }
  }, [key]);
  /** 主菜单收起/换项时一并收起二级菜单（否则下次打开会残留上一次的展开态）。 */
  useEffect(() => { if (!menu) setSubMenu(null); }, [menu]);

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

  /** 打开/切换主菜单（触发元素留给定位用；menuSeq 让「同名菜单换触发项再开」也能重新定位）。 */
  const toggleMenu = useCallback((m: string, trigger?: HTMLElement | null) => {
    menuTriggerRef.current = resolveTriggerEl(trigger);
    setMenuSeq((n) => n + 1);
    setMenu((current) => (current === m ? null : m));
  }, []);
  const openWithDraft = useCallback((m: string, value: string, trigger?: HTMLElement | null) => {
    menuTriggerRef.current = resolveTriggerEl(trigger);
    setMenuSeq((n) => n + 1);
    setDraft(value);
    setMenu((current) => (current === m ? null : m));
  }, []);
  /** 打开内核样式的链接编辑弹层：文本预填当前选区、链接为空；同时暂存选区以便确认时还原。 */
  const openLinkEditor = useCallback((trigger?: HTMLElement | null) => {
    menuTriggerRef.current = resolveTriggerEl(trigger);
    setMenuSeq((n) => n + 1);
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

  /**
   * AI 交互期间保持「原选区」高亮。
   *
   * 背景：AI 提问框 autoFocus 会把 DOM 选区折叠 ⇒ 原生 ::selection 消失，用户看不到自己在处理哪段文字。
   *
   * ⚠️ 为什么不用 CSS Custom Highlight API（`::highlight()`）：Chromium 里它**只画字形盒**（≈21px），
   *    而内核原生选区按**行盒**（line-height ≈30px）绘制 ⇒ 比原生矮一截、行与行之间露缝（用户 261004
   *    实测「行间距没处理，前后效果不同」）。要复刻原生，唯一口径就是按行盒自己画矩形。
   *
   * 几何全部走 `lineBoxRects()`（撑到行高 + 按行合并成一个；单一来源、有单测）。宿主挂在滚动容器里、
   * 用**内容坐标** ⇒ 随正文一起滚、被滚动容器裁切（不画到顶栏）；也因此**不监听 scroll**（内容坐标本就跟随）。
   * 只监听选区/焦点变化，并用矩形比对去重 ⇒ 不来回重画（用户 261004：不许跳动）。
   * 只在「原生选区已被折叠 / 就是捕获的那段」时接管；用户另选了别的文字就把高亮让回原生。
   */
  const [aiSelRects, setAiSelRects] = useState<SelectionRect[] | null>(null);
  // ⚠️ 用 useLayoutEffect（绘制前同步完成）：原生选区会被提问框 autoFocus 折叠，若自绘层晚一帧才挂上，
  //    中间有一帧「原生已消失、自绘还没出现」⇒ 点 AI 按钮时会闪一下（用户 261004 报）。布局阶段
  //    先算好并 setAiSelRects，React 会在同一帧同步重渲染 ⇒ 第一帧就有「面板 + 自绘 + 原生已隐藏」。
  useLayoutEffect(() => {
    if (!aiOpen) { setAiSelRects(null); return; }
    const captured = aiRangeRef.current;
    const ownsSelection = () => {
      const native = window.getSelection();
      if (!native || native.rangeCount === 0 || native.isCollapsed) return true;
      if (!captured) return false;
      const r = native.getRangeAt(0);
      return r.startContainer === captured.startContainer && r.startOffset === captured.startOffset
        && r.endContainer === captured.endContainer && r.endOffset === captured.endOffset;
    };
    const measure = () => {
      const own = ownsSelection();
      container.classList.toggle("lake-ai-sel-hidden", own);
      if (!own || !captured) { setAiSelRects(null); return; }
      try {
        // 行高取捕获范围所在块（line-height 可能是 "normal" → 按 1.6×字号兜底）。
        const el = captured.startContainer.nodeType === Node.ELEMENT_NODE
          ? (captured.startContainer as Element)
          : captured.startContainer.parentElement;
        const cs = el ? window.getComputedStyle(el) : null;
        const fontSize = cs ? Number.parseFloat(cs.fontSize) : NaN;
        const rawLineHeight = cs ? Number.parseFloat(cs.lineHeight) : NaN;
        const lineHeight = Number.isFinite(rawLineHeight) ? rawLineHeight : (Number.isFinite(fontSize) ? fontSize * 1.6 : 0);
        // 内容坐标 = 视口坐标 − 内容原点（宿主在 .ne-editor-wrap 里 ⇒ 随正文滚、被滚动容器裁掉）。
        const wrap = container.querySelector<HTMLElement>(".ne-editor-wrap");
        const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
        const ox = wrap && wrapRect ? wrapRect.left - wrap.scrollLeft : 0;
        const oy = wrap && wrapRect ? wrapRect.top - wrap.scrollTop : 0;
        // ⚠️ **必须逐文本节点取矩形**：`Range.getClientRects()` 在跨块（列表项 / 标题 / 段落）时会额外
        //    返回「块盒」——整块的满宽矩形、还可能横跨多行，于是列表/标题被并成一大条满宽背景
        //    （用户 261004 实测）。逐文本节点的子 Range 只返回**文字盒**，块盒不会出现。
        const raw: SelectionRect[] = [];
        // 画布用来量「空格」宽：内核选区矩形含**行尾空格**，而 getClientRects() 只到最后一个字形
        // ⇒ 不补这一段，右缘会比内核短 4~8px（用户 261004 要求逐条对齐）。
        const canvasCtx = document.createElement("canvas").getContext("2d");
        const spaceWidthOf = (el: Element | null) => {
          if (!canvasCtx || !el) return 0;
          const cs = window.getComputedStyle(el);
          canvasCtx.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
          return canvasCtx.measureText(" ").width;
        };
        const collect = (r: Range, node: Node) => {
          const parent = node.parentElement;
          // 列表标志（一、/ • / 1.）：内核原生选区**不渲染**它们（用户 261004 截图实证）⇒ 跳过，
          // 否则我们会在标志上多画一小块背景。
          if (parent?.closest("ne-oli-i, ne-uli-i, .ne-list-symbol")) return;
          // 行高**逐片段**取：标题 / 列表 / 正文的行高各不相同，用统一行高会把正文撑得过高。
          const cs = parent ? window.getComputedStyle(parent) : null;
          const fontSize = cs ? Number.parseFloat(cs.fontSize) : NaN;
          const rawLh = cs ? Number.parseFloat(cs.lineHeight) : NaN;
          const lineHeight = Number.isFinite(rawLh) ? rawLh : (Number.isFinite(fontSize) ? fontSize * 1.6 : 0);
          const pad = spaceWidthOf(parent);
          for (const q of Array.from(r.getClientRects())) {
            if (q.width > 0 && q.height > 0) raw.push({ left: q.left - ox, top: q.top - oy, width: q.width + pad, height: q.height, lineHeight });
          }
        };
        const startNode = captured.startContainer;
        const endNode = captured.endContainer;
        const root = captured.commonAncestorContainer;
        const rootEl = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
        if (rootEl) {
          const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (!captured.intersectsNode(node)) continue;
            const sub = document.createRange();
            try {
              sub.setStart(node, node === startNode ? captured.startOffset : 0);
              sub.setEnd(node, node === endNode ? captured.endOffset : (node.textContent?.length ?? 0));
            } catch { continue; }
            if (!sub.collapsed) collect(sub, node);
          }
        }
        const value = lineBoxRects(raw, lineHeight);
        setAiSelRects((prev) => (sameRects(prev, value) ? prev : value));
      } catch { setAiSelRects(null); }
    };
    measure();
    // 不监听 scroll/resize：内容坐标本就随正文滚动；重算交给选区/焦点变化。
    document.addEventListener("selectionchange", measure);
    document.addEventListener("focusin", measure, true);
    document.addEventListener("focusout", measure, true);
    return () => {
      container.classList.remove("lake-ai-sel-hidden");
      document.removeEventListener("selectionchange", measure);
      document.removeEventListener("focusin", measure, true);
      document.removeEventListener("focusout", measure, true);
    };
  }, [aiOpen, container]);
  // 自绘高亮层：absolute 铺满滚动容器，span 用内容坐标 ⇒ 随正文滚、被容器裁切。
  const aiSelectionOverlay = aiSelRects ? (
    <div className="selection-toolbar__aisel" aria-hidden="true">
      {aiSelRects.map((r, i) => <span key={i} style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />)}
    </div>
  ) : null;


  // AI 对话框渲染在工具栏**之外**：选中态丢失时工具栏会 `return null`，对话框若挂在工具栏内部
  // 会被一起卸载 ⇒ 状态清零（用户 260930 报「点生成页面闪烁、插入按钮点不了」的根因就在这里）。
  /**
   * 关闭 AI 面板（AI 按钮再点一下、面板里的「关闭」都走这里）。
   * ⚠️ 必须把**原生选区还回去**：面板输入框把 DOM 选区折叠过，不还的话关掉面板后用户会觉得
   *    「我的选区没了」（用户 261003 实测）。等一帧再设，避免面板输入框还持有焦点时被顶掉。
   */
  const closeAi = useCallback(() => {
    setAiOpen(false);
    setMenu(null);
    // 刚插入/替换并自动选中了新内容 ⇒ 不要再还原成原选区（否则「选中新内容」会被立刻盖掉）。
    if (aiKeepSelectionRef.current) { aiKeepSelectionRef.current = false; return; }
    const range = aiRangeRef.current;
    if (!range) return;
    window.setTimeout(() => {
      try {
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        editor.execCommand?.("focus");
      } catch { /* 选区已随 DOM 失效则忽略 */ }
    }, 0);
  }, [editor]);
  const aiDialog = aiOpen ? (
    <AiAssistantDialog
      open
      at={aiAtRef.current}
      // 传入编辑区滚动容器：AI 浮窗渲染进滚动内容、用内容坐标定位 ⇒ 随正文一起滚（与浮动工具栏同款几何）
      scroller={container.querySelector<HTMLElement>(".ne-editor-wrap")}
      // 本编辑器挂载点：AI 面板的文字栏几何直接量自己（不再全局猜「哪个 mount 可见」）。
      container={container}
      selectionText={aiSelectionRef.current}
      onClose={closeAi}
      onInsertAfter={(text) => {
        try {
          // 把内核选区折叠到捕获范围的**末尾**再插入 ⇒ 落到选区之后（对应云端「插入选区下方」）。
          // ⚠️ 实测教训（260930）：内核**不接受"折叠的模型选区"**（execCommand('selection') 设成折叠态后
          // 再插入，会退化成按**原选区替换**，把用户选中的文字吃掉）；insertAtPosition(…, end) 同样没生效；
          // breakLine 的语义本身就是"删除选区内容并换行"。所以这里**不碰内核选区**，改成把
          // 「原文 + 空行 + AI 结果」一起作为一次替换写回：文本不丢，AI 结果另起一段（MD 空行 = 新块）。
          const original = aiSelectionRef.current;
          // AI 结果一律**引用格式**（用户 261004）。
          const quoted = toQuoteMarkdown(text);
          const data = original.trim() ? original + "\n\n" + quoted : quoted;
          // 插入前记下已有块集合（差集 = 新插入的块，用于插入后自动选中）。
          const before = blockSetOf(container);
          applyModelRange(editor, aiModelRangeRef.current);   // best-effort：设回原选区（返回 false 也不影响下面的插入）
          editor.execCommand?.("insertAtSelection", "text/markdown", data);
          aiKeepSelectionRef.current = true;
          window.setTimeout(() => selectNewBlocks(container, before), 0);   // 插入后自动选中新内容
          return;
        } catch { /* 命令不可用时忽略，结果仍可复制 */ }
      }}
      onReplace={(text) => {
        try {
          // AI 结果一律**引用格式**（用户 261004）；插入后自动选中新内容。
          // 模型选区优先（设回内核 ⇒ 非折叠 = 替换）；模型选区可能已随渲染失效，故再补一条 DOM 兜底：
          // 把打开前的 DOM 选区设回去，让内核按当前选区做替换。
          const quoted = toQuoteMarkdown(text);
          const before = blockSetOf(container);
          applyModelRange(editor, aiModelRangeRef.current);   // best-effort
          const range = aiRangeRef.current;
          const sel = window.getSelection();
          if (range && sel) { sel.removeAllRanges(); sel.addRange(range); }
          editor.execCommand?.("insertAtSelection", "text/markdown", quoted);
          aiKeepSelectionRef.current = true;
          window.setTimeout(() => selectNewBlocks(container, before), 0);
        } catch { /* 命令不可用时忽略，结果仍可复制 */ }
      }}
    />
  ) : null;

  // 选区被对话框折叠后工具栏会消失 ⇒ 这时只剩「对话框」，它不依赖工具栏。
  // ⚠️ 工具栏槽位**必须保留成 null**（不是把整棵子树换成两个孩子）：Fragment 按位置对账，
  //    槽位少一个会让对话框换到另一个 index ⇒ 仍然整体重挂载、照样闪。
  if (!target) return <>{aiSelectionOverlay}{null}{aiDialog}</>;

  const renderTextMenu = () => {
    if (menu === "fontsize") {
      return (
        <KMenu menu="fontsize" surfaceRef={setPopoverRef} style={popoverStyle ?? OFFSCREEN}>
          {FONT_SIZE_OPTIONS.map((v) => (
            <KMenuItem key={v} label={v + "px"} labelClass="ne-ui-font-size-item" selected={state.fontSize === v} onClick={() => pick("fontsize", v)} />
          ))}
        </KMenu>
      );
    }
    if (menu === "blockformat") {
      // 父入口菜单（260930 用户第二次调整）：正文留在主菜单、「标题1–6」收进二级菜单；
      //   主菜单 = 正文 · 标题› ｜ 有序/无序/待办/引用 ｜ 行内代码/链接。
      const plainItem = TOOLBAR_BLOCK_TYPE_ITEMS.find((item) => item.kind === "style" && item.value === "p");
      const headingItems = TOOLBAR_BLOCK_TYPE_ITEMS.filter((item) => item.kind === "style" && item.value !== "p");
      const otherItems = TOOLBAR_BLOCK_TYPE_ITEMS.filter((item) => item.kind !== "style");
      const headingActive = headingItems.find((item) => item === activeBlockTypeItem);
      const headingOpen = subMenu === "heading";
      return (
        <KMenu menu="blockformat" surfaceRef={setPopoverRef} style={popoverStyle ?? OFFSCREEN}>
          {plainItem && (
            <KMenuItem icon={plainItem.icon} label={plainItem.label} labelClass="selection-toolbar__mi-label"
              // 260930 用户：默认（正文）也要打勾 —— 没有任何块级/行内格式、也不是标题时，当前就是正文。
              shortcut={plainItem.shortcut} selected={!activeBlockTypeItem}
              onClick={() => pickBlockTypeItem(plainItem)} />
          )}
          {/* 「标题」二级菜单：悬停展开（移入子菜单时行仍处于 hover ⇒ 不会误关），点击也可切换（触屏/键盘）。 */}
          <li
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={headingOpen}
            className={"ant-dropdown-menu-item ne-ui-select-item" + (headingActive ? " ant-dropdown-menu-item-selected" : "")}
            onMouseEnter={() => setSubMenu("heading")}
            onMouseLeave={() => setSubMenu(null)}
            onClick={(event) => { event.stopPropagation(); setSubMenu((current) => (current === "heading" ? null : "heading")); }}
          >
            <div className="ne-ui-select-item-check-icon">{headingActive ? <KIcon type="check" /> : null}</div>
            <div className="ne-ui-select-item-label">
              <div className="ne-ui-select-content">
                <span className="selection-toolbar__mi-label">
                  <span className="selection-toolbar__mi-icon"><KIcon type={headingActive?.icon ?? "editor-h1"} size={15} /></span>
                  {headingActive ? headingActive.label : "标题"}
                </span>
                <span className="selection-toolbar__mi-arrow"><KIcon type="right-arrow" size={14} /></span>
              </div>
            </div>
            {headingOpen && (
              <KMenu menu="blockformat-heading" sub surfaceRef={setSubMenuRef} style={subStyle ?? OFFSCREEN}>
                {headingItems.map((item) => (
                  <KMenuItem key={item.key} icon={item.icon} label={item.label} labelClass="selection-toolbar__mi-label"
                    shortcut={item.shortcut} selected={activeBlockTypeItem === item}
                    onClick={() => pickBlockTypeItem(item)} />
                ))}
              </KMenu>
            )}
          </li>
          <li className="ant-dropdown-menu-item-divider" role="separator" />
          {otherItems.map((item, i) => (
            <Fragment key={item.key}>
              {i > 0 && item.kind !== "block" && otherItems[i - 1].kind === "block" ? (
                <li className="ant-dropdown-menu-item-divider" role="separator" />
              ) : null}
              <KMenuItem
                icon={item.icon}
                label={item.label}
                // `.selection-toolbar__mi-label`（inline-flex + gap）给「图标 + 文字」留间距；菜单统一 13px
                // —— 内核那种"标题按 28/24/20px 预览"的字号在浮栏这种紧凑气泡里会让图标也跟着要放大，不用。
                labelClass="selection-toolbar__mi-label"
                shortcut={hot(item.key)}
                selected={activeBlockTypeItem === item}
                disabled={blockTypeItemDisabled(item)}
                onClick={() => pickBlockTypeItem(item)}
              />
            </Fragment>
          ))}
        </KMenu>
      );
    }
    if (menu === "color" || menu === "bgcolor") {
      const variant: ColorVariant = menu === "color" ? "text" : "bg";
      return (
        <div ref={setPopoverRef} style={popoverStyle ?? OFFSCREEN} className="selection-toolbar__colorpop ne-ui-toolbar-color-picker-overlay" data-menu={menu}>
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
        <div ref={setPopoverRef} style={popoverStyle ?? OFFSCREEN} className="selection-toolbar__popover" data-menu="txtlink">
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

  /** hover 说明 / 菜单快捷键列 = 名称 + 内核快捷键（短，无 markdown 行；见 kernelUiAtoms.KTooltip）。 */
  const hot = (name: string) => kernelHotkey(editor, name);
  /** 父入口当前生效项：**块级/行内优先**（列表项同时是「正文」段落样式），其次标题；都没有 = 正文。 */
  const activeFormatItem = TOOLBAR_FORMAT_ITEMS.find((item) =>
    item.kind === "block" ? state.blocks[item.name] : item.kind === "mark" ? state.marks[item.name] : false);
  const activeStyleItem = state.style && state.style !== "p"
    ? TOOLBAR_BLOCK_TYPE_ITEMS.find((item) => item.kind === "style" && item.value === state.style)
    : undefined;
  const activeBlockTypeItem: ToolbarBlockTypeItem | undefined = activeFormatItem
    ? TOOLBAR_BLOCK_TYPE_ITEMS.find((item) => item.key === activeFormatItem.name)
    : activeStyleItem;
  /** 菜单项可用性：块级/行内沿用内核状态；链接同内核 link descriptor（link 与 insertLink 都不可用才置灰）；
   *  段落样式（正文/标题）恒可用（内核固定栏的正文下拉 likewise）。 */
  const blockTypeItemDisabled = (item: ToolbarBlockTypeItem): boolean =>
    item.kind === "link" ? (!canCommand("link") && !canCommand("insertLink"))
      : item.kind === "style" ? false
        : Boolean(state.itemDisabled[item.key]);
  /** 选中菜单项：段落样式走内核 style 命令；链接弹内核链接编辑层（锚点 = 父入口按钮）；其余直接执行命令。 */
  const pickBlockTypeItem = (item: ToolbarBlockTypeItem) => {
    if (item.kind === "style") { pick("style", item.value); return; }
    if (item.kind === "link") { setMenu(null); openLinkEditor(menuTriggerRef.current); return; }
    run(item.key);
    setMenu(null);
  };

  const renderText = () => {
    const sizeLabel = String(state.fontSize ?? 15);   // 260924 用户口径：字号只显示数值（如 16），不带 px
    return (
      <>
        <KToolbarButton name="clearFormat" icon="editor-clearFormat" title="清除格式" hotkey={hot("clearFormat")} className="ne-ui-toolbar-button ne-ui-toolbar-clear-format ne-toolbar-widget" onClick={() => run("clearFormat")} />
        <span className="selection-toolbar__sep" />
        {/* 260930 用户（第二次调整）：把「段落样式」与「有序/无序/待办/引用/行内代码/链接」并成**一个**父入口 + 菜单，
            且父入口回到**原「段落样式」按钮的位置**（字号左边，而不是末尾）。
            父入口图标 = 当前生效的块类型（列表/引用/代码 → 对应图标；标题 → H1..H6 图标；正文 → editor-paragraph），
            尾部箭头用文字色/背景色同款的内核下拉箭头（.ne-ui-toolbar-color-dropdown-arrow，16×16 背景图，
            本地 public/vendor 已镜像、离线可用）；当前类型同时写进 tooltip。 */}
        <KToolbarButton
          name="formatBlock"
          icon={activeBlockTypeItem?.icon ?? "editor-paragraph"}
          caret
          caretClass="ne-ui-toolbar-color-dropdown-arrow"
          title={activeBlockTypeItem ? "格式 · " + activeBlockTypeItem.label : "格式"}
          checked={Boolean(activeBlockTypeItem)}
          className={TOGGLE + " ant-dropdown-trigger selection-toolbar__fmtbtn"}
          onClick={(e) => toggleMenu("blockformat", e.currentTarget)}
        />
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
        {/* AI 助手：结果只进对话框，用户再决定复制/替换（不自动改写正文）。 */}
        <KToolbarButton name="ai" title="AI 助手" className={TOGGLE} onClick={() => {
          // 再点一下 = 面板消失（用户 261003 定稿，不做开关态）。
          // 这条分支**不重算锚点**：此时选区已被面板输入框折叠，量到空矩形就会让面板落到
          // AiAssistantDialog 的 fallbackAt（右上角，那是给顶栏入口用的）—— 就是之前报的那个 bug。
          if (aiOpen) { closeAi(); return; }
          const sel = window.getSelection();
          aiSelectionRef.current = sel?.toString() ?? "";
          aiRangeRef.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
          let aiRect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
          // 只在量到**有效**矩形时更新锚点；拿不到就沿用上一次的（宁可位置不动，也不要跳到右上角）。
          if (aiRect && (aiRect.width || aiRect.height)) {
            // **不滚动编辑区**（用户 261004：开面板时选区绝不能跳）。锚点就按当前选区落点；
            // 面板高度以编辑区可视高为上限、内容超出面板内滚动，下方不够时由用户自己滚动或拖右下角把手。
            aiAtRef.current = { x: aiRect.left, y: aiRect.bottom + AI_DIALOG_GAP };
          }
          aiModelRangeRef.current = captureModelRange(editor);
          setMenu("ai"); setAiOpen(true);
        }}>
          <AiTagIcon size={18} />
        </KToolbarButton>
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
          <div ref={setPopoverRef} style={popoverStyle ?? OFFSCREEN} className="selection-toolbar__cardpop" data-menu="imgsize">
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
          <div ref={setPopoverRef} style={popoverStyle ?? OFFSCREEN} className="selection-toolbar__cardpop" data-menu="imglink">
            <input className="ne-card-toolbar-input selection-toolbar__urlinput" type="text" placeholder="请输入网址" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }} />
            <label className="selection-toolbar__checkrow"><KCheckbox checked={linkSelf} onChange={setLinkSelf} />在当前页面打开</label>
          </div>
        )}
        {/* 边距：上/下两个开关（内核 card spacing） */}
        {menu === "imgmargin" && (
          <div ref={setPopoverRef} style={popoverStyle ?? OFFSCREEN} className="selection-toolbar__cardpop" data-menu="imgmargin">
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
    <>
      {/* ⚠️ AI 对话框必须待在**固定树位置**（工具栏之外、且两条返回分支都在同一处）：
          它原先在「工具栏可见时挂在工具栏内部、工具栏消失时挂在外层」之间来回搬 —— React 换了树位置就整体
          重新挂载，用户点进提问框（选区折叠 → 工具栏卸载）时会看到面板闪一下（用户 261003 报「还有一点点闪烁」）。 */}
      {aiSelectionOverlay}
      <div
        ref={toolbarRef}
        className="selection-toolbar lakex-default-theme"
        data-kind={target.kind}
        role="toolbar"
        aria-label={target.kind === "text" ? "文字格式工具栏" : "图片工具栏"}
        // 首帧占位；实际坐标由 placeToolbarNow 命令式写入（style 常量引用不变，React 不会覆盖它）
        style={OFFSCREEN}
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
      {aiDialog}
    </>
  );
}
