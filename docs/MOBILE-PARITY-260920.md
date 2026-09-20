# 移动端能力对账（260920）：表格 / 多维表 / 画板 / 小记

> 起因：连续三批大功能（表格 kind=sheet、多维表 kind=bitable、独立画板 kind=board）与「小记内核化重做」都是桌面优先，
> 用户要求盘一遍移动端还缺什么并补齐。本文 = 对账结论 + 本轮已做 + 仍缺（按价值排序）。
> 相关：`HANDOFF.md` §2.14（本批交接）· §8（移动端专职交接，由移动端会话维护）· `docs/QUICK-NOTES-SPEC.md`。

## 一、总览（本轮前 → 本轮后）

| 能力 | 本轮前（移动端） | 本轮后 | 仍缺 |
|---|---|---|---|
| 表格 `kind=sheet` | **完全看不到**（占位「暂不支持在移动端编辑」） | **只读网格**：值/粗斜体/字色底色/对齐/合并单元格/行列号 + 吸顶表头 + 双向滚动（上限 500×60）**+ 图片叠层**（`sheets[].images[]` 按像素几何锚到单元格） | 公式求值（只显示已存显示值）、条件格式、冻结窗格、**编辑** |
| 多维表 `kind=bitable` | 占位 | **只读视图**：多表切换 + 视图口径（筛选/排序/隐藏列/列顺序）+ 选项色块 + 附件缩略图 + 「只读」角标 | 编辑、表单视图、记录详情抽屉、单元格范围复制 |
| 画板 `kind=board` | 本轮早些时候补了**只读查看器** | 只读查看器 + 图片走本机 AssetServer（`fitOnInit` 打开即自适应） | 移动端**新建**画板；画板图片依赖 AB 同步（未测） |
| 小记（Quick Notes） | 纯 `textarea` + 图片列表；保存会用 `quickNoteBodyFromTextAndImages` 合成正文 ⇒ **把桌面端排版的富内容压平** | **完整编辑**：桌面同款内核编辑器（白名单工具条：图片/待办/有序/无序/分割线）+ 附件按类型成卡（视频/音频/图片/附件）+ `body/text/images` 与桌面 `.qnote` v2 同格式；卡片预览改用桌面同一套只读渲染器；纯文本未变时**不再压平 body** | 「小记→正式文档」转换入口、批量操作、置顶/列表视图等桌面工作台能力；音视频/PDF 附件未实测 |

## 二、本轮顺手修掉的**隐形问题**（非 doc 的搜索与缓存口径）

桌面 `Store.searchTextFor` 一直按 kind 分派，但移动端是 `text_cache ?? lakeHtmlToPlain(content)` ⇒ **同步过来的表格/多维表/画板在移动端 FTS 索引里全是 JSON 碎片**（搜 `drawnix`、`activeTableId` 这类键名都能命中）。
本轮把口径收成单一来源 `src/core/noteSearchText.ts`（`searchTextForKind`），桌面 `Store.searchTextFor` 与移动端**搜索索引 / 保存 / 历史恢复**共用：

- 表格 → 单元格文本（`sheetToSearchText`）；多维表 → 表名+字段值（`bitableToSearchText`）；画板 → 图形/文本/导图节点文字（`boardToSearchText`）；
- 移动端 `noteRepository.saveNote`（含**历史恢复**路径）先查 `doc_kind` 再派生，JSON 不再进 `text_cache`；
- 单测 `src/mobile/searchIndex.test.ts` 新增一条：三类非 doc 的**正文文字能搜到**、**JSON 键名搜不到**。

## 三、移动端小记「完整编辑」实现口径（与桌面共用同一套）

- 写作区 = 桌面 `src/features/quickNotes/QuickNoteEditor.tsx`（**同一个组件**）：一个 Lake 内核实例 + 小记白名单工具条；
  `disableVirtualRendering: true`（小记没有内核内部滚动容器，虚拟渲染会量错视口 —— 桌面 260919 踩过）。
- 附件按类型成卡：内核 file input → 我们的 `uploadResource` → `bridge.stageQuickNoteAsset` 落盘 `quick-notes/{id}/{资产名}`
  （**移动端没有桌面那套 staging/draft-journal 基建，编辑目标 id 一开始就已知 ⇒ 直接写正式目录**；取消编辑留下的文件由既有孤儿/GC 回收）。
  `installMediaCardCategoryRouter` 由 `QuickNoteEditor` 挂载 ⇒ mp4→视频卡、mp3→音频卡、png→图片卡、其它→附件卡（与文档侧同一模块）。
- 保存：内核 `text/lake`（body）+ 纯文本镜像 + **按正文引用派生**的资源清单（`extractAssetRefs` → 会话元数据 ∪ 已有清单 ∪ 读回文件兜底），
  `bridge.saveQuickNoteContent` 落库（preview/hash/updated_at + 同步标记）；保存前等本会话上传归零（最多 15s，与桌面同口径，避免「有资源无卡」）。
- 卡片预览：`QuickNotePreview`（桌面同一套白名单渲染）+ 移动端 import 小记样式；点卡片**图片区域也打开编辑**（不让预览抢走卡片点击）。
- 图片放大：`MobileApp` 现在挂了共享 `<ImageLightbox />`（此前只 import 了样式、没挂组件）。

## 四、实测（Android 模拟器 lake_mobile / API36，真实 dev 数据；测试数据验证后已删除）

| 验证项 | 结果 |
|---|---|
| 表格只读视图 | ✅ 打开 `kind=sheet` 笔记 → `.mst-grid` 渲染全部单元格（季度预算/差旅报销/1,200/张三…）、4 行号 + 3 列号、只读角标；**0 个 Lake 编辑器** |
| 多维表只读视图 | ✅ 表头 名称/状态/金额、2 条记录、选项色块（进行中/已完成，用共享 `optionChipStyle` 保证对比度）、只读角标；0 个 Lake 编辑器 |
| 小记卡片富预览 | ✅ 一条含 标题/有序列表/引用/加粗 的小记，卡片渲染出 `.quick-note-preview`（heading ✓ / 2 个列表项 ✓ / 引用 ✓ / 加粗 ✓） |
| 小记完整编辑 | ✅ 新建 → 内核编辑器（白名单工具条 5 项 + 展开）→ 输入文字 → **粘贴 PNG**（走内核上传 → 我们的 stage）→ 保存 |
| 落库形态 | ✅ `quick_notes.content`：`text`=文字、`body`=内核正文（含图片卡、引用资源文件名）、`images`=1 条（filename/mime/size/120×80）；文件写进 `quick-notes/{id}/` 并由 AssetServer 渲染出图 |
| 重开编辑 | ✅ 点卡片（含点图片区域）→ 编辑器加载已存富正文（文字 + 图片卡都在） |
| 报错 | ✅ 全流程 0 未捕获异常 |

证据截图：`/tmp/lake-board-evidence/mobile-sheet.png`、`mobile-bitable.png`、`mobile-qn-preview.png`、`mobile-qn-editor.png`、`mobile-qn-edit-reopen.png`。

## 五、下一步（按价值排序，待用户拍板）

1. **小记附件实测**：图片已验；音视频/PDF 走的是同一个内核 file input（WebView 里能拉起系统文件选择器），建议真机点一次确认四类卡都对。
2. ~~移动端新建 sheet / bitable / board~~ **用户 260920 定稿：先不做，除文档外一律只读。**
3. **表格 100% 保真（可选）**：把 FortuneSheet 也打进移动端（懒加载独立分包 ≈ +0.5MB gzip）即可拿回公式求值/条件格式/冻结窗格；需要你决定是否接受这个体积。
4. **AB 多端 S3 往返**（画板图片 / 表格 / 多维表 / 小记资源）仍未测 —— 与桌面批次点名的 AB 同步是同一件事，建议一起做。
5. **移动端小记工作台的桌面能力**：小记→正式文档、批量选择、置顶/列表视图等（桌面 `QuickNotesWorkspace` 已有）。

## 六、表格图片（浮动图）在移动端的只读渲染 —— 260920

**存储事实（实测）**：桌面插入图片后，正文是 `sheets[].images[]`：
`{ id, src:"data:image/png;base64,…", left, top, width, height, originWidth, originHeight }` ——
`left/top` 是**相对网格内容原点（A1 左上）的像素**，FortuneSheet 已经算好；`src` 目前仍是 base64 内联
（`docs/SHEET-IMAGE-MANAGEMENT-260919.md` 的 P1「落资产管线」尚未实施）。

**实现（≈0.5 天，不引依赖、不动数据格式）**：
- 纯核心 `src/core/sheetDoc.ts`：`sheetImages(sheet)` 归一化浮动图（过滤非法项/按 id 去重）+ `sheetImageSrc(src, noteId)`
  解析器（`data:`/`http:` 原样；**filename 形态拼 canonical URL ⇒ 桌面 P1 落地后渲染层零改动**）；
- 移动端 `MobileSheetViewer`：在表格滚动容器里加**图片叠层**，偏移量用**实测的网格原点**
  （`ResizeObserver` 量 A1 相对画布的位置，兜底 44/30）而不是写死常量 —— 实测同时修掉了行号列被通用 `th`
  规则撑到 84px 的问题（`.mst-grid th.mst-row-head` 提高优先级后回到 44px）；
- 图片超出数据范围时按图片范围撑开画布（只求"看得见图"）。

**实测（模拟器）**：种一张锚在 A1、显示 80×50 的图 ⇒ `.mst-image-layer` 存在、图片渲染成功；
图片矩形与 A1 单元格**逐像素对齐**（`alignedX=0, alignedY=0`）。截图 `/tmp/lake-board-evidence/mobile-sheet-image.png`。

## 七、长按桌面图标 → 闪念速记（260920，对齐思源）

**参考实现（`/Users/admin/file/local-lake/siyuan-android-main`，AGPL-3.0，仅参考不抄代码）**：
- 入口两条腿：① **静态 App Shortcut** `res/xml/shortcuts.xml`（`shortcutId=shorthand`，`action=VIEW` + `data="shorthand"`，
  `targetClass=ShortcutActivity`，专用图标 `@drawable/shorthand_icon`，short/long label 同文案）；② **应用内「添加到桌面」**
  （`ShortcutManager.requestPinShortcut` + `getPinnedShortcuts()` 判断是否已固定 ⇒ 已固定就隐藏按钮；固定后延迟 1s 复查并给成功/失败提示）。
  **没有按品牌分支的黑魔法**：`flavors.gradle` 的 cn/googleplay/huawei/official 只是商店分发渠道，与长按无关。
- 体验：`ShortcutActivity` 是**独立轻量 Activity**（原生 `EditText` + 提交，**不走主 App/WebView**），
  `launchMode=singleTask` + `taskAffinity=…shorthand`（独立任务栈）、键盘自动弹、透明状态栏/刘海屏适配；
  **草稿**用 `ShorthandDraftStore`（250ms 防抖 + `onStop` flush + 提交后清空）⇒ 进程被杀也不丢；
  提交写 `{timestamp}.md`（AtomicFile：tmp→rename）到 `shorthands/` 目录，内核每 7 秒转入文档；
  同一 Activity 还接 `ACTION_SEND`（文本/图片/音视频/文件）⇒ 也是系统分享目标。
- 语义差异：思源的闪念速记是「**本地暂存 → 自动追加/生成到指定文档**」（路径模板可配），
  本项目的对应能力是**小记**（Quick Notes，独立库 + 随时预览/编辑）⇒ 我们把快捷方式落到「新建小记」。

**我们的实现（v1）**：
1. `res/xml/shortcuts.xml`：`quick-note` 静态快捷方式（`action=VIEW` + `data=lakenotes://quick-note`，label「闪念速记」）；
2. `AndroidManifest.xml`：launcher activity 挂 `android.app.shortcuts` meta-data + 注册 `lakenotes://` 深链 intent-filter；
3. JS：`src/mobile/quickNoteShortcut.ts` 统一收口 —— **冷启动** `App.getLaunchUrl()`（启动瞬间可能还没就绪 ⇒ 前 3 秒短轮询重试）
   + **热启动** `App.appUrlOpen`；命中即让 `MobileApp` 切到「小记」标签并请求 `HomePage` 直接打开新建写作区；
4. **机型兜底（对齐思源第 ② 条）**：新增原生插件 `PinShortcutPlugin`（`isAvailable` / `isPinned` / `requestPin`），
   设置 → 编辑器 →「闪念速记快捷方式」在「可固定且未固定」时显示 **「添加到桌面」**（系统会弹确认框）。

**实测（模拟器 API36）**：
| 验证项 | 结果 |
|---|---|
| 静态快捷方式注册 | ✅ `adb shell cmd shortcut get-shortcuts` 列出 `id=quick-note`、shortLabel=闪念速记、longLabel=闪念速记：直接写一条小记、intent=VIEW→MainActivity |
| 冷启动 | ✅ `force-stop` → `am start -a VIEW -d lakenotes://quick-note` ⇒ 直接进入「小记」标签 + 新建写作区（内核编辑器已挂） |
| 热启动（后台 → 再触发） | ✅ 回到前台并打开新建写作区（输入框为空，不串上一次内容） |
| 机型兜底「添加到桌面」 | ✅ `PinShortcut.isAvailable()={available:true}` → `requestPin()`={requested:true} → 系统弹出「闪念速记 / Add to home screen」确认框（截图 `/tmp/lake-board-evidence/mobile-pin-dialog.png`）→ 确认后 `cmd shortcut` 该条目 flags 变为 **`Pin`**（已固定到桌面） |
| 报错 | ✅ 全流程 0 未捕获异常 |

> **踩坑（重要）**：订阅不能用 `hasNativeBridge()`（它判的是 `window.lakeNative`，而移动端这个调试契约是在
> MobileApp 启动流程**之后**才注入的）⇒ 冷启动瞬间判假、订阅被跳过，长按图标永远不生效。改成按
> `window.Capacitor.isNativePlatform()` 判断后正常（`quickNoteShortcut.ts` 里有注释）。

**与思源的差距（可选下一步）**：思源是「原生轻量 Activity 秒开 + 草稿 + 文件暂存 + 内核每 7 秒转入」，
冷启动不等 WebView/内核；我们 v1 是「深链 → App → 内核小记编辑器」，冷启动约 1–2s。
要做到思源那种"秒开输入框"，需要：原生 Activity（输入框 + 草稿 + 提交写入 inbox 目录）+ App 侧启动时把 inbox 导入为小记，
估 **1–1.5 天**；另外系统分享（`ACTION_SEND` 文本/图片 → 小记）约 **0.5 天**（思源两个入口都做了）。

**v1.1（260920 续，轻量速记框）**：深链那条路径已从「内核小记编辑器」改为 **不挂内核的轻量速记框**
（`src/mobile/home/QuickNoteFlashComposer.tsx`：`textarea` + 图片、不可展开），冷启动不再等内核 bundle/实例化；
工作台里的「新建小记」/「编辑」仍是完整内核编辑器。上面的「与思源的差距」只剩原生 Activity 秒开 + 草稿 + 系统分享。
- **正文口径（核实结论）**：内核**没有**"不建实例就把文本转成 Lake 正文"的能力（`setDocument('text/*')` 要编辑器实例、
  `markdownStream` 要阅读器实例；见 `docs/LAKEX-CONTRACT.md` §5.12.10）⇒ 轻量框走无内核写入者唯一被认可的通道
  `core/quickNoteModel.quickNoteBodyFromTextAndImages` → `core/lakeDocForm`（`<p>` + 图片 `<card>`，无裸 `<img>`）。
- **护栏**：`src/mobile/home/quickNoteFlashComposer.test.ts`（零内核/不可展开/保存通道/路由分工的源码级断言）。
- **修掉一个真 bug（260920 CDP 复现）**：`subscribeQuickNoteShortcut` 原先用**永久布尔量**去重冷启动的"双触发"
  （`getLaunchUrl` + `appUrlOpen`）⇒ **一次冷启动之后，进程存活期间再长按图标（热启动 appUrlOpen）被永久忽略**
  （第二次长按无任何反应）。改为 **1.5s 短窗口去重**（只压同一次点击的两条路径），并补行为护栏
  `src/mobile/quickNoteShortcut.test.ts`（冷启动触发 → 立即重复被去重 → 1.5s 后热启动仍能触发）。

**v1.2（260920 续，冷启动提速）**：把「深链 → WebView → 轻量框」的冷启动从 **~1.3s 压到 ~0.30–0.43s**（模拟器 API36 实测 3 次）。
- **先量再改（关键）**：`bridge.init()` 只 **87ms**、`refreshAll()` 只 **11ms** —— 真正的大头是 **WebView + JS bundle**：
  入口 chunk **6.7MB**（含整个 Lake 内核）+ React 挂载 ≈ **712ms**。原以为要拆 `bridge.init/refreshAll`，量完发现方向错了。
- **① 内核按需加载**：`MobileApp → NotebookWorkspace`、`HomePage → QuickNoteComposer`、`SettingsDrawer → TrashPreviewPage`
  三条**静态**路径把内核拖进入口；全部改 `React.lazy` 后 **入口 6.7MB → 80KB**，内核进独立懒 chunk（不 modulepreload），
  `effectStart` **712 → ~200ms**。
- **② 闪念速记独立入口**：轻量框改挂 `MobileApp` 的 `captureOpen` 分支，**在 `bridge.init()/refreshAll()` 之前**渲染
  （保存时才 `ensureDb()`；返回键先关它）。实测 `initDone = null`（框已能输入时 DB 还没打开）。
- **实测**：`appMsToFlash` **305 / 337 / 428ms**（改前 ~1250–1500ms）、`flashMount` 214–248ms（改前 ~850ms）。
- **⚠️ 踩坑**：**不要**用 rolldown `codeSplitting.groups` 给 `\@dlient/lakex-doc-react` 分组 —— 实测会把 vendor 内部
  `DrawnixBoardCore` 懒 chunk 的 export 绑定拆坏，打开编辑器即 `SyntaxError: Export '..._exports' is not defined in module`、
  整页白屏。正确做法是**懒加载边界**；已加护栏 `src/mobile/mobileLazyChunks.test.ts` 卡住这三条 lazy 与"别加分组"。
