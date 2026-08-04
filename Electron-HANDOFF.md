# Lake Notes Electron — 交接文档

> **读者：完全没有本项目上下文的新会话。**
>
> 建议阅读顺序：
> 1. 本文；
> 2. `docs/PROGRESS.md` 的「★ 最新交接」；
> 3. 涉及小记时阅读 `docs/QUICK-NOTES-SPEC.md`；
> 4. 真实桌面端验证前阅读 `docs/CODEX-GUIDE.md`；
> 5. 数据与同步改动前阅读 `docs/ARCHITECTURE.md`。

---

## 1. 项目与本次任务概况

- 项目目录：`/Users/admin/file/local-lake/lake-notes-electron`
- 远程：`origin = https://gitee.com/gtycoder/local-lake.git`
- 交接日期：2026-08-04
- 本次目标：为 Electron 桌面端实现并验收 **小记 V1**；它是本地优先、无标题、手动保存、按创建时间倒序展示的临时时间线，而不是 Lake 文档或 Lake 编辑器的另一种皮肤。
- 当前分支与基线：`master`。
- 本轮已完成并推送：`410a570 feat: add isolated quick notes workspace`（`origin/master`）。

### 已确认的产品定位

小记用于短、碎、临时的记录；绝大多数小记会被删除，少量有价值的内容才转为正式 Lake 笔记。

已确认边界：

- 无标题，不能把首行隐式提升为标题；转为正式笔记后再由用户补充主题。
- V1 只支持多行纯文本与图片；不做富文本、Markdown 解析、列表、待办、附件、网页收藏卡片。
- 手动点击“记下”才持久化；不自动保存、不做草稿恢复。放弃未保存内容可以接受，但离开、取消或关闭窗口前必须确认。
- 不做标签、统一搜索、移动端入口、回收站。
- 删除后仅提供 5 秒 Undo。
- 小记与 Lake 数据、资源、SQLite、S3 Manifest、搜索空间必须独立；**小记 → Lake 的单向转换是唯一交集**。
- 转换只选择笔记本；新正式文档固定插入笔记本顶部，用户可在资料库自行调整位置。

---

## 2. 已完成内容

### 2.1 UI 与交互

- 桌面左侧活动栏新增“小记”入口，使用 `Feather`（羽毛）图标；资料库入口及原有 dock / collapse 行为保留。
- 新增 `src/components/QuickNotesWorkspace.tsx`：
  - 无标题创建卡片；
  - 多行纯文本输入；
  - 图片选择、拖入、粘贴；
  - 手动“记下”；
  - 创建时间倒序时间线；
  - 卡片原地编辑；
  - 删除与 5 秒撤销；
  - “转为正式笔记”笔记本选择弹窗。
- 卡片“编辑小记”使用 `Pencil`（铅笔）图标，避免与“记下/保存”语义混淆。
- 小记页不渲染 Lake 的多标签栏；为它增加了 `quick-notes-titlebar`：一个独立的、窗口全宽的 macOS 标题栏拖拽层。它使用 `-webkit-app-region: drag`，解决了小记内容覆盖窗口顶部而无法拖拽窗口的问题。
- 小记样式只使用 `.quick-*` 和 `.app-shell.quick-notes-active`，没有修改 Lake 的 `.ne-*` 或 Slate 内部选择器。

### 2.2 本地数据与资源隔离

本地数据目录（位于 `workspace-default/` 下）：

```text
quick-notes/
├── metadata.sqlite3
├── items/{quickNoteId}.qnote
├── assets/{quickNoteId}/{filename}
└── staging/{draftId}/{filename}
```

- `electron/quickNotes.ts` 管理独立 SQLite 和 `.qnote` 内容文件。
- 相关表：`quick_notes`、`quick_note_assets`、`quick_note_sync_base`、`quick_note_deleted`、`quick_note_conversions`。
- 图片格式：PNG / JPEG / GIF / WebP / AVIF；单张上限 25 MiB；保存、导入、同步都会校验 hash 和大小。
- 小记资源路由必须保持独立：
  - `/quick-notes/{quickNoteId}/{filename}`
  - `/quick-notes/staging/{draftId}/{filename}`
- 正式 Lake 图片继续使用 `/{noteId}/{filename}`，两者不能混用。

### 2.3 小记 → Lake 单向转换

- 转换隔离层：`electron/quickNoteConversion.ts`；这是唯一允许同时理解小记格式与 Lake inline image card 序列化的模块。
- 正式文档标题格式：`未命名文档 · YYYY-MM-DD HH:mm`（本机时区、分钟精度）。
- 图片转换策略：**复制**小记图片到 `note-assets/{targetNoteId}/`，不会移动源图片。
- 文本转换策略：小记的每个物理换行生成一个独立 Lake `<p>`；空行生成空段落。不要把换行重新写成同一段的 `<br />`。
  - 原因：同一段的 `<br />` 在 Lake 中切换有序/无序列表时会成为一个列表项内的软换行；独立段落才能正确变成多个列表项。
  - 注意：此修复只对**新转换**的小记生效；不要无提示批量改写历史正式文档。
- 跨两套 SQLite 的转换 journal：

```text
prepared → target_created → source_deleted_waiting_sync → complete
```

- 启动时 `quickNotes.recoverConversions()` 恢复中断转换；没有正式元数据的 Lake 半成品会被清理。

### 2.4 正式笔记顶部插入能力

- `electron/store.ts` 新增 `createNoteInAtTopWithContent()`（及私有通用实现）。
- 同一 SQLite 事务中同步后移 `tree_nodes.sort_order` 与 `notes.sort_order`，然后将新笔记放到顶部。
- 普通新建笔记仍是底部追加；该能力以后可扩展为“新建文档默认顶部/底部”的用户偏好。

### 2.5 小记 S3 同步

Lake Manifest v2 保持不变。小记只使用 `{prefix}/quick-notes/` 的独立空间：

```text
quick-notes/
├── objects/{contentHash}.qnote
├── assets/{quickNoteId}/{filename}
└── manifests/latest.json       # 小记 Manifest v1
```

- 实现：`electron/quickNotesSync.ts`。
- 主进程顺序：Lake `syncNow()` 成功 → `markTargetNotesSynced()` → 小记同步。
- 小记同步失败写入 `result.quickNotes.error`，不能把已经成功的 Lake 同步改判失败；组合结果会写回 `device_state.last_sync_result` 供 SyncPanel 展示。
- 转换源小记的 tombstone 在目标 Lake 成功同步前保持 `ready_to_sync=0`：
  - 不上传该删除；
  - 不从远端下载源小记把它复活；
  - 新 Manifest 必须保留远端源条目，防止 Lake 未成功前误删除远端小记。
- 两端同时编辑同一小记时，保留本地版本，并将远端版本导入为可见的冲突副本。

---

## 3. 本轮验证与用户验收

已通过：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm test                                  # 111/111 passed
npx tsc --noEmit                          # passed
node node_modules/vite/bin/vite.js build  # passed
git diff --check                          # passed
```

真实 Electron / Playwright 回归已经覆盖：

1. 进入小记工作台；
2. 保存一条图文小记；
3. 原地编辑并再次保存；
4. 转为指定笔记本中的正式 Lake 文档；
5. 目标文档出现在目录顶部，转换后的 inline image 正常加载；
6. Lake 编辑、保存、重启后内容与图片仍保留；
7. 源小记已从时间线移除；
8. 多行小记转换后，使用 Lake 有序/无序列表可得到独立列表项；
9. 小记页顶部可正常拖动 macOS 窗口。

用户在 2026-08-04 的最终验收结论：小记本轮功能、图标、文本转换、窗口拖拽以及上次会话残留的样式问题均正常。

---

## 4. 当前问题 / 已知限制

没有已知阻塞性问题。

后续继续前需要知道的限制：

1. 小记同步协议已由 mock 对象存储测试覆盖上传、下载、幂等、删除、冲突和转换等待期，但本轮没有使用真实 S3 凭据再跑双端端到端验证。
2. V1 刻意不支持标签、统一搜索、富文本、列表、待办、附件、网页收藏、移动端入口；不要把这些当作遗漏直接补入。
3. 历史上已经通过旧 `<br />` 规则转换出的正式 Lake 文档不会自动迁移，避免静默改动用户的正式笔记。
4. 应用尚未完成签名和公证；发布流程见 `docs/RELEASE.md`。
5. Lake 编辑器自身的既有边界问题、历史优化和更多背景在 `docs/PROGRESS.md`、`docs/TROUBLESHOOTING.md` 中维护。

---

## 5. 下一步计划（按优先级）

### P0：仅在用户继续提出需求时进行

- 使用用户提供的真实 S3 配置进行小记双端上传、下载、删除、冲突与“转换后等待 Lake 同步”的完整验收。
- 如果要增加新的小记能力，先确认产品定位是否仍是“临时记录”；随后先更新 `docs/QUICK-NOTES-SPEC.md`，再实现。

### P1：已明确但暂缓的候选能力

- 利用现有顶部插入底层能力，设计 Lake 新建文档默认插入顶部/底部的用户偏好。
- 评估小记标签或简单筛选；不是 V1 必需项，复杂度高时继续不做。

### P2：不要主动开启

- 小记富文本、Markdown/列表解析、待办、附件、网页收藏、统一搜索、移动端小记入口。
- 这些会明显改变小记的临时记录定位，并可能迫使小记复用 Lake 编辑器或数据结构；必须先重新做产品与隔离设计评审。

---

## 6. 踩过的坑与强制约束

### 6.1 不能碰的 Lake 编辑器边界

除非用户明确授权并做专项真实回归，禁止修改：

```text
src/features/editor/LakeEditor.tsx
src/features/editor/EditorTab.tsx
src/features/editor/lakeRuntime.ts
```

不要新增或覆盖：

```text
.ne-*
Slate 内部选择器
Lake 工具栏 / 卡片 / 表格 / 虚拟渲染内部行为
```

小记不能写入 Lake 的：

```text
metadata.sqlite3
notes/
note-assets/
Lake Manifest v2
Lake 搜索空间
```

唯一例外是转换隔离层明确执行的“新建正式 Lake 文档并复制图片”。

### 6.2 图片和转换的坑

- 小记图片没有保存前位于 `staging/{draftId}`；离开、取消和关闭都要在确认丢弃后清理 staging。
- 转换时是复制资源，不是移动；任意失败都不能留下错误引用或过早删除源数据。
- 文本换行必须序列化为**多个段落**，不是 `<br />`；这是 Lake 后续列表语义的关键。

### 6.3 同步的坑

- 绝不能把小记对象塞进 Lake Manifest v2，也不能因小记同步失败否定 Lake 已成功的同步。
- 转换 tombstone 的 `ready_to_sync=0` 等待期是防数据丢失的关键；不要为了“尽快清理”移除它。

### 6.4 桌面窗口与验证的坑

- Lake 页面通过 `.tab-bar` 提供 `hiddenInset` 模式的顶部拖拽区域；小记页没有标签栏，`quick-notes-titlebar` 不能删除，否则顶部拖拽会再次失效。
- 真实 GUI 问题优先按 `docs/CODEX-GUIDE.md` 用 Playwright `_electron` 验证。不要只看单测或静态 HTML。
- 不要使用 `pkill -f Electron`，会误杀其他 Electron 应用。开发环境如需结束本项目，只按项目进程名精确处理。
- 真实 GUI 测试会写入开发 userData；测试结束后必须清理测试小记/正式笔记/图片，并确认没有残留。

---

## 7. 关键文件索引

```text
src/App.tsx                           # 工作台切换、活动栏、小记标题栏拖拽层、转换后打开正式文档
src/components/QuickNotesWorkspace.tsx# 小记卡片/草稿/时间线/图片/转换 UI
src/styles.css                        # .quick-* 样式、quick-notes-titlebar
src/lib/native.ts                     # 小记 IPC renderer 封装
src/lib/types.ts                      # 小记类型定义

electron/main.ts                      # 小记 IPC、同步编排、启动恢复
electron/preload.cjs                  # 小记 IPC 暴露
electron/quickNotes.ts                # 独立 SQLite、.qnote、资源与转换 journal
electron/quickNoteConversion.ts       # 小记 → Lake 的唯一序列化隔离层
electron/quickNotesSync.ts            # 独立小记 Manifest v1 同步
electron/assetServer.ts               # /quick-notes/ 资源路由
electron/store.ts                     # 正式笔记顶部插入能力

docs/QUICK-NOTES-SPEC.md              # 小记产品和技术规格（扩展前先更新）
docs/ARCHITECTURE.md                  # 系统数据/同步架构
docs/PROGRESS.md                      # 进度、历史交接与验证记录
docs/CODEX-GUIDE.md                   # 真实 Electron / Playwright 操作方式
```
