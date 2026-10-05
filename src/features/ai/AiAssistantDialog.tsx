import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Copy, CornerDownRight, RotateCcw, X } from "lucide-react";
import { AiSparkIcon } from "./AiSparkIcon";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import { aiMessageText, type AiAssetRef, type AiChatMessage } from "../../core/aiProviders";
import { activeEditorMount } from "../editor/activeEditor";
import { AiMessageBody } from "./AiMessageBody";
import { copyMarkdownAsLake, type LakePayloadKernel } from "./aiLakeClipboard";
import { editorInstanceAt } from "../editor/editorRegistry";
import { AI_IMAGE_PRESETS, AI_PROMPT_CUSTOM_ID, AI_PROMPT_CUSTOM_LABEL, AI_PROMPT_PRESETS, type AiPromptPreset } from "./aiPrompts";
import "./aiDialogParts.css";

/**
 * AI 助手浮动面板。
 *
 * - 进入即「向智能助手提问…」输入框（**无预设**）；有选区时选区作为上下文随指令发出，
 *   面板内**不回显**原文（对齐云端形态）。
 * - **多轮**：首次生成后可继续追问，历史（含首次拼好的 prompt）作为上下文继续发。
 * - 结果**不自动改写正文**：由用户点「替换选区 / 插入到选区后 / 复制 / 重新生成」。
 *   回写一律用 `insertAtSelection("text/markdown", …)`，由内核把 MD 转成 Lake 节点。
 */
interface Turn { role: "user" | "assistant"; text: string }

/** 输入框自增高的上限（与 CSS `.ai-dialog__field` 的 max-height 同值）。 */
const FIELD_MAX_HEIGHT = 120;
/** 无编辑器上下文（没有可见正文）时的兜底宽度。 */
const FALLBACK_WIDTH = 460;
/** 面板最小宽度：再窄按钮行就放不下（正文栏更窄时按此兜底）。 */
const MIN_WIDTH = 360;

interface EditorColumn { mount: HTMLElement; left: number; width: number; top: number; bottom: number }

/** 与 usePopoverPosition 的 gap/margin 同值（夹取与补空间必须用同一口径）。 */
export const AI_DIALOG_GAP = 8;
export const AI_DIALOG_MARGIN = 8;
/** 右下角拖动把手可缩到的最小高度（保住输入条 + 按钮行）。 */
export const AI_DIALOG_RESIZE_MIN = 140;
/** 面板最大高度（px，配置值）：需要多高直接改这个数（用户 261005）。 */
export const AI_DIALOG_MAX_HEIGHT = 512;
// 拖出来的高度**不做记忆**（用户 261004：每次场景都不同，关掉就恢复默认自适应）。

/**
 * 取当前正文的「文字栏」几何（左缘 + 宽度 + 编辑区顶）——AI 弹窗按它取宽，
 * 实现「与正文文字栏等宽」（用户 261003 选定）。宽度**不能**用编辑器挂载点整宽：
 * 内核在大纲展开布局态下给正文块留 `margin-right:280px`（见 lakeRuntime.ts），
 * 直接用挂载点宽度会比正文栏宽出一大截。这里优先量**真实正文块**（p / h1–h6），
 * 拿不到再回落到 `.ne-engine` 的内容盒 ⇒ 两种布局态都能得到真正的文字栏。
 *
 * 261005：`container` = 本面板所属编辑器的挂载点（浮栏入口传进来，天然正确，不用猜）；
 * 顶栏入口没有容器，退回 `activeEditorMount()`（唯一来源 = data-active，不再看几何）。
 */
function resolveEditorColumn(container?: HTMLElement | null): EditorColumn | null {
  const mount = container ?? activeEditorMount();
  if (!mount) return null;
  const engine = mount.matches(".ne-engine") ? mount : mount.querySelector<HTMLElement>(".ne-engine");
  if (!engine) return null;
  const mr = mount.getBoundingClientRect();
  const { top, bottom } = mr;
  const block = engine.querySelector<HTMLElement>("ne-p, ne-h1, ne-h2, ne-h3, ne-h4, ne-h5, ne-h6");
  if (block) {
    const r = block.getBoundingClientRect();
    if (r.width > 0) return { mount, left: r.left, width: r.width, top, bottom };
  }
  const cs = getComputedStyle(engine);
  const er = engine.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const width = engine.clientWidth - padL - padR;
  if (width <= 0) return null;
  return { mount, left: er.left + padL, width, top, bottom };
}

/**
 * hover 说明气泡：表面 = kit 的 `.ln-tip`（`.ai-dialog__tip` 补 position:fixed，与多维表 `.bt-file-tip` 同口径），
 * 定位 = usePopoverPosition 实测；**无延时**（原生 title 有约 1s 延迟，用户 261005 要求实时出）。
 */
function useCopyTip() {
  const [tip, setTip] = useState<{ text: string; anchor: HTMLElement } | null>(null);
  const { surfaceRef, style } = usePopoverPosition({ open: Boolean(tip), anchor: tip?.anchor ?? null, gap: 6 });
  const surface = tip ? <span ref={surfaceRef} className="ln-tip ai-dialog__tip" style={style ?? undefined} role="tooltip">{tip.text}</span> : null;
  const show = (text: string, anchor: HTMLElement) => setTip({ text, anchor });
  const hide = () => setTip(null);
  return { surface, show, hide };
}

export function AiAssistantDialog({ open, selectionText, attachments, onClose, onReplace, onInsertAfter, anchor, at, scroller, container }: {
  open: boolean; selectionText: string; onClose: () => void;
  /** 多模态上下文（图片浮栏「AI」/ 选区含图）：随首轮 user 消息作为 image 块发送。 */
  attachments?: AiAssetRef[];
  /** 贴靠的锚点元素（浮动工具栏的 AI 按钮）——给了就悬浮在它下方，无遮罩、不压暗文档。 */
  anchor?: HTMLElement | null;
  /** 无锚点时的落点（顶栏入口）；缺省落在右上角。 */
  at?: { x: number; y: number } | null;
  /** 编辑区滚动容器（.ne-editor-wrap）：给了就把面板渲染进去、用内容坐标定位 ⇒ 随正文一起滚。 */
  scroller?: HTMLElement | null;
  /** 本面板所属编辑器的挂载点（.lake-editor-mount）：浮栏入口传入 ⇒ 文字栏几何直接量自己，不猜。 */
  container?: HTMLElement | null;
  /** 替换选区内容（无选区时= 插到光标处）。 */
  onReplace?: (text: string) => void;
  /** 插到选区**之后**（无选区时不提供）。 */
  onInsertAfter?: (text: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef<string | null>(null);
  const historyRef = useRef<AiChatMessage[]>([]);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  /** 用户在右下角拖出来的高度（null = 跟随内容自适应）；**不做记忆**，每次打开都从自适应开始。 */
  const [userHeight, setUserHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  /** 复制反馈：记「哪一条 + 哪种复制」用于对应按钮上的勾（1200ms 复原）。 */
  const [copied, setCopied] = useState<{ index: number; mode: "plain" | "lake" } | null>(null);
  /** 首轮预设（有选区才显示）：点它只填词、不发送；手动改字退回「自定义」。 */
  const [presetId, setPresetId] = useState<string>(AI_PROMPT_CUSTOM_ID);
  const copyTimerRef = useRef<number | null>(null);
  /** hover 说明气泡（两个复制按钮共用；无延时）。 */
  const copyTip = useCopyTip();


  useEffect(() => {
    if (!open) return;
    setInstruction(""); setFollowUp(""); setTurns([]); setError(null); setBusy(false);
    setUserHeight(null);   // 打开即恢复默认高度（内容自适应），不沿用上次拖出来的大小
    reqRef.current = null; historyRef.current = [];
    if (copyTimerRef.current !== null) { window.clearTimeout(copyTimerRef.current); copyTimerRef.current = null; }
    setCopied(null);
    setPresetId(AI_PROMPT_CUSTOM_ID);
  }, [open, selectionText]);

  // 卸载时清掉「已复制」定时器（避免对已卸载组件 setState）。
  useEffect(() => () => { if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current); }, []);

  // 无预设：进来就是自定义提问；选区只作为**上下文**附在后面（不在面板里回显原文，对齐云端）。
  const firstPrompt = selectionText.trim() ? instruction.trim() + "\n\n" + selectionText : instruction.trim();
  const lastOutput = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";
  const canSendFirst = Boolean(instruction.trim());
  /** 图片上下文：有图时首轮把图片作为 image 块一起发出；没有文字选区时改出图片预设。 */
  const hasImages = (attachments?.length ?? 0) > 0;
  const presets = hasImages && !selectionText.trim() ? AI_IMAGE_PRESETS : AI_PROMPT_PRESETS;
  // 当前生效的输入（首轮=提问，之后=追问）——叉号「清除内容」与自增高都以它为准。
  const activeValue = turns.length === 0 ? instruction : followUp;

  // 长文本框自增高：随回车换行/内容变多而变高，到 --max-height 后由 textarea 自己滚动。
  useEffect(() => {
    const el = fieldRef.current;
    if (!el || !el.scrollHeight) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX_HEIGHT)}px`;
  }, [activeValue, turns.length, open]);

  // 正文文字栏几何：打开时量一次，并跟随**编辑器区域尺寸变化**（目录栏收放、窗口缩放）重算。
  const [column, setColumn] = useState<EditorColumn | null>(null);
  useEffect(() => {
    if (!open) { setColumn(null); return; }
    let observed: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    function update() {
      const next = resolveEditorColumn(container);
      setColumn((prev) => (prev && next && prev.left === next.left && prev.width === next.width ? prev : next));
      if (next && typeof ResizeObserver !== "undefined") {
        if (!ro) ro = new ResizeObserver(update);
        if (observed !== next.mount) { if (observed) ro.unobserve(observed); observed = next.mount; ro.observe(next.mount); }
      }
    }
    update();
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); ro?.disconnect(); };
  }, [open, container]);

  const appendAssistant = (delta: string) => setTurns((prev) => {
    const next = prev.slice();
    const last = next[next.length - 1];
    if (last && last.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + delta };
    return next;
  });

  /** 发一轮：messages 已是完整上下文（含本轮 user）。 */
  const send = async (messages: AiChatMessage[]) => {
    setBusy(true); setError(null);
    const reqId = newAiRequestId();
    reqRef.current = reqId;
    try {
      const res = await runAiChat(reqId, messages, appendAssistant);
      if (!res.ok) {
        setError(res.error ?? "未知错误");
      } else {
        historyRef.current = [...messages, { role: "assistant", content: res.text ?? "" }];
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); reqRef.current = null;
    }
  };

  /** first=true 用预设+选区起头；first=false 用追问，带上历史。 */
  const run = async (first: boolean) => {
    if (busy) return;
    const content = first ? firstPrompt : followUp.trim();
    if (!content) { setError("请先写要让 AI 做什么"); return; }
    const base = first ? [] : historyRef.current;
    const firstContent: AiChatMessage["content"] = hasImages
      ? [{ type: "text", text: content }, ...attachments!.map((asset) => ({ type: "image" as const, asset }))]
      : content;
    const messages: AiChatMessage[] = [...base, { role: "user", content: first ? firstContent : content }];
    historyRef.current = messages;
    setTurns((prev) => [...(first ? [] : prev),
      { role: "user", text: first ? instruction.trim() : followUp.trim() },
      { role: "assistant", text: "" }]);
    setFollowUp("");
    await send(messages);
  };

  /** 重新生成：丢掉最后一条助手回复，用同样的上文再要一次（对应云端「重新生成」）。 */
  const regenerate = async () => {
    if (busy) return;
    const hist = historyRef.current;
    let cut = -1;
    for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].role === "user") { cut = i; break; } }
    if (cut < 0) return;
    const messages = hist.slice(0, cut + 1);
    historyRef.current = messages;
    const lastUser = aiMessageText(messages[messages.length - 1]);
    setTurns((prev) => {
      const next = prev.slice();
      while (next.length && next[next.length - 1].role === "assistant") next.pop();
      if (!next.length || next[next.length - 1].role !== "user") next.push({ role: "user", text: lastUser });
      next.push({ role: "assistant", text: "" });
      return next;
    });
    await send(messages);
  };
  const stop = () => { if (reqRef.current) void cancelAiChat(reqRef.current); };

  /** 回车 = 确定（发这一轮，等同点「生成 / 发送」）；Ctrl/⌥（及 ⌘/⇧）+回车 = 换行（对齐 Codex 输入框）。 */
  const submit = () => {
    if (busy) return;
    if (turns.length === 0) { if (canSendFirst) void run(true); }
    else if (followUp.trim()) void run(false);
  };
  const onFieldKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing) return;                       // 中文输入法组字中不提交
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return; // 带修饰键 → 换行（浏览器默认行为）
    e.preventDefault();
    submit();
  };
  // 贴选区/锚点悬浮（无遮罩）：
  //   · 有 scroller（浮动工具栏入口）→ 渲染进编辑区滚动容器、用**内容坐标**绝对定位 ⇒ 随正文一起滚；
  //   · 无 scroller（顶栏入口）→ 维持原来的视口级 fixed 定位。
  const viewportW = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 0 : window.innerHeight;
  // 内容坐标锚点：只在 open / at 变化时算一次（at 打开时给定、滚动不再更新）⇒ 内容位置恒定，随正文滚不漂。
  const contentAnchor = useMemo(() => {
    if (!open || !scroller || !at) return null;
    const wr = scroller.getBoundingClientRect();
    return { top: at.y - wr.top + scroller.scrollTop, left: at.x - wr.left + scroller.scrollLeft };
  }, [open, scroller, at]);
  // 内容坐标几何：宽度=正文栏宽、顶=内容锚点、高上限=**打开时选区下方在编辑区内的可用高度**
  // 高度上限 = **编辑区可视高**（减上下边距）：超出交面板内滚动，不无限扩大。
  // 不再按「选区下方可用高」封顶，也**不在打开时自动滚动编辑区**（用户 261004：选区绝不能跳）。
  const contentGeom = contentAnchor && scroller && at ? (() => {
    const wr = scroller.getBoundingClientRect();
    const w = column ? Math.max(MIN_WIDTH, Math.min(column.width, wr.width - 16)) : FALLBACK_WIDTH;
    const leftContent = column ? column.left - wr.left + scroller.scrollLeft : contentAnchor.left;
    // 内容自适应上限 = 手动拖拽硬上限 = 编辑区可视高（用户 261004：拖动不该被默认上限锁死）。
    const resizeMax = Math.max(AI_DIALOG_RESIZE_MIN, Math.min(Math.ceil(wr.height - 2 * AI_DIALOG_MARGIN), AI_DIALOG_MAX_HEIGHT));
    return {
      left: Math.max(0, Math.min(leftContent, Math.max(0, wr.width - w - AI_DIALOG_MARGIN))),
      top: contentAnchor.top,
      width: w,
      maxHeight: resizeMax,
      resizeMax,
    };
  })() : null;

  const width = column ? Math.max(MIN_WIDTH, Math.min(column.width, viewportW - 16)) : FALLBACK_WIDTH;
  const fallbackAt = { x: Math.max(16, viewportW - (FALLBACK_WIDTH - 4)), y: 64 };
  const rawAt = column
    ? { x: column.left, y: at?.y ?? column.top + 24 }
    : (at ?? (anchor ? null : fallbackAt));
  const minTop = (column ? column.top : 0) + AI_DIALOG_MARGIN;
  const atPoint = rawAt ? { x: rawAt.x, y: Math.max(rawAt.y, minTop) } : null;
  // allowFlip:false —— 贴选区的弹窗**绝不翻到选区上方**（用户 261004 明确禁止）；空间不足时面板内部滚动。
  // 有 contentGeom 时位置由内容坐标直接给，关掉这套视口定位。
  const pos = usePopoverPosition({ open: open && !contentGeom, anchor: column ? null : anchor ?? null, at: atPoint, width, align: "start", side: "below", gap: AI_DIALOG_GAP, allowFlip: false });

  // 视口级兜底（顶栏入口）的高度上限 = 弹窗顶到「可见空间底部」的距离；内容超出在面板内滚动。
  // ⚠️ 必须 floor 而不是 round：round 会向上越界 ~1px，让「下方是否放得下」判定失败（261004 实测翻转）。
  const limitBottom = column ? Math.min(viewportH, column.bottom) : viewportH;
  const topY = atPoint ? atPoint.y : AI_DIALOG_MARGIN;
  const maxHeight = Math.max(1, Math.min(Math.ceil(limitBottom - AI_DIALOG_MARGIN - topY), AI_DIALOG_MAX_HEIGHT));
  const capHeight = contentGeom ? contentGeom.maxHeight : maxHeight;
  // 手动拖拽的硬上限（编辑区可视高）：**不受**内容自适应上限 capHeight 限制（用户 261004）。
  const resizeMax = contentGeom
    ? contentGeom.resizeMax
    : Math.max(AI_DIALOG_RESIZE_MIN, Math.min(Math.ceil(viewportH - 2 * AI_DIALOG_MARGIN), AI_DIALOG_MAX_HEIGHT));
  const appliedHeight = userHeight === null ? undefined : Math.max(AI_DIALOG_RESIZE_MIN, Math.min(userHeight, resizeMax));
  // 拖过之后 max-height 必须放到拖出的高度，否则会被 capHeight 夹回去；没拖过时按内容自适应上限。
  const effectiveMaxHeight = userHeight === null || appliedHeight === undefined ? capHeight : Math.max(capHeight, appliedHeight);
  const dialogStyle = contentGeom
    ? { left: contentGeom.left, top: contentGeom.top, width: contentGeom.width, maxHeight: effectiveMaxHeight, height: appliedHeight, position: "absolute" as const }
    : { ...(pos.style ?? {}), maxHeight: effectiveMaxHeight, height: appliedHeight };
  const placed = contentGeom ? true : pos.placed;

  /** 面板表面元素：测真实高度用（拖拽起点），也交给 usePopoverPosition 定位。 */
  const setSurface = useCallback((el: HTMLElement | null) => { panelRef.current = el; pos.surfaceRef(el); }, [pos.surfaceRef]);

  /**
   * 右下角拖拽把手：**只改高度**（用户 261004：上下可拖、左右不动）。
   * 宽度继续跟随正文栏宽；高度夹在 [AI_DIALOG_RESIZE_MIN, 上限] 内，松手写回本地记忆。
   */
  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation();
    const startY = event.clientY;
    const startH = panelRef.current?.getBoundingClientRect().height ?? 0;
    const cap = resizeMax;   // 手动拖拽用硬上限（编辑区可视高），不用内容自适应上限
    const onMove = (ev: PointerEvent) => {
      setUserHeight(Math.max(AI_DIALOG_RESIZE_MIN, Math.min(cap, Math.round(startH + (ev.clientY - startY)))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [resizeMax]);

  // 关闭/卸载时把临时底部余量还回去（滚动位置按用户 261004 口径**不还原**）。

  // 打开即把光标放进提问框（用户 261003）。必须等 `pos.placed`：面板首帧是定位用的
  // `visibility:hidden` 占位样式，**隐藏元素不可聚焦** ⇒ 那一刻（以及 autoFocus）的 focus() 会被
  // 浏览器静默忽略。等定位落地（可见）后再聚焦、光标落末尾。
  useEffect(() => {
    if (!open || !placed) return;
    const el = fieldRef.current;
    if (!el) return;
    // preventScroll：面板是**内容坐标**绝对定位在滚动容器里的，直接 focus() 会让浏览器把它
    // 滚进可视区 ⇒ 整个编辑区跟着跳（用户 261004：选区/视图绝不能跳）。
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* 个别输入类型不支持选区，忽略 */ }
  }, [open, placed]);

  /** 首轮预设：只把提示词填进输入框（**不发送**）；传 null = 「自定义」（清空）。 */
  const applyPreset = (preset: AiPromptPreset | null) => {
    setPresetId(preset ? preset.id : AI_PROMPT_CUSTOM_ID);
    setInstruction(preset ? preset.prompt : "");
    fieldRef.current?.focus({ preventScroll: true });
  };

  /** 复制成功反馈：对应按钮短暂显示勾再复原。 */
  const markCopied = (index: number, mode: "plain" | "lake") => {
    setCopied({ index, mode });
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => { setCopied(null); copyTimerRef.current = null; }, 1200);
  };

  /** 复制**某一条** AI 回答的纯文本（对话式：每条各自复制，用户 261005）。 */
  const copyMessage = (text: string, index: number) => {
    void navigator.clipboard?.writeText(text);
    markCopied(index, "plain");
  };

  /** 复制为 **Lake 内核格式**：内核转换后放剪贴板，粘到 Lake 是原生样式、不弹「是否转换」。 */
  const copyAsLake = async (text: string, index: number) => {
    const kernel = editorInstanceAt(activeEditorMount())?.kernel;
    if (!kernel) return;
    const ok = await copyMarkdownAsLake(kernel as unknown as LakePayloadKernel, text, window.location.href);
    if (ok) markCopied(index, "lake");
  };



  return (
    <Popover open={open} onDismiss={onClose} container={scroller} style={dialogStyle} surfaceRef={setSurface} className="ai-dialog" label="AI 助手">
      <div className="ln-dialog__body">
        {turns.length > 0 && (
          <>
            <div className="ai-dialog__thread">
              {turns.map((t, i) => {
                const streaming = busy && i === turns.length - 1;
                if (t.role === "user") return <div key={i} className="ai-dialog__msg ai-dialog__msg--user">{t.text}</div>;
                return (
                  <div key={i} className="ai-dialog__msg ai-dialog__msg--assistant">
                    {t.text ? <AiMessageBody text={t.text} /> : (streaming ? "…" : "")}
                    {/* 对话式：**每条** AI 回答各带一个复制（用户 261005），不再只给最后一条 */}
                    {t.text && !streaming && (
                      <div className="ai-dialog__copy-actions">
                        {/* 两个复制：复制文字 / 复制为 Lake（用户 261005）。说明 = 即时 hover 气泡（无 title 延时）。 */}
                        <button
                          type="button"
                          className={"ln-iconbtn ln-iconbtn--compact" + (copied?.index === i && copied.mode === "plain" ? " is-selected" : "")}
                          aria-label="复制文字"
                          onMouseEnter={(e) => copyTip.show("复制文字", e.currentTarget)}
                          onMouseLeave={copyTip.hide}
                          onFocus={(e) => copyTip.show("复制文字", e.currentTarget)}
                          onBlur={copyTip.hide}
                          onClick={() => copyMessage(t.text, i)}
                        >
                          {copied?.index === i && copied.mode === "plain" ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        <button
                          type="button"
                          className={"ln-iconbtn ln-iconbtn--compact" + (copied?.index === i && copied.mode === "lake" ? " is-selected" : "")}
                          aria-label="复制为 Lake"
                          disabled={!editorInstanceAt(activeEditorMount())?.kernel}
                          onMouseEnter={(e) => copyTip.show("复制为 Lake", e.currentTarget)}
                          onMouseLeave={copyTip.hide}
                          onFocus={(e) => copyTip.show("复制为 Lake", e.currentTarget)}
                          onBlur={copyTip.hide}
                          onClick={() => void copyAsLake(t.text, i)}
                        >
                          {copied?.index === i && copied.mode === "lake" ? <Check size={12} /> : <span className="ai-dialog__lake-badge" aria-hidden="true">lake</span>}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {lastOutput && <div className="ai-dialog__note">内容由 AI 生成，请自行核对</div>}
          </>
        )}
        {error && <div className="ai-dialog__error">{error}</div>}
      </div>
      {/* 单横条：✦ 贴框内**左上角**（对齐云端浮条形态）；✕ 只清除输入内容，不关面板。 */}
      <div className="ai-dialog__bar">
        <AiSparkIcon size={18} />
        {turns.length === 0 ? (
          <textarea ref={fieldRef} className="ai-dialog__field" rows={1} placeholder="向智能助手提问…" value={instruction} onChange={(e) => { setInstruction(e.target.value); setPresetId(AI_PROMPT_CUSTOM_ID); }} onKeyDown={onFieldKeyDown} />
        ) : (
          <textarea ref={fieldRef} className="ai-dialog__field" rows={1} placeholder="继续追问…" value={followUp} onChange={(e) => setFollowUp(e.target.value)} onKeyDown={onFieldKeyDown} />
        )}
        {activeValue && (
          <button type="button" className="ai-dialog__clear" aria-label="清除内容" onClick={() => {
            if (turns.length === 0) setInstruction(""); else setFollowUp("");
            fieldRef.current?.focus();
          }}><X size={12} /></button>
        )}
      </div>
      {/* 首轮预设（用户 261005）：**仅首轮 + 有选区**才出现；点击只填词、不发送；分段控件复用 kit 的 .ln-segment。 */}
      {turns.length === 0 && (selectionText.trim().length > 0 || hasImages) && (
        <div className="ai-dialog__presets">
          <span className="ln-segment" role="group" aria-label="预设提示词">
            {presets.map((preset) => (
              <button key={preset.id} type="button" className={"ln-segment__item" + (presetId === preset.id ? " is-active" : "")} onClick={() => applyPreset(preset)}>{preset.label}</button>
            ))}
            <button type="button" className={"ln-segment__item" + (presetId === AI_PROMPT_CUSTOM_ID ? " is-active" : "")} onClick={() => applyPreset(null)}>{AI_PROMPT_CUSTOM_LABEL}</button>
          </span>
        </div>
      )}
      <div className="ln-dialog__actions">
        {turns.length === 0 ? (
          <button type="button" className="ln-btn" disabled={busy || !canSendFirst} onClick={() => void run(true)}>{busy ? "生成中…" : "生成"}</button>
        ) : (
          <button type="button" className="ln-btn" disabled={busy || !followUp.trim()} onClick={() => void run(false)}>{busy ? "生成中…" : "发送"}</button>
        )}
        {busy && <button type="button" className="ln-btn" onClick={stop}>停止</button>}
        {turns.length > 0 && <button type="button" className="ln-btn" disabled={busy} onClick={() => void regenerate()}><RotateCcw size={12} /> 重新生成</button>}
        {/* 复制 / 插入 / 替换都依赖生成结果：**没有结果就不出这些选项**，只留「生成 + 关闭」。 */}
        {lastOutput && onInsertAfter && (
          <button type="button" className="ln-btn" onClick={() => { onInsertAfter(lastOutput); onClose(); }}><CornerDownRight size={12} /> 插入到选区后</button>
        )}
        {/* 260930 真机验证：打开前捕获内核模型选区、回写前用 selection 命令设回，非折叠即**替换**（⌘Z 可撤销）。 */}
        {lastOutput && onReplace && <button type="button" className="ln-btn" onClick={() => { onReplace(lastOutput); onClose(); }}><Check size={12} /> 替换选区</button>}
        <button type="button" className="ln-btn" onClick={onClose}><X size={12} /> 关闭</button>
      </div>
      {/* 右下角拖拽把手：只改高度（用户 261004：左右不动）。 */}
      <div className="ai-dialog__grip" role="separator" aria-label="拖动调整高度" onPointerDown={startResize} />
      {/* 复制按钮的即时说明（无延时；定位/夹取走 usePopoverPosition）。 */}
      {copyTip.surface}
    </Popover>
  );
}
