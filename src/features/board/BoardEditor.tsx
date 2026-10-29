/**
 * 画板编辑器（kind="board"）——独立画板文档：一个文档 = 一张 Drawnix/Plait 无限画布。
 *
 * 关键约束（260920 可行性验证，见 docs/STORAGE-LAYERS.md）：
 * - **不挂 Lake 内核**：直接挂 vendor 的 `DrawnixBoardCore`（零内核实例、正文不是 `.lake`、无卡片上下文）。
 *   引擎分包已存在且懒加载：`DrawnixBoardCore-*.js`（≈113KB gzip）+ `drawnix-*.js`（≈398KB gzip），
 *   不在首屏 index chunk。
 * - **只存场景 + 视口**：卡片那份 `previewImage`（整幅 PNG data URL，实测占带画板文档体积 90%+）
 *   与 `cardHeight` 在独立文档里没有意义 —— 收到就丢，绝不写进正文。
 * - **视口走 ref、不回灌 value**：pan/zoom 是视图状态不是内容，用 `onViewportPersist` 被动记录，
 *   只在真的保存时把当前视口一并写进正文（保住 260916「拖一下画布不该触发保存」的结论）。
 * - keep-alive：首次可见前不挂载画布（隐藏态量到 0 尺寸会画不出来，与 UniverSheetEditor 同因）。
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorHostProps } from "../editor/editorHost";
import { loadDrawnixBoardCore } from "@dlient/lakex-doc-react";
import type { DrawingBoardAIConfig, DrawnixBoardCoreProps } from "@dlient/lakex-doc-react";
import "./boardEditor.css";
import { uploadLakeResource } from "../editor/resourceUpload";
import { native } from "../../lib/native";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import { parseLocalAssetUrl } from "../../core/assetUrl";
import { boardToBody, createBoardDoc, type BoardDoc, type BoardViewport } from "../../core/boardDoc.js";
import { checkDocBody } from "../../core/docBodySafety.js";
import { docBaselineSettled } from "../../core/docBaseline.js";
import { collectBoardAssetUrls, collectInlineImageUrls, replaceInlineImageUrls } from "./boardImageAssets.js";
import { readBoardView, writeBoardView } from "./boardViewStore.js";
import { registerBoardExport, triggerBoardExport } from "./boardExport";

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

/** DT-06：共用 prop 词表见 features/editor/editorHost.ts（本宿主暂无专有 prop）。 */
export type BoardEditorProps = EditorHostProps;

function cardValueOf(doc: BoardDoc, viewport: BoardViewport | null): BoardCardValue {
  const value: BoardCardValue = {
    version: 2,
    engine: "drawnix",
    preset: doc.preset,
    plaitValue: doc.elements,
  };
  if (doc.presetInitialized) value.presetInitialized = true;
  if (viewport) value.plaitViewport = viewport;
  return value;
}

function docOf(value: BoardCardValue, viewport: BoardViewport | null): BoardDoc {
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

export function BoardEditor({ noteId, content, visible, readOnly: readOnlyProp, focused, pane, onChange, onDirty, onCapture: onEditorCapture }: BoardEditorProps) {
  /**
   * CORE-02：坏正文必须只读。board 的解析器是**宽容退化**（坏数据 → 空白画板，保证文档打得开），
   * 所以不能只看 doc；可读性由 core 的单一判据回答（usheet/board/ink 同一套）。
   * 非空但 readable=false ⇒ 只读 + 横幅，否则用户画一笔就会把「空白 + 新元素」覆盖回原文。
   */
  const [bodyCheck] = useState(() => checkDocBody("board", content));
  const bodyUnreadable = bodyCheck.status === "unreadable";
  const readOnly = readOnlyProp || bodyUnreadable;
  /**
   * 打开时的视图：**本机记下的优先**（用户上次拖/缩到的位置），其次才是正文里那份
   * （历史遗留的 viewport）。两者都没有 = 交给引擎自适应。见 boardViewStore.ts。
   */
  const [initial] = useState(() => {
    const doc = bodyCheck.status === "ok" ? bodyCheck.doc : createBoardDoc();
    const view = readBoardView(noteId);
    return { doc, view, viewport: view?.viewport ?? doc.viewport ?? null };
  });
  const initialDoc = initial.doc;
  const [cardValue, setCardValue] = useState<BoardCardValue>(() => cardValueOf(initialDoc, initial.viewport));
  const cardValueRef = useRef(cardValue);
  const viewportRef = useRef<BoardViewport | null>(initial.viewport);
  /** 宿主根节点：用来找画布内核的滚动容器（平移位置就在它的 scrollLeft/Top 上）。 */
  const hostRef = useRef<HTMLDivElement | null>(null);
  /**
   * 统一导出菜单的 PNG / SVG 转给画板内已有的 Drawnix 导出（不在宿主层另写一份画布渲染）。
   * 只登记已挂载的画板；从目录树导出未打开的画板时注册表里没有 ⇒ 菜单给"先打开画板"的提示。
   */
  useEffect(() => registerBoardExport(noteId, (format) => triggerBoardExport(hostRef.current, format)), [noteId]);
  /**
   * 记下了滚动位置时必须"贴好位置再显示"——否则会先按默认视口画一帧再跳到记下的位置
   * （用户 260926 报「切换会有跳动」）。没有记过位置（首次打开）就不需要这一层。
   */
  const [viewReady, setViewReady] = useState(() => !initial.view?.scroll);
  /** 恢复尚未完成时不采集（那时的滚动量是临时值，写进去会把记下的位置覆盖掉）。 */
  const viewReadyRef = useRef(viewReady);
  viewReadyRef.current = viewReady;
  /**
   * 打开时的磁盘原文（CORE-03 的基线）。capture 在「无真实改动 / 改过又改回原样」时原样返回它，
   * 外层看到的正文与磁盘逐字节一致 ⇒ 不写盘、不产生新 contentHash。
   */
  const diskBodyRef = useRef<string>(content);
  /** 上一次已落盘的正文（规范化后）：相同则跳过，避免「打开即标脏」（首次基线 = 磁盘原文的规范形态）。 */
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

  /**
   * 重新显示这个标签时，把「本次会话记住的视口」再对一次给引擎。keep-alive 下引擎一般自己就守着位置，
   * 但任何一次内部重挂/重排（隐藏期间容器是 0 尺寸、同步后按需重载等）都可能把它抖回 value 里那份旧视口。
   * 只在「隐藏 → 显示」这一帧对齐，**不参与拖动过程**（拖动中绝不回灌 value，见 260916 结论）。
   */
  useEffect(() => {
    if (!visible) return;
    const remembered = viewportRef.current;
    if (!remembered) return;
    setCardValue((prev) => {
      if (prev.plaitViewport === remembered) return prev;
      const nextValue: BoardCardValue = { ...prev, plaitViewport: remembered };
      cardValueRef.current = nextValue;
      return nextValue;
    });
  }, [visible]);

  /**
   * 平移位置（画布容器的滚动量）的记住与恢复。
   *
   * 实测（260926）：这个 plait 版本的平移就是**滚动画布容器** —— 手形工具拖拽只改
   * `.viewport-container` 的 `scrollLeft/scrollTop`，`board.viewport` 不变，所以内核的
   * `onViewportPersist` 对平移根本不触发（只有缩放会）。因此位置记忆必须直接盯容器：
   * 平移中/松手即记进本机记忆（boardViewStore），重新显示/重挂时把记下的滚动量放回容器。
   *
   * 两个坑：① 内核是在 `pointermove` 里**直接赋值** `scrollLeft/Top`，窗口被遮挡时浏览器会挂起
   * 渲染步骤 ⇒ `scroll` 事件与 `requestAnimationFrame` 都不跑（实测：遮挡窗口里整段平移 0 个事件）
   * ⇒ 除了 scroll，还在 pointerup 这类**输入事件**上同步采一次（松手时收尾值已落在 scrollLeft/Top）；
   * ② 容器出现在画布分包挂载之后，取值/恢复都要等它出现且有了可滚范围（用 setTimeout 重试，
   * 不用 rAF —— 理由同上）。
   */
  useEffect(() => {
    if (!everVisible || !visible) return;
    const host = hostRef.current;
    if (!host) return;
    let container: HTMLElement | null = null;
    let scrollRaf = 0;
    let writeId = 0;
    let tries = 0;
    const timers: number[] = [];
    /** 立即落盘当前滚动量（不经过 rAF：遮挡窗口里 rAF 会被挂起）。 */
    const persist = () => {
      if (!container || !viewReadyRef.current) return;
      writeBoardView(noteId, { scroll: { left: container.scrollLeft, top: container.scrollTop } });
    };
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        // 拖动中不逐帧写 localStorage：合并到停手后一次；松手另有立即落盘
        if (writeId) window.clearTimeout(writeId);
        writeId = window.setTimeout(() => { writeId = 0; persist(); }, 200);
      });
    };
    /** 只在画板内收尾的手势上立即落盘（应用里其它地方的点击不该改画板记忆）。 */
    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !host.contains(target)) return;
      persist();
    };
    const attach = () => {
      container = host.querySelector<HTMLElement>(".viewport-container");
      if (!container) {
        // 画布内核分包还没挂完：给 ~1s 窗口，别一直空转
        if (tries++ < 20) timers.push(window.setTimeout(attach, 50));
        else setViewReady(true);
        return;
      }
      container.addEventListener("scroll", onScroll, { passive: true });
      // 松手时立刻落盘：平移的收尾值一定已落在 scrollLeft/Top 上（内核在 pointermove 里直接赋值）。
      // 注意必须限定「手势发生在画板内」——挂在 window 上会让**应用里任何一次点击**都来写一遍，
      // 包括刚打开、恢复还没生效时的那一次 ⇒ 会把记下的位置覆盖成默认位置。
      window.addEventListener("pointerup", onPointerUp);
      const remembered = readBoardView(noteId)?.scroll ?? null;
      if (!remembered) return;
      /**
       * 贴位置 → 确认**持续稳定**了才显示画板（"收敛后再显示"）。
       *
       * 重挂时内核初始化会把滚动量摆到它自己的默认值（实测：贴完立刻又变成内容的居中位置），
       * 所以只贴一次会被覆盖；这里反复贴、并要求**连续 250ms 不动**才认为稳了，期间画板一直
       * visibility:hidden，用户看不到"先默认再跳"。用 setTimeout 而不是 rAF：窗口被遮挡时
       * rAF 会停（实测），setTimeout 仍会跑；另有 1.2s/40 次的上限与 1s 兜底，绝不会把画板藏死。
       */
      let attempts = 0;
      let stableSince = 0;
      const startedAt = Date.now();
      const restore = () => {
        if (!container) return;
        const scrollable = container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight;
        if (!scrollable) {
          if (tries++ < 60) { timers.push(window.setTimeout(restore, 16)); return; }
          setViewReady(true);
          return;
        }
        const atTarget = Math.abs(container.scrollLeft - remembered.left) <= 1
          && Math.abs(container.scrollTop - remembered.top) <= 1;
        if (!atTarget) {
          container.scrollLeft = remembered.left;
          container.scrollTop = remembered.top;
          stableSince = 0;
        } else if (stableSince === 0) {
          stableSince = Date.now();
        }
        const stableFor = stableSince === 0 ? 0 : Date.now() - stableSince;
        if (stableFor >= 250 || Date.now() - startedAt > 1200 || attempts++ >= 40) {
          setViewReady(true);
          return;
        }
        timers.push(window.setTimeout(restore, 24));
      };
      restore();
    };
    attach();
    // 兜底：无论如何 1.5s 内露出画板，绝不留在看不见的状态（比上面的 1.2s 收敛上限更宽，
    // 让"收敛后再显示"有机会跑完；这里只是最后一道保险）
    timers.push(window.setTimeout(() => setViewReady(true), 1500));
    return () => {
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
      if (writeId) window.clearTimeout(writeId);
      for (const id of timers) window.clearTimeout(id);
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [everVisible, visible, noteId]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(currentThemeMode()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  /** flush 的自引用：推迟保存时要重新排队（避免闭包捕获旧 timer）。 */
  const flushRef = useRef<() => void>(() => {});
  // 审计 F15：回调放 ref（避免父层内联函数导致重复注册）+ 按需同步序列化。
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onEditorCaptureRef = useRef(onEditorCapture);
  onEditorCaptureRef.current = onEditorCapture;

  const scheduleSave = useCallback(() => {
    if (readOnlyRef.current) return;
    onDirtyRef.current?.(); // 立即标脏（不等 800ms 内部防抖）
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flushRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(() => {
    // 坏正文 / 只读：绝不落盘（否则空白画板会覆盖原文；CORE-02）。
    if (readOnlyRef.current) return;
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
    // 视图（平移位置 / 缩放）**不写正文**（用户 260926 口径 A1+B）：位置改由本机记忆
    // （src/features/board/boardViewStore.ts）承担。写正文的代价是缩放/平移会把文档标脏 →
    // 保存 → 待同步 → S3 上传（260916 报过的坑），而且视口会跨端串味。
    // 这里沿用正文里原有的 viewport（历史字段，已不再维护）⇒ 同一份内容序列化稳定，不多产生保存。
    const json = boardToBody(docOf(forDisk, initialDoc.viewport ?? null));
    if (json === lastSerializedRef.current) return;
    // CORE-03：改过又改回原样（撤销 / 元素被删回原值）——规范化后与磁盘原文等价 ⇒ 不写盘、不标脏。
    if (docBaselineSettled("board", diskBodyRef.current, json)) {
      lastSerializedRef.current = json;
      return;
    }
    lastSerializedRef.current = json;
    changeRef.current(json);
  }, [initialDoc, scheduleSave]);
  flushRef.current = flush;
  /** 审计 F15：关闭/保存/退出时现取正文（与 flush 同口径，但不改 lastSerialized/不回调）。 */
  const captureContent = useCallback((): string | null => {
    if (readOnlyRef.current) return null;
    if (promoteInFlightRef.current > 0) return null;
    const forDisk: BoardCardValue = {
      ...cardValueRef.current,
      plaitValue: replaceInlineImageUrls(cardValueRef.current.plaitValue, promotedRef.current) as unknown[],
    };
    const json = boardToBody(docOf(forDisk, initialDoc.viewport ?? null));
    // CORE-03：与磁盘原文等价（打开后没动 / 改过又改回原样）⇒ **返回磁盘原文**：
    // 外层落盘写的还是同一份字节 ⇒ contentHash 不变，避免为规范化差异（键序 / 未知键被丢）多写一次盘。
    return docBaselineSettled("board", diskBodyRef.current, json) ? diskBodyRef.current : json;
  }, [initialDoc]);
  useEffect(() => {
    onEditorCaptureRef.current?.(captureContent);
    return () => { onEditorCaptureRef.current?.(null); };
  }, [captureContent]);

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
      // 只读（锁定/回收站/被他端删除）：防御性兜底，绝不接收内容变更。
      // 正常路径由 plait 的 board.options.readonly 拦住；这里挡住"内核漏放"的写入。
      if (readOnlyRef.current) return;
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

  /**
   * 画板 AI 助手（内核 `LakexAIBoardAssistant`，工具栏上的绿色 AI 徽标）：
   * 内核只认 `ai.generate(request)` 一个钩子 —— 它**不存 Key、不绑模型**，只把
   * `{ systemPrompt, contextPrompt, history, currentBoard, signal }` 交给宿主（官方示例 examples/aiProxyPlugin.ts 同款分工）。
   * 我们把这一枪转给主进程既有的 AI 通道（`ai_chat` / `ai_cancel`）⇒ Key 始终不出主进程、不新增 IPC。
   * 返回值形态由内核 `parseAIBoardResponse` 判定：原生 `plaitValue/elements`，或 `{version:1,nodes,edges}` 的中间格式（JSON 字符串/对象皆可）。
   */
  const aiGenerate = useCallback<DrawingBoardAIConfig["generate"]>(async (request) => {
    const requestId = newAiRequestId();
    const onAbort = () => { void cancelAiChat(requestId); };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      // 内核建议：直接用 contextPrompt 当 user message（里面已含历史需求 + 当前画布唯一一份最新 JSON + 本轮需求）。
      const messages = [
        { role: "system" as const, content: request.systemPrompt },
        { role: "user" as const, content: request.contextPrompt ?? request.description },
      ];
      const total = messages.reduce((n, m) => n + m.content.length, 0);
      // 主进程 ai_chat 的入参上限 = 20 万字符（electron/ipc/registerAi.ts）——大画板会撞上；
      // 与其透出「内容过长」，不如给一句能看懂、能指导下一步的提示。
      if (total > 190_000) throw new Error("画板内容过大，已超出 AI 上下文上限，请先拆分或精简画板");
      const res = await runAiChat(requestId, messages);
      if (!res.ok) throw new Error(res.error || "AI 调用失败");
      return res.text ?? "";
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
    }
  }, []);
  /** 只读（锁定 / 回收站）不给 AI 入口：它会往正文里落元素，属写操作（与「只读必须封死所有写入口」一致）。 */
  const aiConfig = useMemo<DrawingBoardAIConfig | undefined>(
    () => (readOnly ? undefined : { generate: aiGenerate }),
    [readOnly, aiGenerate],
  );

  return (
    <div
      ref={hostRef}
      className={`board-editor${viewReady ? "" : " board-editor--restoring"}`}
      data-active={(focused ?? visible) ? "true" : undefined}
      data-pane-visible={visible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      {bodyUnreadable ? (
        <div className="tab-gone-banner" role="status" data-board-parse-error>
          <span>画板正文无法解析（文件损坏或版本不兼容）：已锁定为只读，不会覆盖原文。请从「历史版本」或云端备份恢复。</span>
        </div>
      ) : null}
      {/* 坏正文：不挂画布（空白画布会让人以为「本来就没内容」），只留横幅（CORE-02）。 */}
      {!bodyUnreadable && everVisible && (
        <Suspense fallback={<div className="board-editor-loading" />}>
          <DrawnixBoardCore
            value={cardValue}
            locale={currentLocale()}
            theme={theme}
            readOnly={readOnly}
            ai={aiConfig}
            onChange={handleCoreChange}
            onViewportPersist={(next) => {
              const viewport = { x: next.x, y: next.y, zoom: next.zoom };
              viewportRef.current = viewport;
              // 本机记住（不写正文、不触发保存）：重开/重挂时用它恢复缩放，见 boardViewStore.ts
              writeBoardView(noteId, { viewport });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default BoardEditor;
