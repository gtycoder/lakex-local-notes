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
import { uploadLakeResource } from "../editor/resourceUpload";
import { native } from "../../lib/native";
import { parseLocalAssetUrl } from "../../core/assetUrl";
import { boardToBody, parseBoardBody, type BoardDoc, type BoardViewport } from "../../core/boardDoc.js";
import { collectBoardAssetUrls, collectInlineImageUrls, replaceInlineImageUrls } from "./boardImageAssets.js";

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

export function BoardEditor({ noteId, content, visible, readOnly, onChange }: BoardEditorProps) {
  const [initialDoc] = useState<BoardDoc>(() => parseBoardBody(content));
  const [cardValue, setCardValue] = useState<BoardCardValue>(() => cardValueOf(initialDoc));
  const cardValueRef = useRef(cardValue);
  const viewportRef = useRef<BoardViewport | null>(initialDoc.viewport ?? null);
  /** 上一次已落盘的正文（规范化后）：相同则跳过，避免「打开即标脏」。 */
  const lastSerializedRef = useRef<string>(boardToBody(initialDoc));
  const timerRef = useRef<number | null>(null);
  /** 正在进行的「内联图片 → 资产文件」提升任务数：>0 时**推迟保存**（正文绝不落 base64）。 */
  const promoteInFlightRef = useRef(0);
  /** 本次会话已提升过的 data URL → canonical URL（同一张图重绘时不再重复上传）。 */
  const promotedRef = useRef<Map<string, string>>(new Map());
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

  /** flush 的自引用：推迟保存时要重新排队（避免闭包捕获旧 timer）。 */
  const flushRef = useRef<() => void>(() => {});

  const scheduleSave = useCallback(() => {
    if (readOnlyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flushRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(() => {
    // 提升未落地前不保存：否则会把 data:image 版本写进 boards/*.board.json（正文膨胀 + 不走资产管线）。
    // 提升落地会再触发一次变更 → 那时才真正落盘（正文里已是 canonical URL）。
    if (promoteInFlightRef.current > 0) {
      scheduleSave();
      return;
    }
    // 磁盘口径 = 资产 URL（声明/GC/S3/移动端都按资产管线走）；内存口径 = data URL（见下方 hydrate）。
    const forDisk: BoardCardValue = {
      ...cardValueRef.current,
      plaitValue: replaceInlineImageUrls(cardValueRef.current.plaitValue, promotedRef.current) as unknown[],
    };
    const json = boardToBody(docOf(forDisk, initialDoc, viewportRef.current));
    if (json === lastSerializedRef.current) return;
    lastSerializedRef.current = json;
    changeRef.current(json);
  }, [initialDoc, scheduleSave]);
  flushRef.current = flush;

  /** 同一张 data URL 的并发提升去重（打开时 hydrate 与首次变更可能同时触发）。 */
  const promoteInflightRef = useRef<Map<string, Promise<string | null>>>(new Map());

  /**
   * 把场景里的内联图片提升为资产文件（note-assets/{noteId}/），并在 `promotedRef` 里记下
   * **data URL → 资产 URL** 的映射（保存时按它换写盘口径）。
   *
   * 刻意**不改内存里的元素**：引擎的导出/预览会把 `<img>` 转 base64（`convertImageToBase64`），
   * 跨源 fetch 资产 URL 会被资产服务的 CORS 规则拦掉 ⇒ 内存保持 data URL 才能保住「导出 PNG/SVG」
   * 与预览快照的行为不变；磁盘上则是资产 URL。
   *
   * 复用内核插图用的同一条通道 `uploadLakeResource`（sharp 归一化 / 25MiB 上限 / 并发队列 / 重试）；
   * 单张失败就保持内联形态（不丢图），下次变更会再试。
   */
  const promoteInlineImages = useCallback(async (elements: unknown[]): Promise<void> => {
    const found = collectInlineImageUrls(elements);
    if (found.size === 0) return;
    promoteInFlightRef.current += 1;
    try {
      for (const dataUrl of found) {
        if (promotedRef.current.has(dataUrl)) continue;
        let pending = promoteInflightRef.current.get(dataUrl);
        if (!pending) {
          pending = uploadLakeResource({ type: "base64", data: dataUrl }, noteId)
            .then((out) => { promotedRef.current.set(dataUrl, out.url); return out.url; })
            .catch((error) => {
              console.warn("[board] 内联图片提升为资产失败（保持内联形态）", error);
              return null;
            })
            .finally(() => { promoteInflightRef.current.delete(dataUrl); });
          promoteInflightRef.current.set(dataUrl, pending);
        }
        await pending;
      }
    } finally {
      promoteInFlightRef.current -= 1;
      // 提升落地后立刻排一次保存（此时换写盘口径已是资产 URL）
      scheduleSave();
    }
  }, [noteId, scheduleSave]);

  /**
   * 打开画板时把「磁盘上的资产 URL」换回 data URL（内存口径），并把映射反向登记进 `promotedRef`
   * ⇒ 下次保存仍写回同一个资产 URL（不会重复上传、不会改内容 hash）。
   * 读不到就保持资产 URL（图片照常渲染，只是导出内联会退化）。
   */
  const hydrateBoardAssets = useCallback(async (elements: unknown[]): Promise<void> => {
    const assetUrls = collectBoardAssetUrls(elements, noteId);
    if (assetUrls.size === 0) return;
    const mapping = new Map<string, string>();
    for (const assetUrl of assetUrls) {
      const ref = parseLocalAssetUrl(assetUrl);
      if (!ref || ref.space !== "note" || ref.staging) continue;
      try {
        const preview = await native.readAssetPreview(ref.noteId, ref.filename);
        if (preview.supported && preview.dataUrl) {
          mapping.set(assetUrl, preview.dataUrl);
          promotedRef.current.set(preview.dataUrl, assetUrl);
        }
      } catch (error) {
        console.warn("[board] 资产图片读回失败（保持资产 URL 渲染）", error);
      }
    }
    if (mapping.size === 0) return;
    setCardValue((prev) => {
      const next: BoardCardValue = {
        ...prev,
        version: 2,
        engine: "drawnix",
        plaitValue: replaceInlineImageUrls(prev.plaitValue, mapping) as unknown[],
      };
      cardValueRef.current = next;
      return next;
    });
  }, [noteId]);

  // 打开已有画板：先 hydrate（资产 URL → data URL），再 promote（data URL → 资产文件）。
  // 老正文里遗留的内联图片走同一条 promote 路径自然收敛，不写任何「旧数据兼容」代码（AGENTS §3 #7）。
  useEffect(() => {
    if (readOnlyRef.current) return;
    let cancelled = false;
    void (async () => {
      await hydrateBoardAssets(cardValueRef.current.plaitValue);
      if (cancelled) return;
      await promoteInlineImages(cardValueRef.current.plaitValue);
    })();
    return () => { cancelled = true; };
  }, [hydrateBoardAssets, promoteInlineImages]);

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
      // 有内联图片就立刻提升（不等 800ms 防抖，尽量在第一次保存前完成）
      if (Array.isArray(partial.plaitValue)) void promoteInlineImages(partial.plaitValue);
    },
    [promoteInlineImages, scheduleSave],
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
