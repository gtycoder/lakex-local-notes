/**
 * 画板编辑器（kind="board"）——独立画板文档：一个文档 = 一张 Drawnix/Plait 无限画布。
 *
 * 关键约束（260920 可行性验证，见 docs/BOARD-DOC-FEASIBILITY-260920.md）：
 * - **不挂 Lake 内核**：直接挂 vendor 的 `DrawnixBoardCore`（零内核实例、正文不是 `.lake`、无卡片上下文）。
 *   引擎分包已存在且懒加载：`DrawnixBoardCore-*.js`（≈113KB gzip）+ `drawnix-*.js`（≈398KB gzip），
 *   不在首屏 index chunk。
 * - **只存场景 + 视口**：卡片那份 `previewImage`（整幅 PNG data URL，实测占带画板文档体积 90%+）
 *   与 `cardHeight` 在独立文档里没有意义 —— 收到就丢，绝不写进正文。
 * - **视口走 ref、不回灌 value**：pan/zoom 是视图状态不是内容，用 `onViewportPersist` 被动记录，
 *   只在真的保存时把当前视口一并写进正文（保住 260916「拖一下画布不该触发保存」的结论）。
 * - keep-alive：首次可见前不挂载画布（隐藏态量到 0 尺寸会画不出来，与 SheetEditor 同因）。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { loadDrawnixBoardCore } from "@dlient/lakex-doc-react";
import type { DrawnixBoardCoreProps } from "@dlient/lakex-doc-react";
import "./boardEditor.css";
import { boardToBody, parseBoardBody, type BoardDoc, type BoardViewport } from "../../core/boardDoc.js";

/** 自动保存防抖：画布每次操作都会回调，必须合并（与 sheet/bitable 同口径）。 */
const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * 画布内核走 vendor 的懒加载器：`DrawnixBoardCore` 与 `lakex-drawnix` + `@plait/*`
 * （≈511KB gzip）一起进独立分包，不随首屏加载（vendor LOCAL-CHANGE #7/#18）。
 */
const DrawnixBoardCore = lazy(() => loadDrawnixBoardCore().then((m) => ({ default: m.default })));

/** Drawnix 卡片值形态（子集）：只保留独立画板文档需要的字段。 */
interface BoardCardValue {
  version: 2;
  engine: "drawnix";
  preset: BoardDoc["preset"];
  presetInitialized?: boolean;
  plaitValue: unknown[];
  plaitViewport?: BoardViewport;
}

export interface BoardEditorProps {
  noteId: string;
  content: string;
  visible: boolean;
  readOnly: boolean;
  onChange: (content: string) => void;
}

function cardValueOf(doc: BoardDoc): BoardCardValue {
  const value: BoardCardValue = {
    version: 2,
    engine: "drawnix",
    preset: doc.preset,
    plaitValue: doc.elements,
  };
  if (doc.presetInitialized) value.presetInitialized = true;
  if (doc.viewport) value.plaitViewport = doc.viewport;
  return value;
}

function docOf(value: BoardCardValue, base: BoardDoc, viewport: BoardViewport | null): BoardDoc {
  const doc: BoardDoc = {
    kind: "board",
    version: 1,
    engine: "drawnix",
    preset: value.preset,
    elements: Array.isArray(value.plaitValue) ? value.plaitValue : [],
    viewport,
  };
  if (value.presetInitialized) doc.presetInitialized = true;
  return doc;
}

/** 应用主题（`applyTheme` 写的是 `<html data-theme>`）；运行时切换要跟着走。 */
function currentThemeMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function currentLocale(): "zh-CN" | "en-US" {
  if (typeof navigator === "undefined") return "zh-CN";
  return navigator.language?.toLowerCase().startsWith("zh") === false ? "en-US" : "zh-CN";
}

export function BoardEditor({ content, visible, readOnly, onChange }: BoardEditorProps) {
  const [initialDoc] = useState<BoardDoc>(() => parseBoardBody(content));
  const [cardValue, setCardValue] = useState<BoardCardValue>(() => cardValueOf(initialDoc));
  const cardValueRef = useRef(cardValue);
  const viewportRef = useRef<BoardViewport | null>(initialDoc.viewport ?? null);
  /** 上一次已落盘的正文（规范化后）：相同则跳过，避免「打开即标脏」。 */
  const lastSerializedRef = useRef<string>(boardToBody(initialDoc));
  const timerRef = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const [theme, setTheme] = useState<"light" | "dark">(currentThemeMode);
  // keep-alive：首次可见前不挂载（隐藏态初始化画布会量成 0）。
  const [everVisible, setEverVisible] = useState(visible);

  useEffect(() => {
    if (visible) setEverVisible(true);
  }, [visible]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(currentThemeMode()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const flush = useCallback(() => {
    const json = boardToBody(docOf(cardValueRef.current, initialDoc, viewportRef.current));
    if (json === lastSerializedRef.current) return;
    lastSerializedRef.current = json;
    changeRef.current(json);
  }, [initialDoc]);

  const scheduleSave = useCallback(() => {
    if (readOnlyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  useEffect(
    () => () => {
      // 卸载/切走前补齐未落盘改动（最后一步编辑 + 当前视口）
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    },
    [flush],
  );

  const handleCoreChange = useCallback<NonNullable<DrawnixBoardCoreProps["onChange"]>>(
    (partial) => {
      setCardValue((prev) => {
        // previewImage（整幅 PNG）与 cardHeight 是卡片专用字段：独立文档不持久化，收下即丢。
        const next: BoardCardValue = {
          ...prev,
          version: 2,
          engine: "drawnix",
          ...(partial.preset ? { preset: partial.preset } : {}),
          ...(partial.presetInitialized ? { presetInitialized: true } : {}),
          ...(Array.isArray(partial.plaitValue) ? { plaitValue: partial.plaitValue } : {}),
        };
        cardValueRef.current = next;
        return next;
      });
      // 只有内容变化才排保存；previewImage/尺寸这类派生回调不算改动。
      if (Array.isArray(partial.plaitValue) || partial.presetInitialized) scheduleSave();
    },
    [scheduleSave],
  );

  return (
    <div className={visible ? "board-editor" : "board-editor fn__none"}>
      {everVisible && (
        <Suspense fallback={<div className="board-editor-loading" />}>
          <DrawnixBoardCore
            value={cardValue}
            locale={currentLocale()}
            theme={theme}
            readOnly={readOnly}
            onChange={handleCoreChange}
            onViewportPersist={(next) => {
              viewportRef.current = { x: next.x, y: next.y, zoom: next.zoom };
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default BoardEditor;
