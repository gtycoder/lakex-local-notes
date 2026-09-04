# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（项目长期记忆/红线，务必遵守）→ 相关 `docs/`。
> 历史所有 `HANDOFF-日期.md` / `Electron-HANDOFF` / `PHONE-HANDOFF` 已合并进本文件并删除（内容在 git 历史可查）。
> 本文件只保留**当前状态 + 真正的待办 + 有价值的坑**；过期/已完成的不再罗列。

## 0. 当前基线（新会话开工前）
- 分支/远端：开发主干 `master` ↔ Gitee `origin`（SSH：`git@gitee.com:gtycoder/local-lake.git`；`master` 亦是远程默认分支）同步。
  **本文不固定 commit hash**——查 `git log -1 --oneline`。
- 质量门槛：`tsc` 0 error · `vitest` **828 passed / 15 skipped** · 桌面 `vite build` + 移动 `vite build --config vite.mobile.config.ts` 全绿（计数变动见 §2.x；别写死旧数字）。
- 本地业务分支只有 `master`（其余已合并/删除；`origin/main` 为旧 Tauri 遗留引用）。
- 里程碑（260903，docs/MILESTONES-SYNC-UX-2026-09-03.md）：M1a-M6 已全量实现并合入 master（merge e803948）——B1 冲突通知收口、B3 冲突归档 30 天保护（note_history.protected_until，多端 port 兼容）、C1 回收站到期倒计时（trashDaysUntilPurge 共享纯函数）、C2 purge 三端语义文案、A3 数据体检（runDataHealthCheck）、D2 待回收明细（pendingKeyReason）、F3 清理统计、F1 应用内日志查看器（read_app_log）、A1 整库备份（exportWorkspaceBackup）、A2 云端恢复（prepareCloudRestore 改名隔离+空库重启首同步）、E 视觉 tokens 收编。B4 按审计取消（对齐 S3-GC-DESIGN §14）；A4 云端报告留 backlog。
- 近期其他主线（260902→260903）：语雀 bookmark 卡修复 + S3 同步性能优化 + 两处 bug 修复 + 压测，均已在 master。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron+React+better-sqlite3+语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。

## 2. 本轮已完成（均已在 master）
### 2.1 两个 bug（用户报）
- **#1 同步凭空长「未分类」笔记本**：`syncEngine` 下载阶段原来**无条件**调 `defaultNotebookId()`（本地无笔记本即建「未分类」并上传），
  改为**惰性** `resolveDefaultNotebook()`——仅当某笔记**真正回落到兜底父**时创建（本轮至多一次），且冲突探测等"最终不应用"的路径不解析。
- **#2 小记偶发删不掉**：桌面小记是"乐观删除 + 5 秒撤销窗口（到期才落盘）"，同步完成的 `refresh()` 会把窗口内那条重新拉回列表、且单条 pending 挡住再点删。
  修：`deleteQuickNote` 幂等（已不存在不抛 NotFound）+ `refreshItems` 过滤撤销窗口内那条。移动端小记是即时软删、无此竞态，未动。

### 2.2 S3 同步性能（对齐思源 dejavu：远端清单声明差集，去掉逐对象探测）
- **上传差集** `scanLocalAssets`：存在性以「刚下载的远端清单已声明该资产」为准（发布先对象后清单 + GC 只删未被在留清单引用的键 + 年龄保护 ⇒ 声明即存在），
  只 PUT 缺失者；**返回仍全量声明**（裁剪声明会致他端 GC 误删在用资产）。删除了 `S3Store.exists?/adapter.exists/ObjectStore.headObject` 整条 HEAD 链路。
- **下载差集** `downloadNoteAssets`：下载前按本地实扫 `size+sha256` 跳过已持有资产（缺失/损坏仍下、strict 缺失仍整条拒绝）。
- **active→trash 差集**：跟随删除时，仅"本地实读正文 `sha256==远端 hash`"才复用本地、否则 GET 权威内容（**加固点**：不盲信 `contentHash`——它对 synced 笔记是 `baseHash` 缓存、不读盘）。
- **并发**：正文对象并发上传 `UPLOAD_CONCURRENCY=4`；**P3-4 跨笔记资产扫描并发** `NOTE_UPLOAD_CONCURRENCY=2 × ASSET_CONCURRENCY=4 = 峰值 8`（对齐七牛建议，原 16 偏高）。
- **manifest 链**：`MANIFEST_CHAIN_KEEP 8→3`（回归设计 D4 的 O(3)）+ `pruneOldManifests` 滞后裁剪（超 target+SLACK 才裁，链回捞退出每同步热路径）；prune/gc-reconcile/deep-cleanup 共用该常量。
- **健壮性**：并发 worker 一律"按索引收集错误、池后抛首个"（无 unhandledRejection）；**资产扫描失败的笔记不 markSynced**→保持 local 下轮重扫（防"空声明发布→GC 误删"）。

### 2.3 压测（opt-in，`LAKE_RUN_BENCHMARK=1` 才跑，CI 默认 skip）
- `src/core/syncEngine.benchmark.test.ts`（Tier A 离线计数）、`electron/syncStress.benchmark.test.ts`（Tier B 真实云，隔离前缀+自动清理+凭证仅环境变量）、
  `src/core/syncEngine.dualStress.benchmark.test.ts`（Tier C 双端 A/B 冲突）。报告 `docs/STRESS-260903.md`。
- 关键实测：元数据 churn 真实云 **18.4s→5.0s→（差集+并发）稳态 <1s**；首传 240 图 HEAD **240→0**；manifest 回捞 **~4.3/发布→~1.25**；双端 600 冲突→600 历史快照、1000 篇回收站传播正确。

### 2.4 知识沉淀
- `AGENTS.md` §3 新增不变量 **#11（清单声明⇒存在：禁逐对象 HEAD/禁陈旧缓存；含两前提：无带外删除、资产按 filename 内容寻址；下载侧对称差集）**、
  **#12（未分类惰性）**、**#13（S3 并发峰值 8）**。审计报告（外部 GPT）在仓库外 `../AUDIT-s3-sync-260903.md`、`../AUDIT-dejavu-alignment-260903.md`。

### 2.5 UI 精仿思源（260904，用户验收中·未合入）
- **决策**：设置面板/浮层从「自研 settings-* + 内联样式」整体切到思源版式语法（详见 `AGENTS.md §3 #14`）。
  思源组件 SCSS 本就 vendored 在 `src/b3/siyuan/`，只是我们没用它——所以这次是**接线**，不是新造一套。
- **新增** `src/b3/siyuan/business/_config.scss`（署名移植）：`config-group/title/items/item/name/block/readonly/stats/assets/empty`；
  `overlays.css` 收编为「设置骨架 + 浮层通用件 + 本地小件」三段；`siyuan.scss` 补挂 `util/function`（`fn__space/fn__size200/ft__error/fn__kbd` 之前根本没加载）。
- **SettingsPanel**（767→~840 行 JSX 全重写）：`Group/Item/Block/Switch/Seg/NumField/TextField/Shortcut` 原语替代散落 `style={{}}`；
  数字框不再拉成整行（原「回收窗口 7」占满 1400px 就是它）、S3 长文本 360px、GC 删除记录/待回收明细/日志改 `.config-readonly` 等宽框、体检结果 `.checks` 分行配色。
- **资源页**（用户点名「丑出天际」）：分组清单 + 状态徽章 + 单行省略 + **hover 才出现的图标操作**（复制/位置/删除）+ 预览按思源 设置-资源 的**竖向布局**（清单在上、大图预览在下，`config-assets` flex-direction:column）——先做成右侧窄栏过，图片看不清，已改回竖向。
- **HistoryPanel**：孤儿文件 tab 从「整宽列表 + 删除按钮漂在最右」改成 左 320px 列表 + 右内嵌预览（图片/文本；历史弹窗沿用思源历史面板的横向分栏，不像设置页那样竖向），
  工具条（摘要 + 清理全部）上移；**删掉孤儿预览模态框**（`history-preview-backdrop` 那套），统一走内嵌预览。
- **TrashPanel**：行改 `.b3-list-item` 两行密度（标题 + 元信息），恢复/彻底删除改 hover 图标；`回收站/正文已删/已被他端删除/N 天后清除` 统一 `.badge`；
  文档/小记 tab 用 `ln-tabs`（与历史弹窗同一套）。
- **删除**（不留兼容层）：`.settings-group/row/choice/toggle/field/hint/body`、`.shortcut-list/.shortcut-row`、`.trash-item*`/`.history-item*`/`.trash-tabs`/`.history-tabs`/`.history-create`/`.history-clean-all`、
  `quick-notes-trash-*`（无使用者）、`b3/components.css` 里与 overlays 打架的 `.settings-nav-item.active`/`.settings-choice`。
- **修 bug**：回收站/历史弹窗「数据一多，左侧列表盖住顶部提示文字」——根因是浮层 flex 列里 `.trash-panel-hint/.history-hint/.ln-tabs/.ln-toolbar/.trash-error`
  默认 `flex: 0 1 auto` 被压扁、溢出文字被后绘制的列表盖住；已给这些固定区 `flex: 0 0 auto`（`styles.css`，实测 200px 高面板不再重叠）。
- **第二批（同日，用户验收反馈后）**：
  - **页签存在感**：只给选中项灰底时看不出「这是两个横向 tab」（用户点名）。改成**分段控件**——`.ln-tabs__track`（`--b3-theme-surface` 轨道 + inset 描边 + 圆角）+ 选中项白色浮起段（`--b3-theme-background` + 主色字 + 轻投影）；历史弹窗与回收站共用。JSX 里 tab 项要包进 `.ln-tabs__track`，动作按钮（创建快照）留在轨道外。
  - **搜索面板 / 同步状态 popover / 小记工作台**收进同一套：结果行与冲突快照行改 `.b3-list b3-list--background` + `.b3-list-item`(+`__graphic/__text/__meta`) + `.badge`（命中位置徽章），空态统一 `.ln-empty(--idle)`，popover 结构色由 `--lake-*` 改 `--b3-*`、设置按钮改 `b3-button b3-button--outline`；小记的三段 hex 覆盖层（1287-1306 / 1462-1466 / 基础层）**合并成一段令牌派生块**（紫色身份用 `--shell-hue`，不再写死 `#5d5a86` 等）。
  - 顺带删除：`.search-result*`、`.search-panel-empty*`、`.quick-notes-empty/-loading/-no-notebook/notebook-list 自绘 hover`、`b3/components.css` 里重复的 `.search-result:hover/.settings-nav-item:hover`。
- 门禁：`tsc` 0 · vitest 815/15 · 桌面+移动 build 全绿；深浅主题与真机 DOM 量测（CDP）逐页复核。
### 2.6 「看不见的文档」数据 bug 根因 + 修复（260904，用户报：资源页出现本地/回收站都没有的欢迎文档，2 个资源既不能看也不能删）
- **实数据证据**：`deleted_notes` 里 `notebook-personal`（folder 墓碑，deleted_at 09-02 12:21:22，**purged_at 已被清空**）；
  而 `tree_nodes.welcome-note.created_at = 09-02 12:22:50`（**purge 之后 88 秒被重新导入**），`parent_id=notebook-personal` 指向已不存在的目录
  → 侧栏/回收站都渲染不出来，但 `notes` + 云端清单条目 + 09-02 13:48 的历史快照都活着 → 它的 2 个资源被历史引用 → 「历史保护」不可删；
  那 2 个文件是 89 B / 93 B 的伪 PNG（09-02 粘贴测试残留），所以预览还是破图。
- **洞 1（保护是临时的）**：`isFolderPurged()` 看 `purged_at IS NOT NULL`，而 `markPurgeSynced()` 在 S3 前缀删除成功后会清空 `purged_at`（防重复删前缀）
  ⇒ 前缀一删完，"本地已彻底删除该目录"的判定就失效，陈旧清单里的目录会被重新导入、其子文档落到不存在的父下。
  **改成永久判定**：`deleted_notes` 存在 `node_type='folder'` 墓碑即视为已 purge（该墓碑只由 purgeTrashItem 写、软删不写、也不会被 revoke）。
- **洞 2（墓碑漏写）**：`purgeTrashItem` 里 `if (meta) tombstone.run(...)` —— `notes` 行缺失（漂移）时**不写 note 墓碑** → 云端从不下架 → 必然复活。
  **改成无条件写**：元数据从 `tree_nodes` 兜底（同一棵树的权威副本）。
- **诊断补位**：`runDataHealthCheck` 新增 `treeChecked` / `treeDanglingParent`（父不存在的节点=「文档凭空消失」这一类），设置-文档与历史 的体检结果同步显示。
- **顺手修误报**：哈希比对原先对所有有基线的笔记做，本地"已编辑待上传"（`sync_state='local'`）必然与基线不同 → 天天误报"可能被外部改动"。
  改为**只比对 `sync_state='synced'`**（我们自认与云端一致的那些）；相应既有测试补 `sync_state='synced'` 前置。
- **已清掉这条脏数据**（dev 库，一次性 SQL + 删文件，非兼容代码）：写 `welcome-note` 的 note 墓碑（`deleted_at/purged_at=now`、`published_at=NULL`）
  + 删 `notes/tree_nodes/note_history/orphan_assets/notes_fts/sync_base/declared_assets` 行 + 删 `notes/welcome-note.lake`、`note-assets/welcome-note/`、`history/welcome-note/`。
  ⇒ 下次同步会发布 `deleted:true` 并删云端 `objects/welcome-note-*`、`assets/welcome-note/` 前缀，其他端跟随，不会再复活。**我没有替你点同步**——点一次即可下架。
- 回归测试 4 个（folder 永久判定 / notes 行缺失仍写墓碑 / 树完整性 / 哈希只比 synced）：`electron/store.test.ts`。



### 2.7 关于页重做（260904，用户：「还有什么能模仿思源做得更好的」→ 讨论后定 A+B+C+D+E）
- 思源的关于页其实只有两块（版本 + logo/信息），**没有**数据路径/存储占用；所以我们仿的是它「可核对的元信息」这一意图，不是抄布局。明确**不做**：检查更新/更新渠道（我们没有发布服务，做了就是假设置项）、把危险操作搬进关于页。
- **新增只读 IPC**（`electron/ipc/registerSystemInfo.ts`，已在 `main.ts` 装配；preload 暴露名是 `lakeNative`，不是 lakeApi）：
  - `get_system_info` → 应用版本（`app.getVersion()` 兜 package.json）、Electron/Chromium/Node/平台、**pin 的依赖版本表**（读 `app.getAppPath()/package.json`，含 lakex 内核）、路径、`store.getStorageOverview()`、小记数。
  - `reveal_data_folder(kind)` → **白名单枚举**（data/workspace/logs/assets/history/quickNotes），路径由主进程拼；未知 kind 抛 `IpcInputError`；目标不存在退回父级。绝不接受渲染层传路径（对齐 `read_app_log` 口径）。
- `store.getStorageOverview()`（只读）：笔记/笔记本/分组同口径（**排除回收站里的**）、小记、资源文件数与体积（`note-assets` 浅两层遍历，不全盘扫）、历史快照数与体积（读 `note_history` 的 size，不遍历）、库文件字节、回收站节点/删除墓碑/孤儿登记数。
- 关于页 5 组：关于（版本+一句话定位）/ 版本与运行环境（kv 表）/ 数据与存储（config-stats 概览 + 4 条路径行带「在 Finder 中显示」）/ 诊断（**复制诊断信息**→剪贴板，反馈问题时直接贴）/ 第三方与许可（思源 AGPL 署名、lakex 闭源、开源依赖清单）。
- 新样式件：`.kv/.kv__row/.kv__k/.kv__v`（等宽键值表）、`.config-item.item--path .b3-label__text{word-break:break-all}`（路径必须看全，思源的 desc 默认单行裁切）。
- 测试：`electron/ipc/registerSystemInfo.test.ts`（白名单拒绝任意路径 / logs 定位到文件 / 版本表解析与缺文件降级）+ `store.test.ts` 概览 2 例。计数：vitest **824 passed / 15 skipped**。

### 2.8 设置页条目级搜索（260904，H 项）
- 此前设置搜索只能跳分类；现在对齐思源：**每条设置都可被搜到并定位**。`settingsSearch.ts` 新增 `SETTING_ITEMS`（55 条：id + 分类 + 标题 + 同义词）与 `searchSettingItems`（多词=每个词都命中，如「回收 窗口」）。
- 行原语（Item/Block/Switch/Shortcut）接 `itemId` → 渲染 `data-set-id`；导航下方出现「条目 · N 项」结果列表，点击/回车 → 切分类 + `scrollIntoView` + `.is-hit` 闪 1.5s，当前分类内命中行留 `.is-match` 左指示条。
- **故意不学思源隐藏非命中项**（用户会以为设置被删了），只标注。
- 反漂移：`settingsSearch.test.ts` 读 SettingsPanel 源码比对 `itemId="..."` 集合与注册表（新增/改名/删行不同步就红）；id 唯一、分类合法、标题非空。
- 坑：把「当前分类」补回被过滤空的导航时，「唯一命中自动切分类」的判断必须只看 `filteredNav`，否则永远凑不出 `length===1`（已踩并修正）。
- 计数：vitest **828 passed / 15 skipped**。

## 3. 真正的待办（已剔除全部完成项，按优先级）
**性能/健壮性（本轮延续）**
1. 资产/正文 PUT 的**对象级 5xx 重试 + 池 fail-fast**（当前靠 #2.2 的"失败不 markSynced→下轮重扫"兜底，属缓做）。
2. **快照 gzip 异步化**（`electron/store.ts` 搜 gzip：15min 自动快照 gzip 现主进程同步跑；改先异步压缩、回调内事务写库，**时序不可反**）。
3. **P4-1 FTS 启动全量重建 → 增量**（`src/core/searchRepository.ts`：现每次启动 DELETE 全部 + 逐条重插；加 `updated_at`/旁表记账，只重建缺失/过期。可动 FTS schema，dev 可删重建）。
4. **FTS 1/2 字短词搜索回退**（trigram 只索引 ≥3 字符；短词走「标题+正文 LIKE」回退或提示）。
5. 笔记本新建跨端 `sort_order` 撞号（可选：新建取同级 max+1）。

**移动端编辑遗留（未决，需用户给具体现象）**
6. 「电脑剪贴板数据」注入移动端编辑器**不解析/内容为空**（含/不含 base64 图标都为空）——根因未定位。
   **静态线索（未验证）**：`installPasteInterceptor()` 原本只在桌面入口 `src/main.tsx:35` 调用，移动端入口没有，`src/mobile/` 里 paste/clipboard 代码为 0 处
   （bookmark 卡降级仍生效，因为它挂在共享的 `src/features/editor/lakeRuntime.ts`）；另一嫌疑是粘贴含 `data:image/png;base64` 大图标时移动端无远程/图片处理路径。
   android worktree（见 §0）已补挂该 interceptor 并实现原生下载 ⇒ **下一步先在那条线上验证，而不是从零开始**。
7. 移动端本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` **真机不可达**（手机 127.0.0.1 指自己）：需 `adb reverse tcp:19876 tcp:19876` 或移动端解析为可达地址。
8. 用户反馈「移动端整体编辑还有问题」——**现象未细化**，待复现。

**产品/技术债（长期）**
9. 大纲 **viewer（只读）点击标题不跳转**（`OutlineSheet` 用 `headingUnfold`+`scrollByNodeId`，viewer 下静默失效；用户计划重做大纲时一并处理）。
10. **回收站首拉成本**（批量删除后接收端首拉仍下全文+资产）——惰性下载方案**暂缓**（要动恢复红线：恢复上传时资产清单必须全，否则他端 GC 误删）。
11. Word/PDF 导出（`electron/export.ts` 已预留 docx/pdf，待实现）；附件大文件 S3 分片/断点续传（一期后）。
12. **Lake 内核策略**：A lakejs 开源源码当"机制字典"；B 版本锚点 + hack 清单（vendor lakex 已 pin，勿随意升级）；按需最小 patch，**不整体 fork**（拿不到闭源源码）。
13. Store 分批重构（`docs/REFACTOR-PLAN-2026-08-17.md`，按领域继续、严禁一次改事务边界）；移动端复用专项（查询层→文件层/adapter）。
14. W-8 ACAO / W-10 dompurify（并入"lake 资源导入统一优化"）。依赖维护：`@types/better-sqlite3` 可单升。

**非代码**：安卓同步偶发 `UnknownHostException` = 设备网络（联网重试）。

## 4. 踩过的坑（本会话新增；通用红线/环境见 AGENTS.md）
- **文档漂移**（2026-09-03 清理）：`AGENTS.md`/`README.md` 曾长期残留旧分支名 `feat/electron-43-upgrade`、Electron 33/better-sqlite3 11、
  82/188/217 测试计数、"SSH key 未注册必须 HTTPS 推送"、失效的参考仓库路径（`siyuan/`、`local-lake-notes-devlop/`）；`docs/PROGRESS.md` 还被 README 标成"★最新交接"。
  ⇒ 已在 `AGENTS.md` §2 定了分工：**易过期事实（分支/hash/计数/当前焦点）只写 HANDOFF §0**，别把这些数字写回 AGENTS/README。
- **`git worktree list` 要纳入开工检查**：android worktree 的未提交 WIP 曾完全没进交接，几乎导致重复劳动（现已记入 §0/§3.6）。
- **`defaultNotebookId()` 急切调用 = 空库同步凭空建「未分类」并上传扩散**；改惰性后，`effectiveParent()` 也只能在"真应用"处解析（冲突探测等 skip 路径调它照样会建）。
- **hooks 必须在早退之前**：`SettingsPanel` 里 `if (!open) return null;` 之后还有一堆 `const handler = ...`，我把新加的 `useState/useEffect` 顺手插在那片区域 → 「Rendered more hooks than during the previous render」→ **整个 React 树卸载**（`#root` 变空，表现为"应用白屏/按钮全没了"，很容易被误判成 GPU 崩溃）。加 hook 一律放到组件顶部的 state 区；排查用 CDP 注入 `window.addEventListener('error')` + `Page.reload` 看真实堆栈。
- **CDP `Input.dispatchMouseEvent` 在 `Page.reload` 之后可能点不动**（窗口非激活时），`element.click()` 仍可靠；验证 UI 用 JS click，验证真实交互（拖拽/悬停/剪贴板）才用鼠标事件。
- **`purged_at` 不是"已彻底删除"的永久标记**：`markPurgeSynced()` 在前缀删除成功后会清空它（防重复删）。任何"别把这个复活"的判定都必须看**永久墓碑**（folder 看 `deleted_notes.node_type='folder'`），否则保护只活到下一次同步。
- **`purgeTrashItem` 的墓碑必须无条件写**：`notes` 行缺失时跳过 = 云端永不下架 = 之后必然复活成"父不存在的不可见文档"（本次实数据就这么踩的）。
- **改 `electron/*.ts` / `src/core/*` 会热重载重启 Electron → 又命中 GPU `exit_code=15` 把整个 dev 实例带走**（本轮两次）。改主进程后要么先重启再验证，要么按 HANDOFF §6 用带 `--use-angle=metal` 的方式起；`nohup` 起的 dev 会随会话回收而死，**必须 tty 长驻**。
- **`contentHash` 会骗人**：`syncAdapters.localHashOf` 对 synced 笔记返回 `store.baseHash`（**不读 .lake**）；判"本地可复用"必须**实读正文 + sha256**，否则文件被外部删/坏时把空内容写进回收站（缺口2 加固的教训，与缺口1"验真实字节"对称）。
- **不要给"资产存在性"做本机持久缓存**（GC 会真删对象→缓存失真→破坏跨端自愈，正是当年删缓存的原因）；用"刚下载的远端清单"做差集才对。
- **S3 并发峰值 ≤8**（七牛建议），`NOTE(2)×ASSET(4)`；曾 16 偏高、无必要。
- **改主进程文件（`electron/*.ts`、`src/core/*`）→ vite-plugin-electron 重启 Electron → 命中未带 `--use-angle=metal` 的 GPU `exit_code=15` 崩溃**；fresh `npm run dev` 一般不崩、**热重载才崩**。改完别再动主进程文件、或重启一次即稳。
- **裸驱 CDP 无需第三方库**：nvm Node **v24 有内置 global `WebSocket`**；页面 target 在 `http://127.0.0.1:9222/json`。可点同步按钮 `button[data-sync-status-button]`、合成 `ClipboardEvent`+`DataTransfer` 粘贴（文本/图片）做真机验证。
- 压测真实云用一次性前缀 `lake-stress-<ts>/`，**结束必 `deletePrefix` 清场 + 复核 0 残留**；凭证只走环境变量、绝不入库。合成 `Readable` 走流式 PUT 在七牛会大面积超时→测脚手架用字节 PUT 路径更稳（真实文件的流式在 app 里正常）。
- `better-sqlite3` 是 **N-API**（Electron 和 vitest/node 都能加载）；命令行查库：拷 `.sqlite3`+`.sqlite3-wal` 到别处用 `/usr/bin/sqlite3 -readonly`（app 在跑时读快照）。
- S3 `[perf]` 日志里 head/put-stream 行尾数字是 **epoch 时间戳不是耗时**（旧坑，现 head 已移除）。
- 幂等/删除语义红线：软删=移动到回收站笔记本（`parentId=TRASH + trashedAt`，**非 `deleted:true`**）；`deleted:true` 只用于 purge 墓碑。混用=B1 致命 bug。

- **浮层 flex 列的固定区必须 `flex: 0 0 auto`**：`header/页签/提示条/错误条` 默认 `0 1 auto`，内容一多就被压扁，溢出文字被**后绘制的列表列盖住**（就是用户报的「回收站左侧列盖住顶部文字」）。复现法：CDP 把面板高度压到 200px，比对 `Range` 文字底边与列表 `top`。
- **思源组件 CSS 早就 vendored 在 `src/b3/siyuan/`**（`main.tsx` 里 `siyuan.scss`），做 UI 前先查它有没有现成件，别再自研一套 `settings-*`；`util/function`（`fn__*`/`ft__*` 工具类）此前**没被 @use**，所以 `fn__size200`/`fn__space`/`ft__error` 一直是死类名。
- **`text-clamp` 混入不等于省略号**：vendored `.b3-list-item__text` 只有 `overflow:hidden`，长文件名会把 `__meta`/`__action` 挤出列宽——需自己补 `min-width:0 + text-overflow:ellipsis + white-space:nowrap`。
- **lucide 图标直接把 `className` 给 `<svg>`**：`el.className` 是 `SVGAnimatedString`（`.replace` 会炸），且思源的 `.b3-list-item__graphic svg{}` 选择器匹配不到；要包一层 `<span className="b3-list-item__graphic">`。
- **同一元素被三层 CSS 覆盖**（styles.css → b3/components.css → overlays.css）会互相打架：本次把设置/浮层视觉**收口到 overlays.css 单层**，并删掉 components.css 里的重复规则；改 UI 前先 `grep` 类名看有几处定义。
- **同一元素上「组件类 + 场景类」会互相覆盖**：`.badge`（overlays.css，后加载）赢过 `.quick-notes-count`（styles.css，先加载）。跨层加 modifier 时要么写进**同一层**（如 `.badge--accent/--muted`），要么别指望场景类能覆盖组件类。
- **密集列表行不要做 `:active scale()`**：28~40px 的行按压缩放会抖字、与滚动条抢空间（思源只给 hover 底色）；按压反馈只留给独立卡片（小记）。

## 5. 下一步建议（新会话）
1. 先跑 §6 门禁确认基线；有问题先测再改。
2. 待办优先做 **§3.2 快照 gzip 异步化**（小、独立）→ **§3.3 FTS 增量**（收益大）；移动端 §3.6/3.7 **需先找用户复现/拿现象**。
3. 任何同步/GC 改动**先读** `AGENTS.md #11/#12/#13` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`（红线密集区，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立"）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
# 开发（CDP 9222；改主进程文件会重启、可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm run test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）——端点/桶见 dev 配置：s3.cn-north-1.qiniucs.com / cn-north-1 / local-lake-hebei
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
```
- 安卓：`export JAVA_HOME=.../jdk-21.jdk/Contents/Home`（AGP 要 ≥11）；SDK 在 `/opt/homebrew/share/android-commandlinetools`（`android/local.properties`，gitignore）；
  `npx vite build --config vite.mobile.config.ts && npx cap sync android && (cd android && ./gradlew assembleDebug)`；`adb` 在 `/opt/homebrew/bin/adb`；真机资产可达需 `adb reverse tcp:19876 tcp:19876`。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`。数据目录：dev 可删重建；正式数据 `lake-notes-electron` **禁碰**。

## 7. 文档索引（`docs/` 仍在，非交接、按需查）
`AGENTS.md`（红线/机制/坑，必读）· `SYNC-PROTOCOL.md` · `S3-GC-DESIGN.md`（GC/保留链）· `TODO.md`（待办总表，§3 已摘要）· `PROGRESS.md` ·
`ANDROID-TECH-SCHEME.md` / `MOBILE-TECH-STACK.md`（移动端）· `ARCHITECTURE.md` · 各 `*-AUDIT/*-REVIEW/*-DESIGN`（历史评审/设计，背景用）。
> 注：`docs/` 里若干 `*-HANDOFF`/`AUDIT`/`PERF` 是过程记录，权威待办以本文件 §3 为准。
