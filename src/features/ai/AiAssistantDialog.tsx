import { useEffect, useRef, useState } from "react";
import { Check, Copy, CornerDownRight, RotateCcw, Sparkles, X } from "lucide-react";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import type { AiChatMessage } from "../../core/aiProviders";

/**
 * AI 助手对话框（P0/P1）。
 *
 * - 有选区（编辑器浮动工具栏入口）→ 预设 润色/翻译/总结 + 自定义；无选区（顶栏入口）→ 直接从自定义提问。
 * - **多轮**：首次生成后可继续追问，历史（含首次拼好的 prompt）作为上下文继续发。
 * - 结果**不自动改写正文**：由用户点「复制 / 替换选区」（替换作用于最后一条回复）。
 */
const PRESETS = [
  { id: "polish", label: "润色", instruction: "请润色下面的文字：保持原意和语言不变，修正语病与措辞，只输出润色后的正文。" },
  { id: "zh", label: "译成中文", instruction: "把下面的文字翻译成简体中文，只输出译文。" },
  { id: "en", label: "译成英文", instruction: "Translate the following text into English. Output only the translation." },
  { id: "summary", label: "总结", instruction: "用简洁的中文要点总结下面的文字，只输出总结。" },
  { id: "custom", label: "自定义", instruction: "" },
] as const;

interface Turn { role: "user" | "assistant"; text: string }

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
  const [preset, setPreset] = useState<string>("polish");
  const [instruction, setInstruction] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef<string | null>(null);
  const historyRef = useRef<AiChatMessage[]>([]);

  useEffect(() => {
    if (!open) return;
    // 有选区 → 默认「润色」；无选区（顶栏入口）→ 默认「自定义」，让用户直接提问。
    setPreset(selectionText.trim() ? "polish" : "custom");
    setInstruction(""); setFollowUp(""); setTurns([]); setError(null); setBusy(false);
    reqRef.current = null; historyRef.current = [];
  }, [open, selectionText]);

  const active = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  const instructionText = preset === "custom" ? instruction : active.instruction;
  const firstPrompt = selectionText.trim() ? instructionText + "\n\n" + selectionText : instructionText;
  const lastOutput = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";
  const canSendFirst = Boolean(selectionText.trim() || instruction.trim());

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
      { role: "user", text: first ? (selectionText.trim() || instructionText) : followUp.trim() },
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
  const fallbackAt = { x: Math.max(16, window.innerWidth - 456), y: 64 };
  const pos = usePopoverPosition({ open, anchor: anchor ?? null, at: at ?? (anchor ? null : fallbackAt), width: 420, align: "start", side: "below", gap: 8 });
  const copy = () => { void navigator.clipboard?.writeText(lastOutput); };

  return (
    <Popover open={open} onDismiss={onClose} style={pos.style ?? undefined} surfaceRef={pos.surfaceRef} className="ai-dialog" label="AI 助手">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title"><Sparkles size={15} /> AI 助手</h3></header>
      <div className="ln-dialog__body">
        {turns.length === 0 ? (
          <>
            <div className="ai-dialog__presets">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={"ln-btn ln-btn--ghost" + (p.id === preset ? " is-selected" : "")} onClick={() => setPreset(p.id)}>{p.label}</button>
              ))}
            </div>
            {preset === "custom" && (
              <textarea className="ai-dialog__input" rows={2} placeholder="要让 AI 做什么？例如：把这几点整理成一段话" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            )}
            {selectionText.trim() && <pre className="ai-dialog__source">{selectionText}</pre>}
          </>
        ) : (
          <>
            <div className="ai-dialog__thread">
              {turns.map((t, i) => (
                <div key={i} className={"ai-dialog__msg ai-dialog__msg--" + t.role}>{t.text || (busy && i === turns.length - 1 ? "…" : "")}</div>
              ))}
            </div>
            <textarea className="ai-dialog__input" rows={2} placeholder="继续追问…" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </>
        )}
        {lastOutput && <div className="ai-dialog__note">内容由 AI 生成，请自行核对</div>}
        {error && <div className="ai-dialog__error">{error}</div>}
      </div>
      <div className="ln-dialog__actions">
        {turns.length === 0 ? (
          <button type="button" className="ln-btn" disabled={busy || !canSendFirst} onClick={() => void run(true)}>{busy ? "生成中…" : "生成"}</button>
        ) : (
          <button type="button" className="ln-btn" disabled={busy || !followUp.trim()} onClick={() => void run(false)}>{busy ? "生成中…" : "发送"}</button>
        )}
        {busy && <button type="button" className="ln-btn" onClick={stop}>停止</button>}
        {turns.length > 0 && <button type="button" className="ln-btn" disabled={busy} onClick={() => void regenerate()}><RotateCcw size={14} /> 重新生成</button>}
        <button type="button" className="ln-btn" disabled={!lastOutput} onClick={copy}><Copy size={14} /> 复制</button>
        {onInsertAfter && (
          <button type="button" className="ln-btn" disabled={!lastOutput} onClick={() => { onInsertAfter(lastOutput); onClose(); }}><CornerDownRight size={14} /> 插入到选区后</button>
        )}
        {/* 260930 真机验证：打开前捕获内核模型选区、回写前用 selection 命令设回，非折叠即**替换**（⌘Z 可撤销）。 */}
        <button type="button" className="ln-btn ln-btn--primary" disabled={!lastOutput || !onReplace} onClick={() => { onReplace?.(lastOutput); onClose(); }}><Check size={14} /> 替换选区</button>
        <button type="button" className="ln-btn" onClick={onClose}><X size={14} /> 关闭</button>
      </div>
    </Popover>
  );
}
