/**
 * AI 写作 · 左栏（新对话 + 搜索 + 置顶 + 历史记录）。
 *
 * 261110 用户定稿：左侧字号 14px；**做对话搜索和置顶，不做对话分组**。
 * 交互仍收敛在既有原语上：搜索 = ln-input--search；行 = ln-row；行尾 ⋯ = ln-iconbtn--compact；
 * 重命名 = InlineRenameInput；菜单/确认 = Overlay 的 Menu/Popover + usePopoverPosition。
 */
import { useMemo, useState } from "react";
import { MoreHorizontal, Pin, PinOff, Plus, Search } from "lucide-react";
import { Menu, Popover } from "../../components/ui/Overlay";
import { InlineRenameInput } from "../../components/ui/InlineRenameInput";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { groupAiWritingHistory, splitPinnedConversations, type AiWritingConversation } from "../../core/aiWriting";

export interface AiWritingSidebarProps {
  conversations: readonly AiWritingConversation[];
  activeId: string | null;
  /** 置顶会话 id（有序，最新置顶在前；设备本地）。 */
  pinnedIds: readonly string[];
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}

export function AiWritingSidebar({ conversations, activeId, pinnedIds, onNew, onSelect, onRename, onDelete, onTogglePin }: AiWritingSidebarProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuPos = usePopoverPosition({ open: Boolean(menu), anchor: menu?.anchor ?? null, gap: 4, align: "end", margin: 6 });
  const confirmPos = usePopoverPosition({ open: Boolean(confirm), anchor: confirm?.anchor ?? null, gap: 4, align: "end", margin: 6 });

  /** 搜索只做标题过滤（纯显示层，不新增存储/索引）。 */
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(keyword));
  }, [conversations, query]);
  const { pinned, rest } = useMemo(() => splitPinnedConversations(filtered, pinnedIds), [filtered, pinnedIds]);
  const groups = useMemo(() => groupAiWritingHistory(rest, new Date()), [rest]);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const commitRename = () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (title) onRename(editing.id, title);
    setEditing(null);
  };

  /** 一行 = ln-row（选中 is-selected）；置顶行在标题前加一枚图钉。 */
  const renderRow = (conversation: AiWritingConversation, isPinned: boolean) => {
    if (editing?.id === conversation.id) {
      return (
        <div key={conversation.id} className="ln-row aiw-hist__item--editing">
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
      );
    }
    return (
      <div key={conversation.id} className={"ln-row" + (conversation.id === activeId ? " is-selected" : "")} role="listitem">
        <button type="button" className="aiw-hist__title" title={conversation.title} onClick={() => onSelect(conversation.id)}>
          {isPinned && <Pin size={12} className="aiw-hist__pin" aria-hidden="true" />}
          <span className="ln-ellipsis">{conversation.title}</span>
        </button>
        <button
          type="button"
          className="ln-iconbtn ln-iconbtn--compact ln-row__actions"
          aria-label="对话操作"
          onClick={(event) => { event.stopPropagation(); setMenu({ id: conversation.id, anchor: event.currentTarget }); }}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <aside className="aiw-side" aria-label="AI 写作">
      <div className="aiw-side__head">
        <h2 className="aiw-side__title">AI 写作</h2>
      </div>
      <button type="button" className="ln-btn ln-btn--secondary aiw-new" onClick={onNew}>
        <Plus size={15} aria-hidden="true" />
        <span>新对话</span>
      </button>
      <label className="ln-input ln-input--search aiw-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="ln-input__field"
          type="search"
          placeholder="搜索对话"
          aria-label="搜索对话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="aiw-side__history-head">
        <span className="aiw-side__history-title">历史记录</span>
      </div>
      <div className="aiw-hist" role="list">
        {pinned.length === 0 && groups.length === 0 && (
          <p className="aiw-hist__empty">{query.trim() ? "没有匹配的对话" : "还没有对话"}</p>
        )}
        {pinned.length > 0 && (
          <section className="aiw-hist__group" aria-label="置顶">
            <p className="aiw-hist__label">置顶</p>
            {pinned.map((conversation) => renderRow(conversation, true))}
          </section>
        )}
        {groups.map((group) => (
          <section key={group.label} className="aiw-hist__group" aria-label={group.label}>
            <p className="aiw-hist__label">{group.label}</p>
            {group.conversations.map((conversation) => renderRow(conversation, pinnedSet.has(conversation.id)))}
          </section>
        ))}
      </div>

      <Menu open={Boolean(menu)} onDismiss={() => setMenu(null)} style={menuPos.style ?? undefined} surfaceRef={menuPos.surfaceRef} label="对话操作">
        <button
          type="button"
          role="menuitem"
          className="ln-menu__item"
          onClick={() => { if (menu) { onTogglePin(menu.id); } setMenu(null); }}
        >
          {menu && pinnedSet.has(menu.id) ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
          {menu && pinnedSet.has(menu.id) ? "取消置顶" : "置顶"}
        </button>
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
