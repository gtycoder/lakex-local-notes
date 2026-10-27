import React from "react";
import type { PlaitBoard } from "@plait/core";
import { BoardTransforms } from "@plait/core";
import { BoardCreationMode, setCreationMode } from "@plait/common";
import {
  BasicShapes,
  FlowchartSymbols,
  UMLSymbols,
  type DrawPointerType,
} from "@plait/draw";

export type Locale = "zh-CN" | "en-US";
export type CategoryKey = "basic" | "flowchart" | "smart" | "uml" | "er";

export interface ShapeOption {
  pointer: DrawPointerType;
  zh: string;
  en: string;
}

export interface ShapeCategory {
  key: CategoryKey;
  zh: string;
  en: string;
  shapes: ShapeOption[];
}

const shape = (
  pointer: DrawPointerType,
  zh: string,
  en: string,
): ShapeOption => ({ pointer, zh, en });

export const categories: ShapeCategory[] = [
  {
    key: "basic",
    zh: "基础图形",
    en: "Basic",
    shapes: [
      shape(BasicShapes.rectangle, "矩形", "Rectangle"),
      shape(BasicShapes.roundRectangle, "圆角矩形", "Rounded rectangle"),
      shape(BasicShapes.ellipse, "圆形", "Ellipse"),
      shape(BasicShapes.triangle, "三角形", "Triangle"),
      shape(BasicShapes.diamond, "菱形", "Diamond"),
      shape(BasicShapes.parallelogram, "平行四边形", "Parallelogram"),
      shape(BasicShapes.trapezoid, "梯形", "Trapezoid"),
      shape(BasicShapes.cross, "十字", "Cross"),
      shape(BasicShapes.pentagon, "五边形", "Pentagon"),
      shape(BasicShapes.hexagon, "六边形", "Hexagon"),
      shape(BasicShapes.octagon, "八边形", "Octagon"),
      shape(BasicShapes.star, "星形", "Star"),
      shape(BasicShapes.leftArrow, "左箭头", "Left arrow"),
      shape(BasicShapes.rightArrow, "右箭头", "Right arrow"),
      shape(BasicShapes.twoWayArrow, "双向箭头", "Two-way arrow"),
      shape(BasicShapes.comment, "标注", "Callout"),
      shape(BasicShapes.roundComment, "圆角标注", "Rounded callout"),
      shape(BasicShapes.cloud, "云形", "Cloud"),
    ],
  },
  {
    key: "flowchart",
    zh: "流程图",
    en: "Flowchart",
    shapes: [
      shape(FlowchartSymbols.process, "流程", "Process"),
      shape(FlowchartSymbols.terminal, "开始/结束", "Start / End"),
      shape(FlowchartSymbols.decision, "判断", "Decision"),
      shape(FlowchartSymbols.data, "数据", "Data"),
      shape(FlowchartSymbols.connector, "连接符", "Connector"),
      shape(FlowchartSymbols.manualInput, "手动输入", "Manual input"),
      shape(FlowchartSymbols.preparation, "准备", "Preparation"),
      shape(FlowchartSymbols.predefinedProcess, "子流程", "Subprocess"),
      shape(FlowchartSymbols.document, "文档", "Document"),
      shape(FlowchartSymbols.multiDocument, "多文档", "Multiple documents"),
      shape(FlowchartSymbols.database, "数据库", "Database"),
      shape(FlowchartSymbols.internalStorage, "内部存储", "Internal storage"),
      shape(FlowchartSymbols.delay, "延迟", "Delay"),
      shape(FlowchartSymbols.display, "显示", "Display"),
      shape(FlowchartSymbols.offPage, "页外连接", "Off-page connector"),
      shape(FlowchartSymbols.noteSquare, "注释", "Note"),
    ],
  },
  {
    key: "smart",
    zh: "Smart",
    en: "Smart",
    shapes: [
      shape(UMLSymbols.actor, "角色", "Actor"),
      shape(UMLSymbols.useCase, "用例", "Use case"),
      shape(UMLSymbols.component, "组件", "Component"),
      shape(UMLSymbols.container, "容器", "Container"),
      shape(UMLSymbols.note, "便签", "Note"),
      shape(UMLSymbols.package, "包", "Package"),
    ],
  },
  {
    key: "uml",
    zh: "UML",
    en: "UML",
    shapes: [
      shape(UMLSymbols.simpleClass, "简单类", "Simple class"),
      shape(UMLSymbols.class, "类", "Class"),
      shape(UMLSymbols.interface, "接口", "Interface"),
      shape(UMLSymbols.object, "对象", "Object"),
      shape(UMLSymbols.componentBox, "组件框", "Component box"),
      shape(UMLSymbols.activityClass, "活动", "Activity"),
      shape(UMLSymbols.branchMerge, "分支/合并", "Branch / Merge"),
      shape(UMLSymbols.port, "端口", "Port"),
      shape(UMLSymbols.combinedFragment, "组合片段", "Combined fragment"),
      shape(UMLSymbols.template, "模板", "Template"),
      shape(UMLSymbols.activation, "激活", "Activation"),
      shape(UMLSymbols.deletion, "销毁", "Deletion"),
    ],
  },
  {
    key: "er",
    zh: "ER",
    en: "ER",
    shapes: [
      shape(BasicShapes.rectangle, "实体", "Entity"),
      shape(BasicShapes.roundRectangle, "弱实体", "Weak entity"),
      shape(BasicShapes.diamond, "关系", "Relationship"),
      shape(BasicShapes.ellipse, "属性", "Attribute"),
      shape(BasicShapes.parallelogram, "关联实体", "Associative entity"),
      shape(UMLSymbols.class, "实体明细", "Entity details"),
    ],
  },
];

export function ShapePreview({ pointer }: { pointer: DrawPointerType }) {
  const value = String(pointer);

  switch (value) {
    // ── Basic Shapes ──
    case BasicShapes.rectangle:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="8" y="8" width="16" height="16" />
        </svg>
      );
    case BasicShapes.roundRectangle:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="8" y="8" width="16" height="16" rx="3" />
        </svg>
      );
    case BasicShapes.ellipse:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <ellipse cx="16" cy="16" rx="9" ry="9" />
        </svg>
      );
    case BasicShapes.triangle:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 8L25 24L7 24Z" />
        </svg>
      );
    case BasicShapes.diamond:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 7L25 16L16 25L7 16Z" />
        </svg>
      );
    case BasicShapes.parallelogram:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M11 9L27 9L21 23L5 23Z" />
        </svg>
      );
    case BasicShapes.trapezoid:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M9 10L23 10L26 22L6 22Z" />
        </svg>
      );
    case BasicShapes.cross:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M18.8 7C19.5 7 20.1 7.5 20.1 8.2V11.9H23.8C24.5 11.9 25 12.4 25 13.1V18.9C25 19.6 24.5 20.1 23.8 20.1H20.1V23.8C20.1 24.5 19.5 25 18.8 25H13.1C12.4 25 11.9 24.5 11.9 23.8V20.1H8.2C7.5 20.1 7 19.6 7 18.9V13.1C7 12.4 7.5 11.9 8.2 11.9H11.9V8.2C11.9 7.5 12.4 7 13.1 7Z" />
        </svg>
      );
    case BasicShapes.pentagon:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 7L25.1 13.6L21.6 24.4H10.4L6.9 13.6Z" />
        </svg>
      );
    case BasicShapes.hexagon:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M11 8H21L26 16L21 24H11L6 16Z" />
        </svg>
      );
    case BasicShapes.octagon:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M11 7H21L25 11V21L21 25H11L7 21V11Z" />
        </svg>
      );
    case BasicShapes.star:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 6L18.5 12.5L25.5 13L20 17.5L21.8 24.5L16 20.5L10.2 24.5L12 17.5L6.5 13L13.5 12.5Z" />
        </svg>
      );
    case BasicShapes.leftArrow:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M7 16L16 7V12H25V20H16V25Z" />
        </svg>
      );
    case BasicShapes.rightArrow:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M25 16L16 25V20H7V12H16V7Z" />
        </svg>
      );
    case BasicShapes.twoWayArrow:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M7 16L13 10V14H19V10L25 16L19 22V18H13V22Z" />
        </svg>
      );
    case BasicShapes.comment:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M6 8H26V19H14L9 24V19H6Z" />
        </svg>
      );
    case BasicShapes.roundComment:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M6 12C6 9.8 7.8 8 10 8H22C24.2 8 26 9.8 26 12V17C26 19.2 24.2 21 22 21H14L9 25V21H10C7.8 21 6 19.2 6 17Z" />
        </svg>
      );
    case BasicShapes.cloud:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M9 22C6.8 22 5 20.2 5 18C5 16.1 6.3 14.5 8.1 14.1C8 13.8 8 13.4 8 13C8 10.2 10.2 8 13 8C14.5 8 15.8 8.7 16.7 9.7C17.6 8.6 19 8 20.5 8C23.5 8 26 10.5 26 13.5C26 13.7 26 13.8 26 14C27.7 14.5 29 16.1 29 18C29 20.2 27.2 22 25 22Z" />
        </svg>
      );

    // ── Flowchart Symbols ──
    case FlowchartSymbols.process:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="8" y="8" width="16" height="16" />
        </svg>
      );
    case FlowchartSymbols.terminal:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="9" width="20" height="14" rx="7" />
        </svg>
      );
    case FlowchartSymbols.decision:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 7L25 16L16 25L7 16Z" />
        </svg>
      );
    case FlowchartSymbols.data:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M11 9L27 9L21 23L5 23Z" />
        </svg>
      );
    case FlowchartSymbols.connector:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="8" />
        </svg>
      );
    case FlowchartSymbols.manualInput:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M6 12L26 8L26 24H6Z" />
        </svg>
      );
    case FlowchartSymbols.preparation:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M10 8H22L27 16L22 24H10L5 16Z" />
        </svg>
      );
    case FlowchartSymbols.predefinedProcess:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="7" y="8" width="18" height="16" />
          <path d="M10 8V24M22 8V24" />
        </svg>
      );
    case FlowchartSymbols.document:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M7 8H25V20C25 20 22 24 16 20C10 16 7 24 7 24Z" />
        </svg>
      );
    case FlowchartSymbols.multiDocument:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M9 10H25V20C25 20 22 24 17 20V22C17 22 14 26 9 22Z" />
          <path d="M7 6H23V10H9V18C7 18 7 16.5 7 16.5Z" />
        </svg>
      );
    case FlowchartSymbols.database:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <ellipse cx="16" cy="9" rx="9" ry="3.5" />
          <path d="M7 9V23C7 25 11 26.5 16 26.5S25 25 25 23V9M7 16C7 18 11 19.5 16 19.5S25 18 25 16" />
        </svg>
      );
    case FlowchartSymbols.internalStorage:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="7" y="8" width="18" height="16" />
          <path d="M7 10H25M9 8V24" />
        </svg>
      );
    case FlowchartSymbols.delay:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M6 8H21A5 8 0 0 1 21 24H6Z" />
        </svg>
      );
    case FlowchartSymbols.display:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M8 8H26A3 8 0 0 1 26 24H8L4 16Z" />
        </svg>
      );
    case FlowchartSymbols.offPage:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M7 8H25V18L16 25L7 18Z" />
        </svg>
      );
    case FlowchartSymbols.noteSquare:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M12 8H8V24H12" />
        </svg>
      );

    // ── UML Symbols ──
    case UMLSymbols.actor:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="6" r="3" />
          <path d="M16 9V18M9 13H23M16 18L10 27M16 18L22 27" />
        </svg>
      );
    case UMLSymbols.useCase:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <ellipse cx="16" cy="16" rx="11" ry="8" />
        </svg>
      );
    case UMLSymbols.component:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="8" width="20" height="16" />
          <rect x="4" y="12" width="5" height="3" rx="1" />
          <rect x="4" y="18" width="5" height="3" rx="1" />
        </svg>
      );
    case UMLSymbols.container:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="4" y="8" width="24" height="16" />
          <path d="M11 8V24" />
        </svg>
      );
    case UMLSymbols.note:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M6 6H20L26 12V26H6ZM20 6V12H26" />
          <path d="M10 16H22M10 21H18" />
        </svg>
      );
    case UMLSymbols.package:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 10H14L17 13H28V26H4ZM4 10V6H14L17 10" />
        </svg>
      );
    case UMLSymbols.simpleClass:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="6" width="20" height="20" />
        </svg>
      );
    case UMLSymbols.class:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="5" width="20" height="22" />
          <path d="M6 11H26M6 18H26" />
        </svg>
      );
    case UMLSymbols.interface:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="6" width="20" height="20" />
          <path d="M6 13H26" />
        </svg>
      );
    case UMLSymbols.object:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="6" width="20" height="20" />
        </svg>
      );
    case UMLSymbols.componentBox:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="4" y="8" width="24" height="16" />
          <rect x="21" y="9" width="6" height="7" />
          <rect x="19" y="10" width="2" height="1.5" />
          <rect x="19" y="13" width="2" height="1.5" />
        </svg>
      );
    case UMLSymbols.activityClass:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="6" width="20" height="20" />
          <path d="M8.5 6V26M23.5 6V26" />
        </svg>
      );
    case UMLSymbols.branchMerge:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 7L25 16L16 25L7 16Z" />
        </svg>
      );
    case UMLSymbols.port:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="8" y="8" width="16" height="16" />
        </svg>
      );
    case UMLSymbols.combinedFragment:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="6" width="20" height="20" />
          <path d="M6 6L6 12L12 6Z" />
          <path d="M7 11V7H11" />
        </svg>
      );
    case UMLSymbols.template:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="6" width="20" height="20" rx="3" strokeDasharray="3 2" />
        </svg>
      );
    case UMLSymbols.activation:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="12" y="6" width="8" height="20" />
        </svg>
      );
    case UMLSymbols.deletion:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M9 9L23 23M23 9L9 23" />
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="8" y="8" width="16" height="16" />
        </svg>
      );
  }
}

interface Props {
  board: PlaitBoard | null;
  locale: Locale;
  open: boolean;
  onClose: () => void;
}

export default function LakexShapeCatalog({
  board,
  locale,
  open,
  onClose,
}: Props) {
  const [activeCategory, setActiveCategory] =
    React.useState<CategoryKey>("basic");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const sectionRefs = React.useRef<
    Partial<Record<CategoryKey, HTMLElement | null>>
  >({});
  const scrollingToRef = React.useRef<CategoryKey | null>(null);
  const isZh = locale === "zh-CN";

  if (!open) return null;

  return (
    <section
      className="lakex-shape-catalog"
      data-lakex-shape-catalog
      aria-label={isZh ? "图形库" : "Shape library"}
    >
      <div className="lakex-shape-catalog__tabs" role="tablist">
        {categories.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === activeCategory}
            className="lakex-shape-catalog__tab"
            onClick={() => {
              const container = scrollRef.current;
              const section = sectionRefs.current[item.key];
              if (!container || !section) return;
              scrollingToRef.current = item.key;
              setActiveCategory(item.key);
              container.scrollTo({
                top: section.offsetTop,
                behavior: "smooth",
              });
              window.setTimeout(() => {
                scrollingToRef.current = null;
              }, 400);
            }}
          >
            {isZh ? item.zh : item.en}
          </button>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="lakex-shape-catalog__body"
        onScroll={(event) => {
          if (scrollingToRef.current) return;
          const container = event.currentTarget;
          const atBottom =
            container.scrollTop + container.clientHeight >=
            container.scrollHeight - 2;
          if (atBottom) {
            setActiveCategory(categories[categories.length - 1].key);
            return;
          }
          const scrollTop =
            container.scrollTop + Math.min(container.clientHeight * 0.28, 128);
          let next = categories[0].key;
          for (const category of categories) {
            const section = sectionRefs.current[category.key];
            if (section && section.offsetTop <= scrollTop) {
              next = category.key;
            }
          }
          setActiveCategory(next);
        }}
      >
        {categories.map((category) => (
          <section
            key={category.key}
            ref={(element) => {
              sectionRefs.current[category.key] = element;
            }}
            className="lakex-shape-catalog__section"
            data-shape-category={category.key}
            aria-labelledby={`lakex-shape-category-${category.key}`}
          >
            <div
              id={`lakex-shape-category-${category.key}`}
              className="lakex-shape-catalog__title"
            >
              {isZh ? category.zh : category.en}
            </div>
            <div className="lakex-shape-catalog__grid">
              {category.shapes.map((item, index) => {
                const name = isZh ? item.zh : item.en;
                return (
                  <button
                    key={`${item.pointer}-${index}`}
                    type="button"
                    className="lakex-shape-catalog__shape"
                    title={name}
                    aria-label={name}
                    onClick={() => {
                      if (!board) return;
                      setCreationMode(board, BoardCreationMode.drawing);
                      BoardTransforms.updatePointerType(board, item.pointer);
                      onClose();
                    }}
                  >
                    <ShapePreview pointer={item.pointer} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
