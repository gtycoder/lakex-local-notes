/**
 * 大表格粘贴护栏的提示对话框（A+B 的 UI 部分；纯逻辑见 `tablePasteGuard.ts`）。
 *
 * A：明确告诉用户"表格过大、为避免卡死未直接粘贴"（剪贴板保留）。
 * B：一键「存为表格文档」= 建一篇表格文档写入数据 + 在光标所在块之后插入指向它的「文档引用」卡。
 */
import { useEffect, useState } from "react";
import { Dialog } from "../../components/ui/Overlay";
import { native } from "../../lib/native";
import { activeEditorMount } from "./activeEditor";
import { editorInstanceAt } from "./editorRegistry";
import { applyModelRange, captureModelRange, positionAfterModelRange, type CapturedModelRange } from "./selectionToolbar/aiModelSelection";
import { onOversizeTablePaste, parseHtmlTableToSheetBody, noteRefCardHtml, sheetDocTitle, type OversizeTablePaste } from "./tablePasteGuard";

export function TablePasteGuardDialog({ parentId }: { parentId: string | null }) {
  const [pending, setPending] = useState<OversizeTablePaste | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ title: string; failed?: string } | null>(null);
  /** 粘贴那一刻的模型选区：对话框会抢焦点，必须当场捕获（与 AI 结果回写同一口径）。 */
  const [range, setRange] = useState<CapturedModelRange | null>(null);

  useEffect(() => onOversizeTablePaste((payload) => {
    setRange(captureModelRange(editorInstanceAt(activeEditorMount())));
    setSaved(null);
    setPending(payload);
  }), []);

  const saveAsSheet = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const body = parseHtmlTableToSheetBody(pending.html);
      if (!body) { setSaved({ title: "", failed: "无法解析该表格" }); return; }
      const title = sheetDocTitle(pending.shape, pending.at);
      const note = await native.createSheetIn(parentId, title);
      await native.saveNote(note.id, title, body);
      // 在光标所在块之后插入「文档引用」卡（拿不到落点就只提示，不硬塞）
      const editor = editorInstanceAt(activeEditorMount()) as { execCommand?: (name: string, ...args: unknown[]) => unknown } | null;
      const pos = positionAfterModelRange(range);
      if (editor && pos && typeof editor.execCommand === "function") {
        applyModelRange(editor, range);
        editor.execCommand("insertAtPosition", pos, "text/html", noteRefCardHtml({ noteId: note.id, title }));
      }
      setPending(null);
      setSaved({ title });
    } catch (error) {
      setSaved({ title: "", failed: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  if (!pending && !saved) return null;
  return (
    <Dialog open onDismiss={() => { setPending(null); setSaved(null); }} label="粘贴的表格过大">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">粘贴的表格过大</h3></header>
      <div className="ln-dialog__body">
        {pending && (
          <>
            <p>这张表格有 <strong>{pending.shape.rows}</strong> 行 / <strong>{pending.shape.cells}</strong> 个单元格，
              直接粘进文档会把界面同步卡住、越大越久（实测 1000 行约 2 秒，数千行要十几到几十秒 ——
              内核表格卡片没有虚拟化）。</p>
            <p>已<strong>阻止本次粘贴</strong>，剪贴板内容保持原样；可以：</p>
            <ul className="ln-list">
              <li>点下面的「存为表格文档」——会新建一篇<strong>表格</strong>文档写入这份数据，并在光标处插入一张指向它的<strong>文档引用</strong>卡；</li>
              <li>或自行分批粘贴 / 粘到「表格」文档里。</li>
            </ul>
          </>
        )}
        {saved && (
          saved.failed
            ? <p className="ne-note-ref__title--gone">保存失败：{saved.failed}</p>
            : <p>已存为表格文档：<strong>{saved.title}</strong>（引用卡已插入光标所在块之后）。</p>
        )}
      </div>
      <div className="ln-dialog__actions">
        {pending && <button type="button" className="ln-btn" disabled={busy} onClick={() => void saveAsSheet()}>{busy ? "处理中…" : "存为表格文档"}</button>}
        <button type="button" className="ln-btn" onClick={() => { setPending(null); setSaved(null); }}>{saved ? "知道了" : "取消"}</button>
      </div>
    </Dialog>
  );
}
