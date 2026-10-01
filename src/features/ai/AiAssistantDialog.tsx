import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import type { AiChatMessage } from "../../core/aiProviders";

/**
 * AI 助手对话框（选区工具栏入口，P0）。
 *
 * - 结果**只显示在对话框里**，由用户点「复制 / 替换选区」决定是否落到文档（不自动改写）。
 * - 调用走渲染层 ai service -> 主进程（Key 不出主进程）；支持流式与取消。
 */
const PRESETS = [
  { id: "polish", label: "润色", instruction: "请润色下面的文字：保持原意和语言不变，修正语病与措辞，只输出润色后的正文。" },
  { id: "zh", label: "译成中文", instruction: "把下面的文字翻译成简体中文，只输出译文。" },
  { id: "en", label: "译成英文", instruction: "Translate the following text into English. Output only the translation." },
  { id: "summary", label: "总结", instruction: "用简洁的中文要点总结下面的文字，只输出总结。" },
  { id: "custom", label: "自定义", instruction: "" },
] as const;

export function AiAssistantDialog({ open, selectionText, onClose, onReplace }: {
  open: boolean; selectionText: string; onClose: () => void; onReplace?: (text: string) => void;
}) {
  const [preset, setPreset] = useState<string>("polish");
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreset("polish"); setInstruction(""); setOutput(""); setError(null); setBusy(false); reqRef.current = null;
  }, [open]);

  const active = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  const prompt = (preset === "custom" ? instruction : active.instruction) + "\n\n" + selectionText;

  const run = async () => {
    if (busy || !selectionText.trim()) return;
    if (preset === "custom" && !instruction.trim()) { setError("请先写要 AI 做什么"); return; }
    const reqId = newAiRequestId();
    reqRef.current = reqId;
    setBusy(true); setOutput(""); setError(null);
    const messages: AiChatMessage[] = [{ role: "user", content: prompt }];
    try {
      const res = await runAiChat(reqId, messages, (delta) => setOutput((prev) => prev + delta));
      if (!res.ok) setError(res.error ?? "未知错误");
      else if (res.text) setOutput(res.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); reqRef.current = null;
    }
  };
  const stop = () => { if (reqRef.current) void cancelAiChat(reqRef.current); };
  const copy = () => { void navigator.clipboard?.writeText(output); };

  return (
    <Dialog open={open} onDismiss={onClose} label="AI 助手">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title"><Sparkles size={15} /> AI 助手</h3></header>
      <div className="ln-dialog__body">
        <div className="ai-dialog__presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={"ln-btn ln-btn--ghost" + (p.id === preset ? " is-selected" : "")} onClick={() => setPreset(p.id)}>{p.label}</button>
          ))}
        </div>
        {preset === "custom" && (
          <textarea className="ai-dialog__input" rows={2} placeholder="要让 AI 做什么？例如：改成更正式的书面语" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        )}
        <pre className="ai-dialog__source">{selectionText || "（没有选中文字）"}</pre>
        {output && <pre className="ai-dialog__output">{output}</pre>}
        {error && <div className="ai-dialog__error">{error}</div>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn" disabled={busy || !selectionText.trim()} onClick={() => void run()}>{busy ? "生成中…" : "生成"}</button>
        {busy && <button type="button" className="ln-btn" onClick={stop}>停止</button>}
        <button type="button" className="ln-btn" disabled={!output} onClick={copy}>复制</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!output || !onReplace} onClick={() => { onReplace?.(output); onClose(); }}>替换选区</button>
        <button type="button" className="ln-btn" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}
