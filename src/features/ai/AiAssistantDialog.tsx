import { useEffect, useRef, useState } from "react";
import { Check, Copy, CornerDownRight, RotateCcw, X } from "lucide-react";
import { AiSparkIcon } from "./AiSparkIcon";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import type { AiChatMessage } from "../../core/aiProviders";

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

interface EditorColumn { mount: HTMLElement; left: number; width: number; top: number }

/**
 * 取当前**可见**正文的「文字栏」几何（左缘 + 宽度 + 编辑区顶）——AI 弹窗按它取宽，
 * 实现「与正文文字栏等宽」（用户 261003 选定）。宽度**不能**用编辑器挂载点整宽：
 * 内核在大纲展开布局态下给正文块留 `margin-right:280px`（见 lakeRuntime.ts），
 * 直接用挂载点宽度会比正文栏宽出一大截。这里优先量**真实正文块**（p / h1–h6），
 * 拿不到再回落到 `.ne-engine` 的内容盒 ⇒ 两种布局态都能得到真正的文字栏。
 */
function resolveEditorColumn(): EditorColumn | null {
  const mounts = Array.from(document.querySelectorAll<HTMLElement>(".lake-editor-mount:not(.is-outgoing)"));
  const mount = mounts.find((m) => m.offsetParent !== null && m.getBoundingClientRect().width > 0);
  if (!mount) return null;
  const engine = mount.querySelector<HTMLElement>(".ne-engine");
  if (!engine) return null;
  const top = mount.getBoundingClientRect().top;
  const block = engine.querySelector<HTMLElement>("ne-p, ne-h1, ne-h2, ne-h3, ne-h4, ne-h5, ne-h6");
  if (block) {
    const r = block.getBoundingClientRect();
    if (r.width > 0) return { mount, left: r.left, width: r.width, top };
  }
  const cs = getComputedStyle(engine);
  const er = engine.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const width = engine.clientWidth - padL - padR;
  if (width <= 0) return null;
  return { mount, left: er.left + padL, width, top };
}

export function AiAssistantDialog({ open, selectionText, onClose, onReplace, onInsertAfter, anchor, at }: {
  open: boolean; selectionText: string; onClose: () => void;
  /** 贴靠的锚点元素（浮动工具栏的 AI 按钮）——给了就悬浮在它下方，无遮罩、不压暗文档。 */
  anchor?: HTMLElement | null;
  /** 无锚点时的落点（顶栏入口）；缺省落在右上角。 */
  at?: { x: number; y: number } | null;
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

  useEffect(() => {
    if (!open) return;
    setInstruction(""); setFollowUp(""); setTurns([]); setError(null); setBusy(false);
    reqRef.current = null; historyRef.current = [];
  }, [open, selectionText]);

  // 无预设：进来就是自定义提问；选区只作为**上下文**附在后面（不在面板里回显原文，对齐云端）。
  const firstPrompt = selectionText.trim() ? instruction.trim() + "\n\n" + selectionText : instruction.trim();
  const lastOutput = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";
  const canSendFirst = Boolean(instruction.trim());
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
      const next = resolveEditorColumn();
      setColumn((prev) => (prev && next && prev.left === next.left && prev.width === next.width ? prev : next));
      if (next && typeof ResizeObserver !== "undefined") {
        if (!ro) ro = new ResizeObserver(update);
        if (observed !== next.mount) { if (observed) ro.unobserve(observed); observed = next.mount; ro.observe(next.mount); }
      }
    }
    update();
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); ro?.disconnect(); };
  }, [open]);

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
    const messages: AiChatMessage[] = [...base, { role: "user", content }];
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
    const lastUser = messages[messages.length - 1].content;
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
  // 贴选区/锚点悬浮（无遮罩）：与格式浮栏同款定位原语，贴底自动翻上方。
  // 宽度与左缘跟随正文文字栏（量不到正文时回落固定宽度/右上角）：
  //   有文字栏 → 左缘对齐文字栏、宽度 = 文字栏宽（夹进视口）；
  //   无文字栏 → 维持原行为（选区落点 / 右上角兜底）。
  const viewportW = typeof window === "undefined" ? 0 : window.innerWidth;
  const width = column ? Math.max(MIN_WIDTH, Math.min(column.width, viewportW - 16)) : FALLBACK_WIDTH;
  const fallbackAt = { x: Math.max(16, viewportW - (FALLBACK_WIDTH - 4)), y: 64 };
  const atPoint = column
    ? { x: column.left, y: at?.y ?? column.top + 24 }
    : (at ?? (anchor ? null : fallbackAt));
  const pos = usePopoverPosition({ open, anchor: column ? null : anchor ?? null, at: atPoint, width, align: "start", side: "below", gap: 8 });

  // 打开即把光标放进提问框（用户 261003）。必须等 `pos.placed`：面板首帧是定位用的
  // `visibility:hidden` 占位样式，**隐藏元素不可聚焦** ⇒ 那一刻（以及 autoFocus）的 focus() 会被
  // 浏览器静默忽略。等定位落地（可见）后再聚焦、光标落末尾。
  useEffect(() => {
    if (!open || !pos.placed) return;
    const el = fieldRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* 个别输入类型不支持选区，忽略 */ }
  }, [open, pos.placed]);

  const copy = () => { void navigator.clipboard?.writeText(lastOutput); };

  return (
    <Popover open={open} onDismiss={onClose} style={pos.style ?? undefined} surfaceRef={pos.surfaceRef} className="ai-dialog" label="AI 助手">
      <div className="ln-dialog__body">
        {turns.length > 0 && (
          <>
            <div className="ai-dialog__thread">
              {turns.map((t, i) => (
                <div key={i} className={"ai-dialog__msg ai-dialog__msg--" + t.role}>{t.text || (busy && i === turns.length - 1 ? "…" : "")}</div>
              ))}
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
          <textarea ref={fieldRef} className="ai-dialog__field" rows={1} placeholder="向智能助手提问…" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        ) : (
          <textarea ref={fieldRef} className="ai-dialog__field" rows={1} placeholder="继续追问…" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        )}
        {activeValue && (
          <button type="button" className="ai-dialog__clear" aria-label="清除内容" onClick={() => {
            if (turns.length === 0) setInstruction(""); else setFollowUp("");
            fieldRef.current?.focus();
          }}><X size={12} /></button>
        )}
      </div>
      <div className="ln-dialog__actions">
        {turns.length === 0 ? (
          <button type="button" className="ln-btn" disabled={busy || !canSendFirst} onClick={() => void run(true)}>{busy ? "生成中…" : "生成"}</button>
        ) : (
          <button type="button" className="ln-btn" disabled={busy || !followUp.trim()} onClick={() => void run(false)}>{busy ? "生成中…" : "发送"}</button>
        )}
        {busy && <button type="button" className="ln-btn" onClick={stop}>停止</button>}
        {turns.length > 0 && <button type="button" className="ln-btn" disabled={busy} onClick={() => void regenerate()}><RotateCcw size={12} /> 重新生成</button>}
        {/* 复制 / 插入 / 替换都依赖生成结果：**没有结果就不出这些选项**，只留「生成 + 关闭」。 */}
        {lastOutput && <button type="button" className="ln-btn" onClick={copy}><Copy size={12} /> 复制</button>}
        {lastOutput && onInsertAfter && (
          <button type="button" className="ln-btn" onClick={() => { onInsertAfter(lastOutput); onClose(); }}><CornerDownRight size={12} /> 插入到选区后</button>
        )}
        {/* 260930 真机验证：打开前捕获内核模型选区、回写前用 selection 命令设回，非折叠即**替换**（⌘Z 可撤销）。 */}
        {lastOutput && onReplace && <button type="button" className="ln-btn ln-btn--primary" onClick={() => { onReplace(lastOutput); onClose(); }}><Check size={12} /> 替换选区</button>}
        <button type="button" className="ln-btn" onClick={onClose}><X size={12} /> 关闭</button>
      </div>
    </Popover>
  );
}
