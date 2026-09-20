# 移动端能力对账（260920）：表格 / 多维表 / 画板 / 小记

> 起因：连续三批大功能（表格 kind=sheet、多维表 kind=bitable、独立画板 kind=board）与「小记内核化重做」都是桌面优先，
> 用户要求盘一遍移动端还缺什么并补齐。本文 = 对账结论 + 本轮已做 + 仍缺（按价值排序）。
> 相关：`HANDOFF.md` §2.14（本批交接）· §8（移动端专职交接，由移动端会话维护）· `docs/QUICK-NOTES-SPEC.md`。

## 一、总览（本轮前 → 本轮后）

| 能力 | 本轮前（移动端） | 本轮后 | 仍缺 |
|---|---|---|---|
| 表格 `kind=sheet` | **完全看不到**（占位「暂不支持在移动端编辑」） | **只读网格**：值/粗斜体/字色底色/对齐/合并单元格/行列号 + 吸顶表头 + 横向纵向滚动（上限 500×60，超出提示） | 公式求值、单元格图片、条件格式、冻结窗格、**编辑** |
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
2. **移动端新建 sheet / bitable / board**：现在是「桌面创建、移动端只读」。要做成完整端，需要：创建入口（目录 + 新建菜单/首页）、以及各自的**移动端编辑**能力（表格=FortuneSheet 或自研编辑、多维表=录入、画板=绘制）。
3. **表格 100% 保真（可选）**：把 FortuneSheet 也打进移动端（懒加载独立分包 ≈ +0.5MB gzip）即可拿回公式/图片/条件格式/冻结窗格；需要你决定是否接受这个体积。
4. **AB 多端 S3 往返**（画板图片 / 表格 / 多维表 / 小记资源）仍未测 —— 与桌面批次点名的 AB 同步是同一件事，建议一起做。
5. **移动端小记工作台的桌面能力**：小记→正式文档、批量选择、置顶/列表视图等（桌面 `QuickNotesWorkspace` 已有）。
