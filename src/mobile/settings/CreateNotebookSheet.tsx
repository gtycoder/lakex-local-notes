/** 新建知识库 Sheet（§5：名称必填；默认图标不落库；自定义 Emoji 一次性提交 CreateNotebookInput）。 */
import { useMemo, useRef, useState } from "react";
import { Book, X } from "lucide-react";
import { LAKE_EMOJI_GROUPS } from "../../lib/lakeEmojiGroups";
import { useSwipeToClose } from "../ui/useSwipeToClose";

export interface CreateNotebookSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; icon: string | null }) => void;
}

export function CreateNotebookSheet(props: CreateNotebookSheetProps) {
  const { open, onClose, onCreate } = props;
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 常用表情：取前两组（表情/人物）作为快捷选择
  const quickEmojis = useMemo(
    () => (LAKE_EMOJI_GROUPS[0]?.emojis ?? []).slice(0, 24),
    []
  );
  const sheetRef = useRef<HTMLDivElement>(null);
  useSwipeToClose(sheetRef, () => { if (!saving) onClose(); }, open);

  if (!open) return null;

  const trimmed = title.trim();

  const submit = async () => {
    if (!trimmed) { setError("请输入知识库名称"); return; }
    setSaving(true);
    try {
      await onCreate({ title: trimmed, icon });
      setTitle(""); setIcon(null); setShowEmoji(false); setError(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mobile-sheet-mask" data-prevent-swipe onClick={() => !saving && onClose()}>
      <div ref={sheetRef} className="mobile-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-grab" />
        <div className="mobile-sheet-head">
          <span className="mobile-sheet-title">基本信息</span>
          <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mobile-sheet-body mobile-sheet-body--form">
          <div className="create-nb-row">
            <button className="create-nb-icon" onClick={() => setShowEmoji((v) => !v)} aria-label="选择图标">
              {icon ? <span className="create-nb-emoji">{icon}</span> : <Book size={22} />}
            </button>
            <input
              className="create-nb-input"
              placeholder="知识库名称"
              value={title}
              autoFocus
              onChange={(e) => { setTitle(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            />
          </div>
          {showEmoji && (
            <div className="create-nb-emoji-picker">
              <div className="create-nb-emoji-grid">
                {quickEmojis.map((ch) => (
                  <button key={ch} className={icon === ch ? "create-nb-emoji-btn selected" : "create-nb-emoji-btn"} onClick={() => { setIcon(ch); setShowEmoji(false); }}>{ch}</button>
                ))}
              </div>
              <button className="create-nb-clear-icon" onClick={() => { setIcon(null); setShowEmoji(false); }}><X size={14} />清除自定义图标</button>
            </div>
          )}
          {error && <div className="create-nb-error">{error}</div>}
          <button className="create-nb-submit" disabled={!trimmed || saving} onClick={() => void submit()}>
            {saving ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
