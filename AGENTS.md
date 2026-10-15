# Lake Notes Electron — 项目记忆（AGENTS.md）

> 本项目的**长期记忆**，每次会话自动加载。接手顺序 **README → HANDOFF → AGENTS**：README 看概览，HANDOFF 看当前状态/待办/坑，本文看长期红线与机制。
> **本文只写长期内容**：分支名、commit、测试计数、当前焦点等易过期事实一律进 `HANDOFF.md`。
> **硬约束：本文不得超过 64KB 指令预算**（超了尾部会被截断 ⇒ §8 直接看不见）。新增内容前先删等量旧内容，**不要把 HANDOFF 该装的东西搬进来**。

## 1. 项目是什么

Lake Notes = **本地优先**笔记应用：Electron 44.3 + React 18.3 + better-sqlite3 13 + 语雀 Lake 内核 + S3 同步（七牛 Kodo，S3 兼容）。**本地是真相，S3 只是镜像。**

- 目录 `/Users/admin/file/local-lake/lake-notes-electron`；主分支 `master`（唯一持续演进的业务分支，历史分支已合入并删除）
- Node **必须 24**（`$HOME/.nvm/versions/node/v24.18.0/bin`）
- **目标量级 = 10 万文档 / 100 万附件**：性能与同步决策按此验证，**别用"小库正常"下结论**

## 2. 长期方向与文档分工

- **长期焦点**：同步/存储热路径的性能与健壮性、移动端编辑收口、可维护性（安全/IPC/资源服务/渲染层职责/测试覆盖/拆大文件）。**待办只在 HANDOFF §3**。
- 先修 Critical/Warning；**不在没有测试护栏的情况下做大规模架构重写**。
- **内核（lakex）资料检索顺序**（凡涉及内核 API/配置/命令必走）：
  ⓪ 先翻 vendored 源码树 `vendor/lakex-doc-react/src/**` ——**按「能力」搜**（类名族 `ne-card-toolbar`、图标族 `ne-t-*`），别只盯运行时 bundle。⚠️ 包里大量成品组件只挂在 vendor 的 `LakexEditor` 入口上，而我们是直接 `Doc.createOpenEditor`（`lakeRuntime.ts`）⇒ **那些组件在我们的产品里从不运行**。
  ① **官方出处优先** `/Users/admin/file/local-lake/yuque-developer-docs/`（编号主题：47 通用配置 / 07 API与事件 / 08 命令列表 / 48 适配器 / 65 大纲 …）：**先确认官方有没有这个能力与语义**，有就走官方途径，别反编译猜用法、别写私有 hack。
  ② **本项目契约** `docs/LAKEX-CONTRACT.md`（已核实行为 + 调试速查）：**新观测必须回填此处**，别只留在 HANDOFF 或代码注释。
  ③ **源码字典对照** `lake-editor-main/`（第三方 VSCode 插件）与 `lake-main/`（lakejs 社区版，**序列化方言已分叉、结论不可套用**）。
  **最终仲裁 = vendor bundle `vendor/lakex-doc-react/src/components/lakex/lakex.js` + 运行时实测**（冲突时以实测为准）。
- **内核已 vendored 并 pin（v1.99.0），不要随意升级**；必须改行为时按 `vendor/lakex-doc-react/LOCAL-CHANGES.md` 最小改。
- **表格 = 第三方 Univer**（`@univerjs/*` 全部精确锁版本）：动之前先读 `src/features/usheet/usheetKernelContract.ts`（每处触点写了失效表现）；**升级只走 `docs/USHEET-UPGRADE.md` 的 playbook**（静态护栏 `univerContract.test.ts` + 运行时探针 `scripts/usheet-kernel-probes.mjs`），一次全升、**不要 npm update**。对 Univer 只有**一处**补丁 `patches/@univerjs+ui+1.0.3.patch`（内核把 floating 层 portal 无条件挂 body ⇒ 逃出标签宿主）；**除它之外不要再给依赖打 patch**。
- **多维表 Grid / 关联选择器的行窗口**：动视口或屏外交互前读 `docs/BITABLE-VIEWPORT.md` —— 记录全集不裁剪，主表/选择器共用一套有界行窗口；缓存不留滚过的全格；编辑/IME/选区/粘贴/统计/填色/搜索必须按完整模型验证，**只读与保存/历史协议不因性能改动放宽**。
- **文档分工（防漂移）**：`README` 概览（不维护进度/计数）· `HANDOFF` 唯一交接 · `AGENTS` 长期红线。**已完成的研究/计划/spike/审计直接删**（git 可查），不建 archive 目录。

## 3. 核心设计原则

1. **本地是真相，S3 只是镜像**：数据不丢由本地保证（回收站软删保留文件、历史快照、恢复标记），S3 只用于多端同步。
2. **目录强一致性是同步的基础**：删除必须传播到所有端（墓碑权威）。
3. **墓碑权威（删除压编辑）**：A 删除后，B 的编辑无论早于还是晚于删除都抵抗不了墓碑（删除 = 判定该文档无效，继续编辑是在错误方向工作）；被删侧的本地编辑**强制留档**（历史快照）；小记不备份（随手记语义，丢了就丢）。
4. **恢复是唯一显式例外**：从回收站恢复 = 明确撤销删除 → 写恢复标记（`notes.restore_pending_at` / `quick_notes.restore_pending_at`）→ 同步 local-wins、上传 active 覆盖墓碑并传播；标记在 `markSynced` 时清除（残留 ⇒ 墓碑永胜失效）。
5. **墓碑携带删除前内容**：墓碑 `contentHash` 填**真实 hash**（删除方软删保留 `.lake`）；他端下载**先拉内容再应用墓碑**（先内容后标志）⇒ 回收站/恢复拿到的是删除方最新编辑版。旧占位符墓碑靠容错下载天然兼容。
6. **同步顺序**：先拉远端（带冲突判定地合并）→ 再推合并后的本地。
7. **不为旧数据写兼容/迁移**：判断标准 = **"这些数据能否删了重建？"能，就绝不写兼容**。
8. KISS/DRY；不引入未经验证的抽象、不加无谓依赖（见 17）。
9. **多表写必须事务**（`db.transaction`）。
11. **资产存在性 = 远端清单声明差集**（对齐思源 dejavu）：`manifest.notes[].assets` 就是「云端在用集」的权威快照（先对象后清单）；**禁止逐对象 HEAD/GET、禁止"本机记过=已上传"的持久缓存**。上传只对"清单未声明的缺失资产"PUT，但 `manifest.assets` **永远全量声明**（裁剪 ⇒ 他端 GC 误删在用资产）。下载侧同样走差集：按本地实扫 size+sha256 跳过；`active→trash` 仅在**实读正文 sha256 相等**时复用本地。两个契约外前提（只记录、不写检测）：① 无带外删除；② 资产按 filename 内容寻址（`buildAssetFilename` 保证同名同内容）。
12. **兜底"未分类"笔记本只惰性创建**（真正回落到兜底父时才建；不在下载或冲突探测里提前解析）。
13. **S3 并发上限 = 8**：正文 2 × 资源 4；正文上传 4 / 下载 4 各自 ≤8 且与资产阶段串行。**不得**为吞吐调到 16+。
14. **桌面 UI = 自有设计系统**（规格在 `DESIGN.md` + `.impeccable/design.json`）：
    - **令牌是唯一来源**：颜色/圆角/间距/字号/动效只用 `--lake-*`，定义在 `src/styles/themes/*`；**颜色字面量只允许出现在 themes/**。字号一律 `--lake-font-size-*`（离档值向上取档；要整体抬一档就改 `themes/base.css` 的令牌值）。
    - **同一个交互语义，全仓只能有一套视觉与几何**：改前先 grep 复用；一旦又写一套（新类名/近似几何/另一套间距）**先合并到单一来源**。权威单一来源：行/菜单/图标钮/输入/页签/省略 = `kit.css` 的 `ln-*`（`.ln-row.is-selected` · `.ln-menu__item` · `.ln-iconbtn` · `.ln-tabs`（横向页签唯一）· `.ln-input__field` · `.ln-ellipsis` · `.ln-imgfill` · `.ln-tip`）；浮层表面 = `components/ui/Overlay.tsx` 的 `.ln-dialog/.ln-menu/.ln-popover`（**不要手写 createPortal**）；浮层定位 = `usePopoverPosition` + `topMenuPosition.placeVertical`（**禁止估算高度自己夹**）；分栏分隔条 = `components/ui/SplitHandle.tsx`；附件/图片展示 = `AttachmentChipList` + `FileKindIcon`/`fileKindOf()`；表格与多维表「添加」= `.bt-add-round`；Markdown = `components/markdown/MarkdownView.tsx`；AI 正文 = `features/ai/AiMessageBody.tsx`、AI 结果落库 = `selectionToolbar/aiResultOps.ts`、AI 附件解析 = `electron/ai/aiContentResolver.ts`（跨 IPC 只传 `{noteId,filename}` 引用，字节只在主进程）、AI 消息块模型 = `core/aiProviders.ts`；应用内选色 = `core/colorPalette.ts`（最近使用按入口分桶；Lake 编辑器走 `LakeColorBoard` 适配器）。**判定数据只认** `scripts/css-audit/audit-lookalike.mjs` 与 `audit-primitives.mjs` + 实机几何。**两条已结案、别再立项**：面包屑链接 `.protyle-breadcrumb__item` 与小记列表行的主区按钮 `.quick-note-index-main` 都是**行内可点击文本条目**，**不并入** `.ln-row`/`.ln-input`。
    - **层序即优先级**：`@layer legacy, tokens, reset, kit, shell, feature, overlay, a11y`；新样式写进对应层即可压过旧样式，**不靠特异性/!important 取胜**。`!important` ≤10，新增必须写明理由（仅限"要压内核/第三方写进 element 的 inline style"）。
    - **改落点**：找到根位置**就地改**，禁止一层层套覆盖；组件里不写 `style={{}}`；不要用 emoji/系统字形当图标（图标只有 lucide，描边 1.75）。
    - **两条护栏**（改样式必跑）：`src/styles/cssLayers.test.ts`（逐文件声明数/重复组只许降）+ `node scripts/ui-metrics.mjs`（b3 引用 0 / 非主题颜色 0 / 字号字面量 0 / !important ≤10 / 入口 b3 import 0）。
    - **文字色阶口径**：`--lake-text-*` 按「实际会铺到的最浅/最深表面」标定（text-3 浅/暖 `#5f6874`、深 `#9398a1`；text-4 是**有意的 3:1 档，不要提亮**）。**文字一律用 `--lake-accent-text`**；`--lake-accent` 只做图形/边框/焦点环/底纹。
    - **死 CSS 判定**（`scripts/css-audit/audit-dead-css.mjs`，报告非门禁）：判"没人用"必须排除 ① 内核/第三方命名空间（`ne- ant- lakex- plait- univer- b3- fn__`）② 动态拼接类名（**串中间的拼接也要算**）③ 设计词表（`kit.css` / `themes/` / `fonts/` / `kernel-theme.css` / `compat.css`）。只删「确认无人施加」的规则块，删完跑走查对拍（截图与探针应逐项不变）。
    - **思源层已整体移除**：`src/b3/**` 已删；仅 `.b3-*`/`fn__*` 类名作 JSX 契约保留（承重规则在 `src/styles/compat.css`）。**不要再引入 `src/b3/*`**。
    - **设置页**骨架 `.config-*` 由 `compat.css` 定义；**每加/改一行必须同步 `settingsSearch.ts` 的 `SETTING_ITEMS`**（护栏 `settingsSearch.test.ts`）。
    - **碰内核的细节**：内核用 `focus()` 聚焦普通 `div[tabindex]` 时要补我们自己的 `:focus-visible` 环；碰到库里的**模块级单例**（缓存/标志位）时判据必须**限定在本实例容器内**（`.contains(document.activeElement)`），多实例挂载会串台。
15. **"已彻底删除"的判定必须永久**：`deleted_notes.purged_at` 只是"待删前缀"的工作标记（前缀删完就清空）——folder 看 `node_type='folder'` 墓碑、note 看其墓碑。purge **无条件**写墓碑（`notes` 行缺失就从 `tree_nodes` 兜底），漏写 ⇒ 云端永不下架、必然复活。
16. **任何打开文档的入口先判 `isGoneNote({parentId, syncState})`**（`core/syncDecisions.ts`）⇒ 已进回收站/被他端 purge 则**只读 + 横幅 + 保存被拦要明说**，绝不静默丢弃编辑；恢复走 `handleTrashRestored`。
17. **拒绝"迎合式找需求"（红线）**：非 bug 改动三问缺一即不做 —— ① 问题真实存在吗（有复现/数据/历史证据）？② 不做会付什么代价？③ 收益是否明确大于新增复杂度？**过度设计信号**：为"统一/优雅/以后可能"加抽象层、把两个本就不同的东西强行合并、用新依赖解决旧依赖能解决的问题、收益只停在"代码更整洁"、只给方案不给反对意见。**宁可少做；不确定时先问"这是真问题，还是我想做的？"**
18. **不清理 vendor/依赖的冗余、未用路径、死代码**（第三方本就带冗余）；必须改行为时按 `vendor/lakex-doc-react/LOCAL-CHANGES.md` 做最小改动。**不要再提议清理依赖侧的死路径。**
19. **多维表条件求值单一来源**：视图筛选 / 关联选择器临时筛选 / 条件填色统一用 `BitableFilterRule/Node`、`filterOperatorsFor()`、`evaluateFilterNode()` 与共享编辑器；字段取值走 `bitableFieldValue()`；**禁止**为某个视图另造操作符/空值语义/条件 UI；填色的 `cell/row/column` alpha 混色与 `rowSide` 语义不得改。
20. **云同步只有一套状态判据（`src/core/cloudState.ts`，两端共用）**：`cloudStateOf()` → `unconfigured|offline|manual|auto`；`canTouchNetwork()` 是「能不能出网」的**唯一**判据，`isCloudActive()` 是 UI（状态灯/禁用态）判据。**关闭云同步 = 完全没配置**（任何路径不出网）；离线文案统一 `cloudStateHint()`。恢复**不等网络**（立刻生效 + 后台补拉 + 明确提示）。护栏：`electron/syncDualAB.test.ts`、`src/mobile/bridgeCloudState.test.ts`。
21. **门禁分层（通用规则，两端各自对应）**：
    ① **每次改动都跑**（≈20s，**这就是"门禁"的正式含义**）：`npx tsc --noEmit` + 相关 `vitest`（全库 ≈10–20s）+ `git diff --check`；改样式再加 `ui-metrics` 与对应侧层围栏。
    ② **只有动了视觉/设备那一层才跑样式/设备装置，且只跑受影响的 1~2 个态/屏**：桌面 `check-stylesnap.mjs --states "…"`；移动 `check-mobile-snap.mjs --states home-quicknotes` + 走查传屏名。**全量**（桌面 42 态 / 移动 6 态 + 23 屏）只在换夹具、改装置、发版前跑。
    ③ **动了外壳几何/构成，或重灌夹具 ⇒ 必须先重烤一次基线**（`--from <warm>.json --write-baseline`），否则下次全量必红；这是一次性成本。
    顺序恒定：**先本地 → 再定点 → 最后全量**。

## 4. 关键机制速览

- **Manifest V1**：只读写 `{1}`（字段沿用原 v7：folders/墓碑/锁/`kind`/board），所有端一起升级。传输/GC/类型见 `electron/{s3Store,s3Maintenance,syncTypes}.ts`，编排 `syncEngineController.ts`。
- **壳层双 origin**：打包版页面 = 私有协议 `lake://app`（`appOrigin.ts` + `appProtocol.ts` 服务 `dist/`），dev 走 vite。**判页面来源禁止比 `URL.origin`**（非特殊 scheme 在 Node 里恒为 `"null"`）⇒ 比 scheme+host（`isAppOriginUrl`）；资产服务白名单/ACAO 要同时放行 `APP_ORIGIN`。**主进程 external 从 `package.json.dependencies` 派生**（+ `@smithy/`），别退回首写清单。
- **冲突四分支**在 `core/syncEngine.ts` 下载阶段；`baseHash`/`lastUploadedHash` 存本地 `sync_base`，**绝不上 manifest**；本地改动被远端覆盖时先强制 `createHistorySnapshot`（`supersededNotes`）。
- `folders[]` 必填；手动同步只发触发窗口、自动同步广播所有窗口；同步/GC/深度清理共用 `enqueueMaintenance` 串行队列（进程内唯一必需互斥）。
- **资产差集**：`scanLocalAssets(..., cloudDeclaredFilenames)`（后者 = 已下载清单声明的 filename；空 = 全量）；跨笔记并发登记 `assetTasks`，环后 `runAssetPool(NOTE_UPLOAD_CONCURRENCY=2)` 回填。
- manifest 链保留 `MANIFEST_CHAIN_KEEP=3`，prune/GC/deep-cleanup 共用 + 滞后裁剪；活动对象恒在 latest 全量快照内。
- 小记独立前缀 `quick-notes/` + 独立库 `quick-notes/metadata.sqlite3`。
- **编辑器「本机视图」= 设备本地**（用户定稿）：当前工作表/缩放/选区/滚动/折叠/画板视口 **不进正文、不标脏、不进 S3**；表格列宽行高隐藏冻结、多维表视图配置仍属文档数据。`onDirty` 只在正文真变时触发。
- **多维表导航 = 设备本地**：`activeTableId`/`activeViewId` 不写正文（序列化恒写第一张表/第一个视图），只写 `localStorage`（`lake-notes-v3.bitable-nav.<noteId>`）。**不要**把导航写回正文（纯导航会触发一次 S3 上传）。
- **互斥域**（判据单一来源 `src/core/maintenancePolicy.ts`；移动端 `mobile/maintenanceLocks.ts`）：**写域**（本地写 + 同步引擎的 DB 片段）／**维护域**（syncNow / GC / 资产补拉）／**高优先域**（用户当场发起、不得排在整轮同步后面的 `syncQuickNote`，判据 `PRIORITY_OPS`）。三条不变量：**I1** 网络往返不得持有写域；**I2** 跨网络窗口的「读 → 标记/落地」必须靠"未变才标 / 未变才应用"守卫（内容 hash），不靠全局互斥；**I3** 同域串行、**禁止同域嵌套**（`KeyedAsyncQueue` 无重入 ⇒ 自锁）。护栏：`electron/maintenanceQueueScope.test.ts`、`src/mobile/maintenancePolicyCoverage.test.ts`。
- **同步要"看得见"**：移动端把「上次同步（时间/结果/失败原因）」落盘并**常驻设置页**（`mobile/syncStatusStore.ts`，设备本地；**写入点唯一** = `bridge.syncNow()`；"离线没尝试"不写）；桌面有 `SyncStatusPopover`。
- **开/关应用各同步一次**（只要 `autoMode !== "manual"`；`manual` 不补，保持真正不出网）：桌面 = 就绪 + `before-quit`（`QUIT_SYNC_DEADLINE_MS=60s` 兜底）；移动端 = 就绪（显式信号：`phase` 离开 booting）+ 回前台 + **进后台 best-effort（失败静默、不做等待）**，自动触发之间在途去重。判据单一来源 `core/syncModes.ts` 的 `shouldSyncOnOpenClose()`；文案 `SYNC_OPEN_CLOSE_NOTE`。**能不能出网仍另走 `canTouchNetwork()`，两条判据别合并**。
  **两个例外（用户定稿）**：① 长按桌面图标「小记」的快捷入口 = **「假单独模块」**：这次会话**不主动发起任何同步**（入口/回前台/进后台全跳，只有点「保存并同步」出网；用户自己配的间隔定时器不在此列），提交后不进列表、停在写作界面可连续记，手动退出 = 直接退 App 回桌面。② **点「保存」而不点「保存并同步」= 用户不着急** ⇒ **不得**替他补一次隐式推送（"这种情况下做什么同步，不能想当然"）。
- **小记「保存并同步」= 单条推送**（唯一来源 `src/core/quickNotePush.ts` 的 `pushQuickNote`；桌面 IPC `sync_quick_note`、移动 `bridge.syncQuickNote` 走高优先域 + 推送后回核）：**必须先读远端清单、只 upsert 这一条、其余条目逐字段原样保留**（清单是单文件覆盖写、**没有 CAS**，覆盖式重建 ⇒ 他端按未声明处理、墓碑/GC 误删）。两条**退回完整同步**的路径（都不静默降级）：云端还没有清单；该条在远端是墓碑且本机无恢复标记（墓碑权威，不许复活）。记账 `setBaseHash` + `markSyncedGuarded`。UI：主按钮**保持原来的「保存 / 小记一下」**，「保存并同步」是**普通按钮**夹在中间；云同步关闭时**置灰 + 给理由**（移动端要有一行可见说明，没有 hover）。护栏 `src/components/quickNoteSyncGate.test.ts`。
- **小记预览 = 快路径 + 内核只读兜底**：自研解析器（`src/features/quickNotes/quickNotePreviewParser.ts`）只画纯文字/列表/媒体（**零内核实例**，冷开不受影响）；出现它还原不了的块（表格/代码块/公式/画板/思维导图/日历/日期/表情…）⇒ **整条卡片交给内核只读视图**（`QuickNoteKernelPreview`，`createLakeDocument(host,"viewer",…)` + `IntersectionObserver` 只挂视口内）。判据 = 解析器自己的 `unsupported` 节点（`hasUnsupportedNodes`），**不另立清单**。⇒ 格式覆盖度由内核保证；「+」插入面板 = 内核全量。
- **小记写作卡工具条 = 用户指定七项**：日期·表情·图片·附件·待办·无序·分隔线（精简掉引用/有序）。唯一来源 `src/features/editor/lakeRuntime.ts` 的 `QUICK_NOTE_TOOLBAR_ITEMS`，顺序由 `quickNoteToolbar.test.ts` 卡住。字符串 id 必须内核有效（**无效 id 会被静默丢弃**）；日期/表情/附件走**自定义工具项类**（`features/quickNotes/quickNoteToolbarWidgets.ts`）；**移动端不提供「展开」**。
- **内核浮层 portal 到 `body`**（`.ne-overlay-container`）⇒ 移动端要覆盖内核浮层**必须用 body 级选择器**（入口已加 `body.lake-mobile`）。
- **移动端 Lake 输入面 = 底部 dock，没有第二条路**：移动端编辑态内核工具栏**整条不存在**（`showToolbar:false` ⇒ `disabledPlugins:["save","toolbar"]`）、块悬浮手柄/选区浮栏不挂载、`/` 斜杠面板不可用 ⇒ **能输入什么只取决于 dock 接线了什么**（桌面固定栏 27 项 + 插入面板 22 项里没接进 dock 的，移动端能显示、不能输入）。新增移动端输入能力一律走 dock。
- **移动端有自己的设计与样式层**（`src/mobile/**`，`mb-*` + 移动端 theme）：**不引桌面样式层**，两端 UI 不共享。
- **目录/知识库节点图标与文内表情输入解耦**：两端各自实现节点选择器与图形；只共享`src/lib/nodeIcons.ts`的目录/编解码与表情数据/最近记录逻辑。移动端节点选择器不得import输入态`EmojiPanel`或使用其`mb-emoji-*`类。**默认资源页**唯一判据`nodeIconPickerMode(nodeType)`：笔记本/分组→图标，所有文档类型→表情；当前保存的资源种类不覆盖这条默认规则。目录图标值仍为≤16字符短串，不改同步字段。
- **移动端入口分工（261014 用户逐条定稿，都是"别再搬回去"型契约）**：
  首页胶囊 = **搜索 · ＋ · AI**（整块长按上滑 = 速记；＋ 短按 = 新建面板），排序/视图与云同步在**顶栏右上角**；
  工作区胶囊 = **文档树 · 标签页 · 大纲 · 切换笔记本**（原「更多」已删 —— 编辑在顶栏、新建在抽屉与行内）；
  工作区菜单里**不许再放搜索 / 设置**（设置 = 首页齿轮；搜索 = 首页胶囊，且是全库范围而非"笔记本内搜索"）；
  目录抽屉 = 笔记本行（**只展示图标 + ＋，不放 ⋮**）+ 每一行 `[⋮][＋]`（行 ⋮ = 新建文档/新建分组/重命名/设置图标/移动到…/历史/属性/删除）；
  **笔记本的编辑入口 = 首页「知识库」长按卡片**（重命名 / 设置图标 / 删除笔记本；**不含**新建文档·新建分组，用户明确去掉）；
  长按唯一实现 = `src/mobile/ui/useLongPress.ts`（卡片 10px 取消；目录行 `moveCancelPx:0`），**别再写第二份计时器**。

## 5. 数据路径与安全

| 项 | 路径 |
| --- | --- |
| 开发数据 | `~/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `~/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| B 端开发数据 | `$TMPDIR/lake-device-b` |
| 日志 | 上面两个目录下的 `logs/lake-notes.log` |
| 只读检查 DB | `workspace-default/metadata.sqlite3`（小记 `workspace-default/quick-notes/metadata.sqlite3`） |

- **移动端 S3 密钥不落 WebView 存储**：走 Android Keystore（`android/**/SecureStorePlugin.kt` + `src/mobile/keystoreSecretStore.ts`），密文在应用私有 SharedPreferences；`localStorageSecretStore` 只是 web/vitest 后端与历史值迁移来源。

## 6. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit && npx vitest run && git diff --check          # 日常门禁（≈20s）
npx vite build && npx vite build -c vite.mobile.config.ts       # 两条构建
node scripts/ui-metrics.mjs && npm run check:core && npm run check:mobileui && npm run check:bundle
# 设备/视觉门禁只在动了那一层时跑，且优先只跑受影响态/屏（口径见 §3#21）
# 起 Electron：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9222 .
# 多端：LAKE_USER_DATA="$TMPDIR/lake-device-b" LAKE_ASSET_PORT=19877 …（启动前临时给 vite.config.ts 的 electron 入口加 onstart: () => {}，结束必须还原）
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>   # 云端对象查看
```

## 7. 踩坑记录

### 环境 / 进程
1. vite dev server 会被会话回收 ⇒ 必须长驻 tty；单实例锁按 userData 隔离（资源端口 A=19876 / B=19877）。
2. **杀 Electron 只按唯一 CDP 端口定位**（`pgrep -f "remote-debugging-port=92xx"`）；`pkill -f Electron` / `killall` 会误伤 SiYuan/VSCode，**也会打断 DSH 宿主自己**。
3. **在 DSH 里起本仓 Electron 必须 `env -u ELECTRON_RUN_AS_NODE`**（宿主注入了 `ELECTRON_RUN_AS_NODE=1`，否则以纯 Node 启动、报 `bad option: --disable-gpu`）；改本仓代码不影响 DSH，但**别动 DSH 安装目录**。

### 同步 / 数据 / 构建
4. 同步完成必须广播 `sync-progress`（否则 tab / 状态栏 / 小记不刷新）；`markSynced` 要同时改 `tree_nodes.sync_state`。
5. `contentCache` 会让冲突后 tab 不刷新 ⇒ `reloadKey` 变化时先清缓存。
6. IPC 三处同步改：`electron/main.ts`(handle) + `preload.cjs`(invoke) + `src/lib/native.ts`(类型+封装)。
7. 同步函数里别用内层 `const remote = …` 遮住外层 `remote`（ObjectStore）⇒ `remote.put is not a function`。
8. **`ObjectStore.test()` 必须用 ListObjectsV2**（七牛 HeadBucket 对存在的桶也 404）。正确配置：Endpoint `https://s3.cn-north-1.qiniucs.com` / Region `cn-north-1` / Bucket `local-lake-hebei` / `forcePathStyle=false`。
9. 主进程 external **从 dependencies 派生**（别硬编码）；better-sqlite3 是 Electron ABI（系统 Node 跑不了，bench 用 python3 sqlite3）；vitest 下 electron-log 要静音。
10. 打包：`electron-builder` 弱网会整批失败 ⇒ 换 `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`；打包版默认写**正式数据目录** ⇒ 自测必须覆盖 `LAKE_USER_DATA`。
11. e2e 里"非 http(s) 页面"不要写死 `file:`（打包版是 `lake://app`）。
12. `KeyedAsyncQueue` **无重入** ⇒ 同域嵌套会永久挂起（按 I3 自查）。

### 移动端
13. **移动端改动要过设备装置**：`check:mobilesnap`（6 态）+ 走查（`drive.mjs 9336 mobile-walkthrough.mjs`）；**验收一律设备级截图**（CDP 的 `Page.captureScreenshot` 抓不到 GPU canvas）；keep-alive 隐藏视图仍在 DOM ⇒ 导航必须带命中测试。
14. 快照门禁**依赖设备里的数据**（用户随手记一条小记 ⇒ 该态 +17 元素、假红）⇒ 只在**专用 AVD `lake_gate`**（emulator-5556 / CDP 9336）+ 固定夹具（5 文档 + 4 小记，`scripts/mobile-audit/gate-fixture.mjs`）上跑；**重灌夹具或建过数据 ⇒ 先重烤基线**；`.css-audit/snap/` 的中间快照会被同名 tag 覆盖（别当对拍）。
15. **懒加载入口若会挂内核，必须自带内核样式**（`@dlient/lakex-doc-react/style.css`）；护栏 `src/mobile/kernelStyleBootstrap.test.ts`。
16. **内核「+」插入面板在手机上要夹进视口并归位**（面板 ~1294px 高、内核判定下方放不下会翻到 caret 上方、实测 `top=-558`）：`max-height` + `overflow-y:auto` + 改锚点（内核写的是行内样式，只能 `!important`），落点 `src/mobile/mobile-kit.css`、作用域 `body.lake-mobile`。
17. **程序化 focus 不弹软键盘**（没有用户手势时）：原生 `ShowKeyboardPlugin` + `src/mobile/nativeKeyboard.ts`；只有"没有手势"的入口（快捷 capture / 系统分享）传 `raiseKeyboard`，聚焦后 300ms 请原生弹一次。判据：**innerHeight 收缩 >200px = 键盘弹起**（取样前必须是无键盘态）。
18. **重依赖（内核/usheet/画板）不许进入口静态图**：`HomePage → QuickNotePreview → QuickNoteKernelPreview → lakeRuntime` 一旦静态 import，构建就给入口挂 40+ 条 `modulepreload`（含 1.25MB 内核 CSS），冷启动先拉 + 解析 6.1MB 内核才画首页（实测真首页 **6123 → 533ms**、DCL 3943 → 119ms；改 `lazy()` + Suspense 后 modulepreload 45 → 12；护栏 `quickNoteKernelFallback.test.ts`）。**后台工作一律排到首屏之后**：冷启动那次同步 = 就绪后第一段空闲；内核预热 = 就绪 **4s 后**再排空闲（`requestIdleCallback` 的 timeout 只是上限，实测 2.4s 就回调 ⇒ 必须显式延迟）。判据探针 `scripts/mobile-audit/boot-timeline.mjs`（`--no-idle` 做 A/B）。
19. **设备级点按一律走 CDP `Input.dispatch*`**（本机模拟器上 `adb shell input tap/swipe` 对两个 App 都不生效、`keyevent` 正常）：坐标取 `getBoundingClientRect()`（页面 CSS px）；手势（长按/上滑）用 `Input.dispatchTouchEvent`（鼠标事件验不出 pointer 长按）。
20. **容器级手势别用 `setPointerCapture`**：捕获会把 `mousedown/mouseup` 与合成的 `click` **目标重定向到捕获元素** ⇒ 子按钮 `onClick` 全失效（现象 = "点了没反应"，不报错、DOM 正常）。改挂 **window** 的 move/up/cancel 并在抬手/卸载时摘掉；长按过的那一次要**吞掉随后的 click**，短按语义留给条目自己。

### 装置 / 探针
21. **写进"引号字符串"的正则，反斜杠会被 JS 吃掉 ⇒ 探针静默失效**（曾静默 3 个月）：一律写**双反斜杠**（`\\(`），改完**必须用一条已知会命中的样本自证**（不能只看"跑通了、结果是 0"）。
22. **探针"看不见"比"报错"危险**：只扫组件族选择器 + 只读元素自身 opacity 会漏 ⇒ 要扫**全仓自有文字** + **祖先连乘的有效透明度**，并排除 1×1 sr-only / 内核 `.ne-*` / 第三方（univer/drawnix）。

## 8. 会话启动指引

1. 按 **README → HANDOFF → AGENTS** 读；涉及编辑器/lakex 一律走 §2 的三级检索，**新观测回填 `docs/LAKEX-CONTRACT.md`**。
2. `git status` / `git log` / **`git worktree list`** 确认当前状态（曾漏看未记录的在途 worktree）；`vite.config.ts` 不应有改动（多端调试的 onstart 补丁用完必须还原）。
3. 需要用户确认产品语义时给出选项 + 推荐；**删除/恢复语义已定稿**（§3），不要重新争论。
