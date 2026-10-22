// src/components/plugin/bookmark/BookmarkToolbar.tsx
//
// 书签卡片浮动操作栏（自定义 React 实现，模式与 ImageToolbar 一致）。
//
// 背景：本构建中 lakex 框架原生 bookmark 卡片未实现 getCardToolbarConfig（逆向 lakex.js:69407
// 仅当该方法非 null 才初始化 hover 工具栏），因此该卡片默认没有 hover 工具条。
// 这里绕过原生通路，自行监听书签卡片的 hover / click，定位到卡片正上方渲染浮动条。
//
// 卡片数据获取方式：
//   const ui = editor.renderer.getViewNodeByDOM(el)   // el 为 <ne-card data-card-name="bookmark">
//   ui.cardData.getSrc()                              // 书签 URL（_cardValue.src，见 lakex.js:182434）
//   ui.cardData.getDetail()                           // { title, desc, image, icon, url }
//   ui.cardData.setDetail(detail)                     // 写入 detail（lakex.js:118165）
//   ui.cardData.sync(false)                           // 回写文档模型 + afterChange 触发卡片重渲染
//   ui.id                                            // 卡片 blockId
//   ui.plugin.bookmarkToLink(id, src, title)         // 转为链接
//   ui.editor.kernel.execCommand('deleteCard', id)   // 删除卡片

import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import "../imageToolbar/ImageToolbar.css";
import { makeT, ToolbarLang } from "../i18n";

/** 卡片对应的自定义元素标签名（与 ImageToolbar 一致，HTML 标签为 ne-card） */
const BOOKMARK_TAG = "NE-CARD";

export interface BookmarkToolbarProps {
  /** 编辑器容器（鼠标事件挂载处） */
  containerRef: React.RefObject<HTMLElement | null>;
  /** lakex 编辑器实例（createOpenEditor 返回值） */
  editor: any;
  language?: ToolbarLang;
  /** 暗黑模式 */
  dark?: boolean;
}

interface ToolbarState {
  el: HTMLElement | null;
  /** 相对滚动容器 .ne-editor-wrap 内容坐标系的左偏移（已含卡片半宽居中） */
  left: number | null;
  /** 相对滚动容器 .ne-editor-wrap 内容坐标系的顶部偏移 */
  top: number | null;
  mode: "hover" | "selected";
}

type BookmarkPopupType = "editTitle" | null;

// ──── 工具函数 ────

/**
 * 从事件 target 向上查找最近的书签卡片节点（NE-CARD[data-card-name=bookmark]）。
 */
function findBookmarkNode(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    const cardName = el.getAttribute("data-card-name");
    if (
      el.tagName &&
      el.tagName.toUpperCase() === BOOKMARK_TAG &&
      (cardName === "bookmark" || cardName === "bookmarkInline")
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// ──── 按钮定义 ────

interface ToolbarButtonDef {
  name: string;
  title?: string;
  icon?: string;
  tip?: string;
  /** 自定义点击处理（使用 cardUI 实例） */
  customAction?: (editor: any, cardUI: any, blockId: string) => void;
}

type ToolbarEntry = ToolbarButtonDef | "|";

const TOOLBAR_ITEMS: ToolbarEntry[] = [
  {
    name: "toLink",
    title: "",
    icon: "ne-t-link",
    tip: "bookmark.toLink",
    customAction: (_editor, cardUI) => {
      try {
        _editor.execCommand("cardToLink", cardUI.id, cardUI.value.src, cardUI.value.text);
      } catch (e) {
        console.warn("[BookmarkToolbar] bookmarkToLink 失败", e);
      }
    },
  },
  {
    name: "toTitleView",
    title: "",
    icon: "icon-tb-title-view",
    tip: "bookmark.title",
    customAction: (_editor, cardUI) => {
      try {
        _editor.plugins.bookmark.toTitleMode(cardUI);
      } catch (e) {
        console.warn("[BookmarkToolbar] toTitleMode 失败", e);
      }
    },
  },
  {
    name: "toCardView",
    title: "",
    icon: "icon-tb-card-view",
    tip: "bookmark.card",
    customAction: (_editor, cardUI) => {
      try {
        _editor.plugins.bookmark.toCardMode(cardUI);
      } catch (e) {
        console.warn("[BookmarkToolbar] toCardMode 失败", e);
      }
    },
  },
  "|",
  {
    name: "openLink",
    title: "",
    icon: "ne-o-visit-link",
    tip: "bookmark.openLink",
    customAction: (_editor, cardUI) => {
      _editor.emitEvent("openBookmarkLink", cardUI.value.src);
    },
  },
  {
    name: "editTitle",
    title: "",
    icon: "icon-o-edit",
    tip: "bookmark.edit",
  },
];

// ════════════════════════════════════════════════════════
// 编辑标题弹出层（独立组件，受控 state，规避 hooks 顺序问题）
// ════════════════════════════════════════════════════════

interface BookmarkEditPopupProps {
  /** 当前书签卡片 UI 实例 */
  cardUI: any;
  closePopup: () => void;
  language?: ToolbarLang;
}

const BookmarkEditPopup: React.FC<BookmarkEditPopupProps> = ({
  cardUI,
  closePopup,
  language = "zh-cn",
}) => {
  const t = makeT(language);
  const [title, setTitle] = useState("");
  const cdRef = useRef<any>(null);

  // 打开时从卡片 detail 初始化一次标题
  useEffect(() => {
    const cd = cardUI?.cardData;
    cdRef.current = cd;
    if (!cd) return;
    try {
      const detail = cd.getDetail?.() || {};
      setTitle(typeof detail.title === "string" ? detail.title : "");
    } catch {
      setTitle("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardUI]);

  const apply = useCallback(() => {
    const cd = cdRef.current;
    if (!cd) {
      closePopup();
      return;
    }
    try {
      const cur = cd.getDetail?.() || {};
      cd._cardValue.text = title.trim();
      cd.setDetail({ ...cur, title: title.trim() });
      cd.sync?.(false); // 回写文档模型并触发卡片重渲染
    } catch (err) {
      console.warn("[BookmarkToolbar] 设置标题失败", err);
    }
    closePopup();
  }, [title, closePopup]);

  return (
    <div className="ne-image-toolbar__popup" onClick={(e) => e.stopPropagation()}>
      <input
        className="ne-image-toolbar__popup-input"
        type="text"
        placeholder={t("bookmark.title.placeholder")}
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            closePopup();
          }
        }}
      />
      <button type="button" className="ne-image-toolbar__popup-ok" onClick={apply}>
        {t("common.ok")}
      </button>
    </div>
  );
};

// ════════════════════════════════════════════════════════
// 组件
// ════════════════════════════════════════════════════════

export const BookmarkToolbar = (props: BookmarkToolbarProps) => {
  const { containerRef, editor, language = "zh-cn", dark = false } = props;

  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ToolbarState>({
    el: null,
    left: null,
    top: null,
    mode: "hover",
  });
  const [popup, setPopup] = useState<BookmarkPopupType>(null);
  const [popupAnchor, setPopupAnchor] = useState<string | null>(null);

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const cardUIRef = useRef<any>(null);
  const blockIdRef = useRef<string>("");
  const modeRef = useRef<"hover" | "selected">("hover");

  // ──── 多语言文案 ────
  const t = useMemo(() => makeT(language), [language]);

  // ──── 重新定位（同 ImageToolbar：相对 .ne-editor-wrap 内容坐标，随滚动自然移动） ────

  const computePosition = useCallback(
    (el: HTMLElement): { left: number; top: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const wrap =
        (container.querySelector(".ne-editor-wrap") as HTMLElement | null) ||
        (container.querySelector(".ne-engine") as HTMLElement | null) ||
        container;
      const wrapRect = wrap.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const left =
        elRect.left - wrapRect.left + wrap.scrollLeft + elRect.width / 2;
      const top = elRect.top - wrapRect.top + wrap.scrollTop;
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

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      if (modeRef.current === "selected" && !popup) return; // 选中态不自动隐藏（编辑弹框打开时也不隐藏）
      if (popup) return;
      setVisible(false);
      elRef.current = null;
      cardUIRef.current = null;
      blockIdRef.current = "";
    }, 150);
  }, [cancelHide, popup]);

  const showFor = useCallback(
    (el: HTMLElement, mode: "hover" | "selected") => {
      cancelHide();
      elRef.current = el;
      modeRef.current = mode;
      blockIdRef.current = el.id || el.getAttribute("data-card-id") || "";
      const cardUI = editor.plugins.bookmark.cardNodes.find(
        (node: any) => node.id === blockIdRef.current
      );
      if (!cardUI) return;
      cardUIRef.current = cardUI;

      const pos = computePosition(el);
      setState({
        el,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        mode,
      });
      setVisible(true);
    },
    [editor, cancelHide, computePosition]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor) return;

    const handleMouseOver = (e: MouseEvent) => {
      // 鼠标进入 toolbar 本身：取消隐藏
      if (toolbarRef.current?.contains(e.target as Node)) {
        cancelHide();
        return;
      }
      const node = findBookmarkNode(e.target);
      if (node) {
        showFor(node, "hover");
      } else {
        scheduleHide();
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      if (
        related &&
        (toolbarRef.current?.contains(related) ||
          findBookmarkNode(related))
      ) {
        return;
      }
      scheduleHide();
    };

    const handleClick = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;

      const node = findBookmarkNode(e.target);
      if (node) {
        showFor(node, "selected"); // 点击进入选中态
      } else if (modeRef.current === "selected") {
        // 点击外部退出选中态
        setVisible(false);
        elRef.current = null;
        cardUIRef.current = null;
        blockIdRef.current = "";
        modeRef.current = "hover";
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

  // ──── 容器尺寸变化重新定位（同 ImageToolbar，无需监听 scroll） ────

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (visible && elRef.current) reposition();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, visible, reposition]);

  // ──── 编辑弹框：点击外部关闭 ────

  const closePopup = useCallback(() => {
    setPopup(null);
    setPopupAnchor(null);
  }, []);

  useEffect(() => {
    if (!popup) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (toolbarRef.current && !toolbarRef.current.contains(t)) {
        closePopup();
      }
    };
    document.addEventListener("mousedown", onDocDown, true);
    return () => document.removeEventListener("mousedown", onDocDown, true);
  }, [popup, closePopup]);

  // ──── 按钮点击处理 ────

  const handleButtonClick = useCallback(
    (entry: ToolbarButtonDef) => {
      const blockId = blockIdRef.current;
      const cardUI = cardUIRef.current;

      // 编辑标题：打开 / 关闭弹框（与 ImageToolbar 一致，再次点击同一按钮关闭）
      if (entry.name === "editTitle") {
        cancelHide();
        if (popupAnchor === "editTitle" && popup) {
          closePopup();
        } else {
          setPopupAnchor("editTitle");
          setPopup("editTitle");
        }
        return;
      }

      // 其它按钮：先关闭可能存在的弹框
      if (popup) closePopup();

      if (entry.customAction && cardUI) {
        entry.customAction(editor, cardUI, blockId);
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
    [editor, reposition, popup, popupAnchor, cancelHide, closePopup]
  );

  // ──── toolbar 自身进入/离开（移到 toolbar 时不消失） ────

  const handleToolbarEnter = useCallback(() => {
    cancelHide();
  }, [cancelHide]);

  const handleToolbarLeave = useCallback(
    (e: React.MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      if (
        related &&
        (findBookmarkNode(related) || toolbarRef.current?.contains(related))
      ) {
        return;
      }
      scheduleHide();
    },
    [scheduleHide]
  );

  // ──── 渲染 ────

  if (!visible || state.left == null || state.top == null || !state.el)
    return null;

  // 渲染进 .ne-editor-wrap：工具栏作为滚动内容的一部分，滚动时随卡片一起移动。
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
        top: `${state.top < 50 ? 50 : state.top}px`, // 紧贴卡片顶部（内容坐标）
        transform: "translate(-50%, -100%)",
        zIndex: 200,
      }}
      onMouseEnter={handleToolbarEnter}
      onMouseLeave={handleToolbarLeave}
      onMouseDown={(e) => {
        // 仅对「非输入类元素」阻止默认行为，避免抢占编辑器焦点
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
      }}
    >
      {TOOLBAR_ITEMS.map((btn, idx) => {
        if (btn === "|") {
          return (
            <span key={`div-${idx}`} className="ne-image-toolbar__divider" />
          );
        }
        if (
          cardUIRef.current?.nodeName === "bookmark" &&
          btn.name === "toCardView"
        )
          return null;
        if (
          cardUIRef.current?.nodeName === "bookmarkInline" &&
          btn.name === "toTitleView"
        )
          return null;
        return (
          <div key={btn.name} className="ne-image-toolbar__btn-wrap">
            <button
              type="button"
              className={`ne-image-toolbar__btn${
                popup === "editTitle" && popupAnchor === btn.name
                  ? " ne-image-toolbar__btn--active"
                  : ""
              }`}
              title={t(btn.tip || "")}
              onClick={(e) => {
                e.stopPropagation();
                handleButtonClick(btn);
              }}
            >
              {btn.icon && (
                <span className="ne-image-toolbar__icon ne-icon ne-icon-kitchen ">
                  <svg className="ne-icon-symbol" aria-hidden="true">
                    <use xlinkHref={"#" + btn.icon}></use>
                  </svg>
                </span>
              )}
              {btn.title && (
                <span className="ne-image-toolbar__label">{btn.title}</span>
              )}
            </button>
            {/* 编辑标题弹出层（锚定在该按钮下方） */}
            {popup === "editTitle" && popupAnchor === btn.name && (
              <div className="ne-image-toolbar__popover">
                <BookmarkEditPopup
                  cardUI={cardUIRef.current}
                  closePopup={closePopup}
                  language={language}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return createPortal(toolbarNode, portalTarget);
};

export default BookmarkToolbar;
