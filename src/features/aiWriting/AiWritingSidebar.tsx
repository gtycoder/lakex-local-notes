/**
 * AI 写作 · 左栏（新对话 + 搜索 + 置顶 + 历史记录）。
 *
 * 261110 用户定稿：左侧字号 14px；**做对话搜索和置顶，不做对话分组**。
 * 交互仍收敛在既有原语上：搜索 = ln-input--search；行 = ln-row；行尾 ⋯ = ln-iconbtn--compact；
 * 重命名 = InlineRenameInput；菜单/确认 = Overlay 的 Menu/Popover + usePopoverPosition。
 */
import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash } from "lucide-react";
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
  /**
   * 行操作菜单（用户 261111：**用与知识库目录右键一模一样的形式**——context-menu 表面、
   * 每项 15px lucide + span、分组分隔线、危险项走 className="danger"）。
   * 位置也照右键口径：按**触发点坐标**（点 ⋯ = 按钮左下角；右键行 = 指针位置）展开，
   * 由 usePopoverPosition 负责视口翻转/夹取 ⇒ 不再贴左栏右缘、看起来被分栏框住。
   */
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const menuPos = usePopoverPosition({ open: Boolean(menu), at: menu?.at ?? null, gap: 4, margin: 6 });
  const confirmPos = usePopoverPosition({ open: Boolean(confirm), at: confirm?.at ?? null, gap: 4, margin: 6 });

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
      <div
        key={conversation.id}
        className={"ln-row" + (conversation.id === activeId ? " is-selected" : "")}
        role="listitem"
        /* 右键 = 与知识库目录右键同一入口（指针处展开同一个菜单） */
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ id: conversation.id, at: { x: event.clientX, y: event.clientY } });
        }}
      >
        <button type="button" className="ln-row__main aiw-hist__title" title={conversation.title} onClick={() => onSelect(conversation.id)}>
          {isPinned && <Pin size={12} className="aiw-hist__pin" aria-hidden="true" />}
          <span className="ln-ellipsis">{conversation.title}</span>
        </button>
        <button
          type="button"
          className="ln-iconbtn ln-iconbtn--compact ln-row__actions"
          aria-label="对话操作"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ id: conversation.id, at: { x: rect.left, y: rect.bottom } });
          }}
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
      <button type="button" className="ln-btn ln-btn--primary aiw-new" onClick={onNew}>
        <Plus size={15} aria-hidden="true" />
        <span>新对话</span>
      </button>
      <label className="ln-input ln-input--search aiw-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="ln-input__field aiw-search__field"
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

      {/* 与知识库目录右键**同一套表面与项规格**（用户 261111 点单）：context-menu 表面
          + 每项 15px lucide + span + 分组分隔线 + 危险项 className="danger"。 */}
      <Menu surfaceClassName="context-menu" open={Boolean(menu)} onDismiss={() => setMenu(null)} style={menuPos.style ?? undefined} surfaceRef={menuPos.surfaceRef} label="对话操作">
        <button type="button" role="menuitem" className="ln-menu__item" onClick={() => { if (menu) { onTogglePin(menu.id); } setMenu(null); }}>
          {menu && pinnedSet.has(menu.id) ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
          <span>{menu && pinnedSet.has(menu.id) ? "取消置顶" : "置顶"}</span>
        </button>
        <button type="button" role="menuitem" className="ln-menu__item" onClick={() => { if (menu) setEditing({ id: menu.id, title: conversations.find((item) => item.id === menu.id)?.title ?? "" }); setMenu(null); }}>
          <Pencil size={15} aria-hidden="true" />
          <span>重命名</span>
        </button>
        <div className="context-menu-sep" role="separator" />
        <button type="button" role="menuitem" className="danger" onClick={() => { if (menu) setConfirm({ id: menu.id, at: menu.at }); setMenu(null); }}>
          <Trash size={15} aria-hidden="true" />
          <span>删除</span>
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
