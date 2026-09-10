# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（长期红线/机制/坑，每次自动加载）→ 相关 `docs/`。
> 历史所有 dated handoff 已合并进本文件（内容在 git 历史可查）。本文件只保留**当前状态 + 真正的待办 + 有价值的坑**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 当前基线（新会话开工前）
- 分支/远端：开发主干 `master` ↔ Gitee `origin`（`git@gitee.com:gtycoder/local-lake.git`，SSH 可用；`master` 亦是远程默认分支）。**本文不写死 commit hash**——查 `git log -1 --oneline`。
- 质量门槛：`tsc` 0 error · vitest **904 passed / 15 skipped** · 桌面 `vite build` + 移动 `vite build -c vite.mobile.config.ts` 全绿（计数变动见 §2；别把数字写回 AGENTS/README）。
- **当前业务分支：`refactor/mobile-native-sqlite`**（本轮已提交）；`master` 仍是主干。`git worktree list` 目前只有主目录。
- **开工先跑 `git status` + `git worktree list`**：当前工作区遗留是**非本轮代码**：`AGENTS.md`/`README.md` 被改（未提交）+ `docs/{CODE-AUDIT-20260909-FULL-CODE-AUDIT,LAKEX-CONTRACT,OBSIDIAN-PLUGIN-*,SYNC-RELIABILITY-VERIFY}.md` 未跟踪 + 一个乱码文件 `", v)"`。**别把遗留卷进你的提交**（用显式路径 `git add`）。
- dev 实例状态：**桌面 `npm run dev` 未启动**（本会话未跑）。**安卓模拟器 `emulator-5554` 在跑**，App `com.lakenotes.mobile` 已装**最新移动端 bundle**（用 `bash scripts/android-build.sh --sync --install`，gradle 用 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/…` 缓存、勿走 wrapper）。WebView CDP 已转发 `tcp:9335`（http://127.0.0.1:9335/json/list）。**注意：socket 随 App 重启变化**——先 `adb forward --remove-all`，再 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+"` 找新 socket，`adb forward tcp:9335 localabstract:$s` 后 `curl /json/list` 校验。
- **dev 数据现状（重要）**：
  - `welcome-note`（幽灵文档）已一次性清理：墓碑 `deleted_notes(welcome-note, note, purged_at=now, published_at=NULL)` 已写、行与文件已删 ⇒ **下次同步会发布 `deleted:true` 并删云端 `objects/welcome-note-*`、`assets/welcome-note/` 前缀**，之后不会复活。
  - `到啦领导`（ee860a19）仍在回收站里（`trashed_at=09-04 10:34`，原父=测试本2222，正文含用户 18:06 的编辑「测试老师啦啦队」）；**用户尚未决定是否恢复**，别擅自删。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 43 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。移动端另有铁律见 **§8.0**。

## 2. 本轮已完成

### 2.9 移动端原生 SQLite 收口（260910）
- **生产存储已切到 Android native SQLite（WAL）**：`src/mobile/bridge.ts` 用共享初始化 Promise 打开 `NativeSqliteDb`；`sql.js` 不再承担生产写入；旧 IndexedDB 快照只作为一次性迁移源，不再写入。
- **共享行为契约**：嵌套文档树删除/恢复、资源大小上限、小记同步/墓碑/恢复/冲突归档已在桌面与移动两侧锁定；GC keep set 统一走 `src/core/gcDecisions.ts`。
- **跨端契约收敛**：删除 `src/core/maybeAsync.ts`，`SyncDbPort` / `QuickNotesSyncDbPort` 明确 `Promise`；桌面 adapter 显式 async。`DbLike`、`NoteQueries`、`TrashRepository`、`SearchRepository` 移到 `electron/`，`src/core` 不再共享同步 SQLite 形态。
- **模拟器验证**：最新分支构建安装到 `emulator-5554`；启动、5 笔记 / 3 分组 / 2 小记数据、进程强停重启后数据持久化均通过。资源限制实测：100 MiB+ 附件、25 MiB+ 图片均在落盘前拒绝，无资源残留。
- **门禁**：`tsc` 0 error；vitest **904 passed / 15 skipped**；Android `:app:testDebugUnitTest` + `assembleDebug` 通过；移动 Vite 构建通过。桌面构建仍按需在合并前跑。

### 2.0 移动端 UI 全面对齐思源 B1–B6（260908，见 `docs/MOBILE-UI-SIYUAN-AUDIT-260908.md`）
- **审计**：38 项发现（结构/弹层/手势/图标/动效/色彩排版/第一层/编辑器 8 个维度），每条带思源源码出处（`_mobile.scss` / `template/mobile/index.tpl` / `util/touch.ts` / `touchPanelGesture.ts` / `menus/Menu.ts` / `dialog/message.ts`）。
- **B1 度量与令牌**：`--mobile-*` 骨架度量 + 动效令牌；栏内图标按钮 48×48/20px 图标；列表 16px/40px/18px（`.b3-list--mobile`）；硬编码 rgba/hex → `--b3-*`；滚动条隐藏；reduced-motion 补齐；删 `.med-toolbar` 的 `transition: bottom`。
- **B2 弹层三件套**（新 `src/mobile/ui/`）：`MobileSheetMenu`（`.b3-menu--fullscreen.--sheet`，56dvh、grabber、根层无标题、子菜单整屏下钻、危险项红色）、`ConfirmDialog`+`confirmMobile()`（`.b3-dialog`，替掉两处 `window.confirm`）、`Toasts`+`showToast()`（`.b3-snackbars` 右上滑入，替掉居中黑胶囊）；`backStack`（返回键按层消费）、`haptics`。
- **B3 第二层骨架**：**文档入口统一进 NotebookWorkspace**（删 `DocumentPage`/`NotebookPage` 两套旧壳；`openNote` 先用共享纯函数 `isGoneNote` 判回收站/purge，再向上解析归属笔记本 → 补上移动端一直缺失的 AGENTS §3 #16 守卫）；顶栏改 `.toolbar__title`（当前文档标题、编辑态可直接改名）+ 右侧同步；侧栏/大纲头改思源 `.toolbar` 行（标题 + 新建 + 箭头收起）；底部栏纯图标 5 槽（文档树/标签计数/大纲/编辑/更多）+ 编辑态下滑淡出；**层叠顺序对齐思源**（顶栏/底栏 z3、dock z1 < 遮罩 z6 < 面板 z7——此前顶栏 z10 盖住抽屉头、dock z60 盖住抽屉）；左右面板互斥。
- **B4 手势引擎**（新 `src/mobile/usePanelDrag.ts`，删 `useEdgeSwipe.ts`）：跟手开合抽屉（内容区任意横滑、轴锁定、面板 transform 跟手 + 遮罩透明度联动、`--swiping` 关动画、1/3 屏宽提交、可反悔、关闭方向才可拖），实测开/关双向跟手数据正确。
- **B5 第一层**：知识库宫格 → `.b3-list--mobile` 行（图标+名称+`.counter` 文档数+箭头）；小记白卡 → 平铺行（40 缩略图+摘要+日期）；首页 tab 加底部指示线；**去掉 FAB**，新建/同步进底部胶囊栏；空态补动作按钮。
- **B6 编辑器**：`.med-toolbar` 悬浮胶囊 → 思源 `.keyboard` 贴底直条（48px + border-top，无阴影）；面板贴底平铺；正文区不再重复标题输入框。
- 门禁全程绿：`tsc` 0 · vitest **838 passed / 15 skipped** · 桌面 + 移动 `vite build`。

### 2.1 桌面 UI 整体「精仿思源」（用户：设置-资源丑出天际 → 决定精仿思源）
### 2.1 桌面 UI 整体「精仿思源」（用户：设置-资源丑出天际 → 决定精仿思源）
- **可行性关键**：思源的组件 SCSS **早就 vendored** 在 `src/b3/siyuan/{util,component}` 并由 `main.tsx` 加载（`.b3-list-item`/`.b3-label`/`.b3-text-field`/`.b3-select`/`.b3-switch`/`.b3-button--outline` 全是活的）。丑的原因是设置面板/弹窗**没用它们**，自研了一套 `settings-*` + 大量内联样式。本轮是**接线**，不是新造。
- 新增 `src/b3/siyuan/business/_config.scss`（署名移植版式骨架：`config-group/title/items/item/name/block/readonly/stats/assets/empty`）；`siyuan.scss` 补挂 `util/function`（`fn__space/fn__size200/ft__error/fn__kbd` 此前根本没加载 = 死类名）。
- `SettingsPanel` 全量重写为 `Group/Item/Block/Switch/Seg/NumField/TextField/Shortcut` 原语；数字框不再拉成整行；GC 删除记录/待回收明细/日志改 `.config-readonly` 等宽框；体检结果 `.checks` 分行配色。
- 设置-资源 → 思源资源页语言（分组清单 + 状态徽章 + 单行省略 + **hover 才出现的图标操作** + 清单在上、大图预览在下）。
- HistoryPanel：孤儿文件 tab 改「左 320px 列表 + 右内嵌预览」，**删掉孤儿预览模态框**；TrashPanel：行改 `.b3-list-item` 两行密度 + hover 图标 + `.badge`。
- 搜索面板 / 同步状态 popover / 小记工作台一并收进同一套（小记原有**三层 hex 覆盖块**合并成一段令牌派生块，紫色身份改由 `--shell-hue` 派生）。
- 横向 tab 最终用**底部指示线**（轨道 hairline + 选中主色字 + 2px 下划线）：只给选中项灰底"看不出是两个 tab"，分段控件的阴影浮起又与全局克制风格冲突（用户两次反馈后定稿）。
- 删除全部失效旧层（`settings-group/row/choice/toggle/field/hint/body`、`shortcut-*`、`trash-item*`、`history-item*`、`trash-tabs/history-tabs/history-create/history-clean-all`、`quick-notes-trash-*`、`search-result*`、`b3/components.css` 里与 overlays 打架的重复规则）。
- 长期约束已写进 `AGENTS.md §3 #14`（版式语法 + 禁内联样式 + 设置行必须同步搜索注册表）。

### 2.2 设置页条目级搜索（对齐思源"每条设置都可搜到并定位"）
`settingsSearch.ts` 新增 `SETTING_ITEMS`（55 条：id + 分类 + 标题 + 同义词）与 `searchSettingItems`（多词=每词都命中）；行原语接 `itemId` → `data-set-id`；导航出「条目 · N 项」，点击/回车 → 切分类 + 滚动 + `.is-hit` 闪 1.5s，命中行留 `.is-match` 指示条。**故意不隐藏非命中项**（会被误读成设置被删）。反漂移单测比对源码 `itemId` 集合与注册表。

### 2.3 关于页重做（从两段文字 → 可核对的元信息面板）
新增只读 IPC `electron/ipc/registerSystemInfo.ts`：`get_system_info`（版本 / Electron·Chromium·Node / **pin 的依赖版本表** / 路径 / 存储概览 / 小记数）+ `reveal_data_folder(kind)`（**白名单枚举**，路径由主进程拼，未知 kind 抛 `IpcInputError`）。`store.getStorageOverview()` 只读概览。关于页五组：关于 / 版本与运行环境 / 数据与存储（四条路径 + 在 Finder 中显示）/ 诊断（**复制诊断信息**到剪贴板）/ 第三方与许可。明确**不做**：检查更新、危险操作集中区。

### 2.4 同步复活漏洞（用户报：资源页出现本地/回收站都没有的文档，资源既不能看也不能删）
- 证据链：`deleted_notes.notebook-personal`（folder 墓碑，`purged_at` 已被清空）+ `tree_nodes.welcome-note.created_at` **晚于 purge 88 秒** ⇒ purge 后被陈旧清单重新导入到**已不存在的父**下 → UI 不可见却仍在同步与占资源。
- **洞 1**：`isFolderPurged()` 看 `purged_at IS NOT NULL`，而 `markPurgeSynced()` 在前缀删除成功后会清空它 ⇒ 保护只活到下一次同步。改为**永久判定**（存在 `node_type='folder'` 墓碑）。
- **洞 2**：`purgeTrashItem` 里 `if (meta) tombstone.run(...)` —— `notes` 行缺失时跳过写墓碑 ⇒ 云端永不下架 ⇒ 必然复活。改为无条件写（元数据从 `tree_nodes` 兜底）。
- **诊断补位**：`runDataHealthCheck` 新增 `treeChecked` / `treeDanglingParent`；哈希比对限定只比 `sync_state='synced'`（原来本地未上传编辑天天误报"可能被外部改动"）。脏数据已一次性清理（见 §0）。

### 2.5 回收站里的文档竟然可编辑可保存（用户报，严重）
- 数据结论：**文档没坏也没复活**（`trashed_at` 未被清、无 `restore_pending_at`，编辑写进了回收站文档，可恢复）。"目录栏找不到"是正确行为，错在**毫无提示**。
- 三个洞：① 启动恢复按 `last_opened_note_id` 重开文档时**不校验回收站/purge**；② `tab.deleted` + 保存拦截**只在同步刷新路径设置**；③ `openNote` 复用标签分支**无条件 `deleted:false`** 会解开标记，且丢弃保存**静默 return**。
- 修法：新增 core 纯函数 `isGoneNote({parentId,syncState})`（打开与同步共用）；`openNote` 两条路径都判定；`tab.deleted` → 复用 `EditorTab.locked` 走 **viewer 只读** + 顶部横幅〔打开回收站〕；`onBlockedSave` 明确提示。恢复路径 `handleTrashRestored` 本就存在，无回归。红线写进 `AGENTS.md §3 #16`。

### 2.6 预览"初次切换闪一下"（实测定位，非猜测）
逐帧采样证实：切换时 `setPv(null)` 让预览区塌成一行「加载中…」文本（412→220→412，**192px 跳动**），冷读盘 ~48ms 正好被看见。修法：① 切换**保留旧图**，新图 `img.decode()` 后才替换；② 固定高度舞台 `.config-assets__stage{height:300}` + 说明行 `min-height:17`；③ 换图 `key` 重挂载 + `ln-preview-fade-in` 淡入。设置-资源与历史弹窗孤儿文件同治。修后实测高度全程恒定（352 / 474，0 跳变）。

### 2.7 上一轮（260903）摘要
里程碑 M1a–M6 全量落地（冲突收口、归档 30 天保护、回收站倒计时、数据体检、日志查看器、整库备份 A1 / 云端恢复 A2、审美 tokens）+ 两个 bug（凭空「未分类」、小记删不掉）+ S3 同步差集化性能（churn 18.4s→<1s、首传 240 图 HEAD→0、manifest 链 8→3）。细节见 `docs/MILESTONES-SYNC-UX-2026-09-03.md` 与 git 历史；不变量在 `AGENTS.md §3 #11~13`。

### 2.8 移动端：编辑器工具栏重构 + 首层首页重做（2609xx 本会话；**未提交**）
> 本会话全部为**移动端**改动（桌面/移动已可自由改，§8.0）。产物均已在模拟器 emulator-5554 上 CDP 实测/验收，但**未提交**。目标：对齐 Lake/Yuque 官方移动端的首层与编辑体验。

**A. 编辑器底部工具栏（`src/mobile/editor/EditorDock.tsx` + `editor-dock.css`，对齐 Lake 官方）**
1. **修"展开面板正文区剧烈抖动"**：根因是 `--mobile-dock-space`（正文底部留白）在点开面板瞬间从 54 猛跳到 280+54，而视口仍是键盘高度 ⇒ 内容区先压扁再弹回。修法：留白改由**动画中的 `usable`（= `--kb-offset`）驱动**（`留白 = usable + 工具栏`）。模拟器逐帧实测：键盘收起（inner 530→842）期间**正文可视区恒 436px、spread=0**，无抖动。
2. **命令按钮实时高亮**（B/列表/待办 + 面板内 mark/block）：加 `useActiveCommandStates` 监听 `selectionchange` + 命令执行后 refresh。**坑：lakex 的 `queryCommandState` 对 mark 命令恒返回 `-1`**（0=无效/1=生效/-1=不确定），不能当真值——**行内标记（bold/italic/underline/code）改用 DOM 计算样式判定**（font-weight≥600 / font-style / text-decoration / code），**块级（quote/列表/待办/undo/redo）用 `queryCommandState === 1`**。
3. **类别按钮 + / Aa 展开后变 ×**（`med-open` 实心主色圆钮）+ `tapFeedback()` 震动（震动仅真机可感）。
4. 移除底部冗余"完成"✓（顶栏右侧已有）；工具栏= `[+, Aa, B, 列表, 待办, 键盘]`。

**B. 首层首页（`src/mobile/home/HomePage.tsx` + `NotebookGrid.tsx` + `mobile.css`，对齐 Yuque 移动端首层）**
1. 小记 = **卡片**（图 16:9 + 摘要 3 行 + 日期 MM-DD HH:mm + 「…」菜单[编辑/删除]）。
2. 知识库 = **「最近文档」横向卡 + 笔记本书架**（白卡 + 简约线条 `BookOpen` 图标[默认]、名称带"01-"序号）；右上角**书架↔列表**切换（localStorage 持久化）。
3. **最近文档仅书架视图显示**；数据 = **最近*更新*的 N 条笔记**（代理，非"最近打开"——要"最近打开"需加 `last_opened_at` 追踪）。**样式走过一轮**：去掉大边框→简约（透明、只读按钮改 `background:transparent`，否则浏览器按钮默认灰色 `#efefef` 露出来）→ 本会话最终为极简 icon+标题。
4. 空态**不提示创建**（仅"暂无小记/暂无知识库"）。
5. 底部胶囊栏 = **[搜索 | 新建 | 云同步]**（新建按 tab：小记=写小记/知识库=新建笔记本；纯图标，仿第二层悬浮栏）。之前一度做过 [搜索|筛选|新建|云同步]，后**筛选(排序)移到右上角**。
6. **知识库排序已按用户决策移除**：手机不再拖拽重排、不再写本地 `sort_order` → 直接展示**共享 `sort_order` = 桌面端顺序**（`listTreeNodes` 本身 `ORDER BY parent_id, sort_order`，不重排即桌面顺序；且 `sort_order` 在 sync manifest `folders[].sortOrder`，跨端同步）。小记排序保留（右上角"排序"，最近更新/最早更新）。
7. tab 切换（小记↔知识库）加**方向性滑入动效**（`mobile-tab-in-left/right`，150ms；swipe 或点 tab 都带方向）。

**C. 其它移动端修复**
1. **最近文档/搜索/新建点开直达文档**：`NotebookWorkspace` 启动逻辑改"显式 `initialNoteId` 优先打开并置为活动，再补开上次保存的标签"（旧逻辑"恢复上次标签"优先 ⇒ 点最近文档打开的是之前旧标签）。
2. **第二层底栏滚动隐藏/显示**：阅读态文档下滑超 8px → 底栏 `mobile-bottom-bar--hidden`；上滑超 8px → 恢复（思源设计；修"阅读时底栏消失不再出现"）。

## 3. 真正的待办（已剔除全部完成项，按优先级）
> **260904 后续评估（用户决策 + 本轮核实）**：原 §3.1 对象级 5xx 重试、§3.2 快照 gzip 异步化、§3.5 笔记本 `sort_order` 撞号 —— **已评估不做**（5xx 有"失败不 markSynced→下轮重扫"兜底；gzip 异步收益小；sort_order 撞号场景极低）。
> 原 §3.3（FTS 全量重建→增量）与 §3.4（1/2 字短词回退）**合并为一条**：计划**整体重做索引**，两件一起落地（同属 `src/core/searchRepository.ts` 的索引/搜索路径，同时覆盖 10 万文档量级）。
> 原 §3.6（其余浮层统一）**基本已完成**：顶栏菜单/右键菜单/标签切换器已进 b3 令牌（`src/b3/components.css` + `src/b3/layout.css`）；仅**草稿恢复框**（`draft-recovery-*`，`overlays.css` 自定义类 + `--lake-*` 令牌）未收进 b3 套，属可选小收尾。

**性能/健壮性**
1. **FTS 索引重做**（合并原 P4-1 增量 + P4-2 短词回退）：`src/core/searchRepository.ts` 的 `rebuild()` 现每次启动 `DELETE FROM notes_fts` 全清 + 逐条重插、trigram 只索引 ≥3 字；改为增量账本（`updated_at`/旁表记账，只重建缺失/过期）+ 1/2 字短词回退（标题+正文 LIKE）。可动 FTS schema（dev 可删重建），**按 10 万文档/100 万附件量级验证**。← 近期待办。
2. 其余浮层收尾（可选，成本低）：仅**草稿恢复框**未进 b3 套；如统一照 §2.1 路子 + 同步 `settingsSearch.ts` 注册表即可。

**移动端 UI 对齐思源 · 用户首轮验收反馈修复（260909）**
- **用户看不到变化 = 装机包过期**：改动只在仓库/dist，安卓端必须 `bash scripts/android-build.sh --sync --install` 才进模拟器/真机（本会话已装并复验）。
- **面板闪烁（#2）**：面板改到**工具栏上方**（思源 .keyboard 口径），不再"blur 收键盘 + 面板接管键盘区"；键盘全程不动 → 无双动画对撞。实测 innerHeight 恒 530、面板照常开合。
- **加粗后面板被键盘顶掉（#3）**：根因是旧实现 blur 后 **Lake 内部选区失效**（实测 bolds=0/italics=0），且 focusin 会把面板关掉。现在：不 blur、不抢焦点、pointerdown 只有落在正文才收面板；实测面板保持打开、选区保持、`fontStyle` 随点切换（连续加粗→斜体可用）。
- **表格跟随光标（#4）**：新增 `src/mobile/useCaretIntoView.ts`（选区变化/点击后把光标所在单元格滚进可视区，只调目标所在滚动链，不用 scrollIntoView）。实测 `ne-table-inner-wrap` scrollLeft 0→376，最右单元格 inView=true。
- **dock 文字改图标**：`Aa`→`<Type/>`，`textButtons` 实测为空。
- **修好自己引入的 P0**：`EditorDock` 新加的 `useEffect` 一度放在 `if (!editing) return null` **之后** → 条件 hook → 整棵 React 树卸载（#root 空，HANDOFF §4 老坑）。已把 hooks 全部放回早退之前。**教训：动 EditorDock 这类"早退 + hooks"组件时，任何新 hook 必须放在 `if (!editing) return null;` 上方。**
- 设置页**不做**思源右滑（用户 260909 明确：保持现状）。

**第二轮反馈（260909 同日）**
- **面板方向按用户要求回到"向下展开占住键盘区"**：工具栏屏幕 Y 恒定（实测键盘开 toolbarTop=512 → 面板展开仍 512，差 0），面板 560→842 正好吃掉键盘腾出的 282px。
  不闪的关键不是"面板放上面"，而是**顺序**：同一帧挂面板 + 抬 `--kb-offset`，**下一帧才 blur** → 键盘是在面板背后滑走的；面板无入场动画。
  `--kb-offset = innerHeight - base + panelHeight`（HANDOFF §8.3 原公式，键盘收起过程中屏幕 Y 不跳）。
- **打字/编辑切换**：手指点在正文（pointerdown 落在 contenteditable）→ 关面板 + 恢复键盘（实测点正文后 panel:false、工具栏回到 794）；再点同一工具栏键 = 关面板并 focusEditor。
- **编辑键上移顶栏**：顶栏右侧 = 编辑/完成 + 云同步并列；底部胶囊栏只留阅读相关（文档树/标签/大纲/更多），避免打字时误触；「更多」菜单里保留一个编辑/完成备用入口。
- 教训：**测试脚本自身的 helper 参数写错**（`at(sel)` 少传 label → 恒 MISS）会伪装成"App 没生效"，排查前先手验一次 DOM 查询。

**移动端 UI 对齐思源（260908 审计的剩余批次）** —— 明细见 `docs/MOBILE-UI-SIYUAN-AUDIT-260908.md` §4：
- **B7（未做）**：`SearchSheet`/`CreateNotebookSheet`/图标选择器/历史 sheet 收进 sheet 菜单语言（现在还是 `.mobile-sheet` 自造头）；设置页进入方式改思源 `#model` 右滑（现为整页 fade-in）。
- **B8（剩余）**：插入面板项补 `.b3-menu` 风格分组；文档面包屑行（思源 `.protyle-breadcrumb` 42px）；空块占位符。（`Aa`/`B` 文字图标化已于 260909 完成）
- **B7 修订**：设置页**保持现状**（用户 260909 决定不做思源 #model 右滑），只做 SearchSheet/新建知识库/图标选择器/历史 sheet 的收口。
- **验证缺口**：B4 跟手手势、B2 触感、B6 键盘态只在本机 Electron 390×844 harness 验过，**安卓模拟器/真机未复验**（模拟器 `scripts/emu-cdp.sh` + 真机 IME 行为差异见 §8.3）。

**移动端（安卓）** —— 全部见 **§8.6/§8.7**（剪贴板粘贴不解析、真机资产 canonical URL 不可达、"整体编辑还有问题"待现象、大纲 viewer 跳转）。注意 §8.6 提到的 android worktree **已不存在**，那条"沿 worktree 验证"的线索要重新确认落点。
> **本会话决策/结论（2609xx）**：① **知识库排序不做**（用户确认）——手机端已删除拖拽重排 + 知识库排序入口，直接展示共享 `sort_order` = 桌面端顺序（见 §2.8.B6）；小记排序保留。② "最近文档"用**最近更新**代理（非"最近打开"），需"最近打开"再单独加追踪。③ 首层首页 + 编辑器工具栏已重做（§2.8），待**真机验收**后再提交。④ 删除/恢复语义、同步红线均未动。

**产品/技术债（长期；评估后多属低/缓）**
3. W-8 ACAO / W-10 dompurify（并入"lake 资源导入统一优化"，**安全相关，建议优先**）；依赖维护：`@types/better-sqlite3` 可单升。
4. 大纲 **viewer（只读）点击标题不跳转**（用户计划重做大纲时一并处理，低优先）。
5. **回收站首拉成本**（批量删除后接收端首拉仍下全文+资产）——惰性下载方案**暂缓**（要动恢复红线，低优先）。
6. Store 分批重构（`docs/REFACTOR-PLAN-2026-08-17.md`，按领域、严禁一次改事务边界；移动端复用专项；无测试护栏前不动）。
7. Word/PDF 导出（`electron/export.ts` 已预留 docx/pdf）；附件大文件 S3 分片/断点续传（**nice-to-have，未被需求驱动**）。
8. **Lake 内核策略**（属政策，非任务，记录即可）：A lakejs 开源源码当"机制字典"；B 版本锚点 + hack 清单（vendor lakex 已 pin，勿随意升级）；按需最小 patch，**不整体 fork**。
9. **lakex 契约固化（编辑器可观测性，低成本待落地）**：新增 `src/features/editor/lakex-contract.d.ts`（完整设计见 `docs/LAKEX-CONTRACT.md` §4，速查表 §5），替换 lakeRuntime 等处的 `as any`、收敛反编译结论；纯类型改动 + 门禁全绿，**不碰 vendor**。

**非代码**：安卓同步偶发 `UnknownHostException` = 设备网络（联网重试）。

## 4. 踩过的坑（合并版；通用红线/环境见 AGENTS.md）
### 同步 / 数据语义（最危险的一类）
- **`purged_at` 不是"已彻底删除"的永久标记**：`markPurgeSynced()` 在前缀删除成功后清空它（防重复删）。任何"别让它复活"的判定必须看**永久墓碑**（folder 看 `deleted_notes.node_type='folder'`）。
- **purge 的墓碑必须无条件写**：`notes` 行缺失时跳过 = 云端永不下架 = 之后必然复活成"父不存在的不可见文档"（本轮实数据踩到）。
- **不要给"资产存在性"做本机持久缓存**（GC 会真删对象 → 缓存失真 → 破坏跨端自愈）；用"刚下载的远端清单"做差集（AGENTS #11）。
- **`contentHash` 会骗人**：`syncAdapters.localHashOf` 对 synced 笔记返回 `store.baseHash`（不读 `.lake`）；判"本地可复用"必须**实读正文 + sha256**。
- **清单声明⇒存在**：上传走差集但 `manifest.assets` 仍**全量声明**（裁剪声明 → 他端 GC 误删在用资产）；禁逐对象 HEAD。
- **兜底「未分类」只惰性创建**：下载阶段无条件 `defaultNotebookId()` 会凭空建"未分类"并上传扩散；`effectiveParent()` 也只能在"真应用"处解析。
- **S3 并发峰值 ≤8**（七牛建议）：`NOTE(2)×ASSET(4)`；曾 16 偏高、无必要。
- **软删 = 移动到回收站笔记本**（`parentId=TRASH + trashedAt`），`deleted:true` 只用于 purge 墓碑。混用 = B1 级致命 bug。
- **守卫不能只挂在一条路径上**：`tab.deleted` 此前只在同步刷新里设置，启动恢复/点击打开都不判定 ⇒ 同一文档"同步过就只读、没同步就能编辑"。这类判定必须收敛成一个纯函数（现 `isGoneNote`）在所有入口调用。
- **静默丢弃用户输入是最坏的失败模式**：`if (deleted) return;` 不打提示 → 用户以为已保存。拦截必须同时给可见反馈 + 出口。
- **文档漂移**：易过期事实（分支/hash/计数/当前焦点）**只写 HANDOFF §0**，别写回 AGENTS/README。
- **`git worktree list` 要纳入开工检查**（历史上漏看过一次 android WIP）。

### 渲染 / CSS
- **浮层 flex 列的固定区必须 `flex: 0 0 auto`**：`header/页签/提示条/错误条` 默认 `0 1 auto`，内容一多就被压扁，溢出文字被**后绘制的列表**盖住（就是"回收站左侧列盖住顶部提示"）。复现：CDP 把面板压到 200px 高，比对 `Range` 文字底边与列表 `top`。
- **预览/图片切换不要清空旧内容**：`setState(null)` + 文本占位 = 塌陷再撑开 = "闪一下"。正解：保留旧图 + 新图 `img.decode()` 后替换 + 容器固定高度。
- **居中缩放容器别用 grid 的隐式 auto 行**：`display:grid; height:300px; overflow:hidden` 里图片按原始尺寸撑高行 → `max-height:100%` 失效、图被裁切。要 `display:flex; align-items:center; justify-content:center`。
- **同一元素被多层 CSS 覆盖会互相打架**（styles.css → b3/components.css → overlays.css）。改 UI 前先 `grep` 类名看有几处定义；跨层加 modifier 时写进**同一层**（`.badge` 会赢过 styles.css 里的 `.quick-notes-count`）。
- **vendored `text-clamp` 混入不等于省略号**：`.b3-list-item__text` 只有 `overflow:hidden`，长文件名会把 `__meta/__action` 挤出列宽，需自己补 `min-width:0 + text-overflow:ellipsis + white-space:nowrap`。
- **lucide 图标把 `className` 直接给 `<svg>`**：`el.className` 是 `SVGAnimatedString`（`.replace` 会炸），且 `.b3-list-item__graphic svg{}` 匹配不到 → 包一层 `<span className="b3-list-item__graphic">`。
- **密集列表行不要做 `:active scale()`**：28~40px 的行按压缩放会抖字、与滚动条抢空间（思源只给 hover 底色）。

### 工程 / 环境
- **hooks 必须在早退之前**：`SettingsPanel` 的 `if (!open) return null;` 之后全是普通函数，把 `useState/useEffect` 插进去 → "Rendered more hooks…" → **整个 React 树卸载**（`#root` 变空，长得像 GPU 崩溃）。
- **改 `electron/*.ts` 或 `src/core/*`（含 `syncDecisions.ts` 这类被主进程 import 的共享模块）→ vite-plugin-electron 重启 Electron → 命中未带 `--use-angle=metal` 的 GPU `exit_code=15`，整个 dev 实例被带走**。fresh `npm run dev` 一般不崩、**热重载才崩**。改完别再动主进程文件，或直接重启一次。
- **窗口被关掉 ≠ 进程退出**：`/json` 返回空数组但 Electron 还活着时，`open -a <Electron.app>` 触发 `activate` 会重建窗口。
- **`nohup` 起的 vite/vitest 会随 exec 会话回收而死**：dev server 必须 **tty=true 长驻**；测试直接前台跑（vitest 全量 ~3s）。
- **量 DOM 逐帧变化前必须解除后台节流**：窗口不可见时 rAF 一帧不跑、`setInterval(10ms)` 被节流成 ~1000ms（第一版数据因此全错）。解法：CDP `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:'active'}`，并用"10ms 定时器 1 秒跑了几次"自检。
- **别用跨进程往返做时序观测**：点击和采样要放在页面内**同一个 async 表达式**里，否则错过 <100ms 的中间态。
- **CSS `:nth-of-type` 数的是同类型兄弟**（含分组标题 div），不是"第 N 个列表行"；脚本里用 `rows[i].click()` 显式取索引。
- **`Page.reload` 之后 CDP `Input.dispatchMouseEvent` 可能点不动**（窗口非激活），`element.click()` 仍可靠；要测真实 hover/拖拽/剪贴板才用鼠标事件。
- **CDP 裸驱无需第三方库**：Node **v24 有内置 global `WebSocket`**（别用系统 node 18，会 `WebSocket is not defined`）；页面 target 在 `http://127.0.0.1:9222/json`。
- 压测真实云用一次性前缀 `lake-stress-<ts>/`，**结束必 `deletePrefix` 清场 + 复核 0 残留**；凭证只走环境变量、绝不入库。合成 `Readable` 流式 PUT 在七牛会大面积超时 → 测脚手架用字节 PUT。
- `better-sqlite3` 是 **N-API**（Electron/vitest/node 都能加载）；命令行查库：拷 `.sqlite3`+`.sqlite3-wal` 到别处用 `/usr/bin/sqlite3 -readonly`（app 在跑时读快照）。
- S3 `[perf]` 日志行尾数字是 **epoch 时间戳不是耗时**（旧坑，head 已移除）。
- 七牛：`ObjectStore.test()` 必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404）；正确配置 Endpoint `https://s3.cn-north-1.qiniucs.com`、Region `cn-north-1`、Bucket `local-lake-hebei`、`forcePathStyle=false`。
- 同步完成必须广播 `sync-progress`；`markSynced` 要同时改 `notes` 与 `tree_nodes.sync_state`；IPC 三处同步（`main.ts` handle + `preload.cjs` + `src/lib/native.ts`，preload 暴露名是 **`lakeNative`**）；多表写必须 `db.transaction`。
- 结束 electron 只能 kill 具体 PID，**禁 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae）。

## 5. 下一步建议（新会话）
1. 先跑 §6 门禁确认基线；有问题先测再改。
2. 待办优先：**§3.2 快照 gzip 异步化**（小、独立）→ **§3.3 FTS 增量**（收益大）。
3. 移动端一律按 **§8**（§8.0 移动端/桌面硬隔离已解除——现桌面与移动可自由改；仅 `src/b3/**` 思源 vendored 组件等共享/合规件仍须谨慎）。
4. 任何同步/GC 改动**先读** `AGENTS.md §3 #11/#12/#13/#15/#16` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立、复活路径在哪"。
5. UI 改动先看 `AGENTS.md §3 #14`（思源版式语法），别再造第四套类名、别写内联样式。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
git diff --check                                                # 空白错误（注意会报出移动端会话的文件）
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
```
- **UI 实测姿势**：`curl http://127.0.0.1:9222/json` 拿 page target → Node 24 内置 `WebSocket` 直驱 `Runtime.evaluate` / `Page.captureScreenshot{clip}` / `Input.*`（本会话用这套量出了预览闪烁的逐帧数据）。详见 `docs/CODEX-GUIDE.md`。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8.1 / §8.9**。

## 7. 文档索引（`docs/` 按需查）
`AGENTS.md`（红线/机制/坑，必读）· `LAKEX-CONTRACT.md`（闭源 lakex 契约+速查表，编辑器相关先读）· `SYNC-PROTOCOL.md` · `S3-GC-DESIGN.md`（GC/保留链）· `TODO.md`（历史待办总表，§3 已摘要）· `PROGRESS.md` ·
`CODEX-GUIDE.md`（动手前必读：Playwright/CDP 驱动真实 Electron）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` ·
`ANDROID-TECH-SCHEME.md` / `MOBILE-TECH-STACK.md`（移动端）· `MILESTONES-SYNC-UX-2026-09-03.md` · `STRESS-260903.md` · 各 `*-AUDIT/*-REVIEW/*-DESIGN`。
> `docs/` 里若干 `*-HANDOFF`/`AUDIT`/`PERF` 是过程记录；权威待办以本文件 §3 为准，移动端以 §8 为准。

---

## 8. 移动端（安卓模拟器 + 编辑器）专职交接（260908 收尾）

> 本节是移动端（安卓模拟器 + 编辑器）交接：如何用**本机安卓模拟器**熟练验证移动端 UI/编辑，以及移动端任务的目标/已完成/遗留/坑。桌面 Electron 工作见 §0-§7。**注（260907）：原「只做移动端、别碰桌面」的硬隔离已解除**——现在桌面与移动可自由改动（见 §8.0）。

> **面向零上下文新会话——当前状态一句话（260908 收尾）**：移动端已完成**设置项收口** + **完整端**（历史快照列/恢复/删/24h去重/上限/定时、资源管理本地孤儿+云端GC、运行诊断）+ **大纲 viewer 跳转根因修复**（docs 高度塌陷）。主数据同步/编辑基础早已就绪（见 §8.4/8.5）。下一步见 §8.7（真机验收 + 数据导出/导入 + 剪贴板/资源URL）。本会话所有改动已提交 `master`（最新 `8e26910`）。
>
> **260910 更新**：移动端生产存储已切到 **Android native SQLite（WAL）**；`sql.js` 只保留为测试/一次性迁移验证实现。跨端同步端口已全部显式 `Promise`，共享 GC keep set、嵌套树契约、资源大小契约已锁定。最新分支已在 `emulator-5554` 安装并通过重启持久化与资源上限验证；详见 §2.9。
>
> **更新的状态（2609xx 之后一个会话）**：又完成两块移动端大改——**编辑器底部工具栏**（修面板展开抖动、命令生效高亮、+/Aa 展开变 ×+震动、去冗余完成钮）与**首层首页重做**（小记卡片、知识库书架/列表+最近文档、底部栏[搜索|新建|云同步]、tab 滑入动效），并修**最近文档/搜索直达**、**第二层底栏滚动隐藏/显示**，且**按用户决策删除知识库排序**（改用共享 sort_order=桌面顺序）。**这批未提交**（详见 §2.8，待真机验收后提交）。

### 8.0 移动端注意（原「移动端铁律」已降级为注意项，260907 用户明确解除硬隔离）
- **桌面与移动已可自由改动**（不再限定 `src/mobile/**`；当前无并行会话，不会有提交冲突）。仍请谨慎：`src/b3/**` 是**思源 vendored 组件（AGPL-3.0）**、`src/features/editor/lakeRuntime.ts` 等是**两端共享模块**，改动前先确认影响面；`electron/`、`src/main.tsx` 改动会触发 vite-plugin-electron 重启 Electron（见 §4 踩坑）。
- 移动端设置/浮层 UI 受 `AGENTS.md §3 #14` 约束：用思源 vendored b3 类，**禁内联样式**（`style={{...}}`）。
- **移动端数据在安卓模拟器 App 沙盒（`com.lakenotes.mobile`）里，不是 macOS 的 `lake-notes-dev`**。开发数据可 `adb shell pm clear com.lakenotes.mobile` 整体重建（`seed_initialized` 会重新种子"个人笔记"笔记本）。
- Node **24** 必须：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`（别用系统 node 18）。安卓相关 JAVA/SDK 环境**脚本里已内置，不用手动 export**。

### 8.1 安卓模拟器使用（本机 AVD `lake_mobile`，pixel_6 / API36 / arm64）
**一键脚本**（都在 `scripts/`，环境变量自备，直接跑）：
| 场景 | 命令 |
|---|---|
| 启动模拟器并等开机 | `bash scripts/emu-up.sh`（纯 CDP/远程会话用 `--no-window`） |
| 构建+同步+安装+启动 App | `bash scripts/android-build.sh --sync --install` |
| 把 App WebView 转发到本地 CDP | `bash scripts/emu-cdp.sh`（默认端口 9335） |
| 不起模拟器、浏览器里速测移动 UI | `bash scripts/mobile-preview.sh`（`http://127.0.0.1:1422/preview.html`，390×844 手机框） |

- AVD 名 `lake_mobile`；SDK 在 `/opt/homebrew/share/android-commandlinetools`；gradle 复用缓存 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/.../gradle`（公司网络下不了 distribution，**别走 wrapper**，脚本已指好）。包名 `com.lakenotes.mobile`；`adb` 在 SDK `platform-tools`。
- `npm run dev`（桌面）与移动端无关；移动端构建= `vite build -c vite.mobile.config.ts` → `dist-mobile/`。

**CDP 自动化驱动（本会话验证过的可靠方式）**：
1. `bash scripts/emu-cdp.sh` → 本地 `tcp:9335`。**注意：App 每次重启/导航后 WebView socket 会变**，`/json/list` 可能连不上旧 socket——用 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+" | sort -u` 找所有 socket，逐个 `adb forward tcp:9335 "localabstract:$s"` 后 `curl -s http://127.0.0.1:9335/json/list` 校验 `type=="page"`，命中即 break。
2. 程序：`const list = await fetch("http://127.0.0.1:9335/json/list").then(r=>r.json())`，取 `type==="page"` 的 `webSocketDebuggerUrl`。
3. 连 WebSocket，`Runtime.enable`，用 `Runtime.evaluate`（`returnByValue:true, awaitPromise:true`）执行任意 JS 驱动/断言。
4. **触摸（触发键盘/IME）**：`Input.dispatchTouchEvent {type:"touchStart",touchPoints:[{x,y}]}` → 延时 ~70ms → `{type:"touchEnd",touchPoints:[]}`，再对 contenteditable `.focus()`。
5. **打字**：`Input.insertText {text}`；**选中文本**：`document.createTreeWalker` 找文本节点 + `Range.setStart/setEnd` + `sel.removeAllRanges();sel.addRange(r)`。
6. `window.__mobileEditor` 暴露当前活跃文档的 Lake 编辑器实例，用于 `renderer.execCommand`/`queryCommandEnabled`（比查 DOM 可靠）。

### 8.2 Lake 编辑器命令名（移动端用 `renderer.execCommand`，命令名与桌面 toolbar 不同）
- **有效**（`queryCommandEnabled`=true）：`bold`、`unorderedList`（列表！）、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style`（块级，传 `"p"/"h1"/"h2"`）、`undo`/`redo`。
- **无效**（no-op/返回 false，别用）：`insertUnorderedList`、`formatBlock`、`heading`、`setHeading`、`insertBulletList`、`strike`/`strikethrough`、`justifyLeft/Center/Right`、`clearFormat`、`fontsize`。
- **命令生效前提**：需要真实 caret/选区在文本块里——`bold` 先选中文字；`style "h1"`/`unorderedList` 需 caret 在段落里。**命令名写错/焦点丢了 = 点了没反应，还会疑似"正在下载"。**
- 渲染 DOM（验证用这些选择器）：列表=`ne-uli-i`/`ne-uli-c`/`ne-tli`（**不是** `<ul>/<li>`）；加粗=`ne-text` 且 `font-weight:700`（**不是** `<strong>`）；标题=`ne-h1`/`ne-h2`。

### 8.3 编辑器 Dock 键盘/面板机制
- `src/mobile/useKeyboard.ts` 返回 `{ base, innerHeight, offset, height, keyboardOpen }`。`base`=键盘收起满高度（max innerHeight）；`innerHeight`=当前；`offset`=edge-to-edge 上移量（adjustResize=0）；`height`=键盘实际高；`keyboardOpen=height>8`。
  - 模拟器是 **adjustResize**（键盘弹 `innerHeight 842→530`，`offset=0`，`bottom:0` 元素天然在键盘上方）；真机可能 **edge-to-edge**（`offset>0` 需上移）。两模式都被覆盖。
- `src/mobile/editor/EditorDock.tsx`：`if(!editing) return null`。工具栏 8 钮：`[+]插入 [Aa]字体 [B]加粗 [列表]unorderedList [任务]taskList [...]字体 [键盘]切换 [√]完成`。
- **工具栏 `--kb-offset`（bottom 基准）**：面板开时 `usable = Math.max(0, innerHeight - base + panelHeight)`；无面板 `usable = offset`。作用：工具栏屏幕 Y 恒等于 `base - panelHeight`——键盘收起 `innerHeight 530→842` 全程**不跳**（本轮修的核心）。CSS：工具栏 `bottom:calc(var(--kb-offset)+4px)`；面板 `bottom:0; height:calc(var(--kb-offset))` 占键盘区。
- **焦点/键盘**：`onMouseDown={(e)=>e.preventDefault()}` 加在 `.med-toolbar`/`.med-panel` 上，**防按钮抢走编辑器焦点**（否则键盘关、caret/选区丢→命令 no-op）。`runInline`（工具栏）= 仅 `exec`；`runPanel`（面板项）= 仅 `exec`，**都不要调 `focusEditor`**。
- 面板开关：开=`setPanelHeight(max(round(height),280))` + `setTimeout(()=>blur(),0)`（提 IME、占住键盘区）；关=`setPanelMode(null);setPanelHeight(0); focusEditor()`（自动恢复键盘）；`收起键盘/显示键盘` 切换。

### 8.4 任务主线（用户定位：移动端=完整端）
用户把移动端定位为**完整端**（大平板轻办公趋势，可能长期只用移动端），要求对齐桌面端的体验与逻辑（AGENTS §3 红线全适用）。
**近期主线（260908 本会话，已全部完成）**：
1. **设置项收口**：移除 `showToolbar`/`showToc`；设置项加 `platform` 标记（桌面专属/移动专属/两端）；设置版式原语抽共享 `settingsPrimitives.tsx`。
2. **移动端完整端**：历史快照（列/恢复/删除/去重/上限/定时自动快照）、资源管理（本地孤儿检测+清理、云端 GC）、运行诊断。
3. **大纲 viewer 跳转根因修复**：编辑器滚动容器塌陷（`.mobile-workspace-body` 非 flex → doc 高度 0）。

**更早（260904，移动端编辑器核心）**：面板闪烁/堆叠、命令名错、焦点/键盘、`--kb-offset` 稳定（见 §8.2-8.3 机制）。

### 8.5 已完成（本会话 + 早前，按领域组织；全部已提交 master）

**编辑/会话基础（早前）**：多 tab+左右抽屉、设置竖向菜单+子页、移动精仿思源样式、seed 数据、keep-alive 性能、settings 重构、`useKeyboard`/`EditorDock`/`editor-dock.css`（命令名、焦点/键盘、`--kb-offset` 稳定）。

**设置收口（260908）**：移除 `showToolbar`/`showToc`（AppSettings schema + 桌面/移动 UI + settingsSearch 全清）；`SettingItemEntry.platform`（desktop/mobile/both）+ `isSettingVisibleFor` 助手；桌面专属项标 `platform:desktop`（快捷键/历史/GC/备份/日志/关于详情）；设置版式原语抽 `src/components/settingsPrimitives.tsx`（桌面 `SettingsPanel` + 移动 `SettingsDrawer` 共用，对齐思源"内核+薄前端"分层）。

**移动端完整端**：
- **历史快照**：`listNoteHistory`/`restoreHistory`（恢复前先给当前正文留档=可反悔）/`deleteHistory`/`cleanupHistory`（共享 `selectHistoryDrops` 分层保留+上限+保留天数）/`snapshotNote` + **24h 去重**；`HistoryMobileSettings`（maxSnapshots/retentionDays/cleanupIntervalHours/snapshotIntervalMinutes，存 device_state）+ 设置「历史」视图 + MobileApp 定时器（`snapshotIntervalMinutes` 周期快照）；目录树长按「历史版本」sheet。
- **资源管理（本地）**：`orphan_assets` 表 + `detectOrphans`（保存登记未引用资源，含历史 refs 保护）+ `listLocalAssets` 跳过孤儿（**删图不再重传**）+ list/delete/clean API + 设置「资源管理」视图。
- **资源管理（云端 GC）**：`S3Store` 扩 `listObjects`/`deleteMany`；共享 `src/core/gcDecisions.buildGcKeepSet`（含 `extraManifests` prev 链引用保护，+单测）；`s3_gc_pending`/`s3_gc_log` 表 + add/remove/list/record；`syncNow` 加 `onPublished` 钩子（新 manifest 不再引用的旧正文/资源→登记待回收，full key）；`gcDeepCleanup` double-anchor 窗口 + 删除写 gc 日志 + 设置「云端清理」按钮。
- **运行诊断**：`getDiagnostics`（文档/分组/小记/资源/孤儿/待回收/快照数+库大小）+ 关于页「数据诊断」区块（移动端无桌面日志文件，此为「关于/日志」等价）。

**其他**：标签保持（localStorage 记上次打开标签 + `maxOpenTabs` LRU 淘汰）；工作区改标题；插入面板纯图标；小记缩略图批量（`listQuickNotes` 一次返回 `firstImage`）；目录树长按管理（重命名/图标/移动/删除）；**大纲 viewer 跳转根因修复**（`.mobile-workspace-body` 加 flex + `.doc-pane` flex:1，编辑器滚动容器恢复）+ `OutlineSheet.jump` 补 DOM 校正。

**lakeNative 暴露（调试契约）**：listOrphanAssets/cleanOrphanAssets/deleteOrphanAsset/gcDeepCleanup/listNoteHistory/restoreHistory/cleanupHistory/getHistorySettings/saveHistorySettings/snapshotNote/getDiagnostics。

门禁：`tsc` 0 · `vitest` 838 通过/15 跳过 · desktop `vite build` + 移动 `vite build -c vite.mobile.config.ts` 全绿 · `android-build.sh --sync --install` 过。

**（2609xx 后续会话，未提交）编辑器工具栏 + 首层首页 —— 详见 §2.8**：
- **编辑器工具栏**（`EditorDock.tsx`/`editor-dock.css`）：面板展开抖动修复（`--mobile-dock-space` 由动画 `usable` 驱动，正文区恒 436px）；命令生效高亮（mark 用 DOM 计算样式、块级用 `queryCommandState===1`）；+/Aa 展开变 ×（`med-open`）+ 触感；去底部冗余"完成"。
- **首层首页**（`HomePage.tsx`/`NotebookGrid.tsx`/`mobile.css`）：小记卡片；知识库书架（白卡+线条图标）/列表 + "最近文档"；右上书架↔列表；底部栏[搜索|新建|云同步]；tab 滑入动效；空态不提示创建。
- **其它**：最近文档/搜索/新建直达文档（`NotebookWorkspace` 的 `initialNoteId` 优先）；第二层底栏滚动隐藏/显示；**删除知识库排序**（改用共享 sort_order=桌面顺序）；最近文档简约样式 + 书架默认线条 `BookOpen` 图标。

### 8.6 当前问题 / 未决（需用户真机给现象）
1. **大纲 viewer 跳转 —— 已修复，但待长文档真机验证**：根因（`.mobile-workspace-body` 非 flex → doc 高度塌陷 0）已修复（e95ec6f，实测 doc 高 0→794）。**但**完整"点击大纲标题滚动到位"未端到端验证——因为**用测试文档造不出 Lake 可接受的高内容**（`ne-p`/`ne-h1` 格式不被编辑器接受，渲染成短内容），这是测试固件问题非 bug。**用真实长文档（正确内容格式）点大纲标题确认**。若仍不滚，给现象。
2. **"正在下载"从未复现**（MutationObserver 实时抓也没有）——判断是编辑器初始化瞬时态/旧命令报错后遗症，修复后未见。**若真机仍见，要截图或位置**。
3. 命令在**被改乱的段落**上可能不生效（caret 落标题/边界时 list 0→0）——编辑器 caret 语义，非命令 bug；干净段落正常。
4. **剪贴板粘贴不解析为空**（§3.6-3.8 遗留）：静态线索=移动端入口没挂 `installPasteInterceptor`；android worktree 已补挂，先沿那条线验证。
5. **本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` 真机不可达**：需 `adb reverse tcp:19876 tcp:19876` 或移动端解析成可达地址。
6. 用户"移动端整体编辑还有问题"现象未细化——**真机反馈给具体现象再定位**。
7. **首层首页 + 编辑器工具栏改动未提交**（§2.8）：待真机验收后按用户确认提交（代码红线）。
8. **首层"最近文档"= 最近*更新*代理**：非"最近打开"；对用户说清后可再加 `last_opened_at` 追踪。
9. **知识库排序已删除**（用户决策，不再做）：手机端不再写本地 `sort_order`，展示共享顺序 = 桌面端顺序。若日后想"每端独立顺序"，需改同步协议（manifest `folders[].sortOrder`），属红线区、须谨慎。
10. **首层新 UI 真机确认项**：书架白卡+线条 `BookOpen` 图标（已去彩色/红 emoji）；最近文档极简 icon+标题（已去灰底）；顶部排序按钮仅小记显示；知识库右上角为书架↔列表切换。

### 8.7 下一步（移动端，按优先级）
0. **（最新）真机验收首层首页 + 编辑器工具栏**（§2.8 这批未提交改动）：① 工具栏面板展开**不抖**、加粗/斜体生效**高亮**、+/Aa 展开变 × + 震动（震动须真机）；② 首层小记卡片、知识库书架/最近文档样式、tab 滑入动效。确认后**提交**这批（`git add src/mobile/... && git commit`，先跑门禁）。
1. **真机验收本会话交付**（历史/资源/GC/设置/大纲）：重点用**真实长文档**验证①大纲跳转滚动②资源管理（删图不再重传、孤儿清理、云端 GC）。
2. **整库备份/云端恢复**：桌面走「文件系统拷贝 + 应用重启」；移动端数据在沙盒（native SQLite + Capacitor FS，无 workspace 目录），架构不匹配——需另做「**数据导出/导入**」（导出 DB 快照 + 资产清单到文件）。当前已有「运行诊断」统计。
3. **定时自动快照真机验证**：`snapshotNote` 复用 `createHistorySnapshot`（已带 24h 去重）；**移动端模拟器 app 生命周期可能不触发 `setInterval`**，需前台运行验证。
4. **剪贴板粘贴真机验证**（§8.6.4）：沿 android worktree `installPasteInterceptor` 线索。
5. **资源 canonical URL 真机可达**（§8.6.5）：`adb reverse tcp:19876 tcp:19876`。
6. **大纲 viewer 跳转**（§8.6.1）：长文档确认。

### 8.8 移动端踩坑（本会话新增）
- **`insertUnorderedList` 不是 Lake 命令**：`unorderedList` 才对；命令名错=静默 no-op/疑似"下载"。
- **点 dock 按钮会抢走编辑器焦点**：键盘关、caret/选区丢→命令失效。解法：容器 `onMouseDown={e=>e.preventDefault()}`。
- **面板项别调 focusEditor**：`renderer.execCommand("focus")` 重开 IME→叠成"工具栏-面板-键盘"3 层；面板项只 `exec` 不聚焦。
- **别在 setState updater 里 blur**（键盘有时仍开着）；blur 挪到 `setTimeout(0)` 外。
- **工具栏 `transition: bottom` 有害**：它在对"正在 resize 的视口"做动画（键盘收起 `innerHeight 530→842`），把本来稳定的一帧错位放大。改 `--kb-offset=innerHeight-base+panelHeight`（屏幕 Y 恒定）并删 transition。
- **adjustResize vs edge-to-edge**：模拟器 adjustResize（键盘弹 `innerHeight` 变小、`offset=0`）；真机 edge-to-edge（`offset>0` 上移）。用 `height>8` 判键盘开、`offset` 区模式。
- **测试污染**：往文档打字/改格式会改脏 doc → 后续 caret 不可靠（list 0→0）。验证命令用**新建干净文档**（`window.lakeNative.createNote(name,'notebook-personal')`），别在已改过的 PRD/文档上测。
- **模拟器 `.click()` 无 mousedown**：测不了 `preventDefault` 焦点路径；`Runtime.evaluate` 里 `element.click()` 测逻辑，真实 preventDefault 要真触屏/真机。
- **模型看不了图**：`read_image` 失败（模型不声明图片输入）→ 用 DOM/computed style/`getBoundingClientRect` 量测代替截图。

**（260908 本会话新增）**
- **`.mobile-workspace-body` 必须显式 `display:flex`**：它 `flex:1`（高度来自父 flex）但非 flex 容器，`.doc-pane`/`.mobile-doc-body` 的 `height:100%` 在其中**塌陷为 0** → 编辑器无滚动容器 → 大纲跳转/长文滚动失效。修：workspace-body `display:flex; flex-direction:column` + doc-pane `flex:1; min-height:0`。
- **Lake 内容格式 ≠ 裸 HTML**：测试文档别用 `<h1 class="ne-h1">`/`<p class="ne-p">`（编辑器不认，渲染成短内容、无真实标题）。要用**应用内真实生成的 Lake 内容**（或从真实文档读 content 再改）做高度/跳转测试，否则测不出滚动。
- **`S3Store` 接口（共享 `src/core/syncEngine.ts`）扩 listObjects/deleteMany 是可选方法**（`?`）：桌面 `createS3StoreAdapter` 没实现也不报错（GC 用 legacy `electron/sync.ts` ObjectStore）；移动端必须实现才能云端 GC。
- **GC key 带 prefix 一致性**：移动 `listObjects` 返回 **full key**（含 `{prefix}/`），而共享 `buildGcKeepSet`/`collectManifestRefs` 返回 **无 prefix 的 key**——`buildGcKeepSet` 里统一 `keep.add(prefix + "/" + ref)`；`onPublished` 钩子里 `addS3GcPending` 也要传 full key（`${prefix}/${objectKey(...)}`），否则与 `gcDeepCleanup` 的 full-key listing 对不上。
- **`selectHistoryDrops` 是共享函数**（`src/core/storeUtils.ts`）：桌面 `cleanupHistory` 与移动 `cleanupHistory` 共用同一分层保留逻辑；移动端 note_history 无 `protected_until` 列，不涉及桌面那种"冲突归档保护期"。
- **设置项加/改必须同步 settingsSearch 注册表**（AGENTS §3 #14）：新增 `itemId`（如 resources-clean、history-*、appearance-theme）若只在移动端（无搜索），不入 SETTING_ITEMS 也不报错；但**桌面**新增的设置行必须入 SETTING_ITEMS，且 `vitest src/components/settingsSearch.test.ts` 会卡漂移。

**（260908 移动端 UI 对齐思源批次新增）**
- **CSS 层叠顺序坑（同一类被两套定义打架）**：`mobile.css` 由 `MobileApp.tsx` import，注入顺序**早于** `main.tsx` 里的 `src/b3/siyuan.scss` ⇒ 覆盖 `.b3-*` 的选择器必须比思源本体更具体（`.b3-menu.ln-sheet`、`.b3-button.ln-confirm__danger`），否则被反向压过（本次 danger 按钮不红、sheet 高度不生效都是这个原因）。
- **border-box 语义差异**：思源 `_mobile.scss` 的 `.toolbar__icon{width:20px;padding:10px}` 是 content-box 思路；本项目全局 `* { box-sizing: border-box }` ⇒ 照抄会让内容盒塌成 0（图标 0×18 不可见）。移植时写成"总尺寸 = 图标 + 2×padding"。
- **harness 截图假象**：Electron 窗口被遮挡时 transition 会**冻结**，`Page.captureScreenshot` 截到"半开的面板/半屏抽屉"，看着像布局 bug 其实是合成层没画完。解法：截图前注入 `*{transition:none!important;animation:none!important}`（本会话 harness 已内置）+ `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`；另：`mobile:true` 的设备模拟会按 visual viewport 缩放，截图请用 `mobile:false, deviceScaleFactor:2`。
- **同一文档不允许两种壳**：`DocumentPage`（顶栏 4 图标）与 `NotebookWorkspace`（底部栏+抽屉+手势）并存 ⇒ 从首页/搜索打开的文档没有抽屉和守卫。统一后 `openNote()` 一处判定（`isGoneNote`），别再加第二条打开路径。
- **删除文档必须连带关标签**：`applyDelete` 里 `closeTab(node.id)`，否则回收站文档仍留在 tab 里可继续编辑（AGENTS §3 #16 的移动端形态）。

**（2609xx 首层 + 工具栏本会话新增）**
- **lakex `queryCommandState` 对 mark 命令恒返回 `-1`**（0=无效/1=生效/-1=不确定）：用 `!!v` 会把 -1 当"生效"→ 恒误亮。**行内标记生效判定改用 DOM 计算样式**（font-weight≥600 / font-style / text-decoration / code）；块级（quote/列表/待办/undo/redo）用 `queryCommandState === 1`。
- **`--mobile-dock-space`（正文底部留白）别用固定 `panelHeight + 工具栏`**：点开面板瞬间面板还没显形、键盘还开着，留白猛增 280 → 内容区先压扁再弹回（剧烈抖动）。要**用动画中的 `usable`（= `--kb-offset`）驱动**（`留白 = usable + 工具栏`），内容区才全程恒定。
- **`<button>` 默认有浏览器按钮底色 `#efefef`（灰）**：首层最近文档卡、任何"纯图标 button"要设 `background:transparent; border:none`，否则灰色露出来（本会话"最近文档灰底"就是这么来的）。
- **显式打开某文档（最近文档/搜索/新建）时 `initialNoteId` 会被"恢复上次标签"覆盖** ⇒ 打开错文档。修：`NotebookWorkspace` 启动改"显式 `initialNoteId` 优先打开并置为活动，再补开其它已存标签"。
- **emulator CDP socket 随 App 重启变化且 forward 常连不上**：先 `adb forward --remove-all`，再 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+"` 找新 socket，`adb forward tcp:9335 localabstract:$s` 后 `curl /json/list` 校验（多轮重试 + 等 App「Displayed」后再连；用 `adb forward --list` 核对）。
- **知识库 `sort_order` 是共享字段**（manifest `folders[].sortOrder`，跨端同步）：跨端改会互相影响。用户已**决定不做**知识库排序（手机端不写本地 sort_order，展示共享顺序）；以后别再加回，除非先讨论同步语义（红线区）。
- **触感 `navigator.vibrate` 经 CDP 观测不到**：需真机/模拟器手动确认。

### 8.9 移动端常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit                                             # 类型检查
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts   # 移动 bundle→dist-mobile
bash scripts/android-build.sh --sync --install               # sync+gradle+adb install+launch(com.lakenotes.mobile)
bash scripts/emu-cdp.sh                                      # 转发 WebView→tcp:9335（测 UI 前必跑）
bash scripts/emu-up.sh                                       # 启动模拟器（无窗口 --no-window）
bash scripts/mobile-preview.sh                               # 浏览器预览 http://127.0.0.1:1422/preview.html（需先 build）
# UI 走查（本会话用这套，比模拟器快得多；harness 脚本暂在 /tmp/lkm，待入库 scripts/）
node node_modules/vite/bin/vite.js -c vite.mobile.config.ts --host 127.0.0.1 --port 5173   # 移动 bundle dev（HMR）
./node_modules/.bin/electron --remote-debugging-port=9223 /tmp/lkm                          # 390×844 Chromium 壳
node /tmp/lkm/cdp.mjs --shot /tmp/lkm/x.png '<js>' ; node /tmp/lkm/walk.mjs steps.json      # 裸 CDP 求值/批量走查截图
adb shell pm clear com.lakenotes.mobile                      # 清 App 数据重建种子（dev 才做）
```
