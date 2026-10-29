/** 新建知识库 Sheet（§5：名称必填；默认图标不落库；自定义 Emoji 一次性提交）。 */
import { useState } from "react";
import { Book } from "lucide-react";
import { MobileNodeIconPicker } from "../ui/NodeIconPicker";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { MobileSheet } from "../ui/MobileSheet";

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

  // MOB-11：scrim / 右滑关闭 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责；
  // 类名与 DOM 结构沿用原手写版（.mb-scrim + .mb-sheet，视觉快照不变）。
  // 创建中（saving）不允许关闭：遮罩 / 右滑 / × 走同一个 onClose。
  return (
    <MobileSheet
      open
      title="基本信息"
      onClose={() => { if (!saving) onClose(); }}
      bodyClassName="mb-sheet__body--form"
    >
      <div className="create-nb-row">
        <button className="create-nb-icon" onClick={() => setShowEmoji((v) => !v)} aria-label="选择图标">
          {icon ? <span className="create-nb-emoji"><MobileNodeIconGlyph value={icon} /></span> : <Book size={22} />}
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
          <MobileNodeIconPicker nodeType="notebook" value={icon} onPick={setIcon} />
        </div>
      )}
      {error && <div className="create-nb-error">{error}</div>}
      <button className="create-nb-submit" disabled={!trimmed || saving} onClick={() => void submit()}>
        {saving ? "创建中…" : "创建"}
      </button>
    </MobileSheet>
  );
}
