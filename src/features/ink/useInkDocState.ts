/**
 * 手写板正文状态 + 保存管线（261112 R2-S10 阶段②：从 InkPad.tsx 原样搬出，纯搬移、零行为变化）。
 *
 * 职责：doc / docRef / 当前页派生、磁盘基线（CORE-03：与打开时原文等价 ⇒ 不写盘）、
 * 500ms 防抖序列化（P5 热路径不序列化）、父层 save / capture 的 refs 与回调注入。
 *
 * 为什么单独成 hook：这段是「落笔 → 标脏 → 防抖 → 现算序列化 → 与磁盘等价? → 交父层保存」的完整决策链，
 * 与画布 / 工具条 / 页面导航无关；纯逻辑已在 inkPadModel（阶段①，行为测试 inkPadModel.test.ts）。
 * 调用点保持在原组件顶部：state 槽位与 hook 顺序按原声明顺序恢复。
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { inkToBody, parseInkBody, type InkDoc, type InkPage } from "../../core/inkDoc.js";
import { canonicalDocBody } from "../../core/docBaseline.js";
import { createInkDiskBaseline, createInkSavePipeline } from "./inkPadModel.js";
import { readInkNavPage } from "./inkNav.js";
import { inkPerfDebugEnabled, recordInkPerf } from "./inkPerfStats";

export interface InkDocStateDeps {
  /** 打开时的正文（父层传入；只在挂载时解析一次，父层换正文走 reloadKey 重挂载）。 */
  content: string;
  /** 设备本地「当前页」导航键（core/inkNav）；不传 = 内存态。 */
  noteId?: string;
  /** 父层保存回调（管线 emit）。 */
  onChange?: (body: string) => void;
  /** 标脏通知（早于防抖，父层据此打脏标记）。 */
  onDirty?: () => void;
}

export interface InkDocState {
  doc: InkDoc | null;
  setDoc: Dispatch<SetStateAction<InkDoc | null>>;
  docRef: MutableRefObject<InkDoc | null>;
  page: InkPage | null;
  latestContentRef: MutableRefObject<string>;
  diskBodyRef: MutableRefObject<string>;
  sameAsDisk: (body: string) => boolean;
  serializeDoc: () => string | null;
  scheduleSave: () => void;
  flushSave: () => void;
  saveError: string | null;
}

export function useInkDocState({ content, noteId, onChange, onDirty }: InkDocStateDeps): InkDocState {
  // 正文只在挂载时解析；父层保存会更新 content，但编辑器不应因此反复解析整份大 JSON。
  // 外部真正需要换正文时由宿主 bump reloadKey 重挂载。
  // v3：当前页是设备本地视图（core/inkNav.ts），优先用它；没有记录才回退 v1/v2 正文里的旧 activePageId。
  const [doc, setDoc] = useState<InkDoc | null>(() => {
    // 261103 十一批：量一下「打开大文档」的解析成本（默认只记数，debug 才打日志）。
    const parseStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
    const parsed = parseInkBody(content);
    if (!parsed) return null;
    if (typeof performance !== "undefined") {
      recordInkPerf({
        kind: "load",
        ms: performance.now() - parseStartedAt,
        bytes: typeof content === "string" ? content.length : 0,
        pages: parsed.pages.length,
        ...(inkPerfDebugEnabled()
          ? { strokes: parsed.pages.reduce((n, p) => n + p.strokes.length, 0), points: 0 }
          : {}),
      });
    }
    const savedPageId = readInkNavPage(noteId);
    if (savedPageId && parsed.pages.some((page) => page.id === savedPageId)) {
      return { ...parsed, activePageId: savedPageId };
    }
    return parsed;
  });
  const docRef = useRef<InkDoc | null>(doc);

  const [saveError, setSaveError] = useState<string | null>(null);

  /** P5：正文是否还有未落盘的改动（序列化已移出热路径，保存时才现算）。 */
  const dirtyRef = useRef(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;

  /**
   * 父层最新的正文（= 阅读态下盘上正文）。阅读态 capture 交它，而不是挂载时的 diskBodyRef：
   * 编辑过一轮再点「完成」后 diskBodyRef 还是**打开时**的旧原文，交出去会把刚保存的正文覆盖回旧版。
   */
  const latestContentRef = useRef(content);
  latestContentRef.current = content;

  /** 打开时的磁盘原文（CORE-03 基线）：保存/捕获在「与磁盘等价」时原样返回它，不写盘。 */
  const diskBodyRef = useRef(content);
  /** 磁盘基线的规范形态缓存（CORE-03/CORE-07：惰性算一次，见 inkPadModel.createInkDiskBaseline）。 */
  const diskBaselineRef = useRef<ReturnType<typeof createInkDiskBaseline> | null>(null);
  /**
   * 当前正文与磁盘原文是否等价（CORE-03：打开后未动 / 撤销回原样）。
   * body 一律由 inkToBody 产出（同一规范形态）⇒ 与磁盘原文的规范形态逐字节相等即 core 判据的结论；
   * 盘上原文非规范（缺 activePageId / 坐标被 clamp 过）时同样判等价，不为一处格式差异写盘。
   * 缓存磁盘侧的规范形态：正文可达 10 MiB，不能每次保存都把两侧整篇解析一遍（CORE-07）。
   */
  const sameAsDisk = useCallback((body: string): boolean => {
    diskBaselineRef.current ??= createInkDiskBaseline(diskBodyRef.current, (raw) => canonicalDocBody("ink", raw));
    return diskBaselineRef.current.isSameAsDisk(body);
  }, []);

  const page = useMemo(() => {
    if (!doc) return null;
    return doc.pages.find((item) => item.id === doc.activePageId) ?? doc.pages[0] ?? null;
  }, [doc]);

  /**
   * 现算整篇正文：**只在保存 / capture 时调用**。
   * 热路径（落笔、擦除、翻页、撤销）不再序列化整篇 —— 实测 300 页批注文档一次 inkToBody 26.7ms，
   * 每落一笔都会撞一帧预算（P5）。序列化失败（容量上限）时保留内存正文，只给可见横幅。
   */
  const serializeDoc = useCallback((): string | null => {
    const current = docRef.current;
    if (!current) return null;
    try {
      // 261103 十一批：保存路径耗时/字节观测（判断是否该做页粒度增量保存）。
      const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
      const body = inkToBody(current);
      if (typeof performance !== "undefined") {
        recordInkPerf({
          kind: "save",
          ms: performance.now() - startedAt,
          bytes: body.length,
          pages: current.pages.length,
          ...(inkPerfDebugEnabled()
            ? {
                strokes: current.pages.reduce((n, p) => n + p.strokes.length, 0),
                points: current.pages.reduce((n, p) => n + p.strokes.reduce((m, s) => m + s.points.length, 0), 0),
              }
            : {}),
        });
      }
      setSaveError(null);
      return body;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "手写板正文无法保存");
      return null;
    }
  }, []);

  /**
   * 保存管线（P5 + CORE-03）：标脏 → 500ms 防抖 → 现算序列化 → 与磁盘等价则丢弃 → 交父层保存。
   * 逻辑本体在 inkPadModel.createInkSavePipeline（纯闭包、可行为测试）；这里只注入 refs/回调与 window 定时器。
   */
  const inkSavePipeline = useMemo(() => createInkSavePipeline({
    io: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    isDirty: () => dirtyRef.current,
    markDirty: () => { dirtyRef.current = true; onDirtyRef.current?.(); },
    clearDirty: () => { dirtyRef.current = false; },
    serialize: serializeDoc,
    isSameAsDisk: sameAsDisk,
    emit: (body) => { onChangeRef.current?.(body); },
  }), [serializeDoc, sameAsDisk]);
  const { scheduleSave, flushSave } = inkSavePipeline;

  return {
    doc, setDoc, docRef, page,
    latestContentRef, diskBodyRef, sameAsDisk, serializeDoc,
    scheduleSave, flushSave, saveError,
  };
}
