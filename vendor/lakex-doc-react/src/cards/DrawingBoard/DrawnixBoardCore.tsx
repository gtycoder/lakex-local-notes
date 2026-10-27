/**
 * Lakex adapter for the upstream Drawnix editor.
 *
 * The drawing engine and interaction plugins deliberately stay upstream.
 * This layer maps Lakex card data, locale, theme and product-specific chrome.
 */
import React from "react";
import { Drawnix } from "lakex-drawnix";
import {
  addSelectedElement,
  BoardTransforms,
  clearSelectedElement,
  getBoundingRectangleByElements,
  getHitElementByPoint,
  getViewportOrigination,
  getSelectedElements,
  PlaitBoard,
  PlaitHistoryBoard,
  PlaitPointerType,
  ThemeColorMode,
  Transforms,
  toImage,
  type PlaitElement,
  type Viewport,
} from "@plait/core";
import {
  Alignment,
  BoardCreationMode,
  buildText,
  getTextEditorsByElement,
  getTextManages,
  setCreationMode,
} from "@plait/common";
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  BasicShapes,
  createArrowLineElement,
  createDefaultGeometry,
  DrawTransforms,
  FlowchartSymbols,
  memorizeLatestShape,
  PlaitDrawElement,
  setAutoCompleteCommitHost,
  type DrawPointerType,
  type GeometryShapes,
  type PlaitShapeElement,
  UMLSymbols,
} from "@plait/draw";
import {
  createEmptyMind,
  createMindElement,
  getDefaultFontSizeForMindElement,
  MindTransforms,
} from "@plait/mind";
import {
  PlaitMarkEditor,
  TextTransforms,
  type FontSizes,
} from "@plait/text-plugins";
import LakexShapeCatalog from "./LakexShapeCatalog";
import LakexExportMenu from "./LakexExportMenu";
import LakexMaterialLibrary, {
  type LakexMaterialLibraryHandle,
} from "./LakexMaterialLibrary";
import LakexBoardContextMenu from "./LakexBoardContextMenu";
import LakexAIBoardAssistant, {
  type AIBoardApplyMode,
} from "./LakexAIBoardAssistant";
import LakexQuickShapePicker from "./LakexQuickShapePicker";
import type { DrawingBoardAIConfig } from "../../components/lakex/types";
import type { DrawingBoardPreset, IDrawingBoardCardValue } from "./types";
import "./DrawnixBoardCore.css";

type Locale = "zh-CN" | "en-US";
type BoardTheme = "light" | "dark" | "system";

/** LOCAL-CHANGE #20：蓝点快创面板的「最近使用」形状（本机偏好，不进文档）。 */
const RECENT_SHAPES_KEY = "lake-notes-v3.board-recent-shapes";
const RECENT_SHAPE_LIMIT = 7;
/** 面板/工具栏等自研 UI 内的指针手势不算「画布手势」，避免误触发快创面板。 */
const QUICK_SHAPE_IGNORE_SELECTOR =
  ".draw-toolbar, .lakex-shape-catalog, .lakex-material-library, .lakex-drawnix-export, [data-lakex-quick-shape], [data-lakex-ai-board]";

function loadRecentShapes(): DrawPointerType[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_SHAPES_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string").slice(0, RECENT_SHAPE_LIMIT) as DrawPointerType[];
  } catch {
    return [];
  }
}

function saveRecentShapes(shapes: DrawPointerType[]): void {
  try {
    window.localStorage.setItem(RECENT_SHAPES_KEY, JSON.stringify(shapes));
  } catch {
    // localStorage 被禁用时忽略：只影响「最近使用」列表
  }
}

interface BoardElementWithPoints extends PlaitElement {
  points?: [number, number][];
  children?: BoardElementWithPoints[];
}

interface BoardElementsBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const getPointBounds = (
  elements: PlaitElement[],
): BoardElementsBounds | null => {
  const points: [number, number][] = [];
  const collect = (element: BoardElementWithPoints) => {
    element.points?.forEach((point) => {
      if (Number.isFinite(point[0]) && Number.isFinite(point[1])) {
        points.push(point);
      }
    });
    element.children?.forEach(collect);
  };
  elements.forEach((element) => collect(element as BoardElementWithPoints));
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const translateBoardElement = (
  element: PlaitElement,
  deltaX: number,
  deltaY: number,
): PlaitElement => {
  const source = element as BoardElementWithPoints;
  const translated = { ...source };
  if (source.points) {
    translated.points = source.points.map(
      ([x, y]) => [x + deltaX, y + deltaY] as [number, number],
    );
  }
  if (source.children) {
    translated.children = source.children.map(
      (child) =>
        translateBoardElement(child, deltaX, deltaY) as BoardElementWithPoints,
    );
  }
  return translated;
};

const placeElementsBesideCurrentBoard = (
  board: PlaitBoard,
  elements: PlaitElement[],
) => {
  if (!board.children.length) return elements;
  const generatedBounds = getPointBounds(elements);
  if (!generatedBounds) return elements;

  let currentBounds: BoardElementsBounds | null = null;
  try {
    currentBounds = getBoundingRectangleByElements(
      board,
      board.children,
      true,
    );
  } catch {
    currentBounds = getPointBounds(board.children);
  }
  if (!currentBounds || (!currentBounds.width && !currentBounds.height)) {
    return elements;
  }

  const gap = 120;
  const deltaX =
    currentBounds.x + currentBounds.width + gap - generatedBounds.x;
  const deltaY =
    currentBounds.y +
    currentBounds.height / 2 -
    (generatedBounds.y + generatedBounds.height / 2);
  return elements.map((element) =>
    translateBoardElement(element, deltaX, deltaY),
  );
};

const insertArrow = (
  board: PlaitBoard,
  start: [number, number],
  end: [number, number],
) => {
  const arrow = createArrowLineElement(
    ArrowLineShape.straight,
    [start, end],
    { marker: ArrowLineMarkerType.none },
    { marker: ArrowLineMarkerType.arrow },
  );
  Transforms.insertNode(board, arrow, [board.children.length]);
};

type PresetAnchor = "top" | "right" | "bottom" | "left";

const PRESET_CONNECTIONS: Record<PresetAnchor, [number, number]> = {
  top: [0.5, 0],
  right: [1, 0.5],
  bottom: [0.5, 1],
  left: [0, 0.5],
};

const getPresetAnchorPoint = (
  element: PlaitShapeElement,
  anchor: PresetAnchor,
): [number, number] => {
  const [start, end] = element.points;
  switch (anchor) {
    case "top":
      return [(start[0] + end[0]) / 2, start[1]];
    case "right":
      return [end[0], (start[1] + end[1]) / 2];
    case "bottom":
      return [(start[0] + end[0]) / 2, end[1]];
    case "left":
      return [start[0], (start[1] + end[1]) / 2];
  }
};

const insertBoundArrow = (
  board: PlaitBoard,
  source: PlaitShapeElement,
  target: PlaitShapeElement,
  sourceAnchor: PresetAnchor,
  targetAnchor: PresetAnchor,
) => {
  const arrow = createArrowLineElement(
    ArrowLineShape.straight,
    [
      getPresetAnchorPoint(source, sourceAnchor),
      getPresetAnchorPoint(target, targetAnchor),
    ],
    {
      boundId: source.id,
      connection: PRESET_CONNECTIONS[sourceAnchor],
      marker: ArrowLineMarkerType.none,
    },
    {
      boundId: target.id,
      connection: PRESET_CONNECTIONS[targetAnchor],
      marker: ArrowLineMarkerType.arrow,
    },
  );
  Transforms.insertNode(board, arrow, [board.children.length]);
};

const PRESET_SCALE = 0.8;

const scalePresetPoint = (
  point: [number, number],
  origin: [number, number],
): [number, number] => [
  origin[0] + (point[0] - origin[0]) * PRESET_SCALE,
  origin[1] + (point[1] - origin[1]) * PRESET_SCALE,
];

const insertPresetGeometry = (
  board: PlaitBoard,
  points: [[number, number], [number, number]],
  shape: FlowchartSymbols | UMLSymbols,
  text: string,
) => {
  const element = createDefaultGeometry(
    board,
    points,
    shape,
  ) as PlaitShapeElement;
  const label = buildText(text, Alignment.center, { "font-size": "12" });
  let labeledElement: PlaitShapeElement;
  if ("cells" in element && Array.isArray(element.cells) && element.cells[0]) {
    const cells = element.cells.map((cell, index) =>
      index === 0 ? { ...cell, text: label } : cell,
    );
    labeledElement = { ...element, cells } as PlaitShapeElement;
  } else if ("texts" in element && Array.isArray(element.texts)) {
    const texts = element.texts.map((item, index) =>
      index === 0 ? { ...item, text: label } : item,
    );
    labeledElement = { ...element, texts } as PlaitShapeElement;
  } else {
    labeledElement = { ...element, text: label } as PlaitShapeElement;
  }
  Transforms.insertNode(board, labeledElement, [board.children.length]);
  return labeledElement;
};

const insertPresetScene = (
  board: PlaitBoard,
  preset: DrawingBoardPreset,
  locale: Locale,
) => {
  const zh = locale === "zh-CN";
  if (preset === "flowchart") {
    const point = (value: [number, number]) => scalePresetPoint(value, [540, 370]);
    const start = insertPresetGeometry(
      board,
      [point([460, 120]), point([620, 180])],
      FlowchartSymbols.terminal,
      zh ? "开始" : "Start",
    );
    const process = insertPresetGeometry(
      board,
      [point([460, 250]), point([620, 320])],
      FlowchartSymbols.process,
      zh ? "处理" : "Process",
    );
    const decision = insertPresetGeometry(
      board,
      [point([460, 390]), point([620, 490])],
      FlowchartSymbols.decision,
      zh ? "判断" : "Decision",
    );
    const end = insertPresetGeometry(
      board,
      [point([460, 560]), point([620, 620])],
      FlowchartSymbols.terminal,
      zh ? "结束" : "End",
    );
    insertBoundArrow(board, start, process, "bottom", "top");
    insertBoundArrow(board, process, decision, "bottom", "top");
    insertBoundArrow(board, decision, end, "bottom", "top");
    return;
  }

  if (preset === "uml") {
    const point = (value: [number, number]) => scalePresetPoint(value, [625, 315]);
    const actor = insertPresetGeometry(
      board,
      [point([230, 245]), point([350, 365])],
      UMLSymbols.actor,
      zh ? "用户" : "User",
    );
    const useCase = insertPresetGeometry(
      board,
      [point([470, 260]), point([670, 350])],
      UMLSymbols.useCase,
      zh ? "提交申请" : "Submit request",
    );
    const service = insertPresetGeometry(
      board,
      [point([790, 205]), point([1020, 405])],
      UMLSymbols.class,
      zh ? "申请服务" : "Request service",
    );
    insertBoundArrow(board, actor, useCase, "right", "left");
    insertBoundArrow(board, useCase, service, "right", "left");
    return;
  }

  if (preset === "mindmap") {
    const root = createEmptyMind(board, [600, 320]);
    root.data.topic = buildText(zh ? "主题" : "Topic", undefined, { "font-size": "14" }) as any;
    root.children = [
      createMindElement(buildText(zh ? "需求" : "Requirements", undefined, { "font-size": "12" }) as any, {}),
      createMindElement(buildText(zh ? "方案" : "Solution", undefined, { "font-size": "12" }) as any, {}),
      createMindElement(buildText(zh ? "计划" : "Plan", undefined, { "font-size": "12" }) as any, {}),
    ];
    root.rightNodeCount = root.children.length;
    MindTransforms.insertMind(board as any, root);
  }
};

export interface DrawnixBoardCoreProps {
  value?: IDrawingBoardCardValue | null;
  readOnly?: boolean;
  locale: Locale;
  theme: BoardTheme;
  ai?: DrawingBoardAIConfig;
  onChange?: (value: Partial<IDrawingBoardCardValue>) => void;
  /**
   * LOCAL-CHANGE #18：视口（pan/zoom）的**被动**回调 —— 只在调用方要自己记住视口时使用
   * （独立画板文档 kind=board）。与 `onChange` 分离是刻意的：宿主要把视口存进 ref、**不回灌**，
   * 否则每次 pan 都会改 value → 宿主保存（260916 那个"拖一下画布就触发保存"的坑）。
   * 不传 = 与卡片一致：视口不持久化。
   */
  onViewportPersist?: (viewport: Viewport) => void;
  /**
   * LOCAL-CHANGE #19：挂载后若画布已有内容，自动 fit 到内容（只读查看器用，例如移动端画板查看）。
   * 默认 false = 与卡片/桌面独立画板一致（用宿主给的 viewport 或默认视口）。
   */
  fitOnInit?: boolean;
}

function useSystemDark(enabled: boolean) {
  const [isDark, setIsDark] = React.useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setIsDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [enabled]);

  return isDark;
}

export default function DrawnixBoardCore({
  value,
  readOnly,
  locale,
  theme,
  ai,
  onChange,
  onViewportPersist,
  fitOnInit,
}: DrawnixBoardCoreProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const boardRef = React.useRef<PlaitBoard | null>(null);
  const materialLibraryRef = React.useRef<LakexMaterialLibraryHandle | null>(null);
  const boardInteractionActiveRef = React.useRef(false);
  const [board, setBoard] = React.useState<PlaitBoard | null>(null);
  /**
   * LOCAL-CHANGE #22（用户 260930 报）：readOnly **运行中变化**必须同步到 plait 的
   * `board.options.readonly`。原实现只在 `afterInit`（建板那一刻）设一次 ⇒ **已打开**的画板被
   * 锁定后该选项仍是 false：工具栏只是被 `.lakex-drawnix-core--readonly` 的 CSS 隐藏了，而
   * plait-core / plait-mind 都按这个选项判定 ⇒ 思维导图仍能加节点、画布仍可编辑。
   * 锁定 / 解锁都要即时生效（只隐藏工具栏不等于只读）。
   */
  React.useEffect(() => {
    if (board) board.options.readonly = !!readOnly;
  }, [board, readOnly]);
  const [shapeCatalogOpen, setShapeCatalogOpen] = React.useState(false);
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuHasSelection, setContextMenuHasSelection] =
    React.useState(false);
  /**
   * LOCAL-CHANGE #20/#21：蓝点快创的图形选择面板（锚点 = 点蓝点的位置）。
   * - 补丁路径（首选）：plait 补丁把提交权交给宿主 ⇒ `commit` 存在，**先选后建**（点蓝点只弹面板，不先落副本）。
   * - 兜底路径（补丁缺失时）：形状已按上游行为落地，`elementId` 存在 ⇒ 选完再替换形状。
   */
  const [quickShape, setQuickShape] = React.useState<{
    x: number;
    y: number;
    commit?: (shape?: GeometryShapes) => void;
    elementId?: string;
    /** 源形状（快创的"和自己一样"选项：面板里永远可一键选它）。 */
    sourceShape?: DrawPointerType;
  } | null>(null);
  const [recentShapes, setRecentShapes] = React.useState<DrawPointerType[]>(
    () => loadRecentShapes(),
  );
  /** 指针手势快照：用来在 pointerup 后判断「刚刚新增了一个图形」（= 蓝点快创提交）。 */
  const gestureRef = React.useRef<{ ids: Set<string>; selectionMode: boolean } | null>(null);

  /**
   * LOCAL-CHANGE #20：蓝点快创 → 图形选择面板。
   *
   * plait 的 `withArrowLineAutoComplete` 在提交时用 `createDefaultGeometry(board, points, originElement.shape)`
   * ⇒ 新形状**只复制源形状类型**（圆→圆、方→方）。这里在 pointerup 之后判定「选择态下画布新增了一个图形」
   * （= 刚刚从蓝点快创提交），弹出面板让用户改形状（对齐云端语雀的交互）；
   * 用户不选就保持复制出来的形状 ⇒ 与改造前行为一致，不破坏既有习惯。
   */
  React.useEffect(() => {
    if (!board || readOnly) return;
    const isOwnUi = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(QUICK_SHAPE_IGNORE_SELECTOR);
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isOwnUi(event.target)) {
        gestureRef.current = null;
        return;
      }
      gestureRef.current = {
        ids: new Set(board.children.map((child) => (child as PlaitElement).id)),
        selectionMode: (PlaitBoard.getPointer(board) as string) === PlaitPointerType.selection,
      };
    };
    const onPointerUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture?.selectionMode || isOwnUi(event.target)) return;
      // 让 plait 的 globalPointerUp（真正的插入提交）先跑完，再判断新增了什么
      window.setTimeout(() => {
        const current = boardRef.current;
        if (!current || current !== board) return;
        const added = current.children.filter((child) => {
          const element = child as PlaitElement;
          return (
            !gesture.ids.has(element.id) &&
            PlaitDrawElement.isGeometry(element) &&
            !PlaitDrawElement.isText(element)
          );
        });
        if (added.length !== 1) return;
        setQuickShape({
          x: event.clientX,
          y: event.clientY,
          elementId: (added[0] as PlaitElement).id,
        });
      }, 0);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [board, readOnly]);

  /**
   * LOCAL-CHANGE #21：把快创的提交权接过来（需要 `patches/@plait+draw+0.93.4.patch`）。
   * 上游原本在单击蓝点时**立即**插入「源形状副本 + 连线」；打了补丁后改为先调用宿主：
   * 宿主弹面板（此时画布上还没有新形状）→ 用户选完才 `commit(shape)` 落地。
   */
  React.useEffect(() => {
    if (!board || readOnly) return;
    setAutoCompleteCommitHost(board, {
      // 关掉悬停预览的视觉（放大蓝点 / crosshair 光标 / 幽灵形状）：现在点蓝点会弹选择面板，
      // 悬停再飘一个「一样的形状」既多余又容易被误认为已经创建。单击仍会走到 requestShapeChoice。
      hoverPreview: false,
      requestShapeChoice: (context) => {
        setQuickShape({
          x: context.clientX,
          y: context.clientY,
          commit: (shape) => context.commit(shape),
          sourceShape: (context.shapeElement as { shape?: DrawPointerType }).shape,
        });
      },
    });
    return () => setAutoCompleteCommitHost(board, null);
  }, [board, readOnly]);

  const rememberShape = React.useCallback((pointer: DrawPointerType) => {
    setRecentShapes((previous) => {
      const next = [pointer, ...previous.filter((item) => item !== pointer)].slice(
        0,
        RECENT_SHAPE_LIMIT,
      );
      saveRecentShapes(next);
      return next;
    });
  }, []);

  /** 用户选了形状：补丁路径 = 用它落地（先选后建）；兜底路径 = 替换刚落地副本的形状。 */
  const handleQuickShapePick = React.useCallback(
    (pointer: DrawPointerType) => {
      const target = quickShape;
      setQuickShape(null);
      if (!target) return;
      // 面板里的选项都是几何图形指针（DrawPointerType 还含连线指针，这里按几何图形收窄）
      const shape = pointer as GeometryShapes;
      if (target.commit) {
        target.commit(shape);
      } else if (target.elementId) {
        const current = boardRef.current;
        if (current) {
          const element = current.children.find(
            (child) => (child as PlaitElement).id === target.elementId,
          ) as PlaitElement | undefined;
          if (element) {
            clearSelectedElement(current);
            addSelectedElement(current, element);
            DrawTransforms.switchGeometryShape(current, shape);
            memorizeLatestShape(current, shape);
          }
        }
      }
      rememberShape(pointer);
    },
    [quickShape, rememberShape],
  );

  /** 关掉面板不选 = 保持上游行为：落地「源形状副本 + 连线」（补丁路径要由我们补上这一步）。 */
  const handleQuickShapeDismiss = React.useCallback(() => {
    const target = quickShape;
    setQuickShape(null);
    target?.commit?.();
  }, [quickShape]);
  const normalizeTextScheduledRef = React.useRef(false);
  const exportSnapshotTimerRef = React.useRef<number | null>(null);
  const exportSnapshotVersionRef = React.useRef(0);
  const presetFrameRef = React.useRef<number | null>(null);
  const presetFitFrameRef = React.useRef<number | null>(null);
  const textViewportGuardCleanupRef = React.useRef<(() => void) | null>(null);
  const textEditViewportRef = React.useRef<{
    board: PlaitBoard;
    origination: [number, number];
    zoom: number;
    host: SVGSVGElement;
    hostViewBox: string | null;
    hostWidth: string;
    hostHeight: string;
    viewportContainer: HTMLElement | null;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const systemDark = useSystemDark(theme === "system");
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  const themeColorMode = isDark ? ThemeColorMode.dark : ThemeColorMode.default;
  const language = locale === "zh-CN" ? "zh" : "en";
  React.useEffect(
    () => () => {
      textViewportGuardCleanupRef.current?.();
      textViewportGuardCleanupRef.current = null;
    },
    [],
  );
  React.useEffect(() => {
    if (boardRef.current) {
      BoardTransforms.updateThemeColor(boardRef.current, themeColorMode);
    }
  }, [themeColorMode]);

  React.useEffect(() => {
    if (!board || readOnly || typeof window === "undefined") return;

    const updateBoardInteractionState = (event: PointerEvent) => {
      const root = rootRef.current;
      const path = event.composedPath();
      if (
        root &&
        path.some((target) => target instanceof Node && root.contains(target))
      ) {
        boardInteractionActiveRef.current = true;
        return;
      }
      // Native Drawnix popups are portalled outside the board but belong to
      // the current board interaction. Clicking one must not deactivate it.
      if (
        path.some(
          (target) =>
            target instanceof Element &&
            !!target.closest(".plait-board-attached"),
        )
      ) {
        return;
      }
      boardInteractionActiveRef.current = false;
    };

    const protectBoardDeleteShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (
        !boardInteractionActiveRef.current &&
        !PlaitBoard.isFocus(board)
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const root = rootRef.current;
      const editable = target?.closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      // Do not mistake Lakex's outer contenteditable editor root for a
      // Drawnix text editor. Only a real form control or an editable node
      // contained by this board should receive the native editing shortcut.
      if (
        target?.matches("input, textarea, select") ||
        (editable && root?.contains(editable))
      ) {
        return;
      }

      // Lakex owns a document-level card deletion shortcut, while Drawnix
      // normally receives the same event later from a window bubble listener.
      // Handle the shortcut at the earliest boundary, then keep it out of the
      // host editor so deleting a selected drawing never removes the card.
      event.preventDefault();
      event.stopImmediatePropagation();
      board.globalKeyDown(event);
      board.keyDown(event);
    };

    window.addEventListener(
      "pointerdown",
      updateBoardInteractionState,
      true,
    );
    window.addEventListener("keydown", protectBoardDeleteShortcut, true);
    return () => {
      window.removeEventListener(
        "pointerdown",
        updateBoardInteractionState,
        true,
      );
      window.removeEventListener("keydown", protectBoardDeleteShortcut, true);
      boardInteractionActiveRef.current = false;
    };
  }, [board, readOnly]);

  React.useEffect(() => {
    if (!shapeCatalogOpen) return;
    // Dismiss any native creation popover before opening the custom shape
    // catalog in the same toolbar area.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  }, [shapeCatalogOpen]);

  const incomingScene = (value?.plaitValue || []) as PlaitElement[];
  const incomingSceneSignature = JSON.stringify(incomingScene);
  const [scene, setScene] = React.useState<PlaitElement[]>(incomingScene);
  const sceneSignatureRef = React.useRef(incomingSceneSignature);
  const emittedSceneSignaturesRef = React.useRef<Set<string>>(new Set());
  const viewport = value?.plaitViewport as Viewport | undefined;

  // Lakex persists each board operation back into the card. Keep the board's
  // own array reference for that round trip. Slate text editing may emit
  // several values in one keypress and the host can return those snapshots
  // out of order; feeding any of those internal clones back to Drawnix makes
  // its wrapper fit the viewport and visibly shifts the whole diagram.
  React.useEffect(() => {
    if (incomingSceneSignature === sceneSignatureRef.current) return;
    if (emittedSceneSignaturesRef.current.delete(incomingSceneSignature)) {
      return;
    }
    sceneSignatureRef.current = incomingSceneSignature;
    setScene(incomingScene);
  }, [incomingScene, incomingSceneSignature]);

  const scheduleExportSnapshot = React.useCallback(
    (targetBoard: PlaitBoard) => {
      if (!onChange || typeof window === "undefined") return;
      if (exportSnapshotTimerRef.current !== null) {
        window.clearTimeout(exportSnapshotTimerRef.current);
      }
      const snapshotVersion = ++exportSnapshotVersionRef.current;
      exportSnapshotTimerRef.current = window.setTimeout(() => {
        void toImage(targetBoard, { padding: 16 })
          .then((previewImage) => {
            if (snapshotVersion !== exportSnapshotVersionRef.current) return;
            if (previewImage) onChange({ previewImage });
          })
          .catch(() => {
            // Image export must not interrupt normal board editing, for
            // example when a pasted cross-origin image cannot be serialized.
          });
      }, 250);
    },
    [onChange],
  );

  React.useEffect(
    () => () => {
      if (exportSnapshotTimerRef.current !== null) {
        window.clearTimeout(exportSnapshotTimerRef.current);
      }
      if (presetFrameRef.current !== null) {
        window.cancelAnimationFrame(presetFrameRef.current);
      }
      if (presetFitFrameRef.current !== null) {
        window.cancelAnimationFrame(presetFitFrameRef.current);
      }
    },
    [],
  );
  const scheduleTextAutoSize = (targetBoard: PlaitBoard) => {
    if (normalizeTextScheduledRef.current) return;
    normalizeTextScheduledRef.current = true;
    window.setTimeout(() => {
      normalizeTextScheduledRef.current = false;
      for (const element of targetBoard.children) {
        const text = element as PlaitElement & {
          shape?: string;
          autoSize?: boolean;
        };
        if (text.shape === BasicShapes.text && text.autoSize !== true) {
          Transforms.setNode(
            targetBoard,
            { autoSize: true },
            PlaitBoard.findPath(targetBoard, element),
          );
        }
      }
    }, 0);
  };

  /**
   * The native font-size popup updates Slate first. Mind nodes measure their
   * foreignObject in the same turn, so a freshly-created node can still be
   * measured with the previous mark on the first click. Reconcile after the
   * popup event has committed, using the native TextTransforms API only when
   * the serialized node mark is actually behind the requested value.
   */
  const syncFontSizeAfterNativePopup = React.useCallback(() => {
    const targetBoard = boardRef.current;
    if (!targetBoard || typeof window === "undefined") return;

    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(
          ".popup-font-size__input",
        );
        const size = Number(input?.value);
        if (!Number.isFinite(size) || size <= 0) return;

        getSelectedElements(targetBoard).forEach((element) => {
          const editors = getTextEditorsByElement(element);
          if (!editors.length) return;

          const serializedText =
            (
              element as PlaitElement & {
                data?: { topic?: unknown };
                text?: unknown;
              }
            ).data?.topic ??
            (element as PlaitElement & { text?: unknown }).text;
          const marks = serializedText
            ? (PlaitMarkEditor.getMarksByElement(serializedText as any) as Record<
                string,
                unknown
              >)
            : {};
          let defaultFontSize = 14;
          try {
            defaultFontSize =
              getDefaultFontSizeForMindElement(element as any) ??
              defaultFontSize;
          } catch {
            // Non-mind text elements use the text plugin's default size.
          }
          const currentSize = Number(marks["font-size"] ?? defaultFontSize);
          if (currentSize !== size) {
            TextTransforms.setFontSize(
              targetBoard,
              String(size) as FontSizes,
              defaultFontSize,
              editors,
            );
          }
        });

        // Let the board finish its context update before refreshing the
        // foreignObject rectangles used by mind-node text managers.
        window.requestAnimationFrame(() => {
          getSelectedElements(targetBoard).forEach((element) => {
            getTextManages(element).forEach((manage) =>
              manage.updateRectangle(),
            );
          });
        });
      });
    }, 0);
  }, []);

  React.useEffect(() => {
    if (!board) return;

    const isFontSizeTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return !!element?.closest(
        ".popup-font-size, .popup-font-size__stepper-button",
      );
    };
    const onPointerUp = (event: PointerEvent) => {
      if (isFontSizeTarget(event.target)) syncFontSizeAfterNativePopup();
    };
    const onBlur = (event: FocusEvent) => {
      if (isFontSizeTarget(event.target)) syncFontSizeAfterNativePopup();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && isFontSizeTarget(event.target)) {
        syncFontSizeAfterNativePopup();
      }
    };

    // The native popups may be rendered in a portal, so listen at document
    // capture phase instead of relying on the board wrapper's bubbling path.
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("blur", onBlur, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [board, syncFontSizeAfterNativePopup]);

  const isShapeTrigger = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const trigger = element?.closest<HTMLElement>(".draw-toolbar [title]");
    return (
      trigger?.getAttribute("title") === "形状" ||
      trigger?.getAttribute("title") === "Shape"
    );
  };

  const isBoardCanvasTarget = (target: EventTarget | null) => {
    const element = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
    if (!element?.closest(".plait-board-container")) return false;
    return !element.closest(
      ".draw-toolbar, .plait-board-attached, [role=dialog], [data-lakex-shape-catalog]",
    );
  };

  const getBoardPointAt = (
    clientX: number,
    clientY: number,
  ): [number, number] | null => {
    const targetBoard = boardRef.current;
    if (!targetBoard) return null;
    const container = PlaitBoard.getBoardContainer(targetBoard).getBoundingClientRect();
    const origin = getViewportOrigination(targetBoard) ?? [0, 0];
    const zoom = targetBoard.viewport.zoom || 1;
    return [
      origin[0] + (clientX - container.left) / zoom,
      origin[1] + (clientY - container.top) / zoom,
    ];
  };

  const getContextMenuBoardPoint = () =>
    contextMenuPosition
      ? getBoardPointAt(contextMenuPosition.x, contextMenuPosition.y)
      : null;

  const insertContextText = () => {
    const targetBoard = boardRef.current;
    const point = getContextMenuBoardPoint();
    if (!targetBoard || !point) return;
    DrawTransforms.insertText(targetBoard, point, locale === "zh-CN" ? "文本" : "Text");
  };

  const insertContextShape = () => {
    const targetBoard = boardRef.current;
    const point = getContextMenuBoardPoint();
    if (!targetBoard || !point) return;
    DrawTransforms.insertGeometry(
      targetBoard,
      [point, [point[0] + 160, point[1] + 88]],
      BasicShapes.roundRectangle,
    );
  };

  const insertContextLine = () => {
    const targetBoard = boardRef.current;
    const point = getContextMenuBoardPoint();
    if (!targetBoard || !point) return;
    insertArrow(targetBoard, point, [point[0] + 180, point[1]]);
  };

  const setContextActualSize = () => {
    const targetBoard = boardRef.current;
    if (!targetBoard) return;
    BoardTransforms.updateViewport(
      targetBoard,
      getViewportOrigination(targetBoard) ?? [0, 0],
      1,
    );
  };

  const preserveContextSelection = (clientX: number, clientY: number) => {
    const targetBoard = boardRef.current;
    const point = getBoardPointAt(clientX, clientY);
    if (!targetBoard || !point) return false;
    // A right click on an unselected shape should operate on that shape.
    // More importantly, do this before Drawnix's native mouse handlers can
    // clear the current selection as focus leaves the canvas.
    if (!getSelectedElements(targetBoard).length) {
      const hitElement = getHitElementByPoint(targetBoard, point);
      if (hitElement) {
        clearSelectedElement(targetBoard);
        addSelectedElement(targetBoard, hitElement);
      }
    }
    return materialLibraryRef.current?.captureSelection() ??
      getSelectedElements(targetBoard).length > 0;
  };

  const applyAIGeneratedElements = React.useCallback(
    (elements: PlaitElement[], mode: AIBoardApplyMode) => {
      const targetBoard = boardRef.current;
      if (!targetBoard || !elements.length) return;
      const positionedElements =
        mode === "append"
          ? placeElementsBesideCurrentBoard(targetBoard, elements)
          : elements;
      clearSelectedElement(targetBoard);
      PlaitHistoryBoard.withNewBatch(targetBoard, () => {
        if (mode === "replace") {
          for (let index = targetBoard.children.length - 1; index >= 0; index -= 1) {
            Transforms.removeNode(targetBoard, [index]);
          }
        }
        positionedElements.forEach((element) => {
          if (element.type === "mind" || element.type === "mindmap") {
            MindTransforms.insertMind(targetBoard as any, element as any);
          } else {
            Transforms.insertNode(targetBoard, element, [
              targetBoard.children.length,
            ]);
          }
        });
      });
      // Geometry hosts are created during the next React/Plait update. Fit on
      // the following frame so the generated diagram is centered and visible.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (boardRef.current === targetBoard) {
            BoardTransforms.fitViewport(targetBoard);
          }
        });
      });
    },
    [],
  );

  // 移动端外壳的横滑抽屉手势只看这个标记；画板/流程图/UML/导图共用此根节点。
  return (
    <div
      ref={rootRef}
      className={`lakex-drawnix-core ${
        readOnly ? "lakex-drawnix-core--readonly" : ""
      }`}
      data-theme={isDark ? "dark" : "light"}
      data-prevent-swipe
      onPointerDownCapture={(event) => {
        if (event.button === 2 && isBoardCanvasTarget(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          preserveContextSelection(event.clientX, event.clientY);
          return;
        }
        if (isShapeTrigger(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          if (boardRef.current) {
            Transforms.setSelection(boardRef.current, null);
            setCreationMode(boardRef.current, BoardCreationMode.drawing);
            BoardTransforms.updatePointerType(
              boardRef.current,
              BasicShapes.rectangle,
            );
          }
          setShapeCatalogOpen((current) => !current);
          return;
        }
        const target = event.target as Element | null;
        if (shapeCatalogOpen && !target?.closest("[data-lakex-shape-catalog]")) {
          setShapeCatalogOpen(false);
        }
      }}
      onClickCapture={(event) => {
        if (isShapeTrigger(event.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenuCapture={(event) => {
        if (!isBoardCanvasTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        boardInteractionActiveRef.current = true;
        setContextMenuHasSelection(
          preserveContextSelection(event.clientX, event.clientY),
        );
        setShapeCatalogOpen(false);
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key !== "Enter" &&
          event.key !== "Backspace" &&
          event.key !== "Delete"
        ) {
          return;
        }
        const target = event.target as Element | null;
        if (!target?.closest(".slate-editable-container")) return;
        const targetBoard = boardRef.current;
        const origination =
          targetBoard?.viewport.origination ??
          (targetBoard ? getViewportOrigination(targetBoard) : null);
        if (targetBoard && origination) {
          const boardContainer = PlaitBoard.getBoardContainer(targetBoard);
          const host = PlaitBoard.getHost(targetBoard);
          const viewportContainer = boardContainer.matches(".viewport-container")
            ? boardContainer
            : boardContainer.querySelector<HTMLElement>(".viewport-container");
          textEditViewportRef.current = {
            board: targetBoard,
            origination: [...origination] as [number, number],
            zoom: targetBoard.viewport.zoom,
            host,
            hostViewBox: host.getAttribute("viewBox"),
            hostWidth: host.style.width,
            hostHeight: host.style.height,
            viewportContainer,
            scrollLeft: viewportContainer?.scrollLeft ?? 0,
            scrollTop: viewportContainer?.scrollTop ?? 0,
          };
        }
      }}
      onKeyDown={(event) => {
        const target = event.target as Element | null;
        const editingTarget = target?.closest(
          '.slate-editable-container, input, textarea, select',
        );
        const isTextEditingTarget =
          !!editingTarget && !!rootRef.current?.contains(editingTarget);
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          isTextEditingTarget
        ) {
          // Slate handles the deletion at the editing target. Stop afterward
          // so Lakex's ancestor card shortcut cannot delete the whole board.
          event.stopPropagation();
        }
        const changesTextLayout =
          event.key === "Enter" ||
          event.key === "Backspace" ||
          event.key === "Delete";
        if (changesTextLayout && isTextEditingTarget) {
          // The editable target has already processed the key before this
          // ancestor handler runs. Keep the same native event away from both
          // Drawnix's global hotkeys and Lakex's outer editor; otherwise the
          // host may insert a block and shift the entire drawing card.
          if (event.key === "Enter") {
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
          }
          const viewportBeforeTextEdit = textEditViewportRef.current;
          textEditViewportRef.current = null;
          if (
            viewportBeforeTextEdit &&
            typeof window !== "undefined"
          ) {
            textViewportGuardCleanupRef.current?.();
            const restoreViewport = () => {
              if (boardRef.current !== viewportBeforeTextEdit.board) return;
              const currentOrigination =
                viewportBeforeTextEdit.board.viewport.origination ??
                getViewportOrigination(viewportBeforeTextEdit.board);
              const viewportChanged =
                !currentOrigination ||
                Math.abs(
                  currentOrigination[0] - viewportBeforeTextEdit.origination[0],
                ) > 0.01 ||
                Math.abs(
                  currentOrigination[1] - viewportBeforeTextEdit.origination[1],
                ) > 0.01 ||
                Math.abs(
                  viewportBeforeTextEdit.board.viewport.zoom -
                    viewportBeforeTextEdit.zoom,
                ) > 0.001;
              if (viewportChanged) {
                BoardTransforms.updateViewport(
                  viewportBeforeTextEdit.board,
                  viewportBeforeTextEdit.origination,
                  viewportBeforeTextEdit.zoom,
                );
              }

              // Text measurement may resize the SVG viewBox when another
              // element sits below the edited text. Lock the visual host for
              // this text commit so Enter or line deletion cannot produce a
              // one-frame zoom/position flash.
              const { host } = viewportBeforeTextEdit;
              if (viewportBeforeTextEdit.hostViewBox === null) {
                if (host.hasAttribute("viewBox")) host.removeAttribute("viewBox");
              } else if (
                host.getAttribute("viewBox") !==
                viewportBeforeTextEdit.hostViewBox
              ) {
                host.setAttribute("viewBox", viewportBeforeTextEdit.hostViewBox);
              }
              if (host.style.width !== viewportBeforeTextEdit.hostWidth) {
                host.style.width = viewportBeforeTextEdit.hostWidth;
              }
              if (host.style.height !== viewportBeforeTextEdit.hostHeight) {
                host.style.height = viewportBeforeTextEdit.hostHeight;
              }
              if (viewportBeforeTextEdit.viewportContainer) {
                if (
                  Math.abs(
                    viewportBeforeTextEdit.viewportContainer.scrollLeft -
                      viewportBeforeTextEdit.scrollLeft,
                  ) > 0.5
                ) {
                  viewportBeforeTextEdit.viewportContainer.scrollLeft =
                    viewportBeforeTextEdit.scrollLeft;
                }
                if (
                  Math.abs(
                    viewportBeforeTextEdit.viewportContainer.scrollTop -
                      viewportBeforeTextEdit.scrollTop,
                  ) > 0.5
                ) {
                  viewportBeforeTextEdit.viewportContainer.scrollTop =
                    viewportBeforeTextEdit.scrollTop;
                }
              }
            };
            const observer = new MutationObserver(restoreViewport);
            observer.observe(viewportBeforeTextEdit.host, {
              attributes: true,
              attributeFilter: ["viewBox", "style"],
            });
            // Slate commits during this event. A microtask and the next
            // animation frames cover both its synchronous render and Plait's
            // delayed text/foreignObject measurement. Deleting a line can
            // update the scroll container after the SVG attributes settle,
            // so keep the viewport stable for the whole short commit window.
            window.queueMicrotask(restoreViewport);
            let active = true;
            let frameId: number | null = null;
            let timeoutId: number | null = null;
            const guardFrame = () => {
              if (!active) return;
              restoreViewport();
              frameId = window.requestAnimationFrame(guardFrame);
            };
            frameId = window.requestAnimationFrame(guardFrame);
            const cleanup = () => {
              if (!active) return;
              active = false;
              observer.disconnect();
              if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
              }
              if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
              }
            };
            timeoutId = window.setTimeout(() => {
              restoreViewport();
              cleanup();
              if (textViewportGuardCleanupRef.current === cleanup) {
                textViewportGuardCleanupRef.current = null;
              }
            }, 360);
            textViewportGuardCleanupRef.current = cleanup;
          }
        }
      }}
      onKeyUp={(event) => {
        if (
          event.key !== "Enter" &&
          event.key !== "Backspace" &&
          event.key !== "Delete"
        ) {
          return;
        }
        const target = event.target as Element | null;
        const editingTarget = target?.closest(
          '.slate-editable-container, input, textarea, select',
        );
        if (editingTarget && rootRef.current?.contains(editingTarget)) {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
        }
      }}
    >
      <Drawnix
        key={language}
        value={scene}
        viewport={viewport}
        theme={{ themeColorMode }}
        initialLanguage={language}
        /* 261017 用户要求：进入画板默认落到「选择工具」（而不是手型/上次绘图工具）。 */
        initialToolState={{ pointer: PlaitPointerType.selection }}
        tutorial={false}
        afterInit={(board) => {
          boardRef.current = board;
          setBoard(board);
          board.options.readonly = !!readOnly;
          BoardTransforms.updateThemeColor(board, themeColorMode);
          const preset = value?.preset;
          const shouldCreatePreset =
            !readOnly &&
            preset &&
            preset !== "drawing" &&
            !value?.presetInitialized &&
            board.children.length === 0;
          if (shouldCreatePreset) {
            // Board creation and its first viewport measurement happen in
            // separate passive effects. Mind children need their root's
            // renderer first, so create every preset on the next frame.
            presetFrameRef.current = window.requestAnimationFrame(() => {
              presetFrameRef.current = null;
              if (boardRef.current !== board || board.children.length > 0) return;
              insertPresetScene(board, preset, locale);
              onChange?.({ presetInitialized: true });
              // Let Drawnix mount the inserted nodes before asking Plait for
              // their bounds, then use its native fit behavior to center the
              // starter diagram in the visible canvas.
              presetFitFrameRef.current = window.requestAnimationFrame(() => {
                presetFitFrameRef.current = null;
                if (boardRef.current === board) {
                  BoardTransforms.fitViewport(board);
                }
              });
            });
          } else if (fitOnInit && value?.plaitViewport == null && board.children.length > 0) {
            // LOCAL-CHANGE #19：只读查看器（移动端画板）没有保存的视口 ⇒ 自适应到内容，
            // 否则用户打开看到的是一片空白、得自己找图。等一帧让 plait 量完容器再 fit。
            presetFitFrameRef.current = window.requestAnimationFrame(() => {
              presetFitFrameRef.current = null;
              if (boardRef.current === board && board.children.length > 0) {
                BoardTransforms.fitViewport(board);
              }
            });
          }
          scheduleTextAutoSize(board);
          scheduleExportSnapshot(board);
        }}
        onChange={() => {
          if (boardRef.current) scheduleTextAutoSize(boardRef.current);
        }}
        onValueChange={(plaitValue) => {
          const signature = JSON.stringify(plaitValue);
          sceneSignatureRef.current = signature;
          const emitted = emittedSceneSignaturesRef.current;
          emitted.add(signature);
          if (emitted.size > 50) {
            const oldest = emitted.values().next().value;
            if (oldest) emitted.delete(oldest);
          }
          setScene(plaitValue);
          if (boardRef.current) {
            scheduleTextAutoSize(boardRef.current);
            scheduleExportSnapshot(boardRef.current);
          }
          onChange?.({ version: 2, engine: "drawnix", plaitValue });
        }}
        // LOCAL-CHANGE: 视口（拖动/缩放）是纯视图状态，不是内容变更。原实现每次 pan/zoom 都回调
        // onChange({plaitViewport}) → 宿主 contentchange → 保存 → 同步上传（用户 260916 报：
        // 只是拖一下/缩放就触发文档保存）。这里不再上报；画板重开用默认/自适应视口，
        // 内容（plaitValue）与 previewImage 照常持久化。
        onViewportChange={(next) => {
          // LOCAL-CHANGE #18：视口只上报给"想记住它"的宿主（独立画板文档），仍不写回卡片值。
          onViewportPersist?.(next);
        }}
      />
      {!readOnly && (
        <>
          <LakexShapeCatalog
            board={board}
            locale={locale}
            open={shapeCatalogOpen}
            onClose={() => setShapeCatalogOpen(false)}
          />
          <LakexMaterialLibrary
            ref={materialLibraryRef}
            board={board}
            locale={locale}
            dark={isDark}
            toolbarHost={rootRef.current?.querySelector(
              ".draw-toolbar .stack_horizontal",
            ) ?? null}
            onOpen={() => setShapeCatalogOpen(false)}
          />
          <LakexAIBoardAssistant
            ai={ai}
            board={board}
            locale={locale}
            dark={isDark}
            toolbarHost={rootRef.current?.querySelector(
              ".draw-toolbar .stack_horizontal",
            ) ?? null}
            overlayHost={rootRef.current}
            onOpen={() => setShapeCatalogOpen(false)}
            onApply={applyAIGeneratedElements}
          />
          <LakexExportMenu
            board={board}
            locale={locale}
            toolbarHost={rootRef.current?.querySelector(
              ".draw-toolbar .stack_horizontal",
            ) ?? null}
          />
          <LakexBoardContextMenu
            board={board}
            locale={locale}
            dark={isDark}
            hasContextSelection={contextMenuHasSelection}
            position={contextMenuPosition}
            onClose={() => {
              setContextMenuPosition(null);
              setContextMenuHasSelection(false);
            }}
            onAddText={insertContextText}
            onAddShape={insertContextShape}
            onAddLine={insertContextLine}
            onFitToCanvas={() => {
              if (boardRef.current) BoardTransforms.fitViewport(boardRef.current);
            }}
            onActualSize={setContextActualSize}
            onAddToMaterialLibrary={() =>
              materialLibraryRef.current?.addSelectionToLibrary() ?? false
            }
          />
          {quickShape && (
            <LakexQuickShapePicker
              locale={locale}
              anchor={{ x: quickShape.x, y: quickShape.y }}
              recent={recentShapes}
              sourceShape={quickShape.sourceShape}
              onPick={handleQuickShapePick}
              onClose={handleQuickShapeDismiss}
            />
          )}
        </>
      )}
    </div>
  );
}
