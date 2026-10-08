/**
 * 「文档引用」卡的 **React 部分**（R2，261008 用户定稿）；纯逻辑见 `noteRef.ts`；图标见 `noteRefIcon.tsx`。
 *
 * 形态（261008 多轮定稿）：卡片 = 类型图标 + **展示名**（主色、hover 下划线）+ 类型小标签。
 * **悬停文字出动作条**（与内核链接一致），四个动作：
 * - 访问 = 打开引用的文档标签页（**点击文字也直接访问**，同一文档只有一个标签：已打开则激活）；
 * - 编辑 = 锚定小浮层改「文本（展示名）」与「链接（目标文档）」；
 * - 复制 = 把目标文档的**资料库全路径**（`笔记本/分组/文档`）写入剪贴板；
 * - 取消链接 = **把卡片换成一段正文文本**（内核命令 insertAtPosition + deleteCard，见 `unlinkCardToText`）。
 *
 * **完整创建流程（261008 八改定稿）**：插入面板建卡 → 本卡**自动打开编辑浮层**（判据见下方注释）→ 点「链接」选文档 →
 * **自动回填「文本」= 该文档标题**（此时还没落库）→ 用户改完点「确定」→ 卡片展示这段文本。
 * **展示文本 = 卡里存的 `title`**（`value?.title || note?.title`），不是目标文档的实时标题 —— 否则"改文本"等于没改。
 *
 * **两个浮层都不自造几何，直接复用内核类**（与选区浮栏 SelectionToolbar 同一姿势；类定义在 vendored
 * lakex-doc.css，我们只负责接线，不重写尺寸/间距/配色）：
 * - 动作条 = `.ne-card-toolbar` + `.ne-card-toolbar-item`（内核卡片工具栏：padding 6/12、条目 28×28、图标 16）；
 * - 编辑浮层 = `.ne-link-editor` + `.ne-link-editor-field(-title)`（内核链接编辑器：365 宽 / padding 16·12 / 字段间距 16）。
 * 两者都带 `lakex-default-theme`：浮层 portal 到 body、已在编辑器树之外，靠这个类吃 kernel-theme.css 的
 * `--lakex-editor-*` 主题桥（否则暗/暖色下仍取内核浅色 schema 的字面值）。
 * 定位一律走 `usePopoverPosition`（贴文字下方、放不下翻上方、夹进视口）。
 *
 * 只存引用元数据、**不内嵌渲染**目标正文（内核只渲染 Lake 正文；表格/多维表/画板正文是各自的 JSON）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Copy, Pencil, SquareArrowOutUpRight, Unlink } from "lucide-react";
import { HoverPopover, Popover } from "../../components/ui/Overlay";
import { captureModelRange, positionAfterModelRange } from "./selectionToolbar/aiModelSelection";
import { deleteCardNative } from "./selectionToolbar/imageCardOps";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import type { NoteSummary } from "../../lib/types";
import {
  NOTE_REF_CARD_META, appendNoteRefCard, isNoteRefGone, findNoteRef, noteKindLabel, noteRefHost, noteRefUrl, parseNoteRef,
  type NoteRefValue,
} from "./noteRef";
import { NoteRefIconSymbol } from "./noteRefIcon";
import "./noteRefCard.css";
import "./noteRefCardActions.css";   // ⚠️ 必须由使用它的组件 import（漏 import 时元素在、样式空 —— 261008 踩过）

export { NOTE_REF_CARD_NAME, NOTE_REF_SLASH_ITEM, NOTE_REF_MAIN_SEARCH, noteRefUrl, parseNoteRef, setNoteRefHost, isNoteRefGone, findNoteRef, noteKindLabel, withNoteRefSlashItem } from "./noteRef";

/** 已经为哪张卡的 DOM 元素自动开过编辑浮层（模块级；内核会重渲染卡片，重复挂载不许重复弹）。 */
const autoOpenedCards = new WeakSet<Element>();

/** 文本 → 进内核 `text/html` 通道前必须转义（展示名是用户自由文本）。 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/**
 * 「取消链接」= **把这张卡换成一段正文文本**（用户 261008 九改：「直接转为正文就行，不用保留卡片样式」）。
 *
 * 全部走内核命令，不自造模型操作（**踩过一次**：自己 BFS 模型树找 id 找不到 —— 根节点的 `_children` 结构不适合外部遍历）：
 *  ① `execCommand("focusCard", cardId)` —— 内核自己的「把选区落到这张卡上」（就是给新插入卡挂 `ne-focused` 的那条），
 *     卡片 DOM 的 `id` 就是模型节点 id（实测：选区 start/end 的 node.id === 卡片 DOM id）；
 *  ② `captureModelRange` 取模型选区 → `positionAfterModelRange` 换算「该顶层块之后」的落点（模型里卡片外面还包着一层洞节点，靠上溯求顶层块才对）；
 *  ③ `insertAtPosition(落点, "text/html", "<p>文本</p>")` 插入一段正文；
 *  ④ `deleteCard(cardId)` 摘掉卡片 —— 文本正好落在卡片原来的位置。
 * ⚠️ **顺序不能反**：先删卡再算落点，`indexOf` 会变 -1（当成末位），文本会跑到文档末尾。
 * 失败返回 false，调用方回退到「保留卡片、只是清掉引用」。
 */
function unlinkCardToText(editor: unknown, cardEl: HTMLElement | null, text: string): boolean {
  const cardId = cardEl?.id || "";
  if (!editor || !cardEl || !cardId) return false;
  try {
    const ed = editor as { execCommand?: (name: string, ...args: unknown[]) => unknown };
    if (typeof ed.execCommand !== "function") return false;
    ed.execCommand("focusCard", cardId);
    const pos = positionAfterModelRange(captureModelRange(editor));
    if (!pos) return false;
    ed.execCommand("insertAtPosition", pos, "text/html", `<p>${escapeHtml(text)}</p>`);
    return deleteCardNative(cardEl, cardId, editor);
  } catch { return false; }
}

/** 选文档浮层：只列**未失效**的库内文档（按标题过滤）。表面/行/输入框全部复用 kit 原语。 */
function NoteRefPicker({ onPick, onClose, surfaceRef, style }: { onPick: (note: NoteSummary) => void; onClose: () => void; surfaceRef?: (el: HTMLElement | null) => void; style?: CSSProperties }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // 打开即聚焦搜索框。⚠️ 不能用 `autoFocus`：锚定定位时首帧表面是 `visibility:hidden` 占位，
  // 那一刻的 `focus()` 会被浏览器静默忽略（与编辑浮层同一坑）；放到下一帧（定位已完成）再聚焦。
  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const notes = useMemo(() => {
    const all = (noteRefHost()?.listNotes() ?? []).filter((n) => !isNoteRefGone(n.id));
    const q = query.trim().toLowerCase();
    return (q ? all.filter((n) => (n.title || "").toLowerCase().includes(q)) : all).slice(0, 200);
  }, [query]);
  return (
    <Popover open onDismiss={onClose} label="选择要引用的文档" surfaceRef={surfaceRef} style={style ?? undefined}>
      <div className="ln-dialog__body">
        <input className="ln-input__field ne-note-ref-dialog__search" ref={searchRef} value={query} placeholder="搜索标题…"
          aria-label="搜索标题" onChange={(e) => setQuery(e.target.value)} />
        {notes.length === 0
          ? <p className="ln-empty"><small>没有匹配的文档</small></p>
          : (
            <ul className="ln-list ne-note-ref-dialog__list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button type="button" className="ln-row ne-note-ref-dialog__item" onClick={() => onPick(note)}>
                    <span className="ln-ellipsis">{note.title || "无标题"}</span>
                    <span className="ne-note-ref__kind">{noteKindLabel(note.kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn" onClick={onClose}>取消</button>
      </div>
    </Popover>
  );
}

/**
 * 编辑浮层（**锚定在文字旁**，不是全局弹窗；逐项复刻内核链接编辑器）：
 * 两个字段「文本 / 链接」+「确定」——表面与字段几何全部来自内核 `.ne-link-editor*`（365 宽 / padding 16·12 /
 * 字段间距 16 / 字段名在上、控件在下），我们只把控件换成自己的 kit 原语（`.ln-input` / `.ln-btn`）。
 * 「链接」同样是**输入框外观**（点击 / Enter 打开文档选择器 —— 目标不是 URL，不能真的手输）。
 *
 * **完整创建流程（用户 261008 八改定稿）**：插入 → 本浮层自动打开 → 点「链接」选文档 →
 * **回填「文本」= 该文档标题**（不立刻保存）→ 用户改完点「确定」→ 卡片直接展示这段文本。
 * ⇒ 选中文档只写进本地 `picked`（`refId/targetLabel` 都是"预览值"），**只有「确定」才落库**。
 */
function NoteRefEditPopover({ value, anchor, onSave, onClose }: { value: NoteRefValue; anchor: HTMLElement | null; onSave: (next: NoteRefValue) => void; onClose: () => void }) {
  const [name, setName] = useState(value.title ?? "");
  const [picking, setPicking] = useState(false);
  /** 本次编辑里**新选中的目标**（选完先回填、不落库；用户 261008 的完整创建流程）。 */
  const [picked, setPicked] = useState<{ noteId: string; title: string; kind?: string } | null>(null);
  const pos = usePopoverPosition({ open: !picking, anchor, gap: 6 });
  // 选择器也**锚在同一个文字**上（此前没有锚点/坐标 ⇒ 会掉到视口左上角）
  const pickPos = usePopoverPosition({ open: picking, anchor, gap: 6 });
  const existing = findNoteRef(parseNoteRef(value));
  /** 有效目标 = 本次选中的（优先）或卡片里已有的。 */
  const refId = picked?.noteId ?? parseNoteRef(value);
  const targetTitle = picked ? picked.title : (existing?.title ?? value.title ?? "");
  const targetKind = picked ? picked.kind : existing?.kind;
  const targetLabel = refId ? `${targetTitle || "无标题"} · ${noteKindLabel(targetKind)}` : "";
  const hasRef = Boolean(refId);
  /** 上一次**自动回填**的文本：用户改过就不再被下一次选文档覆盖（"改完了"要留得住）。 */
  const autoFilledRef = useRef("");
  const applyPick = (note: { id: string; title: string; kind?: string }) => {
    const title = note.title || "无标题";
    setPicked({ noteId: note.id, title, kind: note.kind });
    setName((prev) => (prev.trim() === "" || prev === autoFilledRef.current ? title : prev));
    autoFilledRef.current = title;
    setPicking(false);
  };
  const textRef = useRef<HTMLInputElement | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  /**
   * 打开即聚焦（与内核链接编辑器同口径：**已有引用落在「文本」、还没有引用落在「链接」**）。
   * ⚠️ 必须等 `pos.placed`：首帧表面是 `visibility:hidden` 的占位（见 usePopoverPosition），
   * 此刻 `focus()` 会被浏览器**静默忽略** —— 这也是不能用 `autoFocus` 的原因。
   */
  useEffect(() => {
    if (!pos.placed || picking) return;
    (hasRef ? textRef : linkRef).current?.focus();
  }, [pos.placed, picking, hasRef]);
  return (
    <>
      <Popover open={!picking} onDismiss={onClose} label="编辑文档引用"
        surfaceClassName="ne-link-editor" className="lakex-default-theme"
        surfaceRef={pos.surfaceRef} style={pos.style ?? undefined}>
        <div className="ne-link-editor-field">
          <div className="ne-link-editor-field-title">文本</div>
          <div className="ln-input">
            <input className="ln-input__field" ref={textRef} value={name} placeholder="添加描述"
              aria-label="文本" onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="ne-link-editor-field">
          <div className="ne-link-editor-field-title">链接</div>
          <div className="ln-input ne-note-ref-edit__link">
            <input className="ln-input__field" ref={linkRef} readOnly value={targetLabel} placeholder="选择文档…"
              aria-label="链接（点击选择文档）" title="点击选择文档"
              onClick={() => setPicking(true)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicking(true); } }} />
          </div>
        </div>
        <button type="button" className="ln-btn ln-btn--secondary" disabled={!hasRef}
          onClick={() => onSave({ noteId: refId ?? "", title: name.trim() || targetTitle })}>确定</button>
      </Popover>
      {picking && (
        /* 选中文档**只回填、不落库**（完整创建流程：选文档 → 自动填文本 → 改完「确定」才写卡）。 */
        <NoteRefPicker surfaceRef={pickPos.surfaceRef} style={pickPos.style ?? undefined} onClose={() => setPicking(false)}
          onPick={(note) => applyPick(note)} />
      )}
    </>
  );
}

/**
 * 动作条条目：**内核卡片工具栏**的条目类（与图片浮栏 SelectionToolbar 的 CardItem 同一姿势）。
 * 用 `div[role=button]` 而不是 `<button>`：`.ne-card-toolbar-item` 只给几何与悬停底色、并不重置 UA 的
 * 按钮底/描边，用原生 button 会多出一圈系统灰底（再去覆盖就变成"又写一套样式"）。
 */
function NoteRefActionItem({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <div role="button" tabIndex={0} className="ne-card-toolbar-item" title={label} aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>
      {children}
    </div>
  );
}

/**
 * 卡片本体（编辑态 / 阅读态共用），**交互与内核链接对齐（261008 四改，用户定稿）**：
 * - **鼠标移到文字上就出动作条**（不再需要点一下打开；走 `HoverPopover`：锚点与表面共享悬停区 + 开/关延时）；
 * - **点击文字 = 直接打开被引用的文档**（同一文档只能有一个标签，已打开则激活它）。
 * 正文用内核自己的 `.ne-link` 类渲染 ⇒ **样式直接复刻链接**。`mode === "view"` 时只给读操作。
 */
function NoteRefCard({ value, update, mode, editor }: { value: NoteRefValue | null; update: (next: NoteRefValue) => void; mode: "edit" | "view"; editor?: unknown }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /**
   * 浮窗锚点 = **标题文字元素**（不是整块卡片）：用户 261008「浮窗要贴近文字」，贴块底会飘到行外。
   * 同一个元素要供两处用：
   *  - `anchorRef` = `HoverPopover` 的**悬停触发区**（ref 形式，必须在它的 effect 之前就绪 ⇒ 挂在 ref 回调里）；
   *  - `anchor`（state）= `usePopoverPosition` 的**定位锚点**（元素挂上后才量得到真实尺寸/位置）。
   */
  const anchorRef = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const titleRef = useCallback((el: HTMLElement | null) => { anchorRef.current = el; setAnchor(el); }, []);
  /** 贴文字下方 2px（= 内核卡片工具栏的默认 offset；用户 261008：「浮窗要贴近文字」）。 */
  const pos = usePopoverPosition({ open: menuOpen, anchor, gap: 2 });
  /** 空引用态（遗留卡/兜底）那个「选择文档…」浮层也锚在卡上（此前没给坐标 ⇒ 会掉到视口左上角）。 */
  const plainPickPos = usePopoverPosition({ open: picking, anchor, gap: 6 });
  const noteId = parseNoteRef(value);
  const note = findNoteRef(noteId);
  const gone = isNoteRefGone(noteId);
  /**
   * **展示文本 = 卡里存的 `title`（用户在编辑浮层「文本」里填的），不是目标的实时标题**（用户 261008 八改定稿：
   * 「自动填充文本，改完了直接展示文本」）—— 否则改文本等于没改（显示永远被目标文档的标题覆写）。
   * 只有旧卡/未填文本时才回落到目标的实时标题。
   */
  const title = value?.title || note?.title || "";
  const readonly = mode === "view";

  /**
   * **刚插入的卡自动打开编辑浮层**（用户 261008 六改：「插入文档引用，直接打开编辑页面就行，还是类似链接」）——
   * 与内核插入链接后立刻弹链接编辑器同口径。
   *
   * 判据 = 内核**给刚插入的卡**挂的 `ne-focused`（实测：**打开既有文档时卡上没有**这个类；插入后才有）。
   * 三个必须的细节（都踩过）：
   *  ① **轮询而不是一次性判定**：插入时内核可能先把卡渲染到**游离节点**里再挂进文档（挂载那一刻
   *     `closest("ne-card")` 可能是 null），也可能稍后才写 `ne-focused` ⇒ 每 120ms 重看一次，窗口 ~1.4s；
   *  ② **按 DOM 元素去重**（模块级 WeakSet，**开过一次就不再开**）：内核重渲染/重复挂载同一张卡时不会重复弹；
   *  ③ **阅读态不弹**（viewer 不给写操作）；有引用（`noteId`）也不弹。
   */
  useEffect(() => {
    if (readonly || noteId) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const cardEl = anchorRef.current?.closest("ne-card");
      if (cardEl && cardEl.isConnected && !autoOpenedCards.has(cardEl) && cardEl.classList.contains("ne-focused")) {
        autoOpenedCards.add(cardEl);
        window.clearInterval(timer);
        setEditing(true);
        return;
      }
      if (tries >= 12) window.clearInterval(timer);
    }, 120);
    return () => window.clearInterval(timer);
  }, [readonly, noteId]);

  /**
   * 取消链接 = **转为正文**（用户 261008 九改）：走内核命令把卡片换成一段文本（见 `unlinkCardToText`）。
   * 成功时这张卡已被内核删除、本组件随之卸载；只有拿不到内核能力时才退回旧的"保留卡片（清引用）"行为，
   * **绝不静默丢文本**（AGENTS §3#16）。
   */
  const unlink = () => {
    setMenuOpen(false);
    const cardEl = (anchorRef.current?.closest("ne-card") as HTMLElement | null) ?? null;
    if (unlinkCardToText(editor, cardEl, title)) return;
    update({ noteId: "", title });
  };

  /** 点击文字 = 直接访问（失效/无引用时不动）。 */
  const openTarget = () => {
    if (!noteId || gone) return;
    setMenuOpen(false);
    noteRefHost()?.openNote(noteId);
  };

  /**
   * 复制引用 = 复制目标文档的**资料库全路径**（`笔记本/分组/文档`；用户 261008 定稿）。
   * `pathOf` 由宿主注入、签名允许同步/异步（统一 `await`），只在**点击那一刻**取 —— 资料库路径要走一遍树，
   * 放渲染期会随卡片数量白烧。
   * 回退顺序：资料库路径 → 展示名 → `lake-note://<id>`（任何情况下都不会复制空串）。
   */
  const copyRef = async () => {
    if (!noteId) return;
    let path: string | null = null;
    try { path = (await noteRefHost()?.pathOf?.(noteId)) ?? null; } catch { path = null; }
    const text = path || title || noteRefUrl(noteId);
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  /**
   * 动作条：与内核链接那套一致（访问 / 编辑 / 复制 / 取消链接）。
   *
   * ⚠️ 表面类用 **`surfaceClassName="ne-card-toolbar"`** —— 内核卡片工具栏的**单一来源实现**
   * （与选区浮栏里的图片工具栏同一套类；尺寸/间距/悬停底色/圆角全由 vendored lakex-doc.css 给），
   * 我们**不自造一条几何**（261008 三改，用户：「大小和间距也要复刻」）。
   * 也**不要**退回 `Menu`（竖向菜单原语，会把四个图标排成竖列）。
   *
   * ⚠️ **`key` 不能省**：`HoverPopover` 的悬停监听只在**挂载时**读一次 `anchorRef.current`，
   * 而"取消链接 / 重新引用"会让锚点元素在本组件**不重挂**的情况下换掉（链接态 ↔ 纯文本态）
   * ⇒ 用 key 强制重挂，否则换态后悬停彻底失效。
   */
  const actionsMenu = (
    <HoverPopover key={noteId ? (gone ? "linked-gone" : "linked") : "plain"}
      open={menuOpen} onOpenChange={(next) => setMenuOpen(next && !editing && !picking)}
      anchorRef={anchorRef} panelRef={pos.surfaceRef} onDismiss={() => setMenuOpen(false)}
      label="文档引用操作" surfaceClassName="ne-card-toolbar" className="lakex-default-theme"
      style={pos.style ?? undefined} openDelayMs={120} closeDelayMs={160}>
      {noteId && !gone && (
        <NoteRefActionItem label="访问" onClick={() => { setMenuOpen(false); noteRefHost()?.openNote(noteId); }}>
          <SquareArrowOutUpRight size={16} />
        </NoteRefActionItem>
      )}
      {!readonly && (
        <NoteRefActionItem label="编辑（改展示名称 / 换文档）" onClick={() => { setMenuOpen(false); setEditing(true); }}>
          <Pencil size={16} />
        </NoteRefActionItem>
      )}
      {noteId && (
        <NoteRefActionItem label="复制引用路径（目标文档在资料库里的全路径）" onClick={() => void copyRef()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </NoteRefActionItem>
      )}
      {!readonly && noteId && (
        <NoteRefActionItem label="取消链接（转为正文）" onClick={unlink}>
          <Unlink size={16} />
        </NoteRefActionItem>
      )}
    </HoverPopover>
  );

  // 空引用：先出「选择文档…」；**取消链接已改为"转成正文"**，所以这个分支现在只服务
  // （① 旧数据里的无引用卡 ② 拿不到内核能力时 `unlink` 的兜底）：纯文本 + **悬停**出动作条（可重新引用）。
  if (!noteId) {
    return (
      <div className="ne-note-ref ne-note-ref--plain" ref={titleRef}>
        {value?.title
          ? <span className="ne-note-ref__plain ln-ellipsis">{value.title}</span>
          : <button type="button" className="ln-btn" onClick={() => setPicking(true)}>选择文档…</button>}
        {actionsMenu}
        {picking && <NoteRefPicker surfaceRef={plainPickPos.surfaceRef} style={plainPickPos.style ?? undefined}
          onClose={() => setPicking(false)} onPick={(n) => { update({ noteId: n.id, title: n.title }); setPicking(false); }} />}
        {editing && <NoteRefEditPopover value={value ?? {}} anchor={anchor} onClose={() => setEditing(false)} onSave={(nextValue) => { update(nextValue); setEditing(false); }} />}
      </div>
    );
  }

  return (
    /* ⚠️ 外层**不挂** `titleRef`：同一回调 ref 挂两层时最终锚点是"最后一个挂上的"、会漂到卡片块上，
       浮层就比文字低 6~8px（用户 261008：「浮窗要贴近文字」）。锚点只留给**标题文字**元素。 */
    <div className="ne-note-ref" data-gone={gone ? "true" : undefined}>
      {gone
        ? <span className="ne-note-ref__title ne-note-ref__title--gone" ref={titleRef} title="目标文档已删除或不可用">文档已删除{title ? `：${title}` : ""}</span>
        : (
          /* 点击 = 直接访问（不再有"点一下出菜单"）；悬停由 HoverPopover 负责。
             不挂原生 title：悬停已经是动作条，再来一个 .ln-tip 会叠在一起。 */
          <span className="ne-note-ref__title ln-ellipsis" ref={titleRef} role="link" tabIndex={0}
            aria-label={`打开文档：${title || noteId}`} onClick={openTarget}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTarget(); } }}>
            <span className="ne-link">{title || "无标题"}</span>
          </span>
        )}
      <span className="ne-note-ref__kind">{gone ? "失效" : noteKindLabel(note?.kind)}</span>
      {actionsMenu}
      {editing && <NoteRefEditPopover value={value ?? {}} anchor={anchor} onClose={() => setEditing(false)} onSave={(nextValue) => { update(nextValue); setEditing(false); }} />}
    </div>
  );
}

/** 内核注册用的完整卡片描述（组件 + 与 React 无关的 meta）。 */
export const noteRefCardConfig = {
  ...NOTE_REF_CARD_META,
  // 内核给 editorComponent 的 props = { editor, cardValue, updateCardValue, cardType }（vendor 实测）——
  // `editor` 是**这张卡自己的 editor**，「取消链接 → 转为正文」要用它跑内核命令。
  editorComponent: (props: { cardValue: NoteRefValue; updateCardValue: (v: NoteRefValue) => void; editor?: unknown }) =>
    <NoteRefCard value={props.cardValue} update={props.updateCardValue} mode="edit" editor={props.editor} />,
  viewerComponent: (props: { cardValue: NoteRefValue; updateCardValue: (v: NoteRefValue) => void }) =>
    <NoteRefCard value={props.cardValue} update={props.updateCardValue} mode="view" />,
};

/** 把本卡追加进内核的 `customCard.cards`（幂等；必须在 prepareCustomCards 之前调用）。
 *  第三个参数 = **插入面板的图标组件**（渲染 symbol，见 noteRefIcon.tsx）。 */
export function registerNoteRefCard(config: Record<string, unknown>): void {
  appendNoteRefCard(config, noteRefCardConfig, NoteRefIconSymbol);
}