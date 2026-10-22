/**
 * 小记「列表 / 小记」版式切换 + 附件工具的护栏（260919，用户要求对齐语雀云端）。
 *
 * 事实（云端实测 + 本仓库实测，详见 docs/LAKEX-CONTRACT.md §5.11 与 HANDOFF §2.10 续做）：
 * - 云端小记标题右侧是分段控件：左＝列表视图（索引列表 + 全尺寸编辑器），右＝小记卡视图
 *   （写作卡 + 卡片流）。两种版式是**纯展示偏好**（本机 localStorage，不进 S3）。
 * - 附件（挂纸夹）走内核 file 插件唯一工具项 `note-file`；它的图标 symbol 属语雀 App 私有，
 *   必须在本地自补，否则按钮有布局无图形。
 * - 小记的附件与图片共用同一 staging/promote/转换 管线（`content.images` = 资源清单）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const WORKSPACE_SRC = read("../../components/app/QuickNotesWorkspace.tsx");
const EDITOR_SRC = read("./QuickNoteEditor.tsx");
const RUNTIME_SRC = read("../editor/lakeRuntime.ts");
const PREVIEW_SRC = read("./QuickNotePreview.tsx");
const MODEL_SRC = read("../../core/quickNoteModel.ts");
const UPLOAD_SRC = read("../editor/resourceUpload.ts");
const MAIN_SRC = read("../../../electron/quickNotes.ts");
const MOBILE_HOME_SRC = read("../../mobile/home/HomePage.tsx");
const MOBILE_LIST_MODEL_SRC = read("../../mobile/home/useQuickNoteListModel.ts");
const MOBILE_COMPOSER_SRC = read("../../mobile/home/QuickNoteComposer.tsx");

describe("小记版式切换（列表 / 小记）", () => {
  it("版式是纯展示偏好：存 localStorage，不进设置/同步", () => {
    expect(WORKSPACE_SRC).toMatch(/const VIEW_KEY = "local-lakex-notes-v3\.quick-notes-view"/);
    expect(WORKSPACE_SRC).toMatch(/writeLocalStorage\(VIEW_KEY/);
    expect(WORKSPACE_SRC).not.toMatch(/native\.saveSettings\([\s\S]{0,80}viewMode/);
  });

  it("两种版式各自成体系：小记卡（写作卡+卡片流）与列表（索引 + 全尺寸编辑器）", () => {
    expect(WORKSPACE_SRC).toMatch(/quick-notes-split--list/);
    expect(WORKSPACE_SRC).toMatch(/quick-notes-index ln-list-panel ln-list-panel--background/);
    // 列表版式用思源列表件（hover/选中底色直接复用，勿自造）
    expect(WORKSPACE_SRC).toMatch(/ln-list-item/);
    // 两种版式共用一个编辑器组件，但版式不同：分块视图＝小卡片(card)，列表视图＝文档样式(full)
    expect(WORKSPACE_SRC).not.toMatch(/editorMode=/);
    expect(WORKSPACE_SRC).toMatch(/ui="full"/);
    expect(EDITOR_SRC).toMatch(/quickNoteUi: ui/);
    // 时间戳口径对齐云端：今天 = 「今天 HH:MM」，其余 = 「MM-DD」；原子格式化走 core/dateFormat 单一来源（C1-5）
    expect(WORKSPACE_SRC).toContain('from "../../core/dateFormat"');
    expect(WORKSPACE_SRC).toContain("formatListTime(new Date(iso), new Date())");
    expect(WORKSPACE_SRC).toContain("formatListTime(new Date(item.updatedAt || item.createdAt), new Date(), true)");
    expect(WORKSPACE_SRC).not.toMatch(/padStart\(2/);
  });
});

describe("小记附件（内核 file 卡）", () => {
  it("附件与图片共用 staging 管线（主进程 stageFile，宽高 null，走附件上限）", () => {
    expect(MAIN_SRC).toMatch(/stageFile\(draftId: string/);
    expect(MAIN_SRC).toMatch(/MAX_ATTACHMENT_BYTES/);
    expect(MAIN_SRC).toMatch(/width: null, height: null/);
  });

  it("非图片上传必须走 saveResource（否则落进文档资源空间，promote 找不到文件）", () => {
    expect(UPLOAD_SRC).toMatch(/uploadAttachmentFile\(payload, noteId, options\)/);
    expect(UPLOAD_SRC).toMatch(/options\.saveResource\s*\?\s*await options\.saveResource/);
  });

  it("资源清单允许非图片条目，但附件不得带像素尺寸", () => {
    expect(MODEL_SRC).toMatch(/!isQuickNoteImageMime\(image\.mimeType\) && \(image\.width \?\? null\) !== null/);
    expect(MODEL_SRC).toMatch(/export function isSafeAssetMime/);
    // 合成路径（移动端）只把图片条目变成图片卡
    expect(MODEL_SRC).toMatch(/if \(image\.mimeType && !isQuickNoteImageMime\(image\.mimeType\)\) continue;/);
  });

  it("附件/视频/音频走内核「+」面板的卡片类型（面板 = 内核全量，不再过滤）", () => {
    // 旧的 note 版式里我们用 installAttachmentTypeRouting 拦附件按钮改 category；
    // 现在编辑态就是文档编辑器，「+」面板里图片/视频/音频/附件各有条目，类型天然由内核决定。
    expect(RUNTIME_SRC).not.toMatch(/installAttachmentTypeRouting/);
    // 261010：小记「+」面板不再白名单过滤（面板全量 = 与桌面端一致；格式还原交给内核只读兜底）。
    expect(RUNTIME_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/filterOption/);
  });

  it("卡片预览 = 快路径（零内核实例）+ 内核只读兜底，媒体按类型就地渲染", () => {
    // 卡片不再直接铺 <img>/<video>，而是交给 QuickNotePreview 解析正文后按块渲染
    expect(WORKSPACE_SRC).toMatch(/<QuickNotePreview/);
    // 兜底渲染要小记 id（内核解析资源/卡片要用）
    expect(WORKSPACE_SRC).toMatch(/noteId=\{item\.id\}/);
    expect(WORKSPACE_SRC).toMatch(/fallbackText=\{item\.content\.text\}/);
    // 媒体仍按 MIME 分流（图片/视频/音频/附件条），且图片点击放大沿用 Lightbox
    expect(PREVIEW_SRC).toMatch(/isQuickNoteImageMime\(asset\.mimeType\)/);
    expect(PREVIEW_SRC).toMatch(/asset\.mimeType\.startsWith\("video\/"\)/);
    expect(PREVIEW_SRC).toMatch(/quick-note-file-chip/);
    expect(PREVIEW_SRC).toMatch(/parseQuickNotePreview\(body\)/);
  });

  it("保存前等媒体卡上传完成（pending 卡会写出 url:null —— 用户「一编辑就消失」的真因）", () => {
    expect(WORKSPACE_SRC).toMatch(/function hasPendingMediaCard\(body: string\)/);
    expect(WORKSPACE_SRC).toMatch(/%22status%22%3A%22pending%22/);
    expect(WORKSPACE_SRC).toMatch(/while \(Date\.now\(\) < deadline && hasPendingMediaCard\(body\)\)/);
    // 编辑器句柄按草稿 id 存（写作面板与内联编辑并存时不得互相覆盖）
    expect(WORKSPACE_SRC).toMatch(/draftEditorsRef = useRef\(new Map<string, QuickNoteEditorApi>\(\)\)/);
    expect(WORKSPACE_SRC).toMatch(/handleEditorReady\(createDraft\.id, api\)/);
    expect(WORKSPACE_SRC).toMatch(/handleEditorReady\(editingDraft\.id, api\)/);
    // 保存的是「点击的那个 composer 的那份草稿」
    expect(WORKSPACE_SRC).toMatch(/saveDraft\(createDraft\)/);
    expect(WORKSPACE_SRC).toMatch(/saveDraft\(editingDraft\)/);
  });

  it("取消必须作用于「点击的那个 composer 的那份草稿」（260920 修：写作卡的取消会误关右侧正在编辑的小记）", () => {
    expect(WORKSPACE_SRC).toMatch(/async function cancelDraft\(draft: DraftState\)/);
    expect(WORKSPACE_SRC).toMatch(/cancelDraft\(createDraft\)/);
    expect(WORKSPACE_SRC).toMatch(/cancelDraft\(editingDraft\)/);
    // 不得再用全局 activeDraft 决定取消谁（save 路径同理，两边同一口径）
    expect(WORKSPACE_SRC).not.toMatch(/discardQuickNoteDraft\(activeDraft\.id\)/);
  });

  it("内核实例不在隐藏（0 宽）容器里创建：App 的 visible 一路透传到 QuickNoteEditor.active（260920 首次打开宽度错乱根因）", () => {
    // App → DesktopQuickNotes → QuickNotesWorkspace → QuickNoteComposer → QuickNoteEditor
    expect(read("../../../src/App.tsx")).toMatch(/visible=\{desktopWorkspace === "quick-notes"\}/);
    expect(read("../../desktop/DesktopQuickNotes.tsx")).toMatch(/visible=\{visible\}/);
    expect(WORKSPACE_SRC).toMatch(/visible = true/);
    expect(WORKSPACE_SRC).toMatch(/active=\{visible\}/);
    expect(EDITOR_SRC).toMatch(/active = true/);
    // 「见过一次可见」的闩：隐藏时不卸载（卸载会用陈旧 initialBody 重建，丢正在写的正文）
    expect(EDITOR_SRC).toMatch(/const \[everActive, setEverActive\] = useState\(active\)/);
    expect(EDITOR_SRC).toMatch(/if \(!everActive\) return;/);
  });

  it("小记编辑器也挂「附件按类型成卡」路由（260920：插入 mp4 只得到附件卡，预览却是视频）", () => {
    // 路由实现本身是文档/移动端共用的 mediaCardRouting，小记这套新编辑器此前漏挂
    expect(EDITOR_SRC).toMatch(/import \{ installMediaCardCategoryRouter \} from "\.\.\/editor\/mediaCardRouting"/);
    expect(EDITOR_SRC).toMatch(/const detachMediaCardRouter = installMediaCardCategoryRouter\(editor\)/);
    expect(EDITOR_SRC).toMatch(/detachMediaCardRouter\(\)/);
  });

  it("字节走 IPC 时传 Uint8Array（不再 Array.from 成 number[]：附件 100MiB 时凭空多出几百 MB 数组）", () => {
    expect(WORKSPACE_SRC).toMatch(/const payload = \{ bytes: input\.bytes, filename: input\.filename \};/);
    expect(WORKSPACE_SRC).not.toMatch(/Array\.from\(input\.bytes\)/);
  });

  it("编辑态卡片禁止按压缩放（transform 会把展开层的定位基准变成卡片 ⇒ 真鼠标点不到保存/取消）", () => {
    // 260920 真凶：`.quick-note-entry:active { transform: scale(.98) }` 一按下就把卡片变成
    // 绝对定位后代的定位基准，展开层高度 810 → 约 220、按钮从鼠标下跑掉。
    const quickNotesCss = read("../../styles/app/quick-notes.css");   // P7-c：styles/quick-notes.css 已并入此处
    expect(quickNotesCss).toMatch(/\.quick-note-entry\.editing,[\s\S]{0,60}\.quick-note-entry\.editing:active\s*\{\s*transform: none;/);
  });

  it("历史遗留的 pending 死卡不再锁死保存（对齐文档侧：不等、不拒绝，只提示）", () => {
    // 文档保存路径（useWorkspaceState/EditorTab）里没有任何 pending/uploading 判断 ⇒ 正文原样存下；
    // 小记原来"等 15s 后拒绝保存"会让人出不去编辑器，现在改成：只有本会话在传才等，其余照存 + 提示。
    expect(WORKSPACE_SRC).toMatch(/if \(pendingUploadsRef\.current > 0 && !\(await waitForPendingUploads\(\)\)\) \{\s*setViewHint/s);
    // pending 卡：有上传在传等满 15s；没有在传时只在"刚上传完 2s 内"等 1.2s 收尾窗口
    // （覆盖"内核回填 url"的空档），**死卡（早已无上传）直接跳过、保存瞬时完成**。
    expect(WORKSPACE_SRC).toMatch(/pendingUploadsRef\.current > 0[\s\S]{0,40}\? 15000[\s\S]{0,80}lastUploadSettledAtRef\.current < 2000 \? 1200 : 0/);
    expect(WORKSPACE_SRC).toMatch(/lastUploadSettledAtRef\.current = Date\.now\(\)/);
    expect(WORKSPACE_SRC).toMatch(/if \(api && hasPendingMediaCard\(body\)\) setViewHint\("有媒体还没上传完，已按当前内容保存"\)/);
    // 不能再出现"因为 pending/附件处理中而拒绝保存"的 return false
    expect(WORKSPACE_SRC).not.toMatch(/setError\("有媒体还没上传完，请稍候再保存"\)/);
    expect(WORKSPACE_SRC).not.toMatch(/个附件还没完成处理，请稍候再保存/);
  });

  it("列表视图保存/取消不再连拆两次编辑器（260920「点保存反复闪、退不出去」根因）", () => {
    // 保存收尾统一走 settleAfterSave：列表视图"留在这条里"（原地刷基线），其他视图照旧关闭
    expect(WORKSPACE_SRC).toMatch(/function settleAfterSave\(draft: DraftState/);
    expect(WORKSPACE_SRC).toMatch(/if \(viewMode === "list" && editingDraft\?\.id === draft\.id\)/);
    // 两条保存路径（没改动早退 / 真保存）都必须用它，否则早退那条会退回"关掉→默认选中补回来"的老路
    expect(WORKSPACE_SRC).toMatch(/if \(unchanged\) \{ settleAfterSave\(draft/);
    expect(WORKSPACE_SRC).toMatch(/if \(isEditing\) settleAfterSave\(draft/);
    // 取消：列表视图原地重开该条（一次提交），不再先清空再等默认选中
    expect(WORKSPACE_SRC).toMatch(/if \(viewMode === "list" && item\) \{ setEditingDraft\(draftOf\(item\)\); return; \}/);
  });
});

describe("小记标签（随 .qnote 同步，无独立目录表）", () => {
  it("两端都从有效小记派生候选标签，并在写作区支持选择/创建", () => {
    expect(WORKSPACE_SRC).toContain("buildQuickNoteTagIndex(items");
    expect(WORKSPACE_SRC).toContain("tagOptions={tagIndex.tags}");
    expect(WORKSPACE_SRC).toContain("<QuickNoteTagPicker");
    expect(MOBILE_LIST_MODEL_SRC).toContain("buildQuickNoteTagIndex(displayedQuickNotes");
    expect(MOBILE_HOME_SRC).toContain("tagOptions={quickTagIndex.tags}");
    expect(MOBILE_COMPOSER_SRC).toContain("<MobileQuickNoteTagSheet");
  });

  it("卡片显示标签，筛选只影响当前列表；标签写回 .qnote 内容", () => {
    expect(WORKSPACE_SRC).toContain("item.content.tags");
    expect(WORKSPACE_SRC).toContain("filterQuickNotesByTag(items");
    expect(MOBILE_LIST_MODEL_SRC).toContain("filterQuickNotesByTag(displayedQuickNotes");
    expect(WORKSPACE_SRC).toMatch(/native\.updateQuickNote\(noteId,[\s\S]{0,260}tags,/);
    expect(MOBILE_COMPOSER_SRC).toMatch(/saveQuickNoteContent\(noteId, \{ text: plain, body, images, tags \}\)/);
  });

  it("切换标签筛选前先保存并退出正在编辑的小记，避免筛掉卡片时丢未保存内容", () => {
    expect(WORKSPACE_SRC).toMatch(/async function changeTagFilter\(next: QuickNoteTagFilter\)/);
    expect(WORKSPACE_SRC).toMatch(/if \(dirty && !\(await saveBeforeSwitch\(\)\)\) return;/);
    expect(WORKSPACE_SRC).toMatch(/setEditingId\(null\);\s*setEditingDraft\(null\);/);
  });
});
describe("小记类型筛选（261021，对齐语雀 dashboard/notes）", () => {
  it("类型筛选菜单与标签筛选共用一套清筛选/收编辑口径", () => {
    expect(WORKSPACE_SRC).toContain("QUICK_NOTE_TYPE_OPTIONS");
    expect(WORKSPACE_SRC).toContain("filterQuickNotesByType(filtered, typeFilter)");
    expect(WORKSPACE_SRC).toMatch(/async function changeTypeFilter\(next: QuickNoteTypeFilter\)/);
    // 语雀语义：类型筛选与标签筛选互斥（切类型清标签；类型非「小记」时标签条不渲染）
    expect(WORKSPACE_SRC).toMatch(/setTagFilter\(\{ kind: "all" \}\);\s*setTypeFilter\(next\);/);
    expect(WORKSPACE_SRC).toMatch(/if \(typeFilter !== "all" \|\| items\.length === 0 \|\| tagIndex\.tags\.length === 0\) return null;/);
  });

  it("卡片视图标签条渲染在右侧列表列；列表视图收进「标签 ▾」下拉", () => {
    // 卡片视图右栏仍用平铺标签条（Yuque 卡片视图同款）；列表视图的窄索引列不再平铺
    expect(WORKSPACE_SRC.match(/\{renderTagBar\(\)\}/g)?.length).toBe(1);
    expect(WORKSPACE_SRC).not.toMatch(/items\.length > 0 && tagIndex\.tags\.length > 0/);
    expect(WORKSPACE_SRC).toContain("quick-notes-tag-filter-btn");
    expect(WORKSPACE_SRC).toContain('aria-label="标签筛选"');
    expect(WORKSPACE_SRC).toContain("quick-notes-tag-filter-menu");
  });

  it("筛选菜单：默认勾「小记」，并保留批量操作入口（复用既有多选态）", () => {
    expect(WORKSPACE_SRC).toContain("role=\"menuitemradio\" aria-checked={typeFilter === option.id}");
    expect(WORKSPACE_SRC).toMatch(/setSelecting\(true\)[^}]*批量操作|批量操作/);
    expect(WORKSPACE_SRC).toContain("未能找到相关小记");
  });
});
describe("批量勾选框槽位（261021 回归）", () => {
  it("timeline 成为滚动容器后，left:-gutter 的勾选框不能被 overflow 裁掉", () => {
    const css = read("../../styles/app/quick-notes.css");
    // 槽位宽度单一来源：卡片左侧 = --quick-notes-gutter；timeline 用负 margin + 同值 padding 把槽位包进滚动容器
    expect(css).toMatch(/\.quick-notes-list \{[^}]*--quick-notes-gutter: 30px/);
    expect(css).toMatch(/\.quick-notes-list \.quick-notes-timeline[^{]*\{[^}]*margin-left: calc\(-1 \* var\(--quick-notes-gutter\)\)[^}]*padding-left: var\(--quick-notes-gutter\)/);
    expect(css).toMatch(/\.quick-note-select \{[^}]*left: calc\(-1 \* var\(--quick-notes-gutter, 30px\)\)/);
    // 勾选框仍是卡片左侧槽位（不是塞进卡片内容里）
    expect(css).toMatch(/\.quick-notes-list\.selecting \.quick-note-select \{ opacity: 1; \}/);
  });
});
describe("列表视图三件套（261021，对齐语雀 list view）", () => {
  it("左侧头部 = 标签 ▾ / 搜索 / ⋯；N 条与排序只留在卡片视图", () => {
    expect(WORKSPACE_SRC).toContain("quick-notes-index-tools");
    expect(WORKSPACE_SRC).toContain('title="搜索小记" aria-label="搜索小记"');
    expect(WORKSPACE_SRC).toContain('title="更多" aria-label="更多"');
    expect(WORKSPACE_SRC).toContain("quick-notes-more-menu");
    expect(WORKSPACE_SRC).toContain("quick-notes-menu-section");
    // 列表视图标题/版式切换/新建小记在左栏头；条数/类型筛选/排序只在卡片视图页头
    expect(WORKSPACE_SRC).toContain("quick-notes-list-head");
    expect(WORKSPACE_SRC).toMatch(/viewMode === "note" && <header className="quick-notes-header">/);
    expect(WORKSPACE_SRC).toMatch(/setSortBy\(option\.id\); writeQuickNoteSort\(option\.id\);/);
  });

  it("搜索：输入框只在列表视图；Enter 应用 / Esc 收起；查询走 core 纯函数", () => {
    expect(WORKSPACE_SRC).toContain("filterQuickNotesByQuery(visibleItems, searchQuery)");
    expect(WORKSPACE_SRC).toMatch(/event\.key === "Enter"[^}]*setSearchQuery\(searchInput\.trim\(\)\)/);
    expect(WORKSPACE_SRC).toMatch(/event\.key === "Escape"[^}]*closeSearch\(\)/);
    expect(WORKSPACE_SRC).toContain("quick-notes-index-search__clear");
  });
});
describe("小记搜索入口（261021）", () => {
  it("卡片视图也有小记内本地搜索；列表视图与卡片视图共用查询", () => {
    expect(WORKSPACE_SRC).toContain("quick-notes-list-search");
    expect(WORKSPACE_SRC).toContain("filterQuickNotesByQuery(visibleItems, searchQuery)");
    expect(WORKSPACE_SRC).toContain("listItems.map");
    expect(WORKSPACE_SRC).toContain("toggleSearch");
  });

  it("全局搜索命中后只定位/高亮，不自动进编辑态", () => {
    expect(WORKSPACE_SRC).toMatch(/async function revealNote\(id: string\): Promise<void>/);
    expect(WORKSPACE_SRC).toContain("data-quick-note-id={item.id}");
    expect(WORKSPACE_SRC).toContain("setRevealNoteId");
    // 定位函数里不得调用 startEditing（用户 261021 点单：搜索进来不要自动编辑）
    expect(WORKSPACE_SRC).toMatch(/async function revealNote[\s\S]{0,700}setRevealNoteId\(id\);/);
    expect(WORKSPACE_SRC).not.toMatch(/async function revealNote[\s\S]{0,700}startEditing\(/);
    expect(WORKSPACE_SRC).toContain("is-revealed");
  });
});
