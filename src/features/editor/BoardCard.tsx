import "../../vendor/drawnix.css";
import "../../vendor/drawnix-react-board.css";
import "../../vendor/drawnix-react-text.css";
import React, { useEffect, useRef } from "react";
import { Drawnix } from "lakex-drawnix";
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
      return () => {
        el.removeEventListener("mousedown", stop, true);
        el.removeEventListener("pointerdown", stop, true);
        el.removeEventListener("focusin", stop, true);
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
            <Drawnix
              value={elements}
              viewport={cardValue.viewport}
              theme={cardValue.theme}
              initialLanguage="zh"
              onChange={(data) => {
                updateCardValue({
                  ...cardValue,
                  elements: data.children,
                  viewport: data.viewport,
                  theme: data.theme,
                });
              }}
            />
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
        <Drawnix
          value={elements}
          viewport={cardValue.viewport}
          theme={cardValue.theme}
          afterInit={(board: PlaitBoard) => { board.options.readonly = true; }}
        />
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
