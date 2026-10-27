import React from "react";
import { createPortal } from "react-dom";
import {
  BoardTransforms,
  clearSelectedElement,
  deleteTemporaryElements,
  getRectangleByElements,
  getSelectedElements,
  getViewportOrigination,
  PlaitBoard,
  PlaitHistoryBoard,
  PlaitPointerType,
  Transforms,
  WritableClipboardOperationType,
  type PlaitElement,
  type Point,
} from "@plait/core";
import { BoardCreationMode, setCreationMode } from "@plait/common";
import {
  BasicShapes,
  FlowchartSymbols,
  type PlaitArrowLine,
  type PlaitGeometry,
} from "@plait/draw";
import {
  materialTemplates,
  type MaterialCategory,
  type MaterialTemplate,
} from "./materialTemplates";

type Locale = "zh-CN" | "en-US";
type LibraryTab = "recommended" | "custom";

interface StoredMaterial {
  id: string;
  name: string;
  createdAt: number;
  elements: PlaitElement[];
  width?: number;
  height?: number;
}

interface SelectionSnapshot {
  elements: PlaitElement[];
  width: number;
  height: number;
}

interface Props {
  board: PlaitBoard | null;
  locale: Locale;
  dark: boolean;
  toolbarHost: HTMLElement | null;
  onOpen?: () => void;
}

export interface LakexMaterialLibraryHandle {
  /** Opens the naming dialog for the current Drawnix selection. */
  addSelectionToLibrary: () => boolean;
  /** Keeps the current selection stable while a board context menu is open. */
  captureSelection: () => boolean;
}

const STORAGE_KEY = "lakex-drawnix-custom-materials-v1";

const categoryItems: Array<{
  key: MaterialCategory;
  zh: string;
  en: string;
  icon?: string;
}> = [
  { key: "hot", zh: "热门推荐", en: "Popular", icon: "🔥" },
  { key: "teamwork", zh: "团队协作", en: "Teamwork" },
  { key: "product", zh: "产品设计", en: "Product" },
  { key: "technology", zh: "技术研发", en: "Technology" },
  { key: "thinking", zh: "思维方式", en: "Thinking" },
];

const cloneElements = (elements: PlaitElement[]) =>
  JSON.parse(JSON.stringify(elements)) as PlaitElement[];

const readText = (value: unknown): string => {
  if (!value || typeof value !== "object") return "";
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("children" in value && Array.isArray(value.children)) {
    return value.children.map(readText).join("");
  }
  return "";
};

const getBounds = (elements: PlaitElement[]) => {
  const points = elements.flatMap((element) => {
    const value = element as PlaitElement & { points?: Point[] };
    return value.points ?? [];
  });
  if (!points.length) return { x: -300, y: -220, width: 600, height: 440 };
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const padding = Math.max(18, Math.min(maxX - minX, maxY - minY) * 0.08);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
};

function GeometryPreview({
  element,
}: {
  element: PlaitGeometry;
}) {
  const [start, end] = element.points;
  const x = Math.min(start[0], end[0]);
  const y = Math.min(start[1], end[1]);
  const width = Math.abs(end[0] - start[0]);
  const height = Math.abs(end[1] - start[1]);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const fill = element.fill && element.fill !== "none" ? element.fill : "#fff";
  const stroke = element.strokeColor || "#718096";
  const text = readText(element.text);
  const common = {
    fill,
    stroke,
    strokeWidth: element.strokeWidth || 1.5,
  };
  let shape: React.ReactNode;

  if (element.shape === BasicShapes.ellipse) {
    shape = <ellipse cx={cx} cy={cy} rx={width / 2} ry={height / 2} {...common} />;
  } else if (
    element.shape === BasicShapes.diamond ||
    element.shape === FlowchartSymbols.decision
  ) {
    shape = (
      <path
        d={`M ${cx} ${y} L ${x + width} ${cy} L ${cx} ${y + height} L ${x} ${cy} Z`}
        {...common}
      />
    );
  } else if (element.shape === BasicShapes.triangle) {
    shape = (
      <path
        d={`M ${cx} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`}
        {...common}
      />
    );
  } else {
    const rounded =
      element.shape === BasicShapes.roundRectangle ||
      element.shape === FlowchartSymbols.terminal;
    shape = (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={rounded ? Math.min(height / 2, 14) : 2}
        {...common}
      />
    );
  }

  return (
    <g>
      {shape}
      {text && (
        <text
          x={cx}
          y={cy}
          fill="#344054"
          fontSize={Math.max(10, Math.min(14, height * 0.25))}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text.length > 18 ? `${text.slice(0, 17)}…` : text}
        </text>
      )}
    </g>
  );
}

function MaterialPreview({ elements }: { elements: PlaitElement[] }) {
  const bounds = getBounds(elements);
  return (
    <svg
      className="lakex-material-card__preview"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="lakex-material-preview-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#7A8699" />
        </marker>
      </defs>
      {elements.map((element) => {
        if (element.type === "geometry") {
          return (
            <GeometryPreview
              key={element.id}
              element={element as PlaitGeometry}
            />
          );
        }
        const line = element as PlaitArrowLine;
        if (!Array.isArray(line.points) || line.points.length < 2) return null;
        return (
          <polyline
            key={element.id}
            points={line.points.map((point) => point.join(",")).join(" ")}
            fill="none"
            stroke={line.strokeColor || "#7A8699"}
            strokeWidth={line.strokeWidth || 1.5}
            markerEnd={
              line.target?.marker && line.target.marker !== "none"
                ? "url(#lakex-material-preview-arrow)"
                : undefined
            }
          />
        );
      })}
    </svg>
  );
}

const MaterialIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 13.5h12.5v6H5z" />
    <path d="m7 13.5 3.1-5 3.2 5M16.5 4.5v4M14.5 6.5h4M19 10.5v2M18 11.5h2" />
    <circle cx="6.5" cy="7" r="1.5" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
);

const loadStoredMaterials = (): StoredMaterial[] => {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const LakexMaterialLibrary = React.forwardRef<LakexMaterialLibraryHandle, Props>(function LakexMaterialLibrary({
  board,
  locale,
  dark,
  toolbarHost,
  onOpen,
}, ref) {
  const [open, setOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<LibraryTab>("recommended");
  const [activeCategory, setActiveCategory] =
    React.useState<MaterialCategory>("hot");
  const [storedMaterials, setStoredMaterials] =
    React.useState<StoredMaterial[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pendingMaterial, setPendingMaterial] =
    React.useState<SelectionSnapshot | null>(null);
  const [materialName, setMaterialName] = React.useState("");
  const selectionSnapshotRef = React.useRef<SelectionSnapshot | null>(null);
  const noticeTimerRef = React.useRef<number | null>(null);
  const materialNameInputRef = React.useRef<HTMLInputElement | null>(null);
  const recommendedScrollRef = React.useRef<HTMLDivElement | null>(null);
  const recommendedSectionRefs = React.useRef<
    Partial<Record<MaterialCategory, HTMLElement | null>>
  >({});
  const scrollingToCategoryRef = React.useRef<MaterialCategory | null>(null);
  const isZh = locale === "zh-CN";
  const labels = isZh
    ? {
        library: "素材库",
        recommended: "推荐素材",
        custom: "自定义素材",
        close: "关闭素材库",
        emptyTitle: "添加自定义素材",
        emptyStepOne: "步骤一：框选需要添加的内容",
        emptyStepTwo: "步骤二：右键打开菜单，选择“添加到素材库”",
        insert: "插入素材",
        remove: "删除",
        use: "使用",
        saved: "已添加到自定义素材库",
        selectionMissing: "请先选择要添加的图形",
        saveFailed: "素材保存失败，请重试",
        nameDialogTitle: "添加到素材库",
        nameDialogHint: "为这个自定义素材命名",
        namePlaceholder: "请输入素材名称",
        cancel: "取消",
        confirm: "添加",
      }
    : {
        library: "Material library",
        recommended: "Recommended",
        custom: "Custom",
        close: "Close material library",
        emptyTitle: "Add custom materials",
        emptyStepOne: "Step 1: Select the content to add.",
        emptyStepTwo: "Step 2: Right-click and choose “Add to material library”.",
        insert: "Insert material",
        remove: "Delete",
        use: "Use",
        saved: "Added to custom materials",
        selectionMissing: "Select shapes to add first",
        saveFailed: "Could not save the material. Please try again.",
        nameDialogTitle: "Add to material library",
        nameDialogHint: "Name this custom material",
        namePlaceholder: "Enter a material name",
        cancel: "Cancel",
        confirm: "Add",
      };

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  React.useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!pendingMaterial) return;
    const focusInput = window.setTimeout(() => materialNameInputRef.current?.select(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingMaterial(null);
        setMaterialName("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusInput);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pendingMaterial]);

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 2200);
  };

  const persistStoredMaterials = (next: StoredMaterial[]) => {
    setStoredMaterials(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be disabled by the host; the in-memory library still works.
    }
  };

  const captureSelection = () => {
    if (!board) {
      return null;
    }
    const selected = getSelectedElements(board);
    if (!selected.length) {
      return null;
    }
    let rectangle = getBounds(selected);
    let fragmentElements: PlaitElement[] | undefined;
    try {
      rectangle = getRectangleByElements(board, selected, true);
      const context = board.buildFragment(
        null,
        rectangle,
        WritableClipboardOperationType.copy,
        selected,
      );
      fragmentElements = context?.elements as PlaitElement[] | undefined;
    } catch {
      // Some plugins (for example a node still mounting) cannot build a
      // native clipboard fragment. The selected serializable elements remain
      // enough to create a reusable local material.
    }
    // Most Drawnix elements are returned by buildFragment. A few native
    // element types can decline that clipboard conversion during a context
    // menu interaction, so keep the selected objects as a safe fallback.
    const elements = fragmentElements?.length ? fragmentElements : selected;
    if (!elements?.length) {
      return null;
    }
    const snapshot = {
      elements: cloneElements(elements),
      width: rectangle.width,
      height: rectangle.height,
    };
    selectionSnapshotRef.current = snapshot;
    return snapshot;
  };

  const openLibrary = () => {
    setStoredMaterials(loadStoredMaterials());
    onOpen?.();
    setOpen(true);
  };

  const insertElements = (
    elements: PlaitElement[],
    size?: { width: number; height: number },
  ) => {
    if (!board || !elements.length) return;
    setCreationMode(board, BoardCreationMode.drawing);
    BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
    clearSelectedElement(board);
    Transforms.setSelection(board, null);
    const container = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
    const origin = getViewportOrigination(board) ?? [0, 0];
    const zoom = board.viewport.zoom || 1;
    const center: Point = [
      origin[0] + container.width / 2 / zoom,
      origin[1] + container.height / 2 / zoom,
    ];
    const bounds = size
      ? { x: 0, y: 0, width: size.width, height: size.height }
      : getBounds(elements);
    const target: Point = [
      center[0] - (bounds.x + bounds.width / 2),
      center[1] - (bounds.y + bounds.height / 2),
    ];
    PlaitHistoryBoard.withNewBatch(
      board,
      () => {
        board.insertFragment(
          { elements: cloneElements(elements) },
          target,
          WritableClipboardOperationType.paste,
        );
        // insertFragment temporarily selects the inserted object instances.
        // Lakex immediately persists/clones the controlled board value, so
        // retaining those instances leaves Plait with a stale selection cache.
        deleteTemporaryElements(board);
        clearSelectedElement(board);
        Transforms.setSelection(board, null);
      },
    );
    setOpen(false);
  };

  const addSelectionToLibrary = () => {
    const snapshot = captureSelection() ?? selectionSnapshotRef.current;
    if (!snapshot) {
      showNotice(labels.selectionMissing);
      return false;
    }
    const existingMaterials = loadStoredMaterials();
    setMaterialName(
      isZh
        ? `自定义素材 ${existingMaterials.length + 1}`
        : `Custom material ${existingMaterials.length + 1}`,
    );
    setPendingMaterial(snapshot);
    return true;
  };

  const savePendingMaterial = () => {
    if (!pendingMaterial) return;
    try {
      const existingMaterials = loadStoredMaterials();
      const name = materialName.trim() || (isZh
        ? `自定义素材 ${existingMaterials.length + 1}`
        : `Custom material ${existingMaterials.length + 1}`);
      const material: StoredMaterial = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        createdAt: Date.now(),
        elements: cloneElements(pendingMaterial.elements),
        width: pendingMaterial.width,
        height: pendingMaterial.height,
      };
      const next = [material, ...existingMaterials];
      persistStoredMaterials(next);
      // The state update is the immediate source of truth. Then read the
      // persisted copy back only when it contains the item just written, so
      // blocked localStorage never erases the visible in-memory material.
      const reloaded = loadStoredMaterials();
      setStoredMaterials(
        reloaded.some((item) => item.id === material.id) ? reloaded : next,
      );
      setActiveTab("custom");
      onOpen?.();
      setOpen(true);
      setPendingMaterial(null);
      setMaterialName("");
      showNotice(labels.saved);
    } catch {
      showNotice(labels.saveFailed);
    }
  };

  React.useImperativeHandle(ref, () => ({
    addSelectionToLibrary,
    captureSelection: () => !!captureSelection(),
  }));

  const renderMaterialCard = (
    id: string,
    name: string,
    elements: PlaitElement[],
    remove?: () => void,
    size?: { width: number; height: number },
    details?: {
      description: string;
    },
  ) => (
    <article className="lakex-material-card" key={id}>
      <button
        type="button"
        className="lakex-material-card__insert"
        title={`${labels.insert}: ${name}`}
        onClick={() => insertElements(elements, size)}
      >
        <span className="lakex-material-card__canvas">
          <MaterialPreview elements={elements} />
        </span>
        <span className="lakex-material-card__footer">
          <span>{name}</span>
        </span>
      </button>
      {details && (
        <div className="lakex-material-card__details">
          <strong>{name}</strong>
          <p>{details.description}</p>
          <button
            type="button"
            className="lakex-material-card__use"
            aria-label={`${labels.use}: ${name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              insertElements(elements, size);
            }}
          >
            {labels.use}
          </button>
        </div>
      )}
      {remove && (
        <button
          type="button"
          className="lakex-material-card__remove"
          aria-label={`${labels.remove}: ${name}`}
          title={labels.remove}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            remove();
          }}
        >
          ×
        </button>
      )}
    </article>
  );

  const trigger = toolbarHost
    ? createPortal(
        <div
          className="lakex-material-trigger-wrap"
          data-tooltip={labels.library}
        >
          <button
            type="button"
            className="lakex-material-trigger"
            title={labels.library}
            aria-label={labels.library}
            aria-expanded={open}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openLibrary}
          >
            <MaterialIcon />
          </button>
        </div>,
        toolbarHost,
      )
    : null;

  return (
    <>
      {trigger}
      {notice && typeof document !== "undefined" &&
        createPortal(
          <div
            className="lakex-material-toast"
            data-theme={dark ? "dark" : "light"}
            role="status"
          >
            <span>✓</span>{notice}
          </div>,
          document.body,
        )}
      {pendingMaterial && typeof document !== "undefined" &&
        createPortal(
          <div
            className="lakex-material-name-dialog__backdrop"
            data-theme={dark ? "dark" : "light"}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setPendingMaterial(null);
                setMaterialName("");
              }
            }}
          >
            <form
              className="lakex-material-name-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lakex-material-name-dialog-title"
              onSubmit={(event) => {
                event.preventDefault();
                savePendingMaterial();
              }}
            >
              <strong id="lakex-material-name-dialog-title">
                {labels.nameDialogTitle}
              </strong>
              <span>{labels.nameDialogHint}</span>
              <input
                ref={materialNameInputRef}
                value={materialName}
                placeholder={labels.namePlaceholder}
                onChange={(event) => setMaterialName(event.target.value)}
              />
              <div className="lakex-material-name-dialog__actions">
                <button
                  type="button"
                  onClick={() => {
                    setPendingMaterial(null);
                    setMaterialName("");
                  }}
                >
                  {labels.cancel}
                </button>
                <button type="submit">{labels.confirm}</button>
              </div>
            </form>
          </div>,
          document.body,
        )}
      {open && (
        <div
          className="lakex-material-library__backdrop"
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="lakex-material-library"
            role="dialog"
            aria-modal="true"
            aria-label={labels.library}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="lakex-material-library__header">
              <div className="lakex-material-library__main-tabs" role="tablist">
                {(["recommended", "custom"] as LibraryTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === "recommended"
                      ? labels.recommended
                      : labels.custom}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="lakex-material-library__close"
                aria-label={labels.close}
                title={labels.close}
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>

            {activeTab === "recommended" ? (
              <div className="lakex-material-library__recommended">
                <nav
                  className="lakex-material-library__categories"
                  aria-label={labels.recommended}
                >
                  {categoryItems.map((category) => (
                    <button
                      key={category.key}
                      type="button"
                      role="tab"
                      aria-selected={category.key === activeCategory}
                      aria-pressed={category.key === activeCategory}
                      onClick={() => {
                        const container = recommendedScrollRef.current;
                        const section =
                          recommendedSectionRefs.current[category.key];
                        if (!container || !section) return;
                        scrollingToCategoryRef.current = category.key;
                        setActiveCategory(category.key);
                        container.scrollTo({
                          top: section.offsetTop,
                          behavior: "smooth",
                        });
                        window.setTimeout(() => {
                          scrollingToCategoryRef.current = null;
                        }, 400);
                      }}
                    >
                      {category.icon && <span>{category.icon}</span>}
                      {isZh ? category.zh : category.en}
                    </button>
                  ))}
                </nav>
                <div
                  ref={recommendedScrollRef}
                  className="lakex-material-library__recommended-scroll"
                  onScroll={(event) => {
                    if (scrollingToCategoryRef.current) return;
                    const container = event.currentTarget;
                    if (
                      container.scrollTop + container.clientHeight >=
                      container.scrollHeight - 2
                    ) {
                      setActiveCategory(categoryItems[categoryItems.length - 1].key);
                      return;
                    }
                    const scrollTop =
                      container.scrollTop +
                      Math.min(container.clientHeight * 0.28, 128);
                    let next = categoryItems[0].key;
                    for (const category of categoryItems) {
                      const section =
                        recommendedSectionRefs.current[category.key];
                      if (section && section.offsetTop <= scrollTop) {
                        next = category.key;
                      }
                    }
                    setActiveCategory(next);
                  }}
                >
                  {categoryItems.map((category) => (
                    <section
                      key={category.key}
                      ref={(element) => {
                        recommendedSectionRefs.current[category.key] = element;
                      }}
                      className="lakex-material-library__recommended-section"
                      aria-label={isZh ? category.zh : category.en}
                    >
                      <div className="lakex-material-library__grid">
                        {materialTemplates
                          .filter((template) =>
                            template.categories.includes(category.key),
                          )
                          .map((template: MaterialTemplate) => {
                            const elements = template.build(locale);
                            return renderMaterialCard(
                              template.id,
                              isZh ? template.zh : template.en,
                              elements,
                              undefined,
                              undefined,
                              template.sourceId
                                ? {
                                    description: isZh
                                      ? template.descriptionZh || ""
                                      : template.descriptionEn || "",
                                  }
                                : undefined,
                            );
                          })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ) : (
              <div className="lakex-material-library__custom">
                {storedMaterials.length ? (
                  <div className="lakex-material-library__grid">
                    {storedMaterials.map((material) =>
                      renderMaterialCard(
                        material.id,
                        material.name,
                        material.elements,
                        () =>
                          persistStoredMaterials(
                            storedMaterials.filter(
                              (item) => item.id !== material.id,
                            ),
                          ),
                        material.width && material.height
                          ? {
                              width: material.width,
                              height: material.height,
                            }
                          : undefined,
                      ),
                    )}
                  </div>
                ) : (
                  <div className="lakex-material-library__empty">
                    <div className="lakex-material-library__empty-copy">
                      <strong>{labels.emptyTitle}</strong>
                      <span>{labels.emptyStepOne}</span>
                      <span>{labels.emptyStepTwo}</span>
                    </div>
                    <div className="lakex-material-library__empty-illustration" aria-hidden="true">
                      <div className="lakex-material-library__empty-selection">
                        <i /><b /><em />
                      </div>
                      <div className="lakex-material-library__empty-menu">
                        <i /><i /><b>{isZh ? "添加到素材库" : "Add to library"}</b><i />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
});

export default LakexMaterialLibrary;
