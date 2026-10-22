// src/components/plugin/imageToolbar/ImageToolbar.tsx
//
// 图片卡片浮动操作栏（自定义 React 实现）。
//
// 背景：本构建中 lakex 框架原生的 cardToolbar「focus（点击）」通路是空桩，
// 因此该组件绕过原生通路，自行监听图片的 hover / click，定位到图片正上方渲染浮动条。
//
// 卡片数据获取方式（用户指定）：
//   const index = editor.plugins.image.cardNodes.findIndex(c => c.id === blockId)
//   const cardNode = editor.plugins.image.cardNodes[index]
//   cardNode.cardData.getStyle() / setStyle() / getRotation() / setRotation() / ...
//   cardNode.cardData.getCardValue()  →  完整数据对象

import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import "./ImageToolbar.css";
import { makeT, ToolbarLang } from "../i18n";

/** 图片卡片对应的自定义元素标签名 */
const IMAGE_TAG = "NE-CARD";

export interface ImageToolbarProps {
  /** 编辑器容器（鼠标事件挂载处） */
  containerRef: React.RefObject<HTMLElement | null>;
  /** lakex 编辑器实例（createOpenEditor 返回值） */
  editor: any;
  language?: ToolbarLang;
  /** 暗黑模式 */
  dark?: boolean;
}

// ──── 弹出层类型 ────

type PopupType = "link" | "style" | "size" | null;

interface ToolbarState {
  el: HTMLElement | null;
  /** 相对滚动容器 .ne-editor-wrap 内容坐标系的左偏移（已含图片半宽居中） */
  left: number | null;
  /** 相对滚动容器 .ne-editor-wrap 内容坐标系的顶部偏移 */
  top: number | null;
  mode: "hover" | "selected";
}

// ──── 样式选项（label 在组件内按语言生成，见 styleOptions） ────

type StyleValue = "none" | "stroke" | "shadow";

// ──── 工具函数 ────

/**
 * 从事件 target 向上查找最近的图片卡片节点（NE-CARD[data-card-name=image]）。
 */
function findImageNode(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    if (
      el.tagName &&
      el.tagName.toUpperCase() === IMAGE_TAG &&
      el.getAttribute("data-card-name") === "image"
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 通过 editor.plugins.image.cardNodes 获取卡片节点。
 * 返回 { cardNode, cardData } 或 null。
 */
function getCardNodeData(editor: any, blockId: string): {
  cardNode: any;
  cardData: any;
} | null {
  try {
    const cards = editor?.plugins?.image?.cardNodes;
    if (!Array.isArray(cards)) return null;
    const idx = cards.findIndex((c: any) => c.id === blockId);
    if (idx < 0) return null;
    const cardNode = cards[idx];
    const cardData = cardNode?.cardData;
    if (!cardData) return null;
    return { cardNode, cardData };
  } catch {
    return null;
  }
}

// ──── 链接弹出层（独立组件，受控 state，规避 hooks 顺序问题） ────

interface ImageLinkPopupProps {
  editor: any;
  blockIdRef: React.MutableRefObject<string>;
  closePopup: () => void;
  language?: ToolbarLang;
}

const ImageLinkPopup: React.FC<ImageLinkPopupProps> = ({
  editor,
  blockIdRef,
  closePopup,
  language = "zh-cn",
}) => {
  const t = makeT(language);
  const [link, setLink] = useState("");
  const [external, setExternal] = useState(true); // true=当前页面打开；默认新窗口(=false)
  const cdRef = useRef<any>(null);

  // 打开时从卡片数据初始化一次
  useEffect(() => {
    const blockId = blockIdRef.current;
    if (!blockId) return;
    const cd = getCardNodeData(editor, blockId);
    if (!cd) return;
    const cardVal = cd.cardData.getCardValue?.() ?? {};
    setLink(typeof cardVal.link === "string" ? cardVal.link : "");
    setExternal(cardVal.linkExternal); // 默认新窗口
    cdRef.current = cd;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const apply = useCallback(() => {
    const cd = cdRef.current;
    if (!cd) {
      closePopup();
      return;
    }
    const url = link.trim();
    try {
      if (typeof cd.cardData.setLink === "function") {
        cd.cardData.setLink(url);
      } else {
        cd.cardData.setValue({ link: url });
      }
      if (typeof cd.cardData.setLinkExternal === "function") {
        cd.cardData.setLinkExternal(external);
      } else {
        cd.cardData.setValue({ linkExternal: external });
      }
      cd.cardData.sync?.(false);
    } catch (err) {
      console.warn("[ImageToolbar] 设置链接失败", err);
    }
    closePopup();
  }, [link, external, closePopup]);

  return (
    <div className="ne-image-toolbar__popup" onClick={(e) => e.stopPropagation()}>
      <input
        className="ne-image-toolbar__popup-input"
        type="text"
        placeholder={t("image.link.placeholder")}
        value={link}
        autoFocus
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            closePopup();
          }
        }}
      />
      <label className="ne-image-toolbar__popup-check">
        <input
          type="checkbox"
          checked={external}
          onChange={(e) => setExternal(e.target.checked)}
        />
        <span>{t("image.link.newWindow")}</span>
      </label>
      <button type="button" className="ne-image-toolbar__popup-ok" onClick={apply}>
        {t("common.ok")}
      </button>
    </div>
  );
};

// ──── 宽高弹出层（独立组件，受控 state） ────

const SIZE_PRESETS = [25, 50, 75, 100] as const;

interface ImageSizePopupProps {
  editor: any;
  blockIdRef: React.MutableRefObject<string>;
  closePopup: () => void;
  language?: ToolbarLang;
}

const ImageSizePopup: React.FC<ImageSizePopupProps> = ({
  editor,
  blockIdRef,
  closePopup,
  language = "zh-cn",
}) => {
  const t = makeT(language);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const originalW = useRef(0);
  const originalH = useRef(0);
  const cdRef = useRef<any>(null);

  // 打开时从卡片数据初始化
  useEffect(() => {
    const blockId = blockIdRef.current;
    if (!blockId) return;
    const cd = getCardNodeData(editor, blockId);
    if (!cd) return;
    cdRef.current = cd;
    try {
      const dw =
        typeof cd.cardData.getDisplayWidth === "function"
          ? cd.cardData.getDisplayWidth()
          : 0;
      const dh =
        typeof cd.cardData.getDisplayHeight === "function"
          ? cd.cardData.getDisplayHeight()
          : 0;
      setWidth(String(Math.round(dw)));
      setHeight(String(Math.round(dh)));
      // 原始尺寸（用于百分比换算）
      originalW.current = 
        typeof cd.cardData.getOriginalWidth === "function"
          ? cd.cardData.getOriginalWidth() || dw
          : dw;
      originalH.current =
        typeof cd.cardData.getOriginalHeight === "function"
          ? cd.cardData.getOriginalHeight() || dh
          : dh;
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const applyPreset = useCallback(
    (pct: number) => {
      if (originalW.current > 0) {
        setWidth(String(Math.round((originalW.current * pct) / 100)));
      }
      if (originalH.current > 0) {
        setHeight(String(Math.round((originalH.current * pct) / 100)));
      }
    },
    []
  );

  const apply = useCallback(() => {
    const cd = cdRef.current;
    if (!cd) {
      closePopup();
      return;
    }
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    if (Number.isNaN(w) && Number.isNaN(h)) {
      closePopup();
      return;
    }
    try {
      if (!Number.isNaN(w)) {
        if (typeof cd.cardData.setDisplayWidth === "function") {
          cd.cardData.setDisplayWidth(w);
        } else {
          cd.cardData.setValue({ displayWidth: w });
        }
      }
      // if (!Number.isNaN(h)) {
      //   if (typeof cd.cardData.setDisplayHeight === "function") {
      //     cd.cardData.setDisplayHeight(h);
      //   } else {
      //     cd.cardData.setValue({ displayHeight: h });
      //   }
      // }
      cd.cardData.sync?.(false);
    } catch (err) {
      console.warn("[ImageToolbar] 设置宽高失败", err);
    }
    closePopup();
  }, [width, height, closePopup]);

  return (
    <div className="ne-image-toolbar__popup ne-image-toolbar__popup--size" onClick={(e) => e.stopPropagation()}>
      {/* 宽 / 高 输入行 */}
      <div className="ne-image-toolbar__size-row">
        <label className="ne-image-toolbar__size-label">{t("image.size.width")}</label>
        <input
          className="ne-image-toolbar__size-input"
          type="text"
          inputMode="numeric"
          value={width}
          onChange={(e) => setWidth(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); apply(); }
            else if (e.key === "Escape") { closePopup(); }
          }}
        />
        <label className="ne-image-toolbar__size-label">{t("image.size.height")}</label>
        <input
          className="ne-image-toolbar__size-input"
          type="text"
          inputMode="numeric"
          value={height}
          onChange={(e) => setHeight(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); apply(); }
            else if (e.key === "Escape") { closePopup(); }
          }}
        />
      </div>
      {/* 百分比快捷按钮行 */}
      <div className="ne-image-toolbar__size-presets">
        {SIZE_PRESETS.map((pct) => (
          <button
            key={pct}
            type="button"
            className={`ne-image-toolbar__size-preset`}
            onClick={() => applyPreset(pct)}
          >
            {pct}%
          </button>
        ))}
      </div>
      {/* 确定 */}
      <button type="button" className="ne-image-toolbar__popup-ok" onClick={apply}>
        {t("common.ok")}
      </button>
    </div>
  );
};

/**
 * 从 DOM 取 cardUI（用于内置 maximize/widthMode/copy/delete 等仍需 cardUI 的动作）。
 */
function getCardUI(editor: any, domEl: HTMLElement | null): any {
  let el: HTMLElement | null = domEl;
  while (el && el !== document.body) {
    try {
      const ui = editor?.renderer?.getViewNodeByDOM?.(el);
      if (ui && (ui.cardData || ui.enterMaxView || ui.cardRootNode || ui.id)) {
        return ui;
      }
    } catch {
      // ignore
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 通过 blockId 从 editor.plugins.image.cardNodes 取回 cardUI 实例
 * （用于 _setCroping 等仍需 cardUI 的动作）。
 */
function getCardUIByBlockId(editor: any, blockId: string): any {
  try {
    const cards = editor?.plugins?.image?.cardNodes;
    if (!Array.isArray(cards)) return null;
    const idx = cards.findIndex((c: any) => c.id === blockId);
    if (idx < 0) return null;
    return cards[idx];
  } catch {
    return null;
  }
}

// ──── 按钮定义 ────

interface ToolbarButtonDef {
  name: string;
  title?: string;
  icon?: string;
  tip?: string;
  /** 自定义点击处理（使用 cardNode.cardData API） */
  customAction?: (
    editor: any,
    blockId: string,
    closePopup: () => void
  ) => void;
  /** 是否带下拉箭头 */
  hasDropdown?: boolean;
}

/** 按钮条目：按钮定义或 '|' 分隔线 */
type ToolbarEntry = ToolbarButtonDef | "|";

const TOOLBAR_ITEMS: ToolbarEntry[] = [
  {
    name: "rotation",
    // title: "旋转",
    icon: "ne-t-image-rotation",
    tip:"image.rotation.tip",
    customAction: (editor, blockId) => {
      const cd = getCardNodeData(editor, blockId);
      if (!cd) return;
      try {
        const current =
          typeof cd.cardData.getRotation === "function"
            ? cd.cardData.getRotation()
            : 0;
        const next = (current + 90) % 360; // 逆时针转90°，360归0
        cd.cardData.setRotation(next);
        cd.cardData.sync?.(false);
      } catch (e) {
        console.warn("[ImageToolbar] setRotation 失败", e);
      }
    },
  },
  {
    name: "crop",
    // title: "剪切",
    icon: "ne-t-image-crop",
    tip: 'image.crop.tip',
    // 原生裁切通道：调用 cardUI._setCroping(true) 进入裁切模式
    // （注意：本构建中原生 crop 通道是空桩，_cropImageOp 恒为 null，
    //  调用后不会真正进入可用的裁切交互，仅保留入口）
    customAction: (_editor, blockId) => {
      const cardUI = getCardUIByBlockId(_editor, blockId);
      if (!cardUI) return;
      try {
        const isCroping = cardUI._$cardUI._isCroping
        if (!isCroping) {
          cardUI.cardData.resetRotationCrop()
          // cardUI.cardData.setDisplayWidth(cardUI.cardData.getOriginalWidth())
          cardUI.cardData.sync(!1)
        }
        console.log("-----", cardUI._$cardUI._setCroping)
        cardUI._$cardUI._setCroping?.({croping: !isCroping});
      } catch (e) {
        console.warn("[ImageToolbar] setCroping 失败", e);
      }
    },
  },
  {
    name: "size",
    title: "image.size.title",
    icon: "ne-t-image-size",
    tip: 'image.size.tip',
    hasDropdown: true,
    // 设置图片宽高，在弹出框中填写高度和宽度
    // 可以选择原始宽高的百分比
  },
  "|",
  {
    name: "link",
    // title: "链接",
    icon: "ne-t-link",
    tip: 'image.link.tip',
    hasDropdown: true,
    customAction: () => {
      /* 由弹出层处理，此处仅用于打开 popup */
    },
  },
  {
    name: "description",
    title: "image.desc.title",
    icon: "ne-t-image-title",
    tip: 'image.desc.tip',
    customAction: (editor, blockId) => {
      const cd = getCardNodeData(editor, blockId);
      if (!cd) return;
      try {
        const val = cd.cardData.getCardValue?.() ?? {};
        const next = !val.showTitle;
        if (typeof cd.cardData.setShowTitle === "function") {
          cd.cardData.setShowTitle(next);
        } else {
          cd.cardData.setValue({ showTitle: next });
        }
        cd.cardData.sync?.(false);
      } catch (e) {
        console.warn("[ImageToolbar] setShowTitle 失败", e);
      }
    },
  },
  "|",
  {
    name: "style",
    title: "image.style.title",
    icon: "ne-t-image-style",
    tip: 'image.style.tip',
    hasDropdown: true,
    customAction: () => {
      /* 由弹出层处理 */
    },
  },
];

// ════════════════════════════════════════════════════════
// 组件
// ════════════════════════════════════════════════════════

export const ImageToolbar = (props: ImageToolbarProps) => {
  const { containerRef, editor, language = "zh-cn", dark = false } = props;

  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ToolbarState>({
    el: null,
    left: null,
    top: null,
    mode: "hover",
  });

  /** 当前打开的弹出层 */
  const [popup, setPopup] = useState<PopupType>(null);

  /** 弹出层锚定按钮的索引 */
  const [popupAnchorIdx, setPopupAnchorIdx] = useState<number>(-1);

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const cardUIRef = useRef<any>(null);
  const blockIdRef = useRef<string>("");
  const modeRef = useRef<"hover" | "selected">("hover");

  // ──── 多语言文案 ────
  const t = useMemo(() => makeT(language), [language]);
  const styleOptions = useMemo(
    () => [
      { value: "none" as StyleValue, label: t("image.style.none") },
      { value: "stroke" as StyleValue, label: t("image.style.stroke") },
      { value: "shadow" as StyleValue, label: t("image.style.shadow") },
    ],
    [t]
  );

  // ──── 重新定位 ────
  // 工具栏通过 createPortal 渲染进 .ne-editor-wrap（滚动容器），是滚动内容的一部分，
  // 滚动时随内容自然移动。因此定位用「相对 .ne-editor-wrap 的内容坐标」，
  // 而非视口坐标（否则滚动后需反复监听 scroll 重算，且可能被祖先 transform 影响）。

  const computePosition = useCallback(
    (el: HTMLElement): { left: number; top: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const wrap =
        (container.querySelector(".ne-editor-wrap") as HTMLElement | null) ||
        (container.querySelector(".ne-engine") as HTMLElement | null) ||
        container;
      const wrapRect = wrap.getBoundingClientRect();
      const imgRect = el.getBoundingClientRect();
      const left =
        imgRect.left - wrapRect.left + wrap.scrollLeft + imgRect.width / 2;
      const top = imgRect.top - wrapRect.top + wrap.scrollTop;
      return { left, top };
    },
    [containerRef]
  );

  const reposition = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const pos = computePosition(el);
    if (!pos) return;
    setState((prev) => ({ ...prev, left: pos.left, top: pos.top }));
  }, [computePosition]);

  // ──── 显示 / 隐藏逻辑 ────
  // 关键修复：
  //   1. toolbar 紧贴图片顶部（0 间隙），鼠标从图片移到 toolbar 不消失
  //   2. toolbar 自身改用 React onMouseEnter/onMouseLeave 阻止隐藏计时器
  //      —— 之前在挂载时把监听绑到 container 上的 tb 元素，但那时 toolbar 尚未渲染
  //         （toolbarRef.current 为 null），导致监听器从未真正绑定，移到 toolbar 即触发隐藏
  //   3. 从图片移到 toolbar 的路径上不触发隐藏（gap=0 且进入即 cancelHide）

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      if (modeRef.current === "selected") return; // 选中态不自动隐藏
      setVisible(false);
      elRef.current = null;
      cardUIRef.current = null;
      blockIdRef.current = "";
      setPopup(null);
    }, 150);
  }, [cancelHide]);

  const showFor = useCallback(
    (el: HTMLElement, mode: "hover" | "selected") => {
      cancelHide();
      elRef.current = el;
      modeRef.current = mode;
      cardUIRef.current = getCardUI(editor, el);
      // 记录 blockId（从 cardUI 或 DOM 属性取）
      blockIdRef.current =
        cardUIRef.current?.id ||
        el.getAttribute("data-card-id") ||
        el.id ||
        "";
      const pos = computePosition(el);
      setState({
        el,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        mode,
      });
      setVisible(true);
      // 切换图片时关闭弹出层
      setPopup(null);
      setPopupAnchorIdx(-1);
    },
    [editor, cancelHide]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor) return;

    // ---- 容器上的事件（capture 阶段，确保先于内部元素）----
    // 注意：toolbar 渲染在 container 之外（fixed 定位），其事件不会冒泡到 container，
    //       toolbar 自身的进入/离开改用 JSX 的 onMouseEnter/onMouseLeave 处理。

    const handleMouseOver = (e: MouseEvent) => {
      // 如果鼠标进入了 toolbar 本身，取消隐藏
      if (toolbarRef.current?.contains(e.target as Node)) {
        cancelHide();
        return;
      }
      const img = findImageNode(e.target);
      if (img) {
        showFor(img, "hover");
      } else {
        scheduleHide();
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      // 如果相关目标在 toolbar 或图片内，不隐藏
      if (
        related &&
        (toolbarRef.current?.contains(related) ||
          findImageNode(related))
      ) {
        return;
      }
      scheduleHide();
    };

    const handleClick = (e: MouseEvent) => {
      // 点击 toolbar 内部不处理（其 onClick 已 stopPropagation）
      if (toolbarRef.current?.contains(e.target as Node)) return;

      const img = findImageNode(e.target);
      if (img) {
        showFor(img, "selected"); // 点击进入选中态
      } else if (modeRef.current === "selected") {
        // 点击外部退出选中态
        setVisible(false);
        elRef.current = null;
        cardUIRef.current = null;
        blockIdRef.current = "";
        modeRef.current = "hover";
        setPopup(null);
      }
    };

    container.addEventListener("mouseover", handleMouseOver, true);
    container.addEventListener("mouseout", handleMouseOut, true);
    container.addEventListener("click", handleClick, true);

    return () => {
      container.removeEventListener("mouseover", handleMouseOver, true);
      container.removeEventListener("mouseout", handleMouseOut, true);
      container.removeEventListener("click", handleClick, true);
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    };
  }, [containerRef, editor, showFor, scheduleHide, cancelHide]);

  // ──── 容器尺寸变化时重新定位 ────
  // 工具栏已通过 createPortal 渲染进 .ne-editor-wrap（滚动内容的一部分），
  // 滚动时随内容自然移动，无需监听 scroll。仅当容器尺寸变化（窗口缩放等）导致
  // 图片重排时，重新计算相对 .ne-editor-wrap 的内容坐标即可。

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (visible && elRef.current) reposition();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, visible, reposition]);

  // ──── 按钮点击处理 ────

  const closePopup = useCallback(() => {
    setPopup(null);
    setPopupAnchorIdx(-1);
  }, []);

  const handleButtonClick = useCallback(
    (entry: ToolbarButtonDef, idx: number) => {
      const blockId = blockIdRef.current;

      // 有下拉菜单的按钮：切换弹出层
      if (entry.hasDropdown) {
        if (popup === entry.name) {
          closePopup(); // 再次点击关闭
        } else {
          setPopup(entry.name as PopupType);
          setPopupAnchorIdx(idx);
        }
        return;
      }

      // 自定义动作（通过 cardNode.cardData API）
      if (entry.customAction && blockId) {
        entry.customAction(editor, blockId, closePopup);
        requestAnimationFrame(() => {
          if (elRef.current && !document.contains(elRef.current)) {
            setVisible(false);
            elRef.current = null;
            cardUIRef.current = null;
            return;
          }
          reposition();
        });
      }
    },
    [editor, reposition, popup, closePopup]
  );

  // ──── toolbar 自身的鼠标进入/离开（修复：移到 toolbar 时消失）────
  // toolbar 渲染在 container 之外，事件不冒泡到 container，故用 JSX 属性直接绑定。
  const handleToolbarEnter = useCallback(() => {
    cancelHide();
  }, [cancelHide]);

  const handleToolbarLeave = useCallback(
    (e: React.MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      // 离开 toolbar 但进了图片，不隐藏；否则延迟隐藏
      if (
        related &&
        (findImageNode(related) || toolbarRef.current?.contains(related))
      ) {
        return;
      }
      scheduleHide();
    },
    [scheduleHide]
  );

  // ──── 弹出层：样式选择 ────

  const renderStylePopup = () => {
    const blockId = blockIdRef.current;
    if (!blockId) return null;

    const cd = getCardNodeData(editor, blockId);
    if (!cd) return null;

    let currentStyle: StyleValue = "none";
    try {
      const raw =
        typeof cd.cardData.getStyle === "function"
          ? cd.cardData.getStyle()
          : "";
      currentStyle = styleOptions.some((o) => o.value === raw)
        ? (raw as StyleValue)
        : "none";
    } catch {
      // ignore
    }

    return (
      <div className="ne-image-toolbar__popup ne-image-toolbar__popup--menu">
        {styleOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`ne-image-toolbar__menu-item${
              currentStyle === opt.value
                ? " ne-image-toolbar__menu-item--active"
                : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              try {
                if (typeof cd.cardData.setStyle === "function") {
                  cd.cardData.setStyle(opt.value);
                } else {
                  cd.cardData.setValue({ style: opt.value });
                }
                cd.cardData.sync?.(false);
              } catch (err) {
                console.warn("[ImageToolbar] setStyle 失败", err);
              }
              closePopup();
            }}
          >
            <span className="ne-image-toolbar__icon ne-icon ne-icon-kitchen ">
            {currentStyle === opt.value && (
              
                  <svg className="ne-icon-symbol" aria-hidden="true">
                    <use xlinkHref="#icon-check"></use>
                  </svg>
                
            )}
            </span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    );
  };

  // ──── 渲染 ────

  if (!visible || state.left == null || state.top == null || !state.el)
    return null;

  // 渲染进 .ne-editor-wrap：工具栏作为滚动内容的一部分，滚动时随图片一起移动，
  // 始终固定在图片上方（不再依赖 scroll 监听反复定位）。
  const containerEl = containerRef.current;
  const portalTarget =
    (containerEl?.querySelector(".ne-editor-wrap") as HTMLElement | null) ||
    (containerEl?.querySelector(".ne-engine") as HTMLElement | null) ||
    containerEl;
  if (!portalTarget) return null;

  const toolbarNode = (
    <div
      ref={toolbarRef}
      className={`ne-image-toolbar${dark ? " ne-image-toolbar--dark" : ""}`}
      style={{
        position: "absolute",
        left: `${state.left}px`,
        top: `${state.top < 50 ? 50 : state.top}px`, // 紧贴图片顶部（内容坐标，0 间隙）
        transform: "translate(-50%, -100%)",
        zIndex: 200,
      }}
      onMouseEnter={handleToolbarEnter}
      onMouseLeave={handleToolbarLeave}
      onMouseDown={(e) => {
        // 仅对「非输入类元素」阻止默认行为，避免抢占编辑器焦点；
        // 输入框 / 文本域需要 mousedown 的默认行为才能正常聚焦、可输入
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
      }} // 防止编辑器失焦
    >
      {/* 按钮组 */}
      {TOOLBAR_ITEMS.map((entry, idx) => {
        if (entry === "|") {
          return (
            <span key={`div-${idx}`} className="ne-image-toolbar__divider" />
          );
        }
        const btn = entry as ToolbarButtonDef;
        const isActivePopup =
          popup === btn.name && popupAnchorIdx === idx;
        let isActive = isActivePopup;
        if (btn.name === 'crop') {
          if (blockIdRef.current) {
            const cardUI = getCardUIByBlockId(editor, blockIdRef.current);
            if(cardUI) isActive = cardUI._$cardUI._isCroping
          }
        }
        if(btn.name === "description") {
          if (blockIdRef.current) {
            const cd = getCardNodeData(editor, blockIdRef.current);
            const val = cd.cardData.getCardValue?.() ?? {};
            isActive = val.showTitle
          }
        }

        return (
          <div key={`${btn.name}-${idx}`} className="ne-image-toolbar__btn-wrap">
            <button
              type="button"
              className={`ne-image-toolbar__btn${
                isActive ? " ne-image-toolbar__btn--active" : ""
              }${btn.hasDropdown ? " ne-image-toolbar__btn--dropdown" : ""}`}
              title={t(btn.tip || "")}
              onClick={(e) => {
                e.stopPropagation();
                handleButtonClick(btn, idx);
              }}
            >
              {btn.icon && (
                <span className="ne-image-toolbar__icon ne-icon ne-icon-kitchen ">
                  <svg className="ne-icon-symbol" aria-hidden="true">
                    <use xlinkHref={'#'+btn.icon}></use>
                  </svg>
                </span>
              )}
              {btn.title && <span className="ne-image-toolbar__label">{t(btn.title)}</span>}
              {btn.hasDropdown && (
                <span className="ne-ui-toolbar-arrow-down">
                </span>
              )}
            </button>

            {/* 弹出层（锚定在对应按钮下方） */}
            {isActivePopup && (
              <div className="ne-image-toolbar__popover">
                {btn.name === "link" && (
                  <ImageLinkPopup
                    editor={editor}
                    blockIdRef={blockIdRef}
                    closePopup={closePopup}
                    language={language}
                  />
                )}
                {btn.name === "size" && (
                  <ImageSizePopup
                    editor={editor}
                    blockIdRef={blockIdRef}
                    closePopup={closePopup}
                    language={language}
                  />
                )}
                {btn.name === "style" && renderStylePopup()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return createPortal(toolbarNode, portalTarget);
};

export default ImageToolbar;
