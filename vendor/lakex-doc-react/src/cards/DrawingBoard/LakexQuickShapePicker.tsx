import React from "react";
import { createPortal } from "react-dom";
import type { DrawPointerType } from "@plait/draw";
import {
  categories,
  ShapePreview,
  type CategoryKey,
  type Locale,
} from "./LakexShapeCatalog";

/**
 * LOCAL-CHANGE #20：蓝点快创（auto-complete）之后的**图形选择面板**。
 *
 * 背景：plait 的 `withArrowLineAutoComplete` 在蓝点处提交时用
 * `createDefaultGeometry(board, points, originElement.shape)` ⇒ 新形状**复制源形状类型**，
 * 画流程图时每次都要再手动改形状。云端语雀的做法是提交后弹一个「最近使用 / 基础图形」面板让用户选。
 *
 * 本组件只负责 UI（portal 浮层 + 网格），选择结果由宿主 `DrawnixBoardCore` 应用
 * （选中刚创建的元素 → `DrawTransforms.switchGeometryShape` —— 同一条 `Transforms.setNode({shape})` 路径，
 * 仍会自动重排已绑定的连线）。
 */

export interface QuickShapePickerProps {
  locale: Locale;
  /** 锚点（clientX / clientY）：蓝点快创提交时的指针位置。 */
  anchor: { x: number; y: number };
  /** 最近使用的形状（最新在前）。 */
  recent: DrawPointerType[];
  /** 源形状（快创来源那个形状的类型）：永远排在「最近使用」第一位，一键"和自己一样"。 */
  sourceShape?: DrawPointerType;
  onPick: (pointer: DrawPointerType) => void;
  onClose: () => void;
}

const PICKER_WIDTH = 248;
const PICKER_MAX_HEIGHT = 320;
const MARGIN = 8;

/** 快创面板只放高频三类：基础 / 流程图 / 智能（UML、ER 走完整图形库）。 */
const PICKER_SECTIONS: CategoryKey[] = ["basic", "flowchart", "smart"];

export default function LakexQuickShapePicker({
  locale,
  anchor,
  recent,
  sourceShape,
  onPick,
  onClose,
}: QuickShapePickerProps) {
  const isZh = locale === "zh-CN";
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);

  // 先渲染到屏幕外量高度，再定位（避免第一帧闪到错误位置）
  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const height = Math.min(panel.offsetHeight, PICKER_MAX_HEIGHT);
    const left = Math.min(
      Math.max(MARGIN, anchor.x + MARGIN),
      window.innerWidth - PICKER_WIDTH - MARGIN,
    );
    const top = Math.min(
      Math.max(MARGIN, anchor.y),
      Math.max(MARGIN, window.innerHeight - height - MARGIN),
    );
    setPosition({ left, top });
  }, [anchor.x, anchor.y]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (panelRef.current?.contains(target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  /** 最近使用 = 源形状（"和自己一样"）打头 + 本机记录，去重。 */
  const recentPointers = [
    ...(sourceShape ? [sourceShape] : []),
    ...recent.filter((pointer) => pointer !== sourceShape),
  ].slice(0, 7);
  const recentOptions = recentPointers
    .map((pointer) => {
      for (const category of categories) {
        const hit = category.shapes.find((item) => item.pointer === pointer);
        if (hit) return hit;
      }
      return null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 7);

  const renderShapeButton = (item: { pointer: DrawPointerType; zh: string; en: string }, key: string) => {
    const name = isZh ? item.zh : item.en;
    return (
      <button
        key={key}
        type="button"
        className="lakex-quick-shape__item"
        title={name}
        aria-label={name}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onPick(item.pointer)}
      >
        <ShapePreview pointer={item.pointer} />
      </button>
    );
  };

  return createPortal(
    <div
      ref={panelRef}
      className="lakex-quick-shape"
      data-lakex-quick-shape
      role="dialog"
      aria-label={isZh ? "选择图形" : "Choose shape"}
      style={{
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.y,
        width: PICKER_WIDTH,
        maxHeight: PICKER_MAX_HEIGHT,
        visibility: position ? "visible" : "hidden",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {recentOptions.length > 0 && (
        <section className="lakex-quick-shape__section">
          <div className="lakex-quick-shape__title">{isZh ? "最近使用" : "Recently used"}</div>
          <div className="lakex-quick-shape__grid">
            {recentOptions.map((item, index) => renderShapeButton(item, `recent-${item.pointer}-${index}`))}
          </div>
        </section>
      )}
      {PICKER_SECTIONS.map((key) => {
        const category = categories.find((item) => item.key === key);
        if (!category) return null;
        return (
          <section key={category.key} className="lakex-quick-shape__section">
            <div className="lakex-quick-shape__title">{isZh ? category.zh : category.en}</div>
            <div className="lakex-quick-shape__grid">
              {category.shapes.map((item, index) =>
                renderShapeButton(item, `${category.key}-${item.pointer}-${index}`),
              )}
            </div>
          </section>
        );
      })}
    </div>,
    document.body,
  );
}
