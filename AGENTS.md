# LakexLocalNotes — 项目长期记忆（AGENTS.md）

> 每次会话自动加载。接手顺序 **README → docs/HANDOFF.md → AGENTS.md**：README 概览、HANDOFF 唯一交接（当前状态/待办/坑）、本文长期红线与机制。
> **本文只写长期内容**：分支、commit、测试计数、当前焦点等易过期事实一律进 `docs/HANDOFF.md`；**不要抄会被改的数值**（令牌 hex、元素数等），以对应单一来源为准。
> **硬约束：≤64KB 指令预算**（超了尾部被截断）。新增前先删等量旧内容；已完成的研究/计划/审计不要搬进来。

## 1. 项目是什么

本地优先笔记应用：Electron 44.9 + React 18.3 + better-sqlite3 13 + 语雀 Lakex 内核 v1.99.0（vendored，已 pin）+ S3 同步（七牛 Kodo）。**本地是真相，S3 只是镜像。**

- 目录 `/Users/admin/file/local/lakex-local-notes`；两端 = 桌面（macOS 优先）+ Android（Capacitor 8）；共享 `src/core`，UI 层独立（桌面 `ln-*` / 移动 `mb-*`）。
- 身份：productName `LakexLocalNotes`；npm `lakex-local-notes`；包名 `com.lakexlocalnotes.desktop` / `com.lakexlocalnotes.android`（iOS 预留 `...ios`）；数据目录 `lakex-local-notes-dev` / `lakex-local-notes`；私有协议 `lakexlocalnotes://app`；日志 `lakex-local-notes.log`。**保留不动**：`LAKE_*` 开发变量、`--lake-*` 设计令牌、`lakex` 内核名与 `.lake` 格式。
- Node **必须 24**（`$HOME/.nvm/versions/node/v24.18.0/bin`）；移动端另需 JDK 21 + Android SDK。
- 目标量级 **2 万文档 / 20 万附件**（性能与同步决策按此验证，别用「小库正常」下结论）；索引硬上限 10 万文档（`S3V3_MAX_LAKE_NOTES`）/ 2 万小记；超过 2 万文档的下一步是按篇增量索引，**不分片**。
- 一级空间（两端同名）：**知识库 · 小记 · 日记 · AI 写作 · 标签**（桌面 ⌘1–5）。

## 2. 长期方向与文档分工

- 长期焦点：同步/存储热路径的性能与健壮性、移动端编辑收口、可维护性（安全/IPC/资源服务/渲染层职责/测试覆盖/拆大文件）。**待办只看 HANDOFF §3**；先修 Critical/Warning；不在没有测试护栏时做大规模架构重写。
- **内核（lakex）资料检索顺序**（凡涉及内核 API/配置/命令必走）：
  ⓪ vendored 源码树 `vendor/lakex-doc-react/src/**` —— **按「能力」搜**（类名族 `ne-card-*` / `ne-ui-toolbar-*`；图标 `editor-main-*`；插入面板用 `quickInput` / `slash` / `cardSelect`，`insert-panel` 在 bundle 里 0 命中），别只盯运行时 bundle。⚠️ vendor 的 **React 包装层**（`LakexEditor` / `SvgIcon` / `ImageToolbar` / `BookmarkToolbar`）只挂在 `LakexEditor` 上，而我们直接 `Doc.createOpenEditor`（`lakeRuntime.ts`）⇒ **该层从不运行**；`BlockHoverHandle` 是唯一自挂例外。按能力找，不要按调用栈找。
  ① **官方出处优先** `docs/lakexEditor-developer-docs/`（75 篇官方镜像：47 通用配置 / 07 API 与事件 / 08 命令列表 / 48 envAdapter / 65 大纲 …）：先确认官方有没有该能力与语义，有就走官方途径，别反编译猜用法、别写私有 hack。
  ② **本项目契约** `docs/LAKEX-CONTRACT.md`（已核实行为 + 调试速查）：**新观测必须回填此处**，别只留在 HANDOFF 或代码注释。
  ③ **源码字典** `lake-editor-main/`（第三方 VSCode 插件）、`lake-main/`（lakejs 社区版，**序列化方言已分叉、结论不可套用**）。**最终仲裁 = vendor bundle + 运行时实测**（冲突以实测为准）。
- 内核 vendored 并 pin（v1.99.0）：**不要随意升级**；必须改行为按 `vendor/lakex-doc-react/LOCAL-CHANGES.md` 最小改；**不清理依赖侧冗余/未用路径/死代码**（不要再提议）。
- **闭源内核分发**：三处 vendored 产物随仓库与构建产物公开分发（未获授权，风险自担，见 `NOTICE`）。双远端：Gitee `origin`（日常源）+ GitHub `github`（SSH，发版主仓 / Actions）；**remote 不入库** ⇒ 每个 clone 跑 `npm run setup:remotes`；`git push origin <branch>` 双推，**GitHub 只在推 tag 时打包**；`backup:lakex` / `setup:lakex` 做仓库外归档与恢复。
- **表格 = Univer**（`@univerjs/*` 精确锁）：动前读 `src/features/usheet/usheetKernelContract.ts`（每处触点写了失效表现）；升级只走 `docs/USHEET-UPGRADE.md` playbook（`univerContract.test.ts` + `scripts/usheet-kernel-probes.mjs`），一次全升、**不要 npm update**。
- **依赖补丁 4 处 / 两个目录（261103 现状）**：`patches/@univerjs+ui+1.0.3.patch`（floating 容器留 body + 按可见标签收起）、`patches/@plait+draw+0.93.4.patch`（画板蓝点快创）、`vendor/lakex-doc-react/patches/@xiangfa+mindmap+0.7.1.patch`（`disableAutoFit`）、`patches/lakex-drawnix+0.1.0.patch`（删按 UA 过滤 hand 工具的两句 ⇒ 移动端工具条与桌面同款；升级后 grep 计数 = 0 且设备出现「手形工具 — H」）。重建 = `PATH=/usr/bin:$PATH npx patch-package --patch-dir patches`（vendor 侧换目录）；**补丁打上但未命中不会报错**，必须逐条验语义；**除这 4 处不再新增 patch**（新增先过 §3#17 并登记作用/重建/升级验法）。
- 多维表行窗口：动视口/屏外交互前读 `docs/BITABLE-VIEWPORT.md` —— 记录全集不裁剪，主表/选择器共用一套有界行窗口；只读与保存/历史协议不因性能改动放宽。
- 文档分工：README 概览（不维护进度/计数）· HANDOFF 唯一交接 · AGENTS 长期红线；**已完成的研究/计划/spike/审计直接删**（git 可查），不建 archive。

## 3. 核心设计原则

1. **本地是真相，S3 只是镜像**：数据不丢由本地保证（回收站软删保留文件、历史快照、恢复标记），S3 只做多端同步。
2. **删除必须传播（墓碑权威）**：目录强一致性是同步的基础。
3. **删除压编辑（v3：删除 = 缺席）**：云端没有墓碑；B 以本地基线判定该文档在云端已缺席即不再上传（继续编辑是在错误方向工作）；被删侧本地编辑**强制留历史快照**；小记不备份（随手记语义）。
4. **恢复是唯一显式例外**：写恢复标记（`notes.restore_pending_at` / `quick_notes.restore_pending_at`）→ local-wins → 上传覆盖并传播；标记在 `markSynced` 清除（残留 ⇒ 墓碑永胜失效）。
5. **删除不带云端内容副本**：Lake 彻底删除当轮清空索引条目 + 正文 + 附件 + 资产声明，恢复只能靠本机回收站或本地历史；被他端判定缺失的本地副本保留在回收站（可恢复）。**回收站 ≠ 墓碑**：移入回收站 = 软删除（移到「回收站」笔记本，索引保留 `trashedAt`、正文/附件不删、**不写墓碑**）；purge 才是墓碑。曾持有副本的端在拉取时把副本留在回收站并标「云端已删除·仅本地」（只读、可恢复、**不参与 S3**，唯一例外是显式恢复）；从未持有过的设备无法恢复（用户接受）。回收站自动过期默认 **90 天**（`trashAutoPurgeDays`；cloud_deleted 副本不豁免）。
6. **同步顺序**：先拉远端（带冲突判定地合并）→ 再推合并后的本地。
7. **不为旧数据写兼容/迁移**：判据 = **「这些数据能否删了重建？」能，就绝不写兼容**。
8. KISS/DRY；不引入未经验证的抽象、不加无谓依赖（见 17）。
9. **多表写必须事务**（`db.transaction`）。
11. **资产存在性 = 远端声明差集（v3：每篇文档一份不可变声明）**：`meta/assets/{noteId}/{declHash}.json` 是「该文档云端在用集」的权威快照（先对象后声明），索引 `assetsHash` 指向它；**禁止逐对象 HEAD/GET、禁止「本机记过 = 已上传」的持久缓存**；上传只对声明缺失资产 PUT，声明**永远全量**；下载同样走差集（本地实扫 size+sha256 跳过），`active→trash` 仅在**实读正文 sha256 相等**时复用。恢复/预览补拉走 `core/s3v3AssetBackfill.ts`。
12. **兜底「未分类」笔记本只惰性创建**（真正回落时才建）。
13. **S3 并发上限 = 12**：传输池默认 `DEFAULT_TRANSFER_CONCURRENCY=12`（硬夹 32）、`deleteMany` 并发 12；**不得**为吞吐调到 16+（provider 限流 / 移动端内存）。
14. **桌面 UI = 自有设计系统**（规格 `docs/DESIGN.md` + `.impeccable/design.json`）：
    - **令牌唯一来源**：颜色/圆角/间距/字号/动效只用 `--lake-*`，定义在 `src/styles/themes/*`；**颜色字面量只允许出现在 themes/**；字号用 `--lake-font-size-*`（离档向上取档）。令牌数值以 themes 为准，**本文不抄**。
    - **同一个交互语义，全仓只能有一套视觉与几何**：改前先 grep；权威单一来源 = `kit.css` 的 `ln-*`（`.ln-row` / `.ln-menu__item` / `.ln-iconbtn` / `.ln-tabs` / `.ln-input__field` / `.ln-btn` 梯队 / `.ln-ellipsis` / `.ln-imgfill` / `.ln-tip`）；浮层 = `components/ui/Overlay.tsx`（**不要手写 createPortal**）；浮层定位 = `usePopoverPosition` + `topMenuPosition.placeVertical`（**禁止估算高度自夹**）；分隔条 = `components/ui/SplitHandle.tsx`；附件/图片 = `AttachmentChipList` + `FileKindIcon`/`fileKindOf()`；表格与多维表「添加」= `.bt-add-round`；Markdown = `components/ui/markdown/MarkdownView.tsx`；AI 正文/落库/解析/消息模型 = `AiMessageBody` / `selectionToolbar/aiResultOps` / `electron/ai/aiContentResolver`（跨 IPC 只传引用，字节只在主进程）/ `core/aiProviders`；选色 = `core/colorPalette.ts`。判定只认 `scripts/css-audit/audit-lookalike.mjs` 与 `audit-primitives.mjs` + 实机几何。**已结案别立项**：面包屑链接 `.protyle-breadcrumb__item` 与小记行主区 `.quick-note-index-main` 是行内可点文本条目，**不并入** `.ln-row`/`.ln-input`。
    - **按钮 = 统一梯队（261110 用户定稿）**：4 语义 `--primary`（主操作实心）/ `--outlined`（主题色框+主题色字）/ `--secondary`（中性框）/ `--ghost`（无框）+ `--danger` + `--link`；尺寸只两档（默认 27 / `--compact` 26；261111 厚度 review：22→26、徽标 18→22、chip 24→26）；六态（default/hover/active/focus-visible/is-selected/disabled）；设置页按钮不再单列 `--settings` 变体。**移动端独立实现 `mb-btn` 同一模型**（UI 两端独立，不共享组件/CSS）。
    - **层序即优先级**：`@layer vendor, legacy, tokens, kit, shell, feature, overlay, a11y`；新样式写进对应层压旧样式，**不靠特异性/!important 取胜**；`vendor` 层由 `scripts/vendorCssLayer.ts` 自动填充（**不要手写规则进 vendor**）。`!important` 桌面守 9 条允许清单（`ui-metrics.mjs` 的 `IMPORTANT_ALLOWLIST`，逐条写明压谁；清单外新增直接失败、只许降；移动端 19 条棘轮）；唯一例外 = 压内核/第三方写进 element 的 inline style 或压 legacy 的 `!important`，且必须写理由。
    - **改落点**：就地改，禁止层层套覆盖；组件里不写 `style={{}}`；图标只用 lucide（描边 1.75），禁 emoji/系统字形。
    - **两条护栏**（改样式必跑）：`src/styles/cssLayers.test.ts`（逐文件声明数/重复组只许降）+ `node scripts/ui-metrics.mjs`。
    - **文字色阶**：`--lake-text-*` 按「实际会铺到的最浅/最深表面」标定；`--lake-text-4` 是**有意的 3:1 档，不要提亮**；文字一律 `--lake-accent-text`，`--lake-accent` 只做图形/边框/焦点环/底纹。
    - **死 CSS 判定**（`scripts/css-audit/audit-dead-css.mjs`，报告非门禁）：判「没人用」必须排除①内核/第三方命名空间（`ne- ant- lakex- plait- univer- b3- fn__`）②动态拼接类名（串中间的拼接也要算）③设计词表（`kit.css`/`themes/`/`fonts/`/`kernel-theme.css`/`compat.css`）。只删确认无人施加的规则，删后跑走查对拍。
    - **思源层与类名已清零（261022）**：`src/b3/**` 已删，产品代码 `.b3-*`/`fn__*` 已改 `ln-*`；**不要再引入**；AGPL 署名保留在设置页「关于」与 `compat.css` 文件头。
    - **设置页**骨架 `.config-*` 由 `compat.css` 定义；**每加/改一行必须同步 `settingsSearch.ts` 的 `SETTING_ITEMS`**（`settingsSearch.test.ts`）。
    - **碰内核**：内核用 `focus()` 聚焦普通 `div[tabindex]` 时要补我们自己的 `:focus-visible` 环；碰到库的**模块级单例**（缓存/标志位）判据必须限定在本实例容器内（`.contains(document.activeElement)`），多实例会串台。
    - **第三方焦点视觉归属**：`tokens.css` 全局 `:where(input, textarea, select, [role=button]):focus-visible` 只服务自有控件；第三方编辑器宿主（`.usheet-editor` / `[data-lake-univer-floating]` / `.lake-editor-mount` / `.ne-overlay-container` / `.board-editor`）由 `src/styles/vendor-focus.css` 收口（否则就是「输入框两层/三层边框」）。新增宿主两处一起补：`vendor-focus.css` 的 `:is()` + `vendorFocusProbe.ts` 的 `VENDOR_HOST_SELECTORS`（dev 下 `window.__vendorFocusProbe()` 空数组才算干净）。
    - **观感红线（261029 UI 审计定型）**：边框一律 **0.5px**（例外：焦点环 2px / 对勾 / 进度环 / 画板笔迹；**文档正文与编辑器内部等内容区不参与统一**）；动效**只保留入场与位移**、统一 `ease-out` 250ms、**不做装饰性过渡**（hover/颜色/背景/边框瞬时切换）；界面文案**不用中点「·」作分隔符**；圆角与阴影克制（同一面「边 or 阴影」二选一；贴角内层走同心圆角，见 DESIGN Shapes）。
15. **「已彻底删除」的判定必须永久**：云端索引没有该 id 就是删了；判据 = 设备本地基线 + 持久删除意图（`state.intents`），不依赖云端墓碑。本地 purge **无条件**清索引条目并删前缀对象（`objects/{id}-`、`assets/{id}/`、`meta/assets/{id}/`）；被他端判定缺失的副本保留进回收站并打「云端已删除·仅本地」徽标；小记另有 `purged` 数组表示不可恢复删除。
16. **任何打开文档的入口先判 `isGoneNote({parentId, syncState})`**（`core/syncDecisions.ts`）⇒ 已进回收站/被他端 purge 则**只读 + 横幅 + 保存被拦要明说**，绝不静默丢弃编辑；恢复走 `handleTrashRestored`。
17. **拒绝迎合式找需求（红线）**：非 bug 改动三问缺一不做 —— ① 问题真实存在（有复现/数据/历史证据）？② 不做会付什么代价？③ 收益是否明确大于新增复杂度？**过度设计信号**：为「统一/优雅/以后可能」加抽象层、把两个本就不同的东西强行合并、用新依赖解决旧依赖能解决的问题、收益只停在「代码更整洁」、只给方案不给反对意见。**宁可少做；不确定先问「这是真问题，还是我想做的？」**
18. **不清理 vendor/依赖的冗余、未用路径、死代码**；必须改行为按 `vendor/lakex-doc-react/LOCAL-CHANGES.md` 最小改动。
19. **多维表条件求值单一来源**：视图筛选 / 关联选择器临时筛选 / 条件填色统一用 `BitableFilterRule/Node`、`filterOperatorsFor()`、`evaluateFilterNode()` 与共享编辑器；字段取值走 `bitableFieldValue()`；**禁止**为某个视图另造操作符/空值语义/条件 UI；填色的 `cell/row/column` alpha 混色与 `rowSide` 语义不得改。
20. **云同步只有一套状态判据（`src/core/cloudState.ts`，两端共用）**：`cloudStateOf()` → `unconfigured|offline|manual|auto`；`canTouchNetwork()` 是「能不能出网」的**唯一**判据，`isCloudActive()` 是 UI 判据。**关闭云同步 = 完全没配置**（任何路径不出网）；离线文案统一 `cloudStateHint()`；恢复**不等网络**。「启用云同步」默认值 = 是否已配置 S3（桌面 `settingsRepository.getSyncSettings()` 的 `hasS3Settings()` 与移动 `context.readSyncSettings()` 同口径）。护栏：`electron/settingsRepository.test.ts`、`electron/syncDualAB.test.ts`、`src/mobile/bridgeCloudState.test.ts`。
21. **门禁分层（两端各自对应）**：
    ① **每次改动都跑**（≈31–36s，最新计数见 HANDOFF §1）：`npx tsc --noEmit` + 相关 `vitest` + `git diff --check`；改样式加 `ui-metrics` 与对应侧层围栏。
    ② **只有动了视觉/设备那一层才跑样式/设备装置，且只跑受影响的 1~2 个态/屏**：桌面 `check-stylesnap.mjs --states`；移动 `check-mobile-snap.mjs --states`；多维表 `npm run check:bitablesnap`（3 态，夹具自建自删）。**全量**（桌面 42 态 / 手机 9 态 + 平板 9 态 + 23 屏）只在换夹具、改装置、发版前跑。
    ③ **动了外壳几何/构成，或重灌夹具 ⇒ 必须先重烤基线**（`--from <warm>.json --write-baseline`），否则下次全量必红。
    ④ **移动端改动 ⇒ 先装包再交付**（261110 用户定）：动过 `src/mobile/**`、`android/**` 或影响移动端渲染，交付时先 `bash scripts/android-build.sh --sync --install`（装 `lake_mobile`）让用户当场验收。
    顺序恒定：**先本地 → 再定点 → 最后全量**。
22. **依赖准入**：新依赖**四问缺一不引入**（先过 §3#17）—— ① 解决已验证痛点（有实测证据，不是「更优雅/以后可能」）？② 会否引入第二套样式/令牌/preflight（撞 14）？③ 体积/离线/许可/打包成本算过？④ 退出成本与护栏（门禁覆盖、删得掉）？
    - **禁止第二样式范式**：不引 Tailwind（preflight 打穿 1.25MB 内核 CSS 与 Univer DOM，且写进 className 会让门禁失效）；**shadcn/ui 不引**（同上 + 语义变量要再映射 `--lake-*`）；**Motion 不引**（禁 rAF 门控、绕过 reduced-motion、layout 动画留 transform 祖先破坏 fixed；28.4KB gzip）；**dnd-kit 不引**（4 处拖拽都有领域语义、长按与滚动共存相悖、`DragOverlay` 替换定稿浮层；16.7KB）；**react-resizable-panels 不引**（不覆盖浮动 8 向，`SplitHandle` 已有护栏）；**Zustand 不引（未取证）**。headless 库（Radix）是唯一例外：仅未来新复杂控件且包自有 API/CSS，不替换现有浮层/选择器/分隔条。**Lucide 维持**唯一图标源（保持 devDependencies）。

## 4. 关键机制速览

- **S3 协议 v3（261026 转正）**：云端只有 `meta/pointer.json`（约 200B）+ 两个不可变索引（`meta/index/{hash}.json` / `quick-notes/meta/index/{hash}.json`）+ 每篇文档资产声明 + 内容寻址正文/附件；**无墓碑、无 manifest 链、无全局资产清单**。发布 = 写索引 → 取锁 → 读回 pointer → 写 pointer（无 CAS，靠锁 + 读回 + 重试）；零变更轮只读 pointer。深度清理 = 列举对象与当前 pointer/索引/声明对比删孤儿（`deepCleanup`）。旧 `manifests/latest.json` **不读、不迁移、不删除**（孤儿）。核心纯逻辑 `src/core/s3v3*.ts`（v4 编排内核 `src/core/s3v3/commit/*` + 单 DeviceStore，261029 收口）；适配器 `electron/s3v3/*`、`src/mobile/v3/*`。
- **冲突判定 = 三方合并**（`core/s3v3Decision.ts` + `s3v3Merge.ts`）：base×local×remote，顺序 = 恢复标记 → 本地删除意图 → 缺席/新增 → contentHash；远端已发布 ⇒ 远端胜，被覆盖版本先 `createHistorySnapshot`；设备基线 `sync-v3/baseline.json.gz`（移动 `sync_v3_state`）**绝不上传**。`folders[]` 必填；手动同步只发触发窗口、自动同步广播所有窗口；同步/GC/深度清理共用 `enqueueMaintenance` 串行队列。v3 资产按每文档声明差集并发传输（`runPool`，并发 12）；上传失败的笔记本轮不进新索引。
- **macOS 应用菜单**（`electron/appMenu.ts` 纯函数 + 测试）：只 darwin 装，分组 = appMenu/编辑/窗口/帮助，**role 打底 + 中文 label**；「设置…（⌘,）」只 `webContents.send(open-settings)`（主进程不造窗口）；帮助 = 使用文档/反馈/打开数据目录/开发者工具（仅 dev）。**标题取 bundle 的 `CFBundleName`**（dev 显示 Electron，打包版 = productName；`app.setName`/label 改不了）。**不做**多窗口切菜单/自定义热键/i18n。
- **壳层双 origin**：打包版页面 = `lakexlocalnotes://app`（`appOrigin.ts` + `appProtocol.ts` 服务 `dist/`），dev 走 vite。**判页面来源禁止比 `URL.origin`**（非特殊 scheme 在 Node 恒为 `null`）⇒ 比 scheme+host（`isAppOriginUrl`）；资产服务白名单/ACAO 同时放行 `APP_ORIGIN`。**主进程 external 从 `package.json.dependencies` 派生**（+ `@smithy/`），别退回首写清单。
- 小记独立前缀 `quick-notes/` + 独立库 `quick-notes/metadata.sqlite3`；标签目录只在小记标签库（261107 起桌面文档标签关系也已迁入）。
- **日记空间（261109）**：日记 = 普通 Lake 文档（「日记」笔记本 + 标题即日期 `YYYY-MM-DD` + 年/月两级 group），wire 标记 `folders[].space`（**不用 `TreeNode.kind`**；发布显式写、非日记写 `null`）；文档树不显示日记本、不打标；搜索复用 FTS（不新增索引）；打开某天由主进程/数据层重新 plan + 单事务。**契约只看 `docs/DIARY.md`。**
- **编辑器「本机视图」= 设备本地**：当前工作表/缩放/选区/滚动/折叠/画板视口**不进正文、不标脏、不进 S3**；表格列宽行高隐藏冻结、多维表视图配置仍属文档数据；`onDirty` 只在正文真变时触发。**表格语义（261104 用户裁决）**：排序、冻结、单元格/行列保护 = 文档数据；阅读态只读（排序/冻结回编辑态做，不提供移动端保护入口）；阅读态筛选是唯一例外（只本机、绝不写正文）。
- **标签顺序 = 设备本地（261105）**：标签目录与单条顺序不参与同步；标签置顶已删除（不要恢复）；默认顺序 = 新的在前（`createdAt DESC`）→ 名称，拖拽后本机记 `device_state.quick_tags_manual_order`、新增追加末尾；wire 上 `tagIds` 是排序后的集合（顺序不传播）。文档标签关系随索引 `tagIds/tagsUpdatedAt` 同步（集合 + 版本 LWW）；**发布时有版本就必须显式写 `tagIds`（空集合也写 `[]`）**。
- **标签删除 = 缺席（261105；S3 列表红线）**：云端 `tags[]` 只出现 active 标签，**禁止墓碑进索引**；删除 = 本机物理删行 + 清 `tag_links`/`tag_link_versions`，跨端靠「基线有 / 远端缺席」，删除压编辑；离线删除用 `device_state.tag_deleted` 抑制远端重发；旧库 `deleted_at` 行由一次性迁移清掉（`tag_absent_migrated`）。**不要再引入标签墓碑/`deletedAt`**。
- **同步记录账本 = 设备本地审计，不进 S3**：只记三类「远端覆盖本地 / 他端删除 / 保存时磁盘被改」，桌面/移动各一张本机表（500 条 / 90 天轮转）；恢复走历史快照 → 标 local-wins 重传；**后台同步绝不弹窗**，只给角标 + 列表。
- **容错与自愈契约 = `docs/RESILIENCE.md`**（判据/降级/取证单一来源）：**新增失败面必须回填**；同一失败面只允许一套判据（坏正文 = `core/docBodySafety`；DB 完整性 = 桌面 `electron/startupRecovery` / 移动 `src/mobile/data/dbHealth`）；「解析失败」路径**禁止写回**；坏库必须给可操作出口；后台定时任务单飞；同步窗口内本地动作优先。
- **编辑器「打开 = 只读」**：打开文档不得因序列化/规范化差异写盘、标脏或触发同步。usheet 三件套：`normalizeUsheetWorkbook`（写入/比较的规范形式）、首次 flush 只对齐基线（`baselineSettledRef` + 内容输入判据）、capture 无真实改动/改回原样时返回磁盘原文；护栏 `usheetOpenReadOnly.test.ts`。移动端 usheet 保存路径已接同一 helper。
- **手动删数据（正文文件缺失）**：`store.readNote` 遇 ENOENT 返回 `bodyMissing`（**不抛错**）⇒ 启动跳过 + 打开时只读面板（历史恢复/重新读取/关闭）；同步**绝不上传空正文**；资源页「缺正文」按「可云恢复 / 仅历史 / 无备份」分组处理；**不要**退回「每次打开都弹 ENOENT」。**小记没有历史快照**：恢复只有云端镜像或搜索索引全文缓存（判据 `missingQuickNoteRecovery`，入口资源页「缺小记」）。移动端（261104 B-lite）：缺正文**不打开** + 同源 toast（每篇每会话一次）；入口 = 设置→资源管理；**不做**移动只读编辑器。
- **多维表导航 = 设备本地**：`activeTableId`/`activeViewId` 不写正文（序列化恒写第一张表/第一个视图），只写 `localStorage`（`lakex-local-notes-v3.bitable-nav.<noteId>`）。
- **互斥域**（判据 `src/core/maintenancePolicy.ts`；移动 `mobile/sync/maintenanceLocks.ts`）：**写域** / **维护域**（syncNow/GC/资产补拉）/ **高优先域**（`syncQuickNote`，`PRIORITY_OPS`）。三条不变量：**I1** 网络往返不得持有写域；**I2** 跨网络窗口的「读 → 标记/落地」靠「未变才标 / 未变才应用」（内容 hash），不靠全局互斥；**I3** 同域串行、**禁止同域嵌套**（`KeyedAsyncQueue` 无重入 ⇒ 自锁）。
- **同步要「看得见」**：移动端「上次同步（时间/结果/失败原因）」落盘并常驻设置页（`mobile/sync/syncStatusStore.ts`；**写入点唯一** = `bridge.syncNow()`）；桌面 `SyncStatusPopover`。
- **S3 配置迁移（261017）**：主路径 = 桌面导出 `.json` → 手机选文件导入；内层统一 `src/core/s3ConfigTransfer.ts` 的 `LLN1.` 迁移码（AES-GCM）；桌面在**主进程**弹框/封装/解码（渲染层不接触明文 Secret），移动端强制虚拟托管；迁移码仅备用，**固定种子不是安全边界**。
- **开/关应用各同步一次**（`autoMode !== manual`）：桌面 = 就绪 + `before-quit`（60s 兜底）；移动 = 就绪 + 回前台 + 进后台 best-effort；判据 `core/syncModes.ts` 的 `shouldSyncOnOpenClose()`。**两个例外**：① 长按图标「小记」入口 = 假单独模块（会话内不主动同步，只有「保存并同步」出网）；② 点「保存」而非「保存并同步」= 用户不着急 ⇒ **不得**补隐式推送。能不能出网仍另走 `canTouchNetwork()`。
- **AI 助手默认关**：桌面 `src/lib/aiEnabled.ts` 与移动 `src/mobile/ai/aiSettings.ts` 同口径（localStorage `=== 1`，存储不可用 fail-closed）；关闭 = 任何路径不出网，配置与 Key 保留；入口仍可见。改默认值要同时改两端 + 测试。
- **小记「保存并同步」= 单条快路径（261110 用户定稿；唯一自同步特例，替换 261026 的「整轮兜底」口径）**：只推当前这一条 —— 最短链 = pointer → quick-notes 索引（合并语义必需）→ 本条正文/资产 → 新索引 → pointer → **只更新本条基线**；**不拉 lake 索引、不处理其他待同步、不跑整轮**。**实现 = 独立管线 `runQuickPush`（`src/core/s3v3/quickPush/pipeline.ts`，11 次请求 / 重复点 1 次；引擎只做薄委托，整轮 sync/pull/apply **不感知**这条快路径）**：桌面 IPC `sync_quick_note` 走 `serializedQuickPush` 高优先门（**不要排进 `enqueueMaintenance`**）；移动 `bridge.syncQuickNote` 走 `runPriority`。回退整轮只限「无 pointer / 无基线 / epoch·generation·lakeCommit 不符 / 远端墓碑且无恢复标记」，且如实回传 full-sync；失败不写基线、不标已同步；重复点内容未变 ⇒ 0 上传、0 发布。UI 主按钮仍是「保存 / 小记一下」，「保存并同步」是普通按钮，云同步关闭置灰 + 给理由；护栏 `quickNoteSyncGate.test.ts`、`quickPushFastPath.test.ts`（两端）、`quickNotePushPriority.test.ts`；契约 `docs/SYNC-PROTOCOL.md` §12.3。
- **小记预览 = 快路径 + 内核只读兜底**：自研解析器（`quickNotePreviewParser.ts`）只画纯文字/列表/媒体（零内核实例）；出现它还原不了的块 ⇒ 整条卡片交给内核只读视图（`QuickNoteKernelPreview`，`createLakeDocument(host, viewer, …)` + `IntersectionObserver`）。判据 = 解析器自己的 `unsupported` 节点，不另立清单。
- **小记写作卡工具条 = 用户指定七项**：日期·表情·图片·附件·待办·无序·分隔线；唯一来源 `QUICK_NOTE_TOOLBAR_ITEMS`（`lakeRuntime.ts`），顺序由 `quickNoteToolbar.test.ts` 卡住；字符串 id 必须内核有效（无效 id 被静默丢弃）；日期/表情/附件走自定义工具项类；**移动端不提供「展开」**。
- **小记写作卡 = 全屏编辑会话（261111 用户定稿）**：长按图标 capture 与正常新建**共用** `.mobile-qn-screen` 容器；写作时隐藏首页顶栏（退出恢复）；正文唯一滚动，标签行/动作行/dock 固定且键盘开合时始终可点；动作行底距 = dock 占位（bar + gap + 安全区）。改动前先跑设备 longtask 对比，别凭感觉调。
- **移动 capture 首帧预取内核 chunk（261111）**：`main.tsx` 用原生 `readLaunchUrlHint()` 判定 `initialCapture` 后、`createRoot` 之前 `void loadQuickNoteComposer()`（同一 loader、不 await、普通启动不触发）——与首帧渲染并发起跑；只省 chunk 等待（几十 ms），内核首次实例化 0.3–0.9s 仍在地板。
- **移动端列表图片 = 资产服务离散缩略**：小记列表卡/标签详情列表内嵌图统一 `?w=1024`（与封面同档；资产服务支持 128/256/512/1024，Android 用 inSampleSize，避免原图解码与双份解码）；`<img>` 带 width/height 比例盒（`src/lib/imageBox.ts` 单一来源）+ `decoding=async`。写作卡/内核内图片仍原图（内核管线，另立项）。
- **卡片内含可交互子控件时不做整卡 `:active` 缩放（261111）**：小记卡 `.qn-card:active{scale(.99)}` 会被卡内勾选框的按下连带触发（按下缩/回弹 = 整卡抖一下）⇒ 已删；与桌面 `eb526bf7` 同口径。新增卡片若含 checkbox/⋯ 等控件，不要用整卡缩放做按压反馈。
- **内核浮层 portal 到 `body`**（`.ne-overlay-container`）⇒ 移动端覆盖内核浮层必须用 body 级选择器（入口已加 `body.lake-mobile`）。
- **移动端 Lake 输入面 = 底部 dock，没有第二条路**：移动端编辑态内核工具栏整条不存在（`showToolbar:false` ⇒ `disabledPlugins: [save, toolbar]`）、块手柄/选区浮栏不挂载、`/` 斜杠面板不可用 ⇒ **能输入什么只取决于 dock 接线了什么**（桌面 27 项 + 插入面板 22 项里没接进 dock 的，移动端能显示不能输入）。新增输入能力一律走 dock。**平板同样只走 dock**（261102 十四批定稿）：曾试「expanded 改内核固定工具栏」被整体回退，平板只保留外壳层宽/侧栏差异（`src/mobile/pad/`，见 `docs/PAD-ADAPTATION.md`）。**收面板→键盘（restore 档）必须让面板内容保持到被键盘盖住**（`closingHold`），否则用户报「闪烁」。
- **移动端正文 = 文件**：正文/小记/历史/草稿落 App 私有 Data（路径单一来源 `src/core/noteBodyPaths.ts`，原生 `BodyStorePlugin` 原子写 + gzip 快照）；**SQLite 只存元数据/hash/同步账本/派生 text_cache+FTS**。旧库 `notes.content` 升级时**整库重置一次**（§3#7），**不要**写兼容读取；浏览器预览的正文在内存（刷新即丢）。
- **移动端 SQLite schema = 版本门 + 批量 DDL**：`applyMobileSchema` 先读 `PRAGMA user_version`（`MOBILE_SCHEMA_VERSION`），已到就整段跳过；首次 DDL 拆两批走 `executeSet`（底表 / 条件语句）。**改表/索引必须 +1 版本号**；新增只加到 `baseSchemaStatements` 或 `collectSchemaStatements`，**不要再回到逐条 `db.exec`**（原生端一条 = 一次桥往返）。
- **移动端有自己的设计与样式层**（`src/mobile/**`，`mb-*`）：**不引桌面样式层**，两端 UI 不共享。
- **桌面内核加载边界**：桌面入口**不得静态 import** `features/editor/lakeRuntime`；内核只经 5 个 React.lazy 边界（`EditorTab` / `TrashPanel(embed)` / `NoteInfoDialog` / `HistoryPanel` / `QuickNoteEditor`）+ `kernelPrefetch.ts`（**立即 / 首帧后 500ms 空闲 / 意图**三条触发）。护栏 `desktopKernelLazy.test.ts`、`check-arch` 桌面首屏 600KB、`check-bundle` app-js 300KB。新增内核消费者 = 新增 lazy 边界并登记测试。
- **桌面启动会自动打开一篇文档**（恢复标签或 `lastOpenedNoteId`）⇒ 首篇 EditorTab 的 lazy import 在挂载瞬间就发起，**预取最多抢几十 ms**；prod 首篇 fallback ≈ 内核 chunk 下载+parse（本机 200–300ms）就是地板。预热触发挂安全模式判据 / 恢复计划 / 首篇候选 / 目录与搜索意图；**不要把预取提前到 App 模块求值**（prod 实测回退 ~200ms）。要再降只能拆内核 chunk 或改「启动自动打开」语义。
- **桌面编辑器 fallback = 同构轻骨架**（`features/editor/EditorLoadingSkeleton`，document/composer 两变体）：`role=status` + `aria-busy` + 视觉隐藏文案（`.a11y-visually-hidden`）；纯静态无动画、**不写死高度**（由 `.tab-panels` grid / `.quick-note-editor` flex 决定）；样式在 `app/editor.css`。不要再退回一行裸文字。
- **平板外壳 = 判据 store + 外壳 reducer**：`pad/formFactor.ts` 是单一 store（`useSyncExternalStore`，`installFormFactor` 唯一 listener、幂等，写 `html[data-form-factor]`，**不要再加 body 类名/第二份 resize 监听**）；判据 = 窗口宽 + 高（`expandedMinHeight=560`，键盘不翻形态）。侧栏 = `notebook/shellModel.ts` 纯 reducer（每侧 closed/floating/pinned；`padEscapeTarget` 定 Esc 顺序；`padPinnedPrefs` 只记 pinned）：**开合/固定/收起/手势/Esc 一律 dispatch**。两侧栏常驻 DOM；平板几何**只在 `pad/pad.css`**（`padCssOwnership.test` 钉死）。
- **手写板两端共享样式 = 副本 + 类名集合护栏**：`src/mobile/ink/inkPad.shared.css` 是桌面副本的独立拷贝（移动端不引桌面样式），类名集合由 `inkSharedCssParity.test.ts` 钉死；**给共享文件加规则必须同步移动端副本**。差异只允许触发方式（桌面 hover / 移动 active）与命中盒尺寸。瞬时动作结果走 `onTransientMessage`（移动 toast / 桌面板内横幅），常驻状态才用板内横幅。
- **手写板页面导航 = 单一入口左侧悬浮覆盖面板**：底栏只有 `◀ 第 n/N 页 ▶ ＋ ▦页面 ▮页签`；`页面` 打开 `InkPagesPanel`（左侧悬浮、不移动画布、不可固定；宽度可拖 320–560、设备本地）；缩略图视图 = 2 列 + 长按 300ms 拖拽排序 + 删除 + 新建页；大纲视图 = 列表 + 筛选（全部/批注/页签）+ 摘要 + 查找（只搜页签文字与页码，笔迹无 OCR）；**页签编辑 = 底栏独立 `InkPageTabButton`**，表单本体 `InkPageTabForm` 两端共享（桌面弹层 / 移动 Sheet）；移动端入口在顶部悬浮导航（共享层不发 `mb-*`）；Pad 同一套外壳。
- **手写板正文格式 = inkDoc v4（261104；v3 读兼容）**：**读 1|2|3|4 写 4**（点编码扁平 + 定点 0.01）；`activePageId` 是设备本地视图（**不许写回正文**）；`sourcePdf` 只留 `{name,pageCount}`、页级 `pdf` 只留 `{page}`；坏页可丢但必须计数+告警，v4 集合字段坏元素只丢自己。v4 新增页签 `page.note`（字段存在即页签，空串 = 纯标记）/ 页内贴图 / 页内文字块，三者都进导出与全文搜索；**S3 协议不需要动**；旧端读到 v4 进只读保护 ⇒ 改格式必须「新端写新版、旧端只读」并同步 `docs/INK-PAD.md`；落笔/翻页**不得**整篇序列化（500ms 防抖 + capture 现算）。
- **目录节点图标与文内表情输入解耦**：两端各自实现选择器与图形，只共享 `src/lib/nodeIcons.ts` 的编解码与表情数据；**默认资源页唯一判据 `nodeIconPickerMode(nodeType)`**（笔记本/分组→图标，文档类型→表情）；移动端节点选择器不得 import 输入态 `EmojiPanel` 或用其 `mb-emoji-*`；图标值仍为 ≤16 字符短串。
- **移动端「文档内查找」= 自研**：内核查找面板只随工具栏 `search` descriptor 挂载，而移动端关掉了工具栏 ⇒ 实现 = `src/mobile/editor/MobileFindBar.tsx`（DOM 文本扫描 + CSS Custom Highlight API + `n/m`），入口 = 工作区顶栏右上角。**桌面不加入口**（内核 ⌘F 已够）。实测见 `docs/LAKEX-CONTRACT.md` §5.39–5.41。
- **移动端入口分工（用户逐条定稿，别再搬回去）**：首页 = **底部五格 Dock（小记·知识库·日记·AI·标签）+ 中央悬浮＋**（261110 改版；五格 = 五个一级空间，左右滑动仍是同一分页容器，`HOME_TABS` 单一来源；顶栏 = 设置 | 空间标题 | 排序/视图 + 搜索 + 云同步（恒可见、最右）；＋ 短按新建面板、长按 260ms+上滑速记（`ui/createPress.ts`）；AI = 第 4 格分页内嵌；写作/多选态隐藏 Dock 与＋）。工作区胶囊 = 文档树 · 标签页 · 大纲 · 切换笔记本；**平板与手机同一套胶囊**，只多「更宽 + 树/大纲默认悬浮可固定」；胶囊在 Lake 编辑态常显并抬到 dock 上方，但可被覆盖（键盘弹起 ⇒ `capsuleHidden` 隐藏；dock 二级面板层序盖住，胶囊 z=2 < dock z=4）；**面板 open/closing 阶段胶囊可见性冻结**（`capsuleVisibility.ts` + `dockPanelPhase.ts`），编辑态胶囊过渡 = none；表格/多维表/画板/手写板编辑态仍隐藏；横向手势拉侧栏只对文档开放；工作区菜单不放搜索/设置；目录抽屉 = 笔记本行（只图标 + ＋）+ 每行 `[⋮][＋]`（行 ⋮ = 重命名/图标/常用/移动/历史/属性/删除，不含新建）；笔记本编辑入口 = 首页「知识库」长按卡片；**长按唯一实现 = `ui/useLongPress.ts`**（别再写第二份计时器）。
- **发版 / 版本号单一来源 = `package.json`**：发版只 `npm version patch --no-git-tag-version` + 提交 + **注解 tag `vX.Y.Z`** 并推 tag（只有 tag 触发 CI）；**不要手改** `android/app/build.gradle` 版本（从根 package.json 派生：versionName = 语义版本，versionCode = 1000 + major×10000 + minor×100 + patch，**只增不减**）；已发 tag 不可移动。
- **更新中心**：只做稳定版；清单 = GitHub latest release 的 `latest.json`（解析/比较以 `src/core/update/updateManifest.ts` 为准）；自动检查默认开（启动 + 6/12/24h）、自动下载默认开（Android 仅 Wi-Fi）；**不做静默安装**；下载必须校验 sha256，Android 另验证书 SHA-256；设置只存设备本地；发布说明与更新日志同源 `docs/RELEASE-NOTES.md`（规格 `docs/UPDATE-CENTER.md`）。

## 5. 数据路径与安全

| 项 | 路径 |
| --- | --- |
| 开发数据 | `~/Library/Application Support/lakex-local-notes-dev`（可重建） |
| 正式数据 | `~/Library/Application Support/lakex-local-notes`（**禁止触碰**） |
| B 端开发数据 | `$TMPDIR/lake-device-b` |
| 日志 | 上面两个目录下的 `logs/lakex-local-notes.log` |
| 只读检查 DB | `workspace-default/metadata.sqlite3`（小记 `workspace-default/quick-notes/metadata.sqlite3`） |

- **移动端 S3 密钥不落 WebView 存储**：走 Android Keystore（`android/**/SecureStorePlugin.kt` + `src/mobile/native/keystoreSecretStore.ts`），密文在应用私有 SharedPreferences；`localStorageSecretStore` 只是 web/vitest 后端与历史值迁移来源。

## 6. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes
npm run setup:remotes    # 首次/新 clone：配 Gitee+GitHub 双推
npm run setup:lakex      # 首次/新 clone：恢复闭源内核（缺归档会报错并给指引）
npx tsc --noEmit && npx vitest run && git diff --check   # 日常门禁（31–36s）
npx vite build && npx vite build -c vite.mobile.config.ts # 两条构建
node scripts/ui-metrics.mjs && npm run check:core && npm run check:mobileui && npm run check:bundle
bash scripts/clean-dev-artifacts.sh   # 清可重建垃圾；默认 dry-run，--apply 才删
npm run check:windowsweep             # 动形态/外壳/胶囊/侧栏时跑（窗口矩阵）
# 设备/视觉门禁只在动了那一层时跑，优先只跑受影响态/屏（口径见 §3#21）
# 起 Electron：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9222 .
# 移动端构建/安装/CDP/点按口径 = docs/MOBILE-OPS.md
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>   # 云端对象查看
# dev 控制台：window.__cssLayerProbe() 取未分层 CSS 命中（空数组 = 干净）
# 日志：docs/LOGGING.md；现场排障 LAKE_LOG_LEVEL=debug、LAKE_LOG_CONSOLE=1
```

## 7. 踩坑记录

### 环境 / 进程
1. vite dev server 会被会话回收 ⇒ 必须长驻 tty；单实例锁按 userData 隔离（资源端口 A=19876 / B=19877）。
2. **杀 Electron 只按唯一 CDP 端口定位**（`pgrep -f "remote-debugging-port=92xx"`）；`pkill -f Electron` / `killall` 会误伤 SiYuan/VSCode，**也会打断 DSH 宿主自己**。
3. **在 DSH 里起本仓 Electron 必须 `env -u ELECTRON_RUN_AS_NODE`**（宿主注入 `ELECTRON_RUN_AS_NODE=1`，否则以纯 Node 启动报 `bad option: --disable-gpu`）；改本仓代码不影响 DSH，但**别动 DSH 安装目录**。同理本机 `git` 要用 `/usr/bin/git`（`/usr/local/bin/git` 是坏的）；patch-package 重建补丁必须 `PATH=/usr/bin:$PATH`。

### 同步 / 数据 / 构建
4. 同步完成必须广播 `sync-progress`（否则 tab/状态栏/小记不刷新）；`markSynced` 要同时改 `tree_nodes.sync_state`。
5. `contentCache` 会让冲突后 tab 不刷新 ⇒ `reloadKey` 变化时先清缓存。
6. IPC 三处同步改：`electron/main.ts`(handle) + `preload.cjs`(invoke) + `src/lib/native.ts`(类型+封装)。
7. 同步函数里别用内层 `const remote = …` 遮住外层 `remote`（ObjectStore）⇒ `remote.put is not a function`。
8. **`ObjectStore.test()` 必须用 ListObjectsV2**（七牛 HeadBucket 对存在的桶也 404）。配置：Endpoint `https://s3.cn-north-1.qiniucs.com` / Region `cn-north-1` / Bucket `local-lake-hebei` / `forcePathStyle=false`。
9. 主进程 external **从 dependencies 派生**（别硬编码）；better-sqlite3 是 Electron ABI（系统 Node 跑不了）；vitest 下 electron-log 要静音。
10. 打包：electron-builder 弱网会整批失败 ⇒ 换 `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`；打包版默认写**正式数据目录** ⇒ 自测必须覆盖 `LAKE_USER_DATA`。
11. e2e 里「非 http(s) 页面」不要写死 `file:`（打包版是 `lakexlocalnotes://app`）。
12. `KeyedAsyncQueue` **无重入** ⇒ 同域嵌套会永久挂起（按 I3 自查）。

### 移动端
13. **移动端改动要过设备装置**：`check:mobilesnap`（9 态）+ 走查（`drive.mjs 9336 mobile-walkthrough.mjs`）；**验收一律设备级截图**（CDP `Page.captureScreenshot` 抓不到 GPU canvas）；keep-alive 隐藏视图仍在 DOM ⇒ 导航必须带命中测试。
14. 快照门禁**依赖设备里的数据**（随手记一条小记 ⇒ 该态 +17 元素、假红）⇒ 只在**专用 AVD `lake_gate`**（CDP 9336）+ 固定夹具（5 文档 + 4 小记，`scripts/mobile-audit/gate-fixture.mjs`）上跑；**重灌夹具或建过数据 ⇒ 先重烤基线**；`.css-audit/snap/` 中间快照会被同名 tag 覆盖（别当对拍）。
15. **移动端懒加载入口若会挂内核，必须自带内核样式**（`@dlient/lakex-doc-react/style.css`），护栏 `kernelStyleBootstrap.test.ts`。⚠️ **桌面禁止照抄**（261021 事故）：桌面样式全在 `@layer` 里，JS import 的 CSS 无法分层 ⇒ 懒 chunk 再 import 内核 CSS 会把 antd base 以未分层身份塞进来（实测设置面板偏移、字体变系统栈）。桌面入口已用 `@import ... layer(legacy)` 引入；护栏 `cssLayers.test.ts` + `audit-vendor-css.mjs`（挂 `check:bundle`）。
16. **内核「+」插入面板在手机上要夹进视口并归位**（面板 ~1294px 高、内核可能翻到 caret 上方，实测 `top=-558`）：`max-height` + `overflow-y:auto` + 改锚点（内核写行内样式，只能 `!important`），落点 `src/mobile/mobile.css`，作用域 `body.lake-mobile`。
17. **程序化 focus 不弹软键盘**（无用户手势时）：`ShowKeyboardPlugin` + `native/nativeKeyboard.ts`；只有无手势入口（快捷 capture / 系统分享）传 `raiseKeyboard`，聚焦后 300ms 请原生弹一次。判据：**innerHeight 收缩 >200px = 键盘弹起**（取样前必须无键盘态）。
18. **重依赖（内核/usheet/画板）不许进入口静态图**：一旦静态 import，入口挂 40+ 条 `modulepreload`（含 1.25MB 内核 CSS），冷启动先拉解析才画首页（实测首页 6123 → 533ms）。**后台工作排到首屏之后**：冷启动同步 = 就绪后第一段空闲；内核预热 = 就绪 4s 后（`requestIdleCallback` 的 timeout 只是上限）。判据探针 `boot-timeline.mjs`。
19. **设备级点按一律走 CDP `Input.dispatch*`**（本机模拟器 `adb shell input tap/swipe` 不生效、`keyevent` 正常）：坐标取 `getBoundingClientRect()`（CSS px）；手势用 `Input.dispatchTouchEvent`（鼠标事件验不出 pointer 长按）。
20. **容器级手势别用 `setPointerCapture`**：捕获会把 mousedown/up 与合成 click 目标重定向 ⇒ 子按钮 `onClick` 全失效（现象 = 点了没反应、不报错）。改挂 **window** 的 move/up/cancel 并在抬手/卸载时摘掉；长按过的那次**吞掉随后的 click**。

### 壳层 / 渲染
- **JS import 的 CSS 一定未分层**：设计系统靠 `@layer` 取胜，但未分层普通声明压过所有分层声明（与特异性无关）。三层防线：① 构建兜底 `scripts/vendorCssLayer.ts`（自动包进 `@layer vendor`，内核 CSS 例外保持入口 `layer(legacy)`）；② dev 探针 `src/lib/cssLayerProbe.ts`（`window.__cssLayerProbe()`）；③ 产物审计 `audit-vendor-css.mjs` + 源码 `cssLayers.test.ts`。组件/懒 chunk 只 import 自己作用域 CSS，内部不得出现裸标签选择器。判据实现单一来源 = `src/lib/cssLayerScan.ts`。
- **`transform` / `will-change: transform` 的祖先会把 `position: fixed` 的包含块改成它自己**：路由转场层常驻 transform ⇒ 编辑 dock 按 layer 盒贴底、面板展开停在键盘上方。**转场播完必须撤掉 transform + will-change**（`is-settled`）；新增会位移的壳层先确认没有依赖视口的 fixed 子元素。
- **键盘（adjustResize）态不要写 `--mb-app-h`**：值与 `innerHeight` 相同 ⇒ `100%` 等价，写字面量等于每帧全页重排（键盘动画十几轮）；只写与视口不同的值（面板 / edge-to-edge），卸载/退出编辑时清一次，resize 事件按帧合并（`useKeyboard`）。261111 实测：写作态长任务 775→72ms。
- **移动端性能基线脚本**（`scripts/mobile-audit/perf-baseline.mjs` / `npm run check:perfmobile`，本地跑不进 CI）：冷启动 / capture / 写作卡热开 / 键盘长任务 / 文档打开；基线 `.css-audit/perf/mobile-perf.json` **绑定设备+构建+视口**，换 AVD / 重灌夹具 / 装新包必须 `--record` 重烤。冷启动 CDP target 竞态已修（每轮重建 forward + target 有效性校验 + 失败重连 + 标记重试；5554 上 3/3 采样通过）；基线数值受装置负载影响，重烤必须同设备同构建。

### 装置 / 探针
21. **写进引号字符串的正则，反斜杠会被 JS 吃掉 ⇒ 探针静默失效**（曾静默 3 个月）：一律写**双反斜杠**，改完**必须用已知会命中的样本自证**（不能只看跑通了、结果是 0）。
22. **探针「看不见」比「报错」危险**：只扫组件族选择器 + 只读元素自身 opacity 会漏 ⇒ 扫**全仓自有文字** + **祖先连乘的有效透明度**，排除 1×1 sr-only / 内核 `.ne-*` / 第三方（univer/drawnix）。
23. **收/放输入法不许遍历所有 contenteditable 逐个 blur/focus**（261104 用户报「光标漂移」）：只处理**当前聚焦宿主**（放回时取顶层宿主），`inputmode` 仍写全部；blur/focus 前后保存/恢复 DOM range 与滚动容器 `scrollTop`（`useEditSurface.applyImeSuppression`）。dock 按钮 `onMouseDown` 先 `snapshotSelection()`；inline 命令后选区失效用 `repairSelection` 补一次。
24. **CDP 验收里 stub 过的 `input[type=file].click` 必须重启 App 再交还用户**（261104 现场事故）：桩不随脚本退出还原，用户随后点「贴图/背景图片」会直接插入测试图。收尾 = `am force-stop` → `am start` → 重跑 `emu-cdp.sh`，并复核 `String(HTMLInputElement.prototype.click).includes("[native code]")` 为真。**同理：图面上做 CDP 点按会留下合成「点」笔迹**，交还前用整笔橡皮清掉。

## 8. 会话启动指引

1. 按 **README → docs/HANDOFF.md → AGENTS.md** 读；涉及编辑器/lakex 一律走 §2 的三级检索，**新观测回填 `docs/LAKEX-CONTRACT.md`**。
2. `git status` / `git log` / **`git worktree list`** 确认当前状态（曾漏看未记录的在途 worktree）；`vite.config.ts` 不应有改动（多端调试的 onstart 补丁用完必须还原）。
3. 需要用户确认产品语义时给出选项 + 推荐；**删除/恢复语义已定稿**（§3），不要重新争论。
4. 每批收尾：回写 HANDOFF §1 基线/计数 + §3 待办 + §0 抬头；并确认本文预算未超。
