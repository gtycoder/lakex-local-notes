import React, { lazy, Suspense, useEffect, useRef } from "react";
const LazyDrawnix = lazy(async () => {
  await Promise.all([
    import("../../vendor/drawnix.css"),
    import("../../vendor/drawnix-react-board.css"),
    import("../../vendor/drawnix-react-text.css"),
  ]);
  const module = await import("lakex-drawnix");
  return { default: module.Drawnix };
});

function DrawnixFallback() {
  return <div className="board-card-loading" aria-label="画板加载中">正在加载画板…</div>;
}
import { CardResizer, type ICardProps } from "lakex-editor-react-component";
import type { PlaitElement, Viewport, PlaitTheme, PlaitBoard } from "@plait/core";

export interface IBoardCardValue {
  elements: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
  cardHeight?: number;
}

export interface CustomCardConfig<TCardValue = any> {
  name: string;
  cardType: "inline" | "block";
  slash: {
    icon: string;
    mainSearch?: string;
    keywords?: string | string[];
    label: string | (() => { zhCN: string; enUS: string });
    description?: string | (() => { zhCN: string; enUS: string });
  };
  initValue: Record<string, any> | null;
  editorComponent: React.ComponentType<ICardProps<TCardValue>>;
  viewerComponent: React.ComponentType<ICardProps<TCardValue>>;
  writeText: (value: TCardValue | null) => string;
  writeHtml: (value: TCardValue | null) => string;
}

export interface CustomCard<TCardValue = any> {
  icon?: React.ElementType | React.FC;
  config: CustomCardConfig<TCardValue>;
}

function BoardIcon() {
  return React.createElement(
    "symbol",
    { id: "editor-main-drawing-board", viewBox: "0 0 1024 1024" },
    React.createElement("path", {
      d: "M853.333333 85.333333H170.666667a85.333333 85.333333 0 0 0-85.333334 85.333334v682.666666a85.333333 85.333333 0 0 0 85.333334 85.333334h682.666666a85.333333 85.333333 0 0 0 85.333334-85.333334V170.666667a85.333333 85.333333 0 0 0-85.333334-85.333334z m0 768H170.666667V170.666667h682.666666v682.666666z",
      fill: "currentColor",
    })
  );
}

function isDrawnixEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest("foreignObject") !== null ||
    target.closest(".slate-editable-container") !== null ||
    target.closest(".plait-text-container") !== null
  );
}

/**
 * Lake 的卡片 sync 可能重排/替换编辑器滚动容器，而 Drawnix 的 onChange
 * 不一定会触发 Lake 的 contentchange。直接从画板变更点通知 EditorTab，
 * 让它在下一批布局完成后恢复一次原位置，覆盖新增/删除元素这条路径。
 */
function notifyLakeBoardChange(source: HTMLElement, before: number): void {
  const host = source.closest(".lake-editor-tab") as HTMLElement | null;
  if (!host) return;
  host.dispatchEvent(new CustomEvent("lake-board-contentchange", {
    detail: { scrollTop: before },
  }));
}

function getLakeScrollTop(source: HTMLElement): number {
  const host = source.closest(".lake-editor-tab") as HTMLElement | null;
  if (!host) return 0;
  const scroller = host.querySelector(".ne-editor-wrap, .ne-viewer") as HTMLElement | null;
  return scroller?.scrollTop ?? 0;
}

const BoardCardEditor = React.forwardRef<HTMLDivElement, ICardProps<IBoardCardValue>>(
  (props, ref) => {
    const { cardValue, updateCardValue } = props;
    const elements = cardValue.elements ?? [];
    const cardHeight = cardValue.cardHeight ?? 400;
    const guardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = guardRef.current;
      if (!el) return;
      const stop = (e: Event) => {
        if (isDrawnixEditableTarget(e.target)) e.stopPropagation();
      };
      el.addEventListener("mousedown", stop, true);
      el.addEventListener("pointerdown", stop, true);
      el.addEventListener("focusin", stop, true);
      // 画板工具栏和文本编辑事件由 Drawnix 自己处理，不能继续冒泡到 Lake。
      // 否则 Lake 的祖先选区逻辑可能把真实滚动容器拉回顶部。
      // CardResizer 的手柄必须放行，否则会破坏画板卡片缩放。
      const stopUp = (e: Event) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".ne-card-resizer-trigger, .ne-card-resizer-mask, .ne-card-resizer-root")) return;
        if (target.closest(".island") || isDrawnixEditableTarget(target)) e.stopPropagation();
      };
      el.addEventListener("mousedown", stopUp);
      el.addEventListener("pointerdown", stopUp);
      el.addEventListener("focusin", stopUp);
      // Drawnix 在画布上选中元素后，Delete/Backspace 会继续冒泡到 Lake 的
      // 全局键盘/选区逻辑；让 Drawnix 先完成删除，再截断外层处理。
      const stopBoardDelete = (e: KeyboardEvent) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        if (e.target instanceof Element && e.target.closest(".ne-card-resizer-trigger, .ne-card-resizer-mask, .ne-card-resizer-root")) return;
        e.stopPropagation();
      };
      el.addEventListener("keydown", stopBoardDelete);
      return () => {
        el.removeEventListener("mousedown", stop, true);
        el.removeEventListener("pointerdown", stop, true);
        el.removeEventListener("focusin", stop, true);
        el.removeEventListener("mousedown", stopUp);
        el.removeEventListener("pointerdown", stopUp);
        el.removeEventListener("focusin", stopUp);
        el.removeEventListener("keydown", stopBoardDelete);
      };
    }, []);

    return (
      <div ref={ref} className="board-card-wrapper board-card-wrapper--editor" style={{ width: "100%" }}>
        <div ref={guardRef} className="board-card-guard" style={{ width: "100%" }}>
          <CardResizer
            height={cardHeight}
            min={200}
            onResize={(height) => updateCardValue({ ...cardValue, cardHeight: height })}
          >
            <Suspense fallback={<DrawnixFallback />}><LazyDrawnix
              value={elements}
              viewport={cardValue.viewport}
              theme={cardValue.theme}
              initialLanguage="zh"
              onChange={(data) => {
                const before = getLakeScrollTop(guardRef.current || document.body);
                // Drawnix 的 onChange 对"纯视口变化（平移/缩放画布）"也会触发，
                // 且 data 里携带新的 viewport。viewport 是运行时视口状态，
                // 不应持久化到卡片值（否则平移/缩放画布会触发 Lake contentchange
                // → 保存 → 15 分钟自动快照，产生无意义快照）。思维导图无此问题
                // 因为它的视口是内部状态不落盘。
                // 修复：仅当 elements 真正变化（增删/移动/改内容）才 updateCardValue，
                // 且不再持久化 viewport（初始 zoom 已在卡片值里，运行时变化忽略）。
                const elementsChanged = JSON.stringify(data.children) !== JSON.stringify(cardValue.elements);
                if (elementsChanged) {
                  updateCardValue({
                    ...cardValue,
                    elements: data.children,
                    theme: data.theme,
                  });
                }
                notifyLakeBoardChange(guardRef.current || document.body, before);
              }}
            />
            </Suspense>
          </CardResizer>
        </div>
      </div>
    );
  }
);

const BoardCardViewer = React.forwardRef<HTMLDivElement, ICardProps<IBoardCardValue>>(
  (props, ref) => {
    const { cardValue } = props;
    const elements = cardValue.elements ?? [];
    const cardHeight = cardValue.cardHeight ?? 400;

    return (
      <div
        ref={ref}
        className="board-card-wrapper board-card-wrapper--viewer"
        style={{ width: "100%", height: cardHeight, minHeight: 200, border: "1px solid var(--ne-color-border, #e5e5e5)", borderRadius: 8 }}
      >
        <Suspense fallback={<DrawnixFallback />}><LazyDrawnix
          value={elements}
          viewport={cardValue.viewport}
          theme={cardValue.theme}
          afterInit={(board: PlaitBoard) => { board.options.readonly = true; }}
        />
        </Suspense>
      </div>
    );
  }
);

export const BoardCard: CustomCard<IBoardCardValue> = {
  icon: BoardIcon,
  config: {
    name: "board-card",
    cardType: "block",
    slash: {
      icon: "editor-main-drawing-board",
      mainSearch: "/board",
      label: () => ({ zhCN: "画板", enUS: "Board" }),
      description: () => ({ zhCN: "自由画、流程图、思维导图一体化白板", enUS: "All-in-one whiteboard" }),
      keywords: ["board", "画板", "白板", "drawnix", "whiteboard", "绘图"],
    },
    initValue: { elements: [], cardHeight: 400 },
    editorComponent: BoardCardEditor,
    viewerComponent: BoardCardViewer,
    writeText: () => "",
    writeHtml: () => '<div data-card="board-card">画板</div>',
  },
};
