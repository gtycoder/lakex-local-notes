/**
 * AI 写作 · 左栏（新对话 + 历史记录）。
 *
 * 语雀同款：标题 / 新对话按钮 / 按日期分组的历史项；行悬停出「…」（重命名行内输入、删除行内确认气泡）。
 * 交互收敛在既有原语上：重命名 = InlineRenameInput，菜单/确认 = Overlay 的 Menu/Popover + usePopoverPosition。
 */
import { useMemo, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Menu, Popover } from "../../components/ui/Overlay";
import { InlineRenameInput } from "../../components/ui/InlineRenameInput";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { groupAiWritingHistory, type AiWritingConversation } from "../../core/aiWriting";

export interface AiWritingSidebarProps {
  conversations: readonly AiWritingConversation[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function AiWritingSidebar({ conversations, activeId, onNew, onSelect, onRename, onDelete }: AiWritingSidebarProps) {
  const groups = useMemo(() => groupAiWritingHistory(conversations, new Date()), [conversations]);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuPos = usePopoverPosition({ open: Boolean(menu), anchor: menu?.anchor ?? null, gap: 4, align: "end", margin: 6 });
  const confirmPos = usePopoverPosition({ open: Boolean(confirm), anchor: confirm?.anchor ?? null, gap: 4, align: "end", margin: 6 });

  const commitRename = () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (title) onRename(editing.id, title);
    setEditing(null);
  };

  return (
    <aside className="aiw-side" aria-label="AI 写作">
      <div className="aiw-side__head">
        <h2 className="aiw-side__title">AI 写作</h2>
      </div>
      <button type="button" className="aiw-new" onClick={onNew}>
        <Plus size={15} aria-hidden="true" />
        <span>新对话</span>
      </button>
      <div className="aiw-side__history-head">
        <span className="aiw-side__history-title">历史记录</span>
      </div>
      <div className="aiw-hist" role="list">
        {groups.length === 0 && <p className="aiw-hist__empty">还没有对话</p>}
        {groups.map((group) => (
          <section key={group.label} className="aiw-hist__group" aria-label={group.label}>
            <p className="aiw-hist__label">{group.label}</p>
            {group.conversations.map((conversation) => (
              editing?.id === conversation.id ? (
                <div key={conversation.id} className="aiw-hist__item aiw-hist__item--editing">
                  <InlineRenameInput
                    className="ln-input__field aiw-hist__input"
                    value={editing.title}
                    autoFocus
                    emptyPolicy="reject"
                    ariaLabel="重命名对话"
                    onChange={(value) => setEditing({ id: conversation.id, title: value })}
                    onCommit={() => commitRename()}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : (
                <div key={conversation.id} className={"aiw-hist__item" + (conversation.id === activeId ? " is-selected" : "")} role="listitem">
                  <button type="button" className="aiw-hist__title" title={conversation.title} onClick={() => onSelect(conversation.id)}>
                    <span className="aiw-hist__text">{conversation.title}</span>
                  </button>
                  <button
                    type="button"
                    className="aiw-hist__more"
                    aria-label="对话操作"
                    onClick={(event) => { event.stopPropagation(); setMenu({ id: conversation.id, anchor: event.currentTarget }); }}
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                </div>
              )
            ))}
          </section>
        ))}
      </div>

      <Menu open={Boolean(menu)} onDismiss={() => setMenu(null)} style={menuPos.style ?? undefined} surfaceRef={menuPos.surfaceRef} label="对话操作">
        <button type="button" role="menuitem" className="ln-menu__item" onClick={() => { if (menu) setEditing({ id: menu.id, title: conversations.find((item) => item.id === menu.id)?.title ?? "" }); setMenu(null); }}>
          重命名
        </button>
        <button type="button" role="menuitem" className="ln-menu__item aiw-menu__danger" onClick={() => { if (menu) setConfirm({ id: menu.id, anchor: menu.anchor }); setMenu(null); }}>
          删除
        </button>
      </Menu>

      <Popover open={Boolean(confirm)} onDismiss={() => setConfirm(null)} style={confirmPos.style ?? undefined} surfaceRef={confirmPos.surfaceRef} label="删除对话">
        <div className="aiw-confirm">
          <p className="aiw-confirm__text">确定删除吗？</p>
          <div className="aiw-confirm__actions">
            <button type="button" className="ln-btn ln-btn--ghost" onClick={() => setConfirm(null)}>取消</button>
            <button
              type="button"
              className="ln-btn ln-btn--primary"
              onClick={() => { const id = confirm?.id; setConfirm(null); if (id) onDelete(id); }}
            >
              确定
            </button>
          </div>
        </div>
      </Popover>
    </aside>
  );
}
