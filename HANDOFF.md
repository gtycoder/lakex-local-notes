# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（长期红线/机制/坑，每次自动加载）→ 相关 `docs/`。
> 历史所有 dated handoff 已合并进本文件（内容在 git 历史可查）。本文件只保留**当前状态 + 真正的待办 + 有价值的坑**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 当前基线（新会话开工前）
- **最新基线（2026-09-15）**：工作分支 `polish/ui-ux-260914`（= master + 本轮改动）。本轮两件事：① 收尾（小记图片完整展示 + 点击放大、草稿恢复框并入浮层通用件）= §2.37 第十一/十二批；② **CSS 结构性问题收敛第一批（桌面已完成并实测零差异）**= 提交 `12d5861` + **§2.38**（含可复用审计工具与移动端待办：移动端只做了测量，改动留待补 `@media` 守卫后再做）。
- 上一基线：feat/drag-siyuan @e69d4a0（含 11 个提交，见文末「附：会话交接（2026-09-14）」）+ 260914 依赖升级两个提交（05bf8ee / 83feda7，即 §2.11）——两者均已合入 master。
- 历史基线：refactor/store-split 8 commits（store.ts 2352→1103 行，见 §3.6）+ 260911 批次（2ecac39 同步收敛 / a18a95b 安卓 AssetServer 403 + Dock IME）已并入本分支祖先；feat/search-refactor（统一 FTS5(unicode61)+单字预分词+增量账本，§2.11–§2.14）在其上。
- 质量门槛：tsc 0 error · vitest **969 passed / 16 skipped**（2026-09-14）· 桌面 vite build + 移动 vite build -c vite.mobile.config.ts 全绿 · Android assembleDebug + adb install -r 通过（计数变动见 §2；别把数字写回 AGENTS/README）。
- **真机级验收（260910-260911，三轮）**：
  - 第一轮（2 桌面 + 1 移动）：A/B 同步 push/pull、新建/删除传播、移动端 WAL 崩溃恢复、旧 IndexedDB 快照迁移 全通过。
  - 第二轮（3 桌面 + 1 移动，大数据量）：50 笔记 + 70 资源（PNG/JPEG/GIF/PDF/512KB/2MB）、23.4MB；A/B/C/移动端四端正文 sha256 完全一致；并发编辑冲突（先提交者获胜 + 被覆盖方强制留档 30 天）；批量删除 5 篇墓碑传播 全通过。
  - 第三轮（260910-260911，真实素材大数据，见 §2.10）：175 笔记（真实壁纸/文档附件，~324MB）四端收敛 pending 0；附件 hash 抽样 5 组一致；**folder 墓碑跨端传播已实现并验证**（原 260910 发现的缺陷，本轮修复）；12 条实验笔记全链路删除→purge→三端回收站 purged=true。
- dev 实例状态（260911 会话结束）：模拟器 `emulator-5554` **带窗口**在跑（AVD lake_mobile，装 v1.2/versionCode 3，数据完好）；桌面 A（9222）可能在跑，B/C（9223/9224）已停。启动方式：`vite` 长驻 1421 + 手动 `electron --remote-debugging-port=9222 .`（多实例加 `LAKE_USER_DATA=… LAKE_ASSET_PORT=…`）；模拟器 `bash scripts/emu-up.sh`。**坑**：emu-up.sh 会复用已跑实例——若用户「看不到模拟器界面」，多半是前一会话用 `--no-window` 启动的 headless 实例（`ps aux | grep qemu` 看 `-no-window`），`adb emu kill` 后重跑脚本即可（AVD 数据不丢）。
- **dev 数据现状（重要）**：
  - `到啦领导`（ee860a19）仍在回收站里（`trashed_at=09-04 10:34`）；**用户尚未决定是否恢复**，别擅自删。
  - 安卓端回收站还有 **48 条旧测试数据未动**（260911 只清了本轮 12 条实验笔记）；笔记本「20-UI编辑测试」「测试本1」保留（后者含用户笔记「啦啦啦」「移动端上行-260910」等，**不是**实验数据，勿删）。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 43 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。移动端另有铁律见 **§8.0**。

## 2. 本轮已完成

### 2.11 依赖升级批次（260914，A 档+B 档一次到位）
- **Electron 43.4.0 → 44.3.0**（Chromium 152 / V8 15.2 / Node 24.20）：唯一破坏性影响 = clipboard 模块 W3C 化重构，`electron/ipc/registerNotes.ts` 两处已迁移（`writeImage` → `clipboard.write([ClipboardItem])`（PNG Blob）、`writeText` 改 await；渲染层本就走 `navigator.clipboard`，不受影响）。better-sqlite3 13 N-API 实测 44 运行时加载 OK，无需 rebuild。
- 其余升级：electron-builder 26.15.3（--dir 打包冒烟通过）/ vitest 5.0.0（969/16 与基线持平）/ vite 8.3.0 / @vitejs/plugin-react 6.1.1 / sass 1.104.1 / sharp 0.35.4 / lucide-react 1.46.0（图标导入全兼容）/ @aws-sdk/client-s3 3.1131.0 / @capacitor 三件套 8.5.2（assembleDebug 通过）/ concurrently 10 / wait-on 9。**不动**：TypeScript 5.9.3（TS7 收益对本项目无感）、React 18.3.1（vendor lakex peerDeps 锁 ^18）、slate 0.116（闭源内核依赖链）、sql.js（移动端运行时已切原生 SQLite，仅测试 mock 用）。
- **vendor 修复**：`vendor/npm/lakex-editor-react-component/package.json` 移除自带的 `postinstall: patch-package`（冗余且有害：它只在 vendor/node_modules 找 patch 目标，而该目录恒空；根 postinstall 才是真正生效路径。此前增量安装不触发，全量重装必炸）。
- **依赖精简（260914 第二批）**：删除 `concurrently` / `wait-on` / `@electron/rebuild`（全仓零引用；better-sqlite3 13 N-API 免 rebuild）；`@capacitor/*` 六件套与 `sql.js` 移入 devDependencies（仅移动端运行时/测试用，桌面 electron-builder 不再打包——打包体积 582M→524M）。**dependencies 只剩桌面运行时真需要的**（external 的 better-sqlite3/sharp/electron-log/@aws-sdk + vite 打进 bundle 的 react/lucide/slate/lakex 系列）。
- 坑：npm 的 allow-scripts 策略可能不跑 electron 的二进制下载，缺二进制时用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm rebuild electron` 补。

### 2.10 同步收敛修复 + 第三轮真实素材压测 + 安卓双修复（260910-260911，提交 2ecac39 / a18a95b）
- **同步收敛三连修**（用户报「folder 的问题也解决了」那批，四端压测验证）：
  - **folder 墓碑跨端传播**（§3 旧待办 7 落地）：manifest 携带 folder 墓碑；收端子树移入回收站标 purged（行保留可恢复、不上传）；从未持有该目录的设备把远端删除学成 `deleted_notes(folder)` 墓碑防复活；`listFoldersForSync` 排除 purged 副本。
  - **purge 每轮重放**：`decidePurge` 原不识别移动端「行保留标 purged」表示 → 每轮重复应用（syncDecisions）。
  - **manifest 空转重发布**：`purgedIds` 把云端已带墓碑的条目当发布理由 → 每轮空提交（syncEngine）。
  - **移动端 `markFolderSynced` 缺失**：folder 永远停在 local → 零变更早退从未生效 + 墓牌占位符每轮重建（syncDbPort/trashRepository）。
- **第三轮压测（真实素材）**：A 端 60 张真实壁纸、B 端真实附件（mp4/mp3/sqlite）、C 端图片+合成大附件，共 175 笔记 ~324MB；四端（3 桌面 + 安卓）收敛 pending 0，安卓应用 178 条 / 下载 378MB；附件 hash 抽样 5 组一致。
- **实验痕迹清理（全链路验证）**：12 条实验笔记（「20-UI编辑测试」10 条 + 「测试本1」2 条无标题）走移动端 UI 删除 → 回收站彻底删除 → purge 墓碑上云 → A/B/C 回收站全部 `purged=true`、active 残留 0。
- **安卓 AssetServer 403 修复**（`AssetServer.java isAuthorized`）：旧逻辑对所有请求无条件要求 token（87e4642 引入的过度限制），Lake 内核上传后重写的 canonical URL（无 token）全 403 → 图片/附件空白。对齐桌面语义：**仅 CORS 请求（带 Origin）校验 token**，`<img>/<audio>/<video>` 等 no-cors 放行，外部 Origin 仍 403。+3 单测；实机验证 DOM 内图片 1500px 渲染、落库正文无 token 泄漏。
- **Dock 面板⇄IME 硬互斥修复**（`EditorDock.tsx`，用户第三次报「工具栏被面板盖住」）：根因 = Lake 命令（hr 等）执行后**内核异步重聚焦正文 → 输入法弹回**；模拟器是 adjustResize，窗口 842→530，`--kb-offset` 塌缩为 0，面板（`height:calc(var(--kb-offset))` 无 border-box）只剩 27px padding 细条压在工具栏上。修：① 面板开着且实测到键盘弹出 → 立即再 blur（实测驱动，任何机型/输入法通用）；② `panelHeight` 跟踪实测键盘高度（原为打开瞬间快照，高输入法会压住）；③ `.med-panel` 加 `box-sizing:border-box`；④ `usable` 取 `max(…, offset)` 兜底 edge-to-edge。实测：hr 后键盘回弹 500ms 内压回、面板 312px 恒定、全程 0 遮挡。
- **版本**：安卓 versionCode 3 / versionName "1.2"；已装模拟器（`scripts/android-build.sh --sync --install`）。
- 门禁：`tsc` 0 · vitest **959 passed / 16 skipped**（新增 `src/mobile/treeRepository.test.ts` 5 例：文档移动/混合排序/重排校验）· mobile 16 文件 67 测试 · Android 单测通过。

### 2.9 移动端原生 SQLite 收口（260910）
- **生产存储已切到 Android native SQLite（WAL）**：`src/mobile/bridge.ts` 用共享初始化 Promise 打开 `NativeSqliteDb`；`sql.js` 不再承担生产写入；旧 IndexedDB 快照只作为一次性迁移源，不再写入。
- **共享行为契约**：嵌套文档树删除/恢复、资源大小上限、小记同步/墓碑/恢复/冲突归档已在桌面与移动两侧锁定；GC keep set 统一走 `src/core/gcDecisions.ts`。
- **跨端契约收敛**：删除 `src/core/maybeAsync.ts`，`SyncDbPort` / `QuickNotesSyncDbPort` 明确 `Promise`；桌面 adapter 显式 async。`DbLike`、`NoteQueries`、`TrashRepository`、`SearchRepository` 移到 `electron/`，`src/core` 不再共享同步 SQLite 形态。
- **模拟器验证**：最新分支构建安装到 `emulator-5554`；启动、5 笔记 / 3 分组 / 2 小记数据、进程强停重启后数据持久化均通过。资源限制实测：100 MiB+ 附件、25 MiB+ 图片均在落盘前拒绝，无资源残留。
- **测试脚手架收敛**：bridge 测试共用全局 sql.js WASM setup 与 `NativeSqliteDb` 测试工厂；`bridgeTree` 只保留一层 async `prepare` 记录器用于 SQL 分批断言。全套 904/15 门槛和双端构建保持绿。
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

### 2.11 搜索整体重构（260911，本会话；分支 `feat/search-refactor`，未推送/未合）
- **问题**：桌面 trigram 天生要求 ≥3 字 → 被迫「1 字只搜标题、2 字只搜标题、≥3 才搜正文」；移动端则是 `LIKE` 裸扫 `notes.content`（命中标签/JSON、摘要不可读、无排序）；两端两套语义。
- **方案**：统一 **FTS5 + `unicode61` + 纯 TS 单字预分词**。
  - 新增 `src/core/search/`：`segment.ts`（中文逐字/拉丁整词）、`query.ts`（引号 phrase + AND + LIKE 转义）、`snippet.ts`（从原文生成带 `<mark>` 的安全 HTML）；桌面/移动共用同一核心。
  - 桌面 `electron/searchRepository.ts` 重写：`search_index` 增量账本（内容 hash 短路 + 稳定 rowid，删除 O(1)）；`ensureIndex()` 只在账本与活跃文档数不符时重建（**去掉启动全量重建**）；搜索按 `bm25(title 权重 10)` + 标题精确/前缀/包含分级 + `updated_at`。
  - 移动 `src/mobile/searchIndex.ts`：同一核心 + FTS5；`reconcileIndex()` 启动/同步后对账，`saveNote` 增量索引、`trashNote` 移除；删除旧的 `src/core/mobileSearch.ts`（LIKE 方案）。
  - schema：`electron/schemaInit.ts` / `src/mobile/schema.ts` 建 `notes_fts(title, body, tokenize='unicode61')` + `search_index`；旧 trigram 直接 DROP 重建（开发期可删重建，AGENTS §3 #7/#10）。
- **实测（模拟器 emulator-5554，真机同引擎 SQLCipher 3.53.3）**：1 字/2 字/3+ 字统一、标题优先、`<mark>` 摘要、回收站排除、增删改增量与清理 全部通过；与桌面同 fixture 结果逐条一致。
- **基准**（`electron/searchRepository.benchmark.test.ts`，opt-in）：5000 文档 build 178ms / 9.8MB / 查询 3–8ms；20000 文档 build 730ms / 39.3MB / 查询 12–34ms（含 tree_nodes/notes JOIN + bm25）。
- **门禁**：`tsc` 0 · vitest **935 passed / 16 skipped** · 桌面+移动 `vite build` 全绿 · Android `assembleDebug` + 安装通过。
- **后续增强（原“留尾”；非缺陷；下列除注明外均已完成）**：
  - ✅ 移动端索引源 **已完成**：编辑器 `getDocument("text/plain")` → `notes.text_cache` → 索引（`saveNote` 带 plain；缺失时从 .lake 派生兜底），两端索引源同源。
  - ✅ 拉丁前缀 **已完成**：单个拉丁/数字词（≥2 字符）走 FTS5 前缀（`Lak`→`Lake`，桌面/安卓一致）。**仍未做**：任意子串（`ake` 搜不到 `Lake`）→ 需“拉丁 3-gram 列”（调研 §6.8）。
  - ✅ 定位 **已改进**：高亮全部命中块（上限 200）、长词优先、滚动到首个命中；仍是 DOM 启发式（lakex 无公开查找 API）。
  - 小记搜索：本期按用户决定不做，二期再评估（调研 §6.7）。
  - 设置页「重建搜索索引」按钮 **已完成**（4fea72b）。
- **自检修复（260911 晚）**：
  1. **重命名会清空正文索引**（旧实现把 `body=null` 当空串）：`renameTreeNode` 传 null → 正文索引被重置。改为 `body=null` 时读 `notes.text_cache` 保留正文；桌面 `store.test` + `searchRepository.test` 各加回归测试。
  2. **移动端 `treeRepository.renameTreeNode` 只处理 folders**，重命名文档静默失败（与桌面不一致）：补 notes 分支并即时 `indexNote`；`bridgeTree.test` 加回归测试。
  3. `applyRemoteFolderDelete` 的 FTS 删除改为一次批量移除（减少嵌套 savepoint）。
- **跨端一致性实测（260911 晚，CDP 驱动）**：桌面 9222 与安卓 9335 用同一 fixture（5 篇文档）+ 12 条查询 + 重命名/删除生命周期，**结果逐条完全一致**：1/2/3+ 字统一、标题优先、短语相邻（`编辑器` 不误命中相隔的 `编…辑…器`）、拉丁大小写、空命中/符号查询、重命名保正文、删除即消失。

### 2.12 Bug 修复：复制到微信裂图 + 大纲重开不渲染 + 大纲增强默认关闭（260911 晚）
- **复制到第三方（微信）图片不显示**：**真因** = `isMobileEnvironment()` 用 `lakeNative.uploadResource` 是否存在判移动端，而**桌面也暴露该方法** → 桌面被误判为移动端，对**跨源**资产图跑 `canvas.toDataURL()`，画布 taint 抛 `SecurityError: Tainted canvases may not be exported` → `normalizeImage` 返回 null、图片被整张丢弃（实测复制 HTML 里 0 个 `<img>`）。改为用 `Capacitor.isNativePlatform()` 判定，并导出 `isMobileEnvironment` 加回归单测。**附带修复**：`assetUrlToDataUrlSync` 对已带 `?token=` 的 URL 会拼出双问号（`?token=X?base64=1&token=Y`），改用 `URL.searchParams.set`（`buildAssetDataUrlRequest`）。桌面 E2E：修复前选中图片卡片复制得到**空 HTML**，修复后得到 `<img src="data:image/png;base64,…">`。
- **桌面大纲关闭重开不渲染**：`useOutline` 开头 `if (!kernel) return`，重开文档时内核可能晚于 effect 就绪且依赖不变 → effect 不再跑，大纲永远为空。改为在既有轮询里动态取内核、就绪后再订阅 `tocChange`，不再早退。（代码根因修复 + 门禁绿；带真实标题文档的“关闭重开”端到端复现待用户确认。）
- **移动端大纲**：`DocumentEditor` 固定 `tocEnabled={false}`（不用 Lake 原生），使用应用 `OutlineSheet`（读 `kernel.getDocExtraContent().toc` → 按 depth 缩进列表 → `headingUnfold + scrollByNodeId` 跳转 + DOM 校正）；本轮补了 toc 就绪短轮询。`outlineEnhance` 是桌面专属设置，移动端始终用应用大纲面板。
- **大纲增强默认关闭**：`DEFAULT_SETTINGS.outlineEnhance=false`；`loadSettings` 仅显式 `true` 才开启（存量已存 true 的保持 true）；设置文案注明“关闭（默认）”。
- 门禁：`tsc` 0 · vitest **943 passed / 16 skipped** · 桌面+移动 `vite build` 全绿。

### 2.13 原生大纲在虚拟渲染下不可用 → 统一使用应用大纲（260911 晚）
- **根因（用户实例 CDP 实测）**：lakex 原生 toc 侧栏依赖**已渲染 DOM**；大文档（245KB）虚拟渲染下 DOM 只有 1 个标题、内核 toc 有 15 个 → 原生侧栏列表为空。重放 `kernel.emitPluginEvent("tocChange")`（15 条）、`editor.emit("afterContentChange")/"contentchange"`、再次 `setDocument`、切 `ne-normal-toc-sidebar` 常态视图，**全部不填充**。`docs/LAKEX-CONTRACT.md` 早已记录“原生 TOC watcher 在虚拟渲染失效；用 kernel toc+自研定位”。
- **修复**：始终使用应用自建大纲（数据来自 `kernel.getDocExtraContent().toc`，与虚拟渲染无关）；`EditorTab` 固定 `disableNativeToc: true`（不再挂原生空侧栏）；`desktopDerivedState.outlineVisible` 不再依赖 `outlineEnhance`；`outlineEnhance` 改为只控制**增强外观**（筛选/折叠/H 徽标/层级线），关闭（默认）= 简洁列表（`OutlineList/OutlineSidebar` 新增 `enhance` 开关）。
- **实测**：`outlineEnhance=false` 下，打开大文档并**连续重开两次**，应用大纲都渲染 **15 条**、无增强件、无原生空侧栏。
- 门禁：`tsc` 0 · vitest **945 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.14 平台判定 isDesktop 把安卓误判为桌面（260911 晚，同类问题扫描）
- **根因**：`src/lib/native.ts` 的 `isDesktop()` 用 `typeof window.lakeNative !== "undefined"` 判定，但**安卓 Capacitor 也注入 window.lakeNative**（与 §2.12 复制裂图同一根因）→ 移动端被当成桌面。安卓 WebView CDP 实测：`Capacitor.isNativePlatform()===true`、`window.lakeNative` 有 44 个键（含 `uploadResource`），但**没有** `downloadRemoteResource` / `onSyncProgress` / `showInFolder`。
- **三处受害路径**：① `resourceUpload.ts` 外链图片：移动端走 `native.downloadRemoteResource`（undefined）→ 抛错；② `useSyncProgress.ts`：移动端订阅 `native.onSyncProgress`（undefined）→ 抛错；③ `LakeEditor.tsx` 附件 `showInFolder`（undefined）。
- **修复**：新增 `hasNativeBridge()`（仅判桥存在）；`isDesktop()` = 有桥 **且** `Capacitor.isNativePlatform() !== true`。外链图片补移动端分支：渲染层取回字节（原 `downloadWithBrowserFetch` 提取为 `downloadRemoteBytes`，保留逐跳字面私网校验 + 25MiB 限流）→ `native.uploadResource` 落盘为资产（与桌面同构，**不**把大图 base64 内嵌正文）；仅纯 web 演示（无桥）才 `embedAsDataUrl`。
- **回归测试**：`src/lib/native.platform.test.ts`（桌面 true / 安卓 false / 无桥 false / 旧外壳 true）、`src/features/editor/resourceUpload.remote.test.ts`（移动端落盘 / web 内嵌）。
- **实测**：桌面 CDP `isDesktop()=true`；安卓 WebView `capNative=true` 且三方法缺失（前提核实）；Android `assembleDebug` + `install` 绿。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.15 撤回「简洁列表」大纲降级 + 关闭虚拟渲染实测（260911 晚，承接 §2.13）
- **用户澄清**：`1bb0360` 把大纲降级成的「无筛选/无定位简洁列表」要删（那是 agent 加的）；**功能齐全的应用大纲（筛选/折叠/定位/徽标，用户长期迭代）不能动**。
- **撤销**：`git checkout 1bb0360^ -- <7 个源文件>` 精确还原（1bb0360 之后无人动过这些文件）→ `outlineEnhance=false`（默认）= **Lake 原生大纲**；`true` = 功能齐全的应用大纲。`OutlineSidebar/OutlineList/OutlineController` 本体零改动，`enhance` 分支删除。
- **原生大纲「关闭重开为空」真因（推翻 §2.13 结论）**：桌面 `EditorTab` **从未调用 `refreshTocSidebar`**（移动端 `LakeEditor` 有）。Lake 侧栏创建时用空 toc 渲染，若 ready 先于内核 `tocChange`，侧栏永远为空 → 与虚拟渲染无必然关系。修复：`EditorTab` 在 `setDocument` 后、原生模式（`tocEnabled && !outlineEnhance && !locked`）调用一次 `refreshTocSidebar(editor, host)`，销毁时清理重试定时器。
- **scrollNode 与虚拟渲染解耦**：`scrollNode` 之前只在虚拟渲染开启时下发；原生 TOC 定位/测量依赖真实滚动容器（TROUBLESHOOTING #26），现编辑态始终下发（移动端 `disableVirtualRendering=true` 仍不传）。
- **关闭虚拟渲染 A/B**（`VIRTUAL_RENDERING.enabled`，文档「测试1112」15 标题，reload×2，本机）：
  - OFF：首资产 ~4.13s / 36 个资产请求 / DCL ~1.19s / 原生大纲出现 ~4.3s
  - ON：首资产 ~2.0–2.3s / 仅 2 个视口资产 / DCL ~0.9–1.2s / 原生大纲出现 ~2.9–3.2s
  - 原生大纲 **两种模式都渲染 15 条**（补上 refreshTocSidebar 后）。**结论：使用原生大纲不需要关虚拟渲染；关掉反而首屏更慢、请求更多。** 用户 260911 拍板：**保持虚拟渲染开启**（`enabled:true`），怎么快怎么来。
- **定位验证限制**：CDP `Input.dispatchMouseEvent` 在本机 Electron 渲染进程收不到（对照：document 级 mousedown/click 计数恒 0），无法用合成点击验证原生大纲点击跳转；已验证 `<a href="#id">` 的 hash 导航能正确滚动内层 `.ne-editor-wrap`。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.16 原生大纲延迟 ~3s → ~2s：绕开 tocChange 的 1s 节流（260911 晚）
- **时间线实测**（大文档「测试1112」，作用域=可见编辑器）：编辑器/侧栏 DOM ~1.5s → `.ne-toc-view` ~1.7–1.8s → **`.ne-toc-item` ~3.0–3.3s**。
- **根因（bundle @4385085）**：编辑器 toc 插件用 `t.kernel.onPluginEvent("tocChange", cI()(…, 1e3))` 订阅（1s 节流）；内核在侧栏挂载**之前**先 emit 一次 `tocChange`，白白消耗 leading 边沿 → 靠事件重放要再等一个 1s 窗口。`sidebarVisibleChange(false) → refresh()` 不能填空白侧栏（实测仍等 ~1.3s）。
- **修复**：`refreshTocSidebar` 在 `.ne-toc-sidebar .ne-toc-view` 挂载后，从 `editor._plugins` 找到带 `_tocSidebar.update` 的插件实例，直接 `update(kernel.getDocExtraContent().toc)` 绕过节流（实测 ~90ms 出现）；找不到则回退 `emitPluginEvent("tocChange")`。固定 120ms 轮询 ×≤40。
- **实测**：条目出现 ~3.0–3.3s → **~1.9–2.05s**（剩余 ~1.7s 是 Lake 建编辑器耗时，非 toc）。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。
- **知识固化**：`docs/LAKEX-CONTRACT.md` 新增 §5.1 + §4.2/§5 表条目（原生编辑 TOC 侧栏填充时序/正确接法）。

### 2.17 「大纲增强」开关支持运行中切换（原生 ↔ 应用自建）（260911 晚）
- **现象**：开启「大纲增强」后原生侧栏不消失。根因：`disableNativeToc` 只在编辑器创建时读，且不在创建依赖里 → 运行中切换不生效。
- **修复**：原生侧栏**始终创建**（`EditorTab` 不再传 `disableNativeToc`，恒调 `refreshTocSidebar` 填充）；`outlineEnhance=true` 时给 host 加 `native-toc-hidden`，CSS 隐藏 `.ne-toc-sidebar`，应用大纲侧栏同时显示。切换只改 class，**不重建编辑器**。
- **实测**：设置面板点开关 ON→OFF→ON，每步 <1 帧：ON 时原生 `display:none` + 应用大纲可见；OFF 时原生 `display:flex` 且已含 15/23 条（无需重新加载）。默认仍 `false`。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.18 移除「段间距」配置（260911 晚）
- 用户判定无用，连同实现一起删。涉及：`settings.ts`（类型/默认值/loadSettings 解析）、`SettingsPanel.tsx`（行 + 分类关键词）、移动端 `SettingsDrawer.tsx`、`settingsSearch.ts` 注册表、`DesktopLibrary.tsx`（`paragraph-spacing` class 与 prop）、`App.tsx` 传参、`styles.css` 三条 `.paragraph-spacing` 规则。
- 旧 localStorage 里的 `paragraphSpacing` 字段不再解析（开发版不考虑数据兼容）。`docs/REFERENCE-REVIEW-2026-08-03.md`/`PROGRESS.md` 属历史记录，不改。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.19 移动端知识库书架样式重做（260911 晚）
- `.nb-shelf` 旧样式（3:4 白卡 + 灰色 BookOpen + 单行标题）重做为**简约书卡**：序号角标 + 柔和渐变封面 + 圆角图标底 + 名称（2 行省略）+ 文档数；6 色按 `nth-child` 循环（`--nb-accent`，用 `color-mix` 混入 b3 表面色，深浅主题自适应）。
- `NotebookGrid` 书架视图改渲染 `nb-shelf-index`/`nb-shelf-glyph`/`nb-shelf-count`；移除 `namePrefix`（序号不再拼进标题，改为角标）。列表视图不变。
- 实测：模拟器 1080×2400 截图，浅色 + 深色两套主题均正常。
- 「最近文档排除附件」：**用户确认那是测试数据，不改代码过滤**，保持现实现（`notes` 表无类型字段，无法结构化区分）。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.20 移动端知识库首页分区化 + 仿语雀（260911 晚）
- 首页「最近文档」「知识库」拆成**两张独立白卡**（灰底 `.mobile-library` + `.home-section`），中间留分隔。
- 「最近文档」改**仿语雀纸卡**：纸张线条纹理 + 回形针 + 标题（2 行）+ 相对时间（今天/昨天 HH:mm）。
- 笔记本：**有 `icon` 就展示图标**（书架圆角图标底 / 列表图标块）；书架卡片样式保持（用户认可）。
- 列表视图改**仿语雀排布**：彩色圆角图标块 + 标题 + 副标题「共 N 篇文档 · 更新时间」+ 右箭头。
- 动效：分区入场（translateY+opacity；切换书架/列表重挂载重放）、卡片按压缩放；reduced-motion 兜底；点卡片/切视图/切 tab 走 `tapFeedback()` 振动。
- 实测：模拟器 1080×2400 截图，书架/列表 + 浅色/深色均正常。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.21 首页微调 + 小记编辑离开即取消（260911 晚）
- 「最近文档」纸卡再缩小（92→72px，字号/线条同步），确保比笔记本卡片小；笔记本区加「笔记本」标题（与「最近文档」对称）。
- 首页分区：**白底 + 白色分块卡片**（圆角 + 轻投影，与小记同一套语言）；去掉灰底与顶部那道缝。（中途试过"发丝线分隔"的扁平版，用户要求改回分块卡片。）
- 小记 composer：离开「小记」tab（顶部 tab / 左右横滑 / 父级路由变化，任一）即 `setComposer(null)`+`setEditNote(null)`——未保存内容默认取消，切回来是小记列表，不保留编辑框（无草稿自动保存，纯状态清理）。
- 实测：新建小记→输入→切知识库→切回，编辑框已关、列表在。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.22 小记卡片仿语雀（整张白卡 + 图片完整展示）（260911 晚）
- 小记列表改为**整张白卡**（圆角 + 轻投影）：有图则上部**完整展示**（`max-width/max-height` + 白底留白，不裁切），下部摘要（最多 3 行）+ 日期 + 「...」；无图则只有摘要区（紧凑白卡）。按压微缩放，点按走 `tapFeedback()`。
- 期间试过「图标块列表」和「彩色头部」两版，用户均否决；最终以**语雀样式**为准（简约、无头部配色）。`.qn-card__tile/__thumb/__ph` 及 `--nb-accent` 循环已移除。
- 实测：模拟器截图（临时建一张图片小记）与参考一致；验证后已删除临时小记（`listQuickNotes` 回到 5 条）。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.23 移动端：笔记本列表行白卡化 + 设置改左侧抽屉（260911 晚）
- 首页列表视图：`.nb-row` 由「白卡容器内的行」改为**每行独立白卡 + 轻投影**（行高不变）；列表模式下外层 section 透明（`.home-section--list`），书架模式仍是分块白卡。
- 设置：`.mobile-settings-page` 由**全屏**改为**左侧抽屉**（宽 `min(86%, 360px)`、右圆角、投影 + 遮罩），复用 `usePanelDrag` 实现**左滑跟手关闭**（跟手位移、超 1/3 视口提交；`side-panel--swiping` 关过渡）；点遮罩也关闭。
- 实测：列表每行独立卡片；抽屉宽 354/412、遮罩存在；合成 TouchEvent 左滑后抽屉关闭。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.24 移动端：设置子页全屏 + 去叉号；目录/大纲抽屉非全屏（260911 晚）
- 设置：**根菜单**保持左侧抽屉（86%/360px + 遮罩 + 左滑关闭）；**点进子页恢复全屏**（`.mobile-settings-page--full`），用左上返回，无遮罩、无左滑。移除右上角叉号（关闭靠遮罩/左滑）。
- 目录/大纲：`.side-panel` 从 `width:100vw` 全屏改为 `width:min(86%,360px)` + 内侧圆角 + 投影，`translateX(±100%)`；影响笔记本左目录、右大纲（以及文档页右大纲）。
- **修复**：`.side-mask` 原为纯黑 `#000`（全屏面板时被面板盖住、看不出问题），抽屉变窄后右侧露出一大条纯黑边 → 改用 `var(--mobile-mask)` 半透明遮罩。
- 实测：设置菜单宽 354/412、无叉号；子页 412 全屏 + 返回；左目录、右大纲均 354 宽、18px 圆角、遮罩半透明可见底层。门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.25 桌面目录栏头部加「目录」标题（260911 晚）
- **背景**：桌面左侧目录栏头部只有一排右对齐图标（筛选/全部收起/定位/新建），左侧全空 → 用户觉得"突兀、像孤儿工具栏"。
- **改动**：头部左侧加「目录」小标题（`.sidebar-toolbar-title`：12px/600/`--lake-text-secondary`），左内缩 12px，图标仍靠右；与右侧「大纲」标题形成对称，整行读作正式 header。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.26 图标统一到思源 litheness（lucide @1.7）+ 目录栏头部悬停（260911 晚）
- **关键结论**：思源默认图标主题 litheness（`app/appearance/icons/litheness/icon.js`）**就是 Lucide**（`viewBox 0 0 24 24`、`stroke-width:1.7`、路径与 lucide 一致）。我们本就用 lucide，问题在 **stroke=2 + 隐喻混用**，不需要换图标库。
- **全局**：`tokens.css` 加 `.lucide { stroke-width: 1.7 }`（桌面+移动共用），全站图标统一到思源口径。
- **目录栏头部**：操作图标默认隐藏、`.sidebar:hover`/聚焦时淡入；**去掉分隔线**。图标换思源口径：筛选=`Filter`、收起=`ChevronsDownUp`、定位=`Focus`、新建=`Plus`。
- **大纲头部**：筛选=`Filter`；并**修正展开/折叠装反**——展开全部=`ChevronsUpDown`、折叠全部=`ChevronsDownUp`（与思源 `iconExpand`/`iconContract` 一致）。
- **增强大纲头部**：对照思源 `app/src/layout/dock/Outline.ts`（`iconFilter/iconFocus/iconExpandLevel/iconExpand/iconContract`）逐枚对齐；新增 `ExpandLevelIcon`（思源 `iconExpandLevel` 路径）替换 `ListOrdered`；折叠箭头 `ChevronRight` 即思源 `iconRight`；面板收纳态图标 `ListTree`→`List`（思源 `iconOutline`）。
- **设置**：移动端菜单 外观=`Palette`、资源=`Image`、缓存=`DatabaseBackup`；桌面 外观=`Palette`、资源=`Image`。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。

### 2.27 桌面右键 / 移动长按菜单（260911 晚）
- **目录树文档**：右键新增「打开 / 打开文件位置」。用户明确**不做**「使用默认程序打开」——.lake 的默认程序就是本应用。新增 IPC `reveal_note_file`（`shell.showItemInFolder(lakePath)`；三处同步 registerNotes + preload + native）。
- **删除编辑器导出右键菜单**：`EditorTab` 的 `EditorContextMenu`（导出 Markdown/HTML/Lake、复制 Markdown、导出资料路径）整体移除，prop 链（`EditorTab→MultiTabEditor→DesktopLibrary→App` 的 `onEditor*`）一并清除；这些能力在目录树右键里已复用（`useNoteActions` 的 `copyMarkdownFromCache/exportAs/copyNotePaths`）。
- **编辑器按点击对象分流**：新增共享 `features/editor/CardContextMenu.tsx`（`CardContextMenu` + `TextContextMenu`）。卡片菜单：打开原始文件 / 打开文件位置（桌面）/ 复制地址或文件名；文本菜单：复制/剪切/粘贴/全选。卡片资产解析新增 `resolveCardAsset`（image/video/audio/file，复用 file 卡的 fiber `cardData` 读取）。
- **移动端长按**：目录项长按本就有；新增 `features/editor/longPress.ts` + `LakeEditor` 宿主长按 → 卡片菜单（走注入的 `onOpenAttachment` 系统打开；移动端无"打开文件位置"）。
- **不做**：分屏"在右侧/下侧打开"、多窗口"新窗口打开"（需重做标签/窗口模型，另立项）。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。
- **实测（环境恢复后，端到端）**：桌面（合成 `contextmenu`，因 CDP 真实鼠标进不了 Electron 渲染进程）——目录文档右键「打开 / 打开文件位置」；真实图片卡右键「打开原始文件 / 打开文件位置 / 复制地址」，点「打开原始文件」后磁盘文件确认存在（`note-assets/{noteId}/…png`，1080×513）；文本右键「复制/剪切/粘贴/全选」；旧导出菜单已消失。移动端（合成 TouchEvent 长按）——真实图片笔记卡片长按「打开原始文件 / 复制地址」，点击生效。
- **E2E 中发现并修复的 bug**：图片 src 带 `?token=` 时，`resolveCardAsset` 用 `src.split("/").pop()` 当文件名 → `fileKindOf` 把图片判成 `other`、菜单错误显示「复制文件名」。改为优先 `parseLocalAssetUrl(src).filename`，否则按 URL pathname 取干净文件名（`assetNameFromUrl`）。

### 2.28 文档右键改造：复制 + 属性（260911 晚）
- 目录文档右键顺序：新建文档 / 新建分组 / 复制 / 重命名 / 属性 / 历史版本 / 打开文件位置 / 导出 / 删除。去掉「打开」（点行即打开）与「设置图标」（行图标处仍可改）。「历史版本」保留独立入口（曾一度并入属性，用户要求加回），属性面板内也保留「打开历史版本」。
- **复制**：`store.duplicateNote` → 新 noteId + `note-assets/{newId}` 拷全部附件（**文件名不变**：路径按 noteId 隔离，无需重命名）+ 正文资源 URL 由旧 id 改写为新 id；`sync_state='local'`。IPC `duplicate_note`。菜单复制后刷新树并打开副本（`useTreeActions.duplicateNode`）。
- **属性**：`store.getNoteInfo` + `src/components/NoteInfoDialog.tsx`（样式在 `ui-polish.css`）→ 位置 / 创建 / 更新 / 字数·字符 / 大小 / 同步状态；文件位置 + 资源目录（可打开）；附件网格（图片缩略图，点击打开原始文件）；历史版本列表 + 打开历史面板。IPC `get_note_info`。
- 实测：菜单顺序 ✓；复制 18 附件文件名一致、`.lake` 同尺寸、正文 URL 已改写 ✓（测试副本已 purge 清理）；属性弹窗数据 ✓。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 桌面+移动 `vite build`。
### 2.29 属性面板增强 + 移动端复制/属性 + 统一可调尺寸弹窗（260911 深夜）
- **右键顺序**（用户定）：新建文档 / 新建分组 / 复制 / 重命名 / 历史版本 / 打开文件位置 / 属性 / 导出 / 删除。
- **属性面板新增**：文档 ID（复制）、**卡片统计**（图片/视频/附件/代码块/表格…，正文 `<card name>` + `<table>` 计数）、**父级路径可点击跳转**（Sidebar `revealNodeId` 展开+滚动）、**历史快照内联预览**（`previewHistorySnapshot` → 内联 HTML）。
- **统一浮层弹窗样式**：新增 `src/styles/dialog.css`（`.ln-dialog`/`__head`/`__title`/`__body`/`__resize` + `.modal-backdrop` + `.note-info-*`），**桌面与移动端都 import**；属性弹窗默认 720×min(80vh,640)、右下角可拖拽调整、窄屏折单列。以后同类弹窗复用 `.ln-dialog`。
- **弹窗层级**：`NoteInfoDialog` 必须 `createPortal(..., document.body)`——否则被 `.sidebar` 的堆叠上下文压住（用户实测"弹窗被目录盖住"）。与 `ContextMenu`/`DesktopOverlays` 同款做法。

### 2.30 属性面板排布细化（260911 深夜）
- 第一部分信息改**两列并排**（位置独占一行；创建/更新、字数/大小成对），去掉 ID 行。
- 第二部分「文件位置」= 3 个按钮：**打开文件位置**（reveal `.lake`）/ **打开附件文件夹**（新 IPC `open_note_assets` → `shell.openPath(assetsDir)`）/ **复制 ID**；下方保留两条路径 + ID 文本。
- **附件 / 历史条目加高度上限**（`.note-info-assets` 190px、`.note-info-history` 200px，`overflow:auto`；渲染上限 200 + "+N"）——附件/快照多时不再撑破或错位。实测 36 个附件：clientH 190 < scrollH 242，正常滚动。
- 移动端：文件管理器类按钮不渲染（无对应能力）；窄屏第一部分折单列；弹窗高度按内容自适应（max 78vh）。
- 收尾调整（用户）：文件位置三个按钮**移到标题右侧**（与「历史版本」同款）；**不再单独展示 ID**（路径里已含两次）。
- **历史快照压测**：造 46 条（`createHistorySnapshot(force)`，settings.maxSnapshots=50）→ `.note-info-history` `clientH 200 < scrollH 1235` 正常滚动；测完已 `deleteHistory` 全清。

### 2.31 卡片复制动作 + 剪切 + 复制审计（260912 凌晨）
- **文件名隔离审计**：本地 `note-assets/{noteId}/{file}`、S3 `assets/{noteId}/{file}`、`declared_assets(note_id,filename)`、GC keep `assets/{noteId}/{file}`、`syncEngineController` gcPending、`orphan_assets` **全部带 noteId**；没有"裸文件名"的全局键，不同笔记同名附件安全。以文件名为键的集合都是单篇笔记内（protected refs / declared）。
- **复制索引补漏**：桌面 `createNoteInWithContent` 只按标题索引（body=""）→ 已让 `duplicateNote` 复制后补 `searchRepository.upsert(newId, title, lakeHtmlToPlain(content))`。新增单测 `duplicateNote 复制文档`（正文可搜 + 附件复制/URL 改写），`store.test.ts` **117 passed**。
- **卡片菜单复制动作**（4 个都做）：使用默认程序打开 / 打开文件位置 / 剪切 / 复制图片(仅图) / 复制文件路径 / 另存为… / 复制文件名；**去掉「复制地址」**（127.0.0.1 本机 URL 无意义）。新 IPC `copy_asset_image`（clipboard.writeImage）、`save_asset_as`（showSaveDialog+copyFile）；移动端只留 使用默认程序打开/剪切/复制文件名。
- **剪切**：`EditorTab`/`LakeEditor` 加 `cut` handler（copy 同源序列化写剪贴板 + `execCommand("delete")`），快捷键与文本菜单「剪切」可用；卡片「剪切」= `cutCardElement`。

### 2.32 卡片菜单：合并复制 + 顺序对齐 + 文件卡右键修复（260912 凌晨）
- **文件卡右键修复**：`resolveCardAsset` 的 file 分支原来 `readFileCardData(card, card)`（从卡片根读 fiber），而 `__reactFiber$` 挂在 `.ne-card-file` 芯片上 → 解析失败落到文字菜单。改为从右键命中元素 `start` 读、并兜底芯片（实测文件卡右键现在出卡片菜单）。
- **复制合并**：三项复制收进「复制 ▸」子菜单（复制图片(仅图) / 复制文件路径 / 复制文件名）；hover 展开 + click 切换（触屏可用）。
- **顺序对齐文档右键理念**（编辑 → 打开 → 位置 → 导出）：**剪切 / 复制▸ / 重命名 / 使用默认程序打开 / 打开文件位置 / 另存为…**（重命名仅 file 卡显示）。

### 2.33 附件展示名重命名（只改展示名，260912 凌晨）
- 需求：只改文档里显示的名字（如微信来的 `weixin-xxx.pdf` 显示体面些），**不动 note-assets 下的存储文件/路径**。
- 后端 `store.renameAssetDisplay(noteId, filename, newName)`：匹配 `name="file"` 卡（src 的 noteId+filename）→ 改 value 的 `name`、保留 `src` → `saveNote`（重索引 + sync_state=local）。IPC `rename_asset_display`。
- UI：卡片菜单只对 **file 卡**加「重命名」→ `AssetRenameDialog`（复用 `.ln-dialog`，预填 + Enter/Esc）→ 成功后经 `useSyncRefresh.reloadNoteTab` 重载 tab（bump reloadKey）。
- 实测：单测 `renameAssetDisplay`（store.test.ts 118 passed）+ 实时 UI 流程（展示名变、src 不变）。
- 另存为默认名：有展示名用展示名，没有用存储名（`3565615`）。

### 2.34 移动端「另存为」：图片进相册 / 附件走 SAF（260912）
- 调研思源安卓（独立仓库 `siyuan-note/siyuan-android`，`app/src/main/java/org/b3log/siyuan/JSAndroid.java`）：它是 `writeImageClipboard(FileProvider uri)` + `exportByDefault/openExternal` **甩浏览器下载** → 用户实测"太糙"。
- 我们走更优：扩 `OpenFilePlugin.java` 加 `saveAs({path,name,mime})`——**image/* 且 API≥29 → MediaStore `Pictures`**（直接进相册）；**其它 → SAF `ACTION_CREATE_DOCUMENT`**（系统"保存到"面板，用户自选可见位置）；低版本/非图片同样 SAF。
- JS：bridge `saveAssetAs(noteId, filename, name)`（`Filesystem.getUri(Directory.Data)` → `OpenFile.saveAs`）；`MobileApp` 调试契约同步；移动端长按卡片菜单加「另存为…」（`CardContextMenu` 复用，有 ref 即显示）。
- 实测：长按图片卡菜单含「另存为…」，触发返回 `{ok:true}`（MediaStore 路径）；附件走 SAF 系统面板（需人工点选，未自动化）。
- **不做**移动端「复制图片」：Android 无通用剪贴板图片，思源靠 FileProvider content URI（`writeImageClipboard`）跨 App 兼容差，用户已确认跳过。
### 2.35 同步事故：文档父级错挂到「测试本1」且不可自愈（260912 查清+修复+已修数据）
- **现象**：桌面/安卓同一个 S3、同一个「个人笔记」，文档列表不一致（安卓有 安卓上行-* 等，桌面没有）。
- **实证结论**：不是丢数据、不是 manifest 覆盖。远端 manifest 链（lake-notes-stress2-260910）整条链里这些 note 一直 parentId=notebook-personal；桌面本地却是 9116074d（测试本1）、updated_at 与远端完全相同、sync_state=synced。桌面日志显示它们走 importRemoteNote（正常下载 apply）。
- **根因（共享 core，一直都有，非某次改动引入）**：syncEngine 的 validParents 只收集「远端 folders」，本地已有 folder 不算合法父；一旦本次清单没列出该父，effectiveParent() 就落 defaultNotebookId()（最老笔记本=测试本1）把 note 错挂、并沿用远端 updatedAt；之后 decideMetaApply 用严格 updatedAt > lastSyncedMetaAt，时间戳相等 → 永久跳过。纯桌面多端难触发（move 会抬 updatedAt）。
- **修复**（f867c7e）：① validParents 纳入 localFolderIdsAtStart；② meta 对账加字段判据：父合法且与本地不同、且本地无待上传 meta 变更（sync_state !== 'local'）→ 跟随远端。
- **数据修复**：零变更早退（hasPending=false + commit 一致）挡在对账循环前，修复后首次同步没生效；清掉 device_state.last_seen_commit_id 强制走完整对账后，10 条自动归位（9116074d 15→5，notebook-personal 10→20）。
- **已闭环**：① fde0725 runDataHealthCheck 增 metaParentMismatch（本地两表父级不一致）；② d639b7f/d91c71f 零变更早退前对账「远端 parent vs 本地活跃 note parent」，有漂移则不早退、强制走完整对账自愈（只看活跃 note，排除回收站/purged 墓碑语义，避免误触发）。
- **Electron 反复被"回收"结论（非内存泄露）**：日志是 `Port 1421 already in use` / devtools `bind() failed` + 单实例锁；`crash reason=killed exitCode=15` 是 SIGTERM（session/job 结束或 kill 旧 PID），非崩溃/OOM；RSS 主进程 ~120MB、渲染 ~125MB。**重启前必须先 kill 占用 1421/9222 的旧 PID**；vite 需长驻 tty（§7.1）。
- **移动端新增**：长按菜单加 复制 / 属性（历史版本原有）。bridge 补 `duplicateNote/getNoteInfo/readAssetPreview/previewHistorySnapshot/openAttachment`；`MobileApp` 的 lakeNative 调试契约同步加。
- **修复**：移动端 `noteRepository.readNote` 的 SQL **漏 select `parent_id`** → 属性父级链恒为空、复制的副本丢父级；已补列。
- 门禁：`tsc` 0 · vitest **951 passed / 16 skipped** · 双端 `vite build`。实测：桌面菜单顺序 ✓、属性新字段 ✓、拖拽 720×640→860×740 ✓；移动端长按菜单 ✓、复制（含父级继承）✓、属性弹窗布局 ✓。

### 2.37 UI/UX 全量审计 + 第一批优化（260914 晚，分支 `polish/ui-ux-260914`，未推送/未验收）
> 玩法：CDP 真驱动桌面（9222）+ 安卓 WebView（9335，`adb` 截图取证），**先量再改**——过程中
> 有多条"看起来是 bug"的判断（小记卡片留白、正文边距不对称、树行高不一致）经实测被撤回，别再凭截图下结论。

**本轮已改（1 个提交 1a5592e，12 文件）**
- **深色彻底统一**（根因：同一界面同时存在思源纯中性 `#1E1E1E/#2C2C2C/#2E3236` 与自有冷灰蓝两套黑，
  设置弹窗的头部与内容都不是一个色系）。现在单一分层：窗口底 `#131519` → 卡片 `#1E2126` →
  编辑纸 `#20242A` → 卡内块 `#262A31` → 抬起层 `#31363F`；`--b3-*` 表面别名与编辑器 `--lakex-*` 全部指向同一组值。
  **坑**：`tokens.css` 的深色别名必须写字面值——移动端 `mobile-theme.css` 把 `--lake-*` 反向映射到 `--b3-*`，
  写 `var(--lake-*)` 会成循环引用 → 变量失效 → 边框/文字回退成 `currentColor`（本轮踩到过，笔记本图标一度全变白）。
  `mobile/main.tsx` 的 `tokens.css` import 也得晚于 `theme-midnight.css`。
- **强调色收敛**：活动标签从"主色浅底 + 主色内描边 + 主色文字"三重信号 → 白卡 `--lake-raised` + 顶部 2px 主色指示线 +
  中性墨色文字；左侧 rail 选中去实心主色与蓝色投影；`.seg` 按 AGENTS §3 #14 改「轨道 + 浮起滑块」；
  移动端 dock 的 `+` 展开态由实心主色圆 → 主色浅底 + 主色图标；移动端设置行图标由"整列蓝色" → 中性墨色。
- **暗色下的白条 bug**：历史/回收站面板头部原写死 `rgba(250,250,251,.94) !important`（深色下顶一条白条）→ 改 `--lake-surface`。
- 状态栏字号 10px → 11px；搜索面板去三重重复文案；移动端书架行「名称折两行导致 N 篇错位」→ 名称块固定两行高；
  书架封面由"饱和色渐变冲淡"→ 中性卡 + 淡色图标徽章（深色下原先是土黄/橄榄，发脏）。
- `prefers-reduced-motion` 不再一刀切 1ms（保留透明度/颜色过渡，只去位移缩放）+ 补 `prefers-reduced-transparency`。
- 门禁：tsc 0 · vitest **969 passed / 16 skipped** · 桌面 + 移动 build 绿 · APK 安装并实机（模拟器）复验。用户已拍板：深色=冷灰蓝分层（保留本轮）、强调色=收敛口径（保留本轮）、移动端首层**保持现状**（不做缩略/摘要）。

**第二批（同一分支追加）**
- **安卓系统栏跟随主题**（用户可见硬伤）：深色下状态栏/导航栏实测 `#fafafa`、内容区 `#1e2126`，顶/底各一条硬边。
  修法：`MainActivity` 新增 `applySystemBarTheme(boolean)` + 注入 `lakeSystemBars` 接口，渲染层 `applyTheme` 时调用
  （`src/mobile/systemBars.ts`）。**注意**：targetSdk 35+ 会忽略 `setStatusBarColor/setNavigationBarColor`（强制 edge-to-edge），
  所以真正生效的是 **window 背景色**（WebView 不延伸到栏下，栏后露出背景）+ 图标明暗；另需 `setNavigationBarContrastEnforced(false)` 去掉系统加的对比蒙层。
  复验：修后 y=20…2399 全为 `#1e2126`，图标自动转亮。
- **移动端阅读态底部让位**：`.mobile-doc-body` 原 `padding-bottom: 40px`，而底部胶囊栏顶边距视口底 80px
  （测：滚到底最后一行 bottom=802 / 栏 top=762 → 末 1~2 行被栏压住）→ 改 `80px`。复验 overlap 0。
- **壳层令牌单一来源**：`--shell-*` 由写死灰/蓝字面值改为从 `--lake-*` 派生（`--shell-text-secondary #5f6368 → #4d5a70` 等，
  深色下自动拿到深色值，不再出现"深底上深灰字"的隐患）；删掉 `:root` 里的重复声明。
- 长路径文本加 `text-wrap: balance`（属性弹窗里第二行不再只剩 2 个字符的孤儿尾巴）。

**第三批（同一分支追加）—— 清死声明 + 移动端动效一致性**
- **浅色渐变字面值 → 令牌**：styles.css 里 5 处 `#e8ebf1/#eff1f6/#fafbfd` 起止点（rail / tab-bar /
  quick-notes-pane / outline-sidebar / `--shell-unified-*`）实测**当前全被 `b3/base.css` 与 `quick-notes.css`
  的 `!important` 覆盖**（深浅两套主题都不生效），换成 `var(--lake-shell)`/`--shell-material` + 新增
  `--shell-gradient-top`（`color-mix(--lake-shell 45%, --lake-panel)`）后浅色只差 2~3 个色阶，
  但深色下不会再冒浅色板——`.outline-sidebar` 是唯一真会踩到的（开「大纲增强」才挂载）。
- `.orphan-list li` 的浅色描边 `#eff1f6` → `color-mix(--lake-text 8%)`（深色下原本是一条亮线）。
- **移动端动效一致性**：新增 `--mobile-ease-out`，抽屉/遮罩/面板的**进入与退出改用同一条曲线**
  （原先进入 `cubic-bezier(.22,1,.36,1)`、退出思源 Material `(0,0,.2,1)`、遮罩还是 `linear`；时长仍保持思源 150ms）。
- **`.mobile-settings-page` 补上缺失的 transform transition**：跟手拖拽未达 1/3 阈值时，`usePanelDrag`
  清掉内联 transform 会让面板**硬跳回原位**。实测修复后回弹序列 -26 → -7 → -2 → 0（150ms ease-out）。
- **两条先前判断撤回（实测推翻，别再当问题）**：① 深色滚动条并不偏亮——`--b3-scroll-color` 深色是
  `rgba(230,230,230,.2)`，主题感知正常；② 编辑区右上不是"游离方块"，是 Lake 的**标题小地图**（39px 轨道 +
  当前标题高亮线）加滚动条拇指，功能正常。
- **动效全量核对（确定性口径，逐元素读 computed transition）**：桌面/移动各关键交互时长均 ≤260ms、
  用的是自定义 cubic-bezier，无 `transition: all` 实声明（`all 0s` 是未声明时的初值，不是问题）；
  `.note-row` 的 250ms transform 属拖拽占用（按压反馈走 `filter:brightness`），不是按压动效。

**第四批（用户验收反馈）**
- **细滚动条回归（重要，别再加回全局标准属性）**：用户反馈"桌面细滚动条没了"。根因不是本会话改动——
  `03ada25`（260914 15:14）在 `:root` 加了 `scrollbar-width/color`，注释假设"已有 ::-webkit-scrollbar
  自定义的区域不受影响"**前提是错的**：`scrollbar-color` 是**继承属性**，元素一旦取到非 auto 值，
  Chromium 就改用标准属性绘制并忽略 `::-webkit-scrollbar` 自绘 → 思源那套细滚动条
  （`b3/siyuan/util/_scroll.scss`：10px 轨道 + 内阴影细拇指 + hover 变粗，颜色本就跟随 `--b3-scroll-color`）
  全端失效。已删除该 `:root` 块，并把 ui-polish 面板组里的 `scrollbar-width: thin` 改成 `auto`/`scrollbar-color: auto`
  （否则同样会压掉 6px 自绘）。实测：编辑器/目录槽宽 15px → **10px**，回收站列表 **6px** 自绘恢复。
- **移动端插入面板改「图标 + 文字」两列**（用户给参考图）：3 列纯图标方块 → 2 列浅灰底条目
  （56px 高、圆角 10、图标 22 + 15px 文字），顺序按使用频次：图片/附件/表格/音频/视频/引用/分割线/代码块。
  条目表改为组件内 `insertItems` 数组（原先 8 个近乎重复的 `<button>`）。
- **震动收敛**：删除 `tapFeedback()`（每次点击 8ms）及全部 16 处调用（切 tab、开文档/笔记本、开抽屉/菜单、
  进编辑、重命名、切换笔记本…）。保留且只在有意义处震：`longPressFeedback`（长按命中）、
  `successFeedback`（保存落盘/拖拽落点提交/创建成功）、`warnFeedback`（失败/危险）。
- **属性弹窗默认按内容收**：`.note-info-dialog` 高度 `min(80vh,640px)` → `auto` + `max-height: min(80vh,640px)`
  （手动拖过之后由内联尺寸接管）。实测 720×640（内容只占 423，底部一片空）→ **720×474**。

**第五批（用户验收反馈）—— 含一个"整个 dock 命令全死"的 P0 修复**
- **P0：移动端 dock 的命令通道一直是死的（除打字后）**。`DocumentEditor` 把 `editorRef.current` 当 prop 传给
  `EditorDock`，而**ref 变化不触发重渲染**：编辑器就绪（`onEditorReady`）后父组件若不重渲染，dock 永远拿到
  `null` → 工具栏 B/列表/待办 与面板里所有 `runPanel` 命令**静默 no-op**；只有用户打字触发一次重渲染后才"活"过来。
  实测证据：包装 `editor.renderer.execCommand` 后点「加粗」与「引用」，调用计数为 0（命令根本没发出去）。
  修法：`DocumentEditor` 用 state 持有编辑器实例（`editorInstance`）并传给 dock（`editorRef` 保留给命令式路径）。
  修后实测：`["quote"]`→文档新增 `<blockquote>`、`["alert","tips"]`→`lake-alert`、`["insertCard","label"]`→状态卡。
- **面板 = 覆盖键盘区（键盘随之收起不显示）**，工具栏停在面板上沿不动 —— 用户 260914 澄清后回到这个口径
  （我先按"在键盘上方另开一块"做过一版，被用户纠正："覆盖键盘 = 不展示键盘"）。**别再把面板挪到工具栏上方**。
  - 几何：`--kb-offset` 无面板 = 键盘上移量；面板开 = 面板占住的键盘区高度（`innerHeight - base + panelHeight`，
    键盘收起过程中同步长出来，工具栏屏幕 Y 恒定）；`.med-panel { bottom:0; height: var(--kb-offset) }`。
  - **本轮新增的内容滑入/滑出**（用户说"收起时要自然"的落点）：面板背景先整块铺满键盘区（不露空档），
    内容放在 `.med-panel-inner` 里做 160ms ease-out 的 `translateY(100%) ⇄ 0` + 淡入淡出；
    关闭时把面板多留 220ms（`closing` 状态）再清 `panelHeight` —— 键盘上升那 200ms 里那一带仍有面板背景兜着，
    不会"先空一块再弹键盘"（这才是旧版看起来突兀的真正原因，不是元素顺序）。
  - 实测（emulator-5554）：收起态 `innerHeight=530 / --kb-offset=0 / toolbarTop=482`；打开态 `innerHeight=842 /
    --kb-offset=312 / 面板矩形 [530,312] = 正好键盘那块 / toolbarTop 仍 482`（工具栏不动）；
    关闭中 120ms 采样 `data-open=0` + inner 正在位移（translateY 301px、opacity 0.03）→ 收尾 `mInputShown=true` 键盘回来。
  - `runPanel` 里的 `dismissIme()` 与「面板⇄输入法硬互斥兜底」effect 都要保留（面板占键盘区时内核会异步重聚焦把键盘顶回来）。
- **插入面板补齐**（用户给参考图）：新增 **拍照**（`<input type=file accept=image/* capture=environment>`）、
  **高亮块**（内核命令是 `execCommand("alert", "tips")`，**不是** `insertCard`；落盘为
  `<blockquote class="lake-alert lake-alert-tips">`）、**状态**（`insertCard("label")`，自带颜色选择器）。
  不做智能识别（用户明确排除）。共 11 项，仍为两列图标+文字。
- 标题小地图**不动**（用户明确要求）。

**第六批（用户验收反馈）—— 可读性 + 书架列数 + 插入面板收紧 + 全量补扫**
- **移动端浅色次要文字对比度修复（实测缺陷）**：`--b3-theme-on-surface-light` 原值 `rgba(95,99,104,.68)`
  叠白底只有 **3.01:1**（低于 WCAG AA 4.5），而移动端所有"次要文字"都用它——最近文档日期 12px、
  笔记本"N 篇" 12px、未选中 tab 16px。改为冷调实色 **`#667085`**（白底 4.97 / 灰卡 #f6f6f6 上 4.60；
  `#6b7280` 在灰卡上只有 4.47，所以又压深一档）。复测七个元素全部 ≥4.5。深色侧不受影响（#bababa 8.32）。
- **书架 3 列，但封面保持竖版书形**：`grid-template-columns` 4 → 3；**宽高比回到 3:3.8**（曾试压扁成 3:2.7
  来省高度，被用户否掉："不能为了放下就做这么丑"）；glyph 回到 42px。→ **别再为了省高度改封面形状**。
- **插入面板收紧**：条目 56→40px、行距 10→5px、图标 22→20、文字 15→14px、圆角 10→8。
  实测键盘区 311px、内容 311px → **11 项一屏放下（不再需要滚动）**。
- `.bottom-bar-count`（底部标签计数徽标）10 → 11px。
- **全量补扫结果（本轮新覆盖的面）**：移动端设置子页（关于/历史/回收站/资源管理等）与各 sheet、
  桌面端 关于页 / 资源页 / 小记工作台——**均无内联样式、无硬编码浅色**（grep 全仓为 0），
  深色下配色统一、可读性达标；未发现新的功能性缺陷。
- **长期项（本轮不做，用户已拍板）**：桌面端 CSS 的 `!important`/多层覆盖收敛（实测桌面主导文件 337 处，
  移动端仅 12 处）—— 用户要求**以后单独开分支做**，本分支不要顺手动。

**第七批（260915，用户验收反馈）—— 桌面小记改左右两栏 + 卡片动作收起 + 书架去编号**
- **桌面小记工作台改左右两栏（仿云端语雀，用户给参考图）**：删掉 `LOCAL TIMELINE` 英文眉毛与副标题；
  头部只留「小记」+ 条数徽标；正文区拆为
  左＝常驻写作面板（图片工具条置顶、写作区 `flex:1` 撑满栏高）+ **卡外发布行**（`小记一下` 中性描边胶囊 +
  `按 ⌘ Enter 发布` + `可拖入或粘贴图片` + 右侧 `取消`），右＝小记卡片流；两栏各自独立滚动（外框 `overflow:hidden`）。
  卡片时间戳改为 `更新于 MM-DD HH:mm`（用 `updatedAt`）。
  **新增 ⌘/Ctrl+Enter 发布**（参考图里的快捷键提示要真的能用）。
- **卡片动作默认收起**：`.quick-note-card-actions` 由 `opacity:.48` 改成 `0`，`:hover` / `:focus-within` 才显形
  （focus-within 保键盘可达）。
- **移动端书架去掉封面「01/02…」编号**：删 `.nb-shelf-index` 节点与样式（用户要求；色相只留在图标徽章上）。
- **重要边界**：**移动端小记是另一套实现**（`src/mobile/home/{HomePage,QuickNoteComposer}.tsx` + `mobile.css`），
  本次**未动**（用户明确："小记移动端不改左右，只有桌面端改"）。桌面小记样式在 `styles.css`/`quick-notes.css`，
  而 `src/mobile/main.tsx` **不加载**这两个文件 → 桌面版式不会渗到移动端，别再"顺手统一"。
- 回归：发布路径实测（⌘Enter → 5 条变 6 条、卡片出现；删除 → 回到 5 条，撤销窗口 5s 后真删）✓。

**第八批（260915）—— 桌面小记：写作区收小 + 多选（批量转文档/批量删除）+ 排序**
- **写作区四周收小**：卡片内边距 `12/14/14` → `10/12/12`，写作区 `min-height` 240 → 200，
  左栏 `padding: 0 8px 8px 0` + 卡片 `margin: 4px 0 6px 2px`（四周都留出一点空隙）。
- **多选**（仿语雀参考图）：头部加 `多选` 图标按钮 → 每张卡左侧出现勾选框（`.qn-check`：绿色实心 + 白勾，
  位置在卡片外侧左槽，列表 `padding-left: 30px`）、顶部多选条＝全选勾选框 +「共选择了 N 篇小记」+ `取消`
  ｜右侧 `转为文档` + `批量删除`（危险色）。多选态下卡片整块可点选、动作行隐藏、双击不再进编辑。
  - 批量转文档：复用同一条 convert 路径循环（全部进用户选中的同一个笔记本）；
  - 批量删除：先 `window.confirm` 确认（破坏性不可恢复），**不进撤销窗口**（多选语义＝确定删）。
  - **坑（第一版踩到）**：`.quick-note-select` 是 `position:absolute`，必须给 `.quick-note-entry` 加
    `position: relative`，否则勾选框全部锚到更外层定位祖先上（实测 x=8、全叠在一起）。
- **排序**：`按更新时间 / 按创建时间`（菜单在头部排序按钮下），存 `localStorage: lake-notes-v3.quick-notes-sort`，
  **纯展示、不进 S3**（用户口径：小记先后顺序不重要，各端各按自己偏好展示，不构成跨端冲突；
  与 Android 端已有的小记排序同口径）。实测切换后刷新页面仍保持，已恢复默认「按更新时间」。
- 端到端验证（用户本人操作）：用批量转文档转了 2 条小记 → 墓碑 `conversion_target_note_id` 有值、
  目标文档正文带上原文字（标题按既有设计为「未命名文档 · 创建时间」，不取首行）、小记列表移除 ✓。

**第九批（260915）—— 小记：勾选框常驻 + 发布键强调 + 去掉空状态行**
- **多选不再有独立按钮**：去掉头部的「多选」按钮；**每张卡片左侧常驻勾选框槽位**（默认 `opacity:0`，
  卡片 hover / 键盘聚焦 / 已选 / 多选态才显形），点它就是进多选（`toggleSelected` 里 `setSelecting(true)`）。
  - **坑 1**：勾选框落在卡片盒子**之外**（`left:-30px`），只写"卡片 hover"会在鼠标移向勾选框时（指针已离开卡片）
    闪没 → 必须同时写 `.quick-note-select:hover { opacity:1 }`，并用 `::after { inset:-8px }` 扩大命中区跨过空隙。
  - **坑 2**：勾选框是绝对定位，卡片必须有 `position: relative`（上一批踩过）。
  - 左槽改**常驻** `padding-left: 30px`（原先只在多选态出现，会引起卡片横向跳动）；为腾出这 30px，
    写作栏整体左移（pane `padding-left` 32→14、分栏首列 38%→36%），实测卡片 x 543（原 549）基本不变。
- **发布键强调**：`.quick-note-publish` 默认中性描边；**有内容（或编辑既有小记）加 `.is-emphasized` = 主色实心**，
  两种按钮（`小记一下` / `保存`）共用同一套强调样式。实测：空态白底 → 输入后 `rgb(59,91,219)` → 清空后回白底。
- **去掉小记页底部的空状态行**：`styles.css` 里 `2609xx` 曾为小记视图写了
  `.app-shell.quick-notes-active .workspace { grid-template-rows: minmax(0,1fr) 28px !important }`，
  小记页没有状态栏内容 → 那条 28px 只剩一条灰带。改为单行 + 去掉底部 4px margin，工作面直接贴到窗口底。

**第十批（260915）—— 多选条并入头部行**
- 多选条从"右栏顶部独占一行"改为**并入头部那一行**（与「N 条 / 排序」同位置，用户要求：对齐、别占卡片区）：
  多选态下头部右侧显示 `☑ 共选择了 N 篇小记 ｜ 取消 —— 转为文档 批量删除`，左侧仍是「小记」标题；
  非多选态仍显示 `N 条 + 排序`。删掉了 `.quick-notes-selectbar` 及其在列表里的占位块
  （`.quick-notes-list` 不再因多选多出一行）。实测：多选态与普通态下首张卡片 y 均为 113，卡片区零位移。
- **再修正（同批）**：`.quick-notes-header` 改用与 `.quick-notes-split` **相同的栅格**（`minmax(290px,36%) 1fr` + 18px gap），
  于是头部工具区起点 = 卡片列起点 → **全选框与卡片勾选框同列**（实测 x 513 vs 514）；多选工具**左对齐**，
  「N 条 + 排序」用 `flex:1` 的 spacer 推到最右并**始终保留**（用户要求两块同时可见，不再互相覆盖）。


**第十一批（260915，桌面）—— 小记卡片图片改为完整展示 + 桌面设置页补扫**
- **卡片里的图片不再裁切**：原先 `.quick-note-saved-images img { width:100%; max-height:280px; object-fit:cover }`
  会把竖长图裁成中间一条（用户那张 1220×2656 的截图因此基本看不到内容）。改为
  `width:auto; max-width:100%; max-height:460px; object-fit:contain; margin-inline:auto` → 等比完整展示。
  实测（DOM 注入验证，不动数据）：2560×1440 → 351×197、1220×2656 → 211×460，宽高比都保持 ✓。
  编辑草稿里的图片格仍是缩略图 `cover`（那是草稿预览，语义不同）。
- 桌面设置页补扫：快捷键 / 日志 / 云端与同步 / 文档与历史 / 回收站 / 资源 —— 版式、分组、数值控件右对齐、
  危险操作红色描边、快捷键胶囊均正常；标签色实测 `rgb(34,34,34)` 中性墨色（先前"看着偏蓝"是错觉）。**未发现缺陷**。

**第十二批（260915，桌面）—— 小记图片点击放大 + 草稿恢复框收进 b3 套（结构性问题开工前的收尾）**
- **小记卡片图片补「点击放大」**：复用编辑器同一套 `ImageLightbox` 单例（`openImagePreview` + 挂 `<ImageLightbox />`，
  与 `EditorTab.tsx` / `LakeEditor.tsx` 同款挂法）；画廊只收**有 url** 的图（`url?: string`，直接 map 会 TS 报错），
  索引按 id 找。实测：卡片内 520×1400 竖长图渲染 171×460（contain，`cursor: zoom-in`、`title=点击放大`）→
  点击后 lightbox `1 / 1`、图 284×764（不裁切、z-index 1000）→ Esc 关闭 ✓。验证用的探查小记已删除（`deleted: 2, remaining: 0`）。
- **草稿恢复框收进浮层通用件**（长期待办 §3.2 收口）：`.draft-recovery-backdrop/dialog/row/restore/discard` 整套自造类删除，
  改用 `.modal-backdrop` + `.ln-dialog{__head,__title,__body}` + `.b3-list-item`（行复用回收站/历史的两行密度 `ln-row2__*`），
  `overlays.css` 只留 6 行间距/危险色。实测（DOM 同构注入）：弹窗 520×219、圆角 12px、表面 `rgb(255,255,255)`
  =`--b3-theme-background`、头高 49px、行高 43px、标题 13px/元信息 11px 全是 b3 令牌色 ✓。
- **坑**：`.modal-backdrop` 的 z-index 是 30（旧自造遮罩是 900）；本对话框只在启动期单独出现，无叠层冲突。
- **坑**：验证脚本里 `document.querySelector('.activity-button[title="小记"]')` 才是左侧 rail 的选择器——
  rail 按钮是纯图标（`textContent` 为空，只有 `title`/`aria-label`），按文本找会静默匹配到别的按钮。

**本轮审计结论（未改，等用户拍板，见会话提问）**
1. **移动端首层排版**：知识库 4 列彩色书架；「最近文档」是 5 张一模一样的「纸片线条 + 回形针」插画卡（深色下像空盒子）。
2. ~~移动端系统栏~~ **✅ 已修（第二批）**；~~移动端阅读态底部留白~~ **✅ 已修（第二批）**；~~`--shell-*` 令牌重复~~ **✅ 已收敛（第二批）**。
3. ~~待清理的死声明（低优先）~~ **✅ 已并入 §2.38 的结构性收敛**（浅色渐变起止点那批死声明在本轮被实测判定后删除；后续同性质清理继续走 §2.38 的工具链，别再手工删）。
4. ~~编辑器内 Lake 原生控件~~ **永不做（用户 260915 拍板：这条从待办里删掉，不要再提）**。
   工具栏左侧插入钮是内核自带控件（vendor 内部），按"不 patch 内核"原则不动。

### 2.38 CSS 结构性问题收敛（260915，桌面已完成第一批；移动端只做了测量）
> 症状（用户 260914 提出）：同一组件被 2~3 层规则互相覆盖，改一处要同时改 3 个文件；
> `.note-row` 的文字色**实际生效的不是源码里那条**。根因：`styles.css` 最先加载却用 `!important`
> 去压后面 12 个文件，而它自己那层里大量声明早已被后面的层完全盖住 = 纯死重。

**方法（全部实测，不靠读代码猜）**
1. **逐条声明做实验**（CDP 注入）：删掉该声明 / 去掉它的 `!important`，读取匹配元素（属性可继承时含后代）
   的计算值 → `dead`（没匹配到元素）/ `shadowed`（删了也没变化）/ `effective` / `load-bearing`。
   **坑**：必须按「源码里写的声明」为单位，不能按 CSSOM 展开的 longhand——`border: 1px solid red !important`
   在 CSSOM 里是 12 条 longhand，逐条做实验会得出「删掉也没事」的假结论。做法：解析 `rule.cssText`
   拿到写出来的声明，再用同名属性 `setProperty/removeProperty` 加/减。
2. **12 屏 × 深浅两主题**（资料库 / 小记 / 编辑器 / 快捷键 / 云端与同步 / 日志 / 文档与历史 / 回收站 /
   资源 / 关于 / 搜索）各跑一遍，任一屏有变化就不动。
3. **合并验证 + 自动剔重**：把整份计划一次性应用，比对全页计算值；有变化的条目剔掉，迭代到零变化。
   **坑（重要）**：成对无变化 ≠ 合并没有变化——删掉两条同值声明会让第三条不同值的露出来。第一版
   397 条计划合并应用时 50158 个元素变化，剔掉 216 条后才归零。
4. **像素级兜底**：改动前/后同流程截图，7 屏共 18.26M 颜色通道 **差异 0**。

**第八批（260915，**用户拍板：按思源的模型做窄窗**）——弹性列宽 + 正文档下限 + 窄窗导航开关**
> 用户补充了窄窗的真实用途："很多人把笔记软件当资料对照库，收成窄窗方便对比和悬挂阅读"——
> 所以窄窗不是"能看就行"，而是**必须可用**。做法照思源（证据见下）。

- **思源为什么丝滑（本地 `siyuan-master/` 实测）**：① 壳是 flex，
  `.layout__center { min-width: 148px }` + `.layout__dockl/r/b { flex-shrink: 0; transition: var(--b3-width-transition) }`
  ——列宽本身可动画、且正文档有硬下限；② **桌面 SCSS 里 shell 层级没有任何 `max-width` 查询**
  （全部 9 处都在弹窗上），宽度不参与布局分支；③ Electron `minWidth: 493 / minHeight: 376`。
  它的"窄 UI"（`app/src/mobile/` + 1580 行 `_mobile.scss`）是**按设备/模板选的第二套产品面**，
  `isMobile()` 只看页面里有没有 `#sidebar`，跟窗口宽度无关。
- **我们为什么做不到（三个原因）**：① 壳是**定宽 grid + 几何全写在 `@media (min-width: 761px)`** ⇒ 761px 断崖；
  ② 折叠是"换 class"但几何仍在同一个媒体块里 ⇒ 窄窗下折叠态无效；③ 我收敛第一批时把
  `.app-shell.sidebar-collapsed{grid-template-columns:44px 1fr}`（窄窗唯一规则）误删（已记在第六批）。
- **本轮改法（提交见下）**：窄窗块改成 **收起态固定 44px 列 / 展开态 `minmax(0,--sidebar-width) + minmax(148px,1fr)`**
  （工作区永不低于 148px）；`.sidebar` 在窄窗铺满自己那列（展开时树真的能看）；
  `useDesktopShell` 里 `toggleSidebarDock` 在窄窗退化为"把目录树拉出来/收回去"的开关
  （`narrowSidebarOpen`，同样不写 localStorage）。
- **实测**（416/560/900/1315 × 收起/展开，均无水平溢出）：
  416 收起 = 38+44+**334**，416 展开 = 38+230+**148**；560 收起 = 478 / 展开 = 265+257；
  900 收起 = 862 / 展开 = 265+597；1315 停靠 = 265+1012（与改动前一致）。轨按钮 y=46/74（<761 时），
  红绿灯带之下。
- **补充（用户 260915 二轮反馈："中间一条很大的空隙 + 顶栏也要适配"）**：
  ① 窄窗收起态把侧栏 `display:none` 之后，工作区必须显式挪到第 2 列——否则栅格仍是三段
  （实测 416px = `38 + 148 + 230`，中间那条 148px 死列就是"很大的空隙"）；现在 416 = `38+378`、
  560 = `38+522`。
  ② 顶栏（`.tab-bar`，注意它没有 `.topbar` 这个类）在窄窗折成两行：第一行工作空间下拉/同步/更多，
  第二行整条给标签胶囊并允许横向滚动；macOS 下第一行 `padding-left: 44px` 让开红绿灯
  （实测标签条 x=82，已在灯带右侧）。截图复核：560px 无重叠、无空隙。

**第七批（260915，移动端收尾）**
- **删掉「最近文档」卡片右上角的回形针徽章**（`.doc-card__clip` + `<Paperclip size={10}/>`）：浅色/深色下
  都是一枚固定的纸片+回形针插画，深色里像空盒子（上个会话审计就点过名）。现在只剩 `.doc-card__paper`
  的纸面 + 横线，靠标题/日期区分内容。
- **移动端 `!important` 结论（补上 @media 守卫后重测）**：5 屏实测 456 条 `!important` 声明里
  453 条是当前状态"没匹配到元素"，3 条"去掉优先级无变化"但同样 `matched=0`（都在未命中的媒体块里）——
  **移动端没有可安全摘除的 `!important`**；`mobile.css` 那 12 处都是"跟思源/antd 层抢"或无障碍分支，
  结构与桌面不同（桌面是 5 层互相盖，移动端只有一层）。移动端这轮的结构收益就是前面删掉的 69 条死规则。

**第六批（260915，**用户报的窄窗问题**）——761px 断崖 + 我自己引入的回归，一起修掉**
> 症状（用户）："以前为了修窄窗直接把窗口最窄长度限死；但右侧一开 DevTools，窗口又乱了。"
> 实测（把视口压到 416×819 = DevTools 停靠后的真实宽度）：只剩左轨 + 目录树，**工作区宽度 0、顶栏消失、还带水平滚动**。

- **根因 1（历史）**：桌面壳层的全部几何（停靠边距 / 状态栏 / 顶栏 / 卡片圆角 / 面板尺寸）都写在
  `layout.css` 的 `@media (min-width: 761px)` 里 ⇒ **761px 是一道断崖**，视口一窄整套失效，只剩
  `styles.css` 的基础栅格 `260px 1fr`（侧栏 260 + 工作区被挤没）。`electron/main.ts` 的 `minWidth: 800`
  就是把用户挡在断崖之外的老办法——但 DevTools 停靠不吃 minWidth，所以照样翻车。
- **根因 2（我自己引入的回归，必须记住）**：收敛第一批把 `.app-shell.sidebar-collapsed { grid-template-columns: 44px 1fr }`
  当成"被完全盖住"删了——它在 1315px 下确实被 layout.css 盖住，**但在 761px 以下它是唯一规则**。
  **教训：审计只在单一视口宽度（1315×868）跑，"完全被覆盖"的判定必须先确认覆盖它的规则是否位于 `@media` 内**；
  否则会把"只在另一种视口/状态生效"的规则当死代码删掉。（同类风险：`@media (max-width:)`、`@container`、打印样式。）
- **修法（两步，缺一不可）**：
  1. **JS**：`useDesktopShell` 加 `NARROW_SHELL_WIDTH = 900`——视口 ≤900px 一律**按收起态渲染**
     （左轨 + 侧栏条 + 工作区；侧栏 hover 时以浮层展开，这套交互本来就有）。只覆盖本次渲染，
     **不写 localStorage**，窗口拉宽后用户原偏好原样恢复。
  2. **CSS**：`styles.css` 末尾补 `@media (max-width: 760px)` 兜底几何
     （`rail + auto + 1fr` 三列 + 显式 `grid-column`，让侧栏 `display:none` 时中间列自动收成 0），
     `@media (max-width: 560px)` 把小记工作台两栏叠成单栏；`electron/main.ts` 的 `minWidth` 800 → **560**
     （断崖没了，就不用再靠限制窗口尺寸兜）。
- **实测**：416 / 700 / 1000px × 资料库 / 小记：`scrollWidth == 视口宽`，**溢出元素 0**（修前 416px 是 15 个，
  且工作区宽度 0）；1000px 的 5 个"溢出"是既有的 lakex TOC 图钉（超出 2px），非本轮引入。
- **还没做**：移动端那部分（`mobile.css` 12 处 `!important` 逐条验证 + 「最近文档」卡片右上角的
  回形针徽章 `.doc-card__n`）——留给下一轮，按"移动端 bundle 无文件归属"的老问题处理。

**第五批（提交 `dae9cd4`，**用户决策**）——壳层材质改单色分层，材质层 !important 随之清零**
> **这是观感决策，不是纯重构**：用户 260915 拍板"顶部那条渐变我看不出来用在哪，做成单色"。
> 之前四批一直压不掉的那批 `!important` 就是用来钉这条渐变的——渐变写在**最外层 `.app-shell`**，
> 而侧栏/顶栏/状态栏/浮窗各有一层自己的单色在压它，谁想透出渐变就得抢 `!important`。

- **改法**：`b3/layout.css` 的 `.app-shell` 从
  `linear-gradient(180deg, mix(#fff 45%, #ebecf0) 0%, #ebecf0 160px) !important` → `var(--b3-body-background)`
  （取渐变落定后的主体色；顺带去 `!important`——它本来就晚加载，靠顺序即可赢）；`styles.css` 里 7 处
  `linear-gradient(180deg, var(--lake-shell) 0%, var(--shell-material) NNNpx)`、`--shell-unified-background`、
  `--shell-unified-topbar`、`outline.css` 的硬编码渐变全部压平成单色。
- **证据**：压平本身 4 屏浅 + 3 屏深，变化幅度 maxΔ ≤10（浅）/ ≤6（深），只落在顶部渐变带（"渐变没了"这一件事）；
  压平之后再去 **47 处材质层 `!important`**，9 屏里 8 屏像素 **0 差异**、1 屏 14 个通道 Δ≤9。
- **给后人的话**：`--shell-*` 那套"材质令牌"现在就是单色别名（`--shell-unified-background: var(--lake-shell)`）。
  **不要再往 `.app-shell` 上加渐变/材质**——一加就会重新长出"整层互相压"的 `!important`；真要加，先把
  谁画它收敛到一条规则。

**第四批（提交见下）+ 构造状态**：靠导航到不了的状态（拖拽中 / 同步 toast / 图片 Lightbox / 删除确认框 /
标签切换菜单 / 编辑器代码块与文件卡）改为**在页内构造等价 DOM**（`/tmp/lkcdp/inject.mjs`：给树行加
`drop-before/drop-after/drop-inside/dragover`、往 body 注入 toast/lightbox/确认框、往 `.lake-editor-mount`
注入 `ne-card[data-card-name=codeblock|file]`），审计完再移除。26 屏（浅）+ 24 屏（深）合计 → 101 条候选，
剔除材质层（壳层/浮动窗表面属性共 54 条）后落地 **25 条**，像素回归 **11 屏全 0 差异**（最大 1 个通道
Δ1，属抗锯齿级别）。结论：把状态补到这一步后，剩下能安全去掉的 `!important` 已经很少了——它们集中在
两处：① 材质层（整层规则 + 令牌，必须成组看）；② 编辑器内核（lakex vendor）自己的样式。

**第三批（提交 `d83cf97`）+ 两条硬教训**

1. **fileIdx 必须"照数不对齐就落盘改错行"**：守卫跳过未命中的 `@media` 后，浏览器侧规则序号与源码侧
   不再一致 → 上一批 63 条只能跳过。改成「**照数**所有叶子规则、只是不对未命中的做实验」后序号对齐
   （`v-rule-align.mjs` 可以自查：Node 解析的规则数/顺序必须等于 CSSOM）。补上后重跑 19+ 屏 × 双主题：
   81 条候选（这次**全部两主题都判"去掉优先级无变化"**），最后按像素回归只留下 **15 条**。
2. **合并判据不是"逐条都无变化"，而是"这一组一起应用后像素 0 差异"**——本轮有两组必须原样保留 `!important`：
   - **壳层表面属性**（`app-shell`/`activity-rail`/`sidebar`/`workspace`/`tab-bar`/`statusbar` 的
     `background`/`border`/`box-shadow`）：去掉后整窗出现约 **2%** 的均匀色差（材质渐变 vs 平色）；
   - **浮动窗/设置面板表面**（`floating-dialog`/`settings-panel*`/`settings-header`）：去掉后浅色下设置弹窗
     出现 **0.144% / maxΔ 12** 的可复现色差。
   结论：这类"材质色"属性是**一整层**在共同决定观感（依赖注入到 `--shell-unified-*`/`--floating-dialog-*`
   令牌的整套规则），不适合按单条 `!important` 逐个去。
3. **像素回归必须先做"同源连跑对照"**：设置弹窗有跨运行的持久状态（`useFloatingDialog` 记住尺寸/位置），
   我一度把 2.96% 的状态差异当成 CSS 回归。判据：同一份 CSS 连跑两次应 0 差异；差异大于该噪声才可信。
4. **两条会让审计卡死的坑（务必避开）**：
   - 点小记「编辑」会留下未保存草稿，之后再导航会弹 **Electron 原生确认框** → renderer 主线程阻塞、
     CDP 全部调用超时（`Page.handleJavaScriptDialog` 无效，它不是 JS dialog）；只能屏幕外按 Esc/Cancel
     或重启 app。审计脚本里这两个状态（`quicknote-edit`、`confirm-delete`）已移除。
   - 杀掉 Electron 后 **vite dev(1421) 也可能一起没了**，此时 `nohup electron .` 会因连不上 dev server 直接退出；
     正确做法是重开 `npm run dev`（tty 长驻，vite-plugin-electron 自动拉起 9222）。

**第一批结果（提交 `12d5861`）**：181 条改动落地 —— 整条规则删除 99 条、单条声明删除 67 条、
去掉多余 `!important` 15 条；`styles.css` −293 行、`b3/components.css` −47 行、`b3/layout.css` −17 行。
真实生效（effective）的声明一条没动；`@media (prefers-reduced-motion)` 内的声明零改动
（`@media (min-width: 761px)` 内的 46 条在 1315×868 窗口下是匹配的，属实测有效范围）。
**第二批结果（提交 `91d27b3`）**：状态覆盖从 12 屏扩到 **19 屏**（新增 hover 树行 / focus 新建输入 /
右键菜单 / 文档属性 / 搜索有结果 / 大纲 / 小记编辑态——`:hover`、`.context-menu`、`.note-info-*`
这类选择器要真的匹配上才谈得上审计），深浅两主题各跑一遍 → 「去掉 `!important` 无变化」168 条 →
落地 **104 条**（其余 63 条 fileIdx 对不上，主动跳过）。像素比对 11 屏（浅 7 + 深 4）× 18.26M 通道
**差异 0**；静态复核本轮去掉的 295 处 `!important` 里 **0 处**落在非 `min-width` 媒体块内。
`b3/layout.css` 84→44、`b3/components.css` 32→20、`b3/dark.css` 55→8、`b3/base.css` 8→3。
门禁全程：`tsc` 0 · vitest 969 passed/16 skipped · 桌面 + 移动 `vite build` 通过。

**工具（不在仓库里，重建即可）**：`/tmp/lkcdp/` 下 `css-audit3.mjs`（跑审计）+ `inpage3.mjs`（逐条实验）+
`css-refine.mjs`（合并验证/剔重）+ `apply-plan.mjs`（落源码）+ `cssedit.mjs`（CSS 文本编辑器）。
用法：`node drive.mjs 9222 css-audit3.mjs -`（`LK_MODE=priority|delete`）→ `agg.mjs/agg2.mjs` →
`do-edits2.mjs`（`PLAN_OUT=plan.json DRY=1`）→ `css-refine.mjs` → `apply-plan.mjs`。
**关键守卫**：`v-rule-align.mjs` 会核对「Node 解析出的规则顺序」与「浏览器 CSSOM 顺序」是否一致
（首次不一致就是 `@starting-style` 里的规则没被递归进来）；只有对齐了才能按下标改源码。

**移动端（本轮已做，提交见下）**：移动端加载的是**打包后的单个 bundle**（`assets/mobile-*.css`），
没有 `data-vite-dev-id` ⇒ 无法按文件归属做逐条实验，只能按「选择器是否存在」做静态+动态联合判定。
- **静态 + 动态联合判定**：扫出「选择器里的类名在 `src/**/*.{ts,tsx}` 里一个都不出现」的规则 69 条，
  再在模拟器上跨 5 屏（知识库/小记/文档/设置/搜索）实测 `querySelectorAll` 命中数 **全部为 0** → 删除。
  落地：`mobile.css` −64 条、`editor-dock.css` −1、`dialog.css` −4（后两个是移动端也加载的共享文件）。
- **移动端 `!important` 实测**：全 bundle 466 条（含 vendor siyuan 70 条），但「去掉优先级无变化」的
  9 条**全部落在 `@media (prefers-reduced-motion: reduce)` 里**——模拟器没开减少动态效果，那个分支根本
  不生效，属误判。**这就是给审计器补「跳过未命中的 @media/@supports」这条守卫的原因**（已补）。
  `mobile.css` 自身只有 19 处 `!important`，量级远小于桌面，没有桌面那种多层互盖的病。
- **移动端改动要装机才可见**：模拟器里跑的是上一次 `scripts/android-build.sh --sync --install` 的包，
  CSS 删除属"选择器命中 0"的死代码，重新 build 即生效（本轮已过 `vite build -c vite.mobile.config.ts`）。

## 3. 真正的待办（已剔除全部完成项，按优先级）
> **260904 后续评估（用户决策 + 本轮核实）**：原 §3.1 对象级 5xx 重试、§3.2 快照 gzip 异步化、§3.5 笔记本 `sort_order` 撞号 —— **已评估不做**（5xx 有"失败不 markSynced→下轮重扫"兜底；gzip 异步收益小；sort_order 撞号场景极低）。
> 原 §3.3（FTS 全量重建→增量）与 §3.4（1/2 字短词回退）**合并为一条**：计划**整体重做索引**，两件一起落地（同属 `src/core/searchRepository.ts` 的索引/搜索路径，同时覆盖 10 万文档量级）。
> 原 §3.6（其余浮层统一）**基本已完成**：顶栏菜单/右键菜单/标签切换器已进 b3 令牌（`src/b3/components.css` + `src/b3/layout.css`）；仅**草稿恢复框**（`draft-recovery-*`，`overlays.css` 自定义类 + `--lake-*` 令牌）未收进 b3 套，属可选小收尾。

**性能/健壮性**
1. ~~**FTS 索引重做**~~ **✅ 已完成（260911，见 §2.11）**：统一 FTS5 + unicode61 + 单字预分词 + 增量账本；不再有 1/2/3 字分支。后续增强：移动端 `getDocument("text/plain")` 索引源、A+ 拉丁检索、小记搜索（二期）。
2. ~~其余浮层收尾：草稿恢复框进 b3 套~~ **✅ 已完成（260915，见 §2.37 第十二批）**。

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
> **本会话决策/结论（2609xx）**：① **知识库排序不做**（用户确认）——手机端已删除拖拽重排 + 知识库排序入口，直接展示共享 `sort_order` = 桌面端顺序（见 §2.8.B6）；小记排序保留。② "最近文档"用**最近更新**代理（非"最近打开"），需"最近打开"再单独加追踪。③ 首层首页 + 编辑器工具栏已重做（§2.8），**已提交**（a752f2a）。④ 删除/恢复语义、同步红线均未动。

**产品/技术债（长期；评估后多属低/缓）**
3. W-8 ACAO / W-10 dompurify（并入"lake 资源导入统一优化"，**安全相关，建议优先**）；依赖维护：`@types/better-sqlite3` 可单升。
4. 大纲 **viewer（只读）点击标题不跳转**（用户计划重做大纲时一并处理，低优先）。
5. **回收站首拉成本**（批量删除后接收端首拉仍下全文+资产）——惰性下载方案**暂缓**（要动恢复红线，低优先）。
6. Store 分批重构（**拆分完成**，分支 `refactor/store-split` 8 commits 已推 Gitee，待用户验收后合 master）：全部只搬家不改语义，事务边界/SQL 零改动，每批全量门禁验证（904/15 + tsc + check:core + 双端 build）。store.ts **2352 → 1103 行（-53%）**，8 个新领域模块：① `trashLifecycle.ts`（回收站 300）② `historyLifecycle.ts`（快照 205）③ `orphanLifecycle.ts`（孤儿资产 296）④ `diagnostics.ts`（体检/备份 187）⑤ `syncReconciliation.ts`（同步对账 451：hash 账本/标记/applyRemote*/墓碑/游标/GC 记录）⑥ `settingsRepository.ts`（设置 123，类型收敛到 storeTypes.ts）⑦ `noteExport.ts`（导出 206 + localAsset*Re 正则工厂）⑧ `schemaInit.ts`（建表/迁移/种子 221）。**终态**：Store = 组合根装配 + 笔记域核心 CRUD（createNoteInWithContent 等与 ensureParent/resolveParentNotebook 强耦合，按"Store 留核心"原计划原则保留）+ wrapper。
7. ~~**folder 墓碑不跨端传播**~~ **✅ 已完成（260911，提交 2ecac39，见 §2.10）**：manifest 已携带 folder 墓碑表达，收端子树 purged、学端防复活，四端压测 + 12 条笔记 purge 链路验证通过。
8. Word/PDF 导出（`electron/export.ts` 已预留 docx/pdf）；附件大文件 S3 分片/断点续传（**nice-to-have，未被需求驱动**）。
9. **Lake 内核策略**（属政策，非任务，记录即可）：A lakejs 开源源码当"机制字典"；B 版本锚点 + hack 清单（vendor lakex 已 pin，勿随意升级）；按需最小 patch，**不整体 fork**。
10. **lakex 契约固化（编辑器可观测性，低成本待落地）**：新增 `src/features/editor/lakex-contract.d.ts`（完整设计见 `docs/LAKEX-CONTRACT.md` §4，速查表 §5），替换 lakeRuntime 等处的 `as any`、收敛反编译结论；纯类型改动 + 门禁全绿，**不碰 vendor**。

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
2. **搜索重构已完成（§2.11，分支 `feat/search-refactor`）**：`src/core/search/` 共享核心 + 桌面/移动 FTS5 统一，设备实测通过；待用户验收后合 master。后续增强：移动端编辑器纯文本源、A+ 拉丁检索、小记搜索（二期）。
3. 待用户验收 `refactor/store-split` 上的 260911 批次（2ecac39 同步收敛 + a18a95b 安卓修复）后合 master；用户可能要求真机（小米）复验 §8.7.0。
4. 移动端一律按 **§8**（§8.0 移动端/桌面硬隔离已解除——现桌面与移动可自由改；仅 `src/b3/**` 思源 vendored 组件等共享/合规件仍须谨慎）。
5. 任何同步/GC 改动**先读** `AGENTS.md §3 #11/#12/#13/#15/#16` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立、复活路径在哪"。
6. UI 改动先看 `AGENTS.md §3 #14`（思源版式语法），别再造第四套类名、别写内联样式。

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
- **工具栏 `--kb-offset`（bottom 基准）**：面板开时 `usable = Math.max(0, innerHeight - base + panelHeight, offset)`；无面板 `usable = offset`。作用：键盘收起 `innerHeight 530→842` 全程工具栏屏幕 Y **不跳**；`max(…, offset)` 兜底 edge-to-edge 真机（键盘回弹瞬间工具栏实时抬到实测键盘上方）。CSS：工具栏 `bottom: var(--kb-offset)`（**无 transition**——对 resize 中的视口做动画会把一帧错位放大成抖动）；面板 `bottom:0; height:var(--kb-offset)` 占键盘区（**有 `box-sizing:border-box`**，塌缩到 0 时不会剩 padding 细条）。
- **面板⇄IME 硬互斥兜底（260911 新增，EditorDock guard effect）**：Lake 命令（hr 等）执行后**内核会异步重聚焦 contenteditable → 输入法弹回**，面板开着时会把面板压扁盖住工具栏（用户三次报此现象，260911 定位到真因）。兜底：`useEffect` 监听 `panelMode && keyboardOpen`（实测键盘状态驱动）→ `setPanelHeight(max(h, height))` + `blurActiveEditable()` 再压回。**任何机型/输入法通用**，因为依据是 visualViewport 实测而非输入法假设。
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

**（260911 本会话新增，提交 a18a95b）安卓 AssetServer + Dock 竞态 —— 详见 §2.10**：
- **AssetServer token 语义对齐桌面**：仅 CORS（带 Origin）校验 token，no-cors（`<img>` 等）放行，外部 Origin 仍 403；修 no-token canonical URL 403 → 图片空白（87e4642 的过度限制）。`+3` 单测（`AssetServerTest`）。
- **Dock 面板⇄IME 硬互斥**（guard effect + panelHeight 跟踪实测 + border-box + usable max(offset)），模拟器实测 0 遮挡。
- **实验痕迹清理**：12 条实验笔记 UI 删除→purge→三端 purged=true。

### 8.6 当前问题 / 未决（需用户真机给现象）
1. **大纲 viewer 跳转 —— 已修复，但待长文档真机验证**：根因（`.mobile-workspace-body` 非 flex → doc 高度塌陷 0）已修复（e95ec6f，实测 doc 高 0→794）。**但**完整"点击大纲标题滚动到位"未端到端验证——因为**用测试文档造不出 Lake 可接受的高内容**（`ne-p`/`ne-h1` 格式不被编辑器接受，渲染成短内容），这是测试固件问题非 bug。**用真实长文档（正确内容格式）点大纲标题确认**。若仍不滚，给现象。
2. **"正在下载"从未复现**（MutationObserver 实时抓也没有）——判断是编辑器初始化瞬时态/旧命令报错后遗症，修复后未见。**若真机仍见，要截图或位置**。
3. 命令在**被改乱的段落**上可能不生效（caret 落标题/边界时 list 0→0）——编辑器 caret 语义，非命令 bug；干净段落正常。
4. **剪贴板粘贴不解析为空**（§3.6-3.8 遗留）：静态线索=移动端入口没挂 `installPasteInterceptor`；android worktree 已补挂，先沿那条线验证。
5. ~~**本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` 真机不可达**~~ **✅ 已解决（260911）**：安卓端 `AssetServer.java` 让 canonical URL 在本机可达，403 过度限制已修（§2.10），模拟器实测编辑器内图片正常渲染。`adb reverse tcp:19876 tcp:19876` 仅宿主机浏览器调试时需要。
6. 用户"移动端整体编辑还有问题"现象未细化——**真机反馈给具体现象再定位**。
7. ~~**首层首页 + 编辑器工具栏改动未提交**~~ **✅ 已提交**（a752f2a，260911 前批次）。
8. **首层"最近文档"= 最近*更新*代理**：非"最近打开"；对用户说清后可再加 `last_opened_at` 追踪。
9. **知识库排序已删除**（用户决策，不再做）：手机端不再写本地 `sort_order`，展示共享顺序 = 桌面端顺序。若日后想"每端独立顺序"，需改同步协议（manifest `folders[].sortOrder`），属红线区、须谨慎。
10. **首层新 UI 真机确认项**：书架白卡+线条 `BookOpen` 图标（已去彩色/红 emoji）；最近文档极简 icon+标题（已去灰底）；顶部排序按钮仅小记显示；知识库右上角为书架↔列表切换。

### 8.7 下一步（移动端，按优先级）
0. **（最新）真机（小米）验收 260911 双修复**（模拟器已实测通过，真机待验）：① **图片/附件插入后立即显示**（AssetServer no-cors 放行修复，此前上传后空白 403）；② **编辑态工具栏不被面板/键盘盖住**（插入分割线→回车复现路径）；③ 同步后图片加载。注意真机很可能是 **edge-to-edge 模式**（与模拟器 adjustResize 不同），兜底已覆盖但值得盯一下。
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

**（260911 同步收敛 + AssetServer + Dock 竞态新增）**
- **跨端平台代码先读对端实现再写**：安卓 AssetServer 当初对所有请求强制 token（87e4642），而桌面只对 CORS 请求校验——语义漂移直接造成「上传后图片全 403」。安全语义（token/Origin）两端必须逐字节对齐。
- **Lake 命令执行后内核会异步重聚焦 contenteditable**：面板开着时 IME 会被顶回。不要试图枚举谁在重聚焦（lakex 闭源），用**实测键盘状态兜底**（`panelMode && keyboardOpen` → 再 blur）；`panelHeight` 是打开瞬间的快照，真机输入法带候选条/工具条会更高，必须跟踪实测最大值。
- **`.med-panel` 的 `height:calc(var(--kb-offset))` 必须配 `box-sizing:border-box`**：否则塌缩到 0 时剩 27px padding+border 细条，压在工具栏下半截（就是用户截图里的「工具栏被弹窗盖住」）。
- **adjustResize 下「面板展开 + IME 弹回」的可视症状**：窗口 842→530、`--kb-offset`→0、面板变细条——看到的不是「键盘盖住工具栏」而是「面板细条盖住工具栏」，别误判成 z-index 问题。
- **`listNoteSummaries()` 没有 `trashedAt` 字段**（返回 id/title/parentId/sortOrder/updatedAt/syncState/isConflict/isLocked/lockedAt）：判定「回收站/活跃」必须用 `listTrash()` 的条目（含 `purged`/`deletedAt`）。本轮验证脚本两次因此误判「删除失败」。
- **桌面实例会占宿主机 19876/19877**：`adb reverse tcp:X tcp:19876` 想从宿主机 curl 安卓 AssetServer 时，请求会被宿主 Electron 的 asset server 截胡（404/语义不同）——先 `lsof -nP -i :<port>` 确认宿主端口归属，换冷门端口。
- **`adb kill-server` 后 reverse 规则可能注册了但监听没真正建立**（curl 000）：重启 adb server 后重建 forward/reverse，再 `lsof` 核对监听。
- **CDP 复现 IME 竞态的假象**：物理 `input tap` 后 `userTappedEditorRef` 可能残留 true（目标已聚焦时不再触发 focusin 消费）→ 程序化点击面板命令会把面板关掉，与真实用户路径不同。验证 IME 用 `dumpsys input_method | grep mInputShown` 当事实源；测兜底可直接 JS `el.focus()`（CDP 的 focus 足以唤起模拟器 IME）。
- **模拟器 headless 实例复用坑**：`emu-up.sh` 检测到已跑实例就复用；前会话 `--no-window` 启动的实例会让用户「看不到界面」。处理：`adb emu kill`（优雅关，AVD 数据不丢）→ 重跑脚本（默认带窗口）。

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

### 2.36 目录树交互对齐思源：桌面 ⋯＋ / 移动端 ⋯＋ + 长按拖拽（260912）
- **桌面**：每行 ⋯（竖向 lucide-ellipsis-vertical，= 右键菜单，弹出位置在按钮处）+ ＋（= 新建子文档）。动作默认 display:none 不占宽度（不逼标题缩略），行 hover/选中/聚焦才显形，此时标题才 ellipsis 截断让位；着重色只给光标所在的那个按钮。对齐思源 .b3-list-item__action / more-root / new（见 siyuan-master/app/src/layout/dock/Files.ts:1448-1451）。
- **移动端**：行内 ⋯ + ＋ 常显（触屏无 hover；对齐思源移动端 MobileFiles.ts:1505-1509——移动端行 class 不带 --hide-action）。⋯ → setMenuFor（现有 MobileSheetMenu）；＋ → 弹「新建文档 / 新建分组」再建（bridge.createNote / bridge.createGroup）。标题 min-width:0 + ellipsis 防超长名盖住按钮。
- **长按拖拽排序**：长按 350ms 进入拖拽（haptic），长按不再弹菜单（菜单交给 ⋯）；document 级 touchmove 跟手位移，用 elementFromPoint + 落点比例（<28% before / >72% after / 中间 inside）定落点，视觉 .nb-dragging / .nb-drop-before|after|inside；松手：同父 → bridge.reorderSiblings，跨父/拖入分组 → bridge.moveTreeNodeOrdered。真机实测：把「安卓上行-2」拖到「安卓上行-1」前，顺序生效。
- **已补齐（ed87eb7 / 9d78e6a）**：① 边缘自动滚动——手指进入面板上/下 64px 内，rAF 循环滚动；② 其他行让位——源行到落点之间的行整体上/下移一个行高；③ 拖起行 pointer-events:none，elementFromPoint 穿透到下层行，落点判定稳定；④ 落点线照搬桌面专做的那套（drop-line-before/after 伪元素画 2px accent 线 + soft 光晕；拖入分组 drop-parent），替换原 nb-drop-* box-shadow 方案。真机合成拖拽复验：第 3 行拖到第 1 行前顺序生效。

---

## 附：会话交接（2026-09-12）—— 无上下文的新会话请先读这一节

> 分支：feat/search-refactor（本地未推；**未经用户验收不要 push / merge**）。工作区干净，门禁全绿（tsc 0 / vitest 959 passed 16 skipped / 桌面+移动构建绿）。

### 0. 本轮任务目标
1. **卡片右键菜单补齐**（桌面 + 移动）：文件卡重命名展示名、另存为、复制合并、剪切、打开原始文件/位置。
2. **目录树交互对齐思源**：⋯ 悬浮按钮 = 右键菜单触发；＋ 快捷创建（后按用户要求全部并入菜单）；长按拖拽排序。
3. **查清并修复「多端同步后文档挂错笔记本」**（用户报了严重不一致）。
4. 用户真机反馈的每个问题当场修掉。

### 1. 已完成

#### 1.1 卡片重命名 / 另存为（桌面 + 移动）
- **重命名展示名**：lakex 里没有文档化的 API，最终实测确认正确调用是
  **cardData.setName(名字) + cardData.sync(true)**（写回文档模型，可落盘；不调 setDocument，所以不重挂、不白屏）。
  详见 docs/LAKEX-CONTRACT.md 第 5.2 节（含反例：setName 单独调用落不了盘；_updateCardValue 传旧值会把卡片清空）。
- **扩展名锁定**：AssetRenameDialog 只编辑基名 + 固定后缀；后端纯函数 renameFileCardDisplay 再锁一次。
- **另存为（移动端）**：扩展 OpenFilePlugin.java 加 saveAs——图片走 MediaStore（进相册），其它走 SAF（系统"保存到"）。
  前端 bridge.saveAssetAs，移动端长按卡片菜单「另存为…」已接入。桌面端走 dialog.showSaveDialog。
- 复制动作合并成子菜单：剪切 / 复制▸ / 重命名 / 使用默认程序打开 / 打开文件位置 / 另存为…；移动端只有「复制文件名」时内联不套子菜单。

#### 1.2 目录树交互（桌面 + 移动）
- **桌面**：每行 ⋯（竖向 lucide-ellipsis-vertical）= 右键菜单，弹出在按钮处；动作默认 display:none 不占宽度，
  行 hover/选中/聚焦才显形，此时标题才 ellipsis；着重色只给光标所在的按钮。行内 ＋ 已按用户要求删除（右键菜单本就有新建）。
- **移动端**：每行 ⋯ 常显（触屏无 hover；对齐思源移动端 MobileFiles.ts，行不带 --hide-action）。
  ⋯ 菜单已加入「新建文档 / 新建分组」（此前菜单没有新建项）；行内 ＋ 与抽屉头 ＋ 均已删除。
- **长按拖拽排序（移动端）**：长按 350ms 进入拖拽；落点判定复用 .side-panel-body [data-node-id] + elementFromPoint + 比例分带；
  松手：同父 reorderSiblings / 跨父或 inside moveTreeNodeOrdered。
  已实现：其他行让位位移、边缘自动滚动（面板上/下 64px，rAF）、拖起行 pointer-events:none 让落点穿透、
  落点线照搬桌面专做的那套（drop-line-before/after 伪元素 2px accent 线 + soft 光晕；拖入分组 drop-parent）、
  **乐观本地重排**（松手立即生效，不等 loadTree，去掉约 2 秒延迟）+ FLIP 松手回弹。
- **inside = 成为子文档**：不再限定分组；移动端 notes 也能作父，可把文档拖成别的文档的子文档（对齐桌面）。

#### 1.3 同步事故：文档挂错笔记本（根因已查清 + 已修 + 数据已修回）
- **现象**：桌面/安卓同一个 S3、同一个「个人笔记」，两端文档列表不一致。
- **实证**：不是丢数据、不是 manifest 覆盖。远端 manifest 链（lake-notes-stress2-260910）里这些 note 一直 parentId=notebook-personal；
  桌面本地却是 9116074d（测试本1）、updated_at 与远端**完全相同**、sync_state=synced。
- **根因（共享 core，一直都有，不是某次改动引入）**：syncEngine 构建合法父集合 validParents 时**只收集远端 folders**，
  本地已有 folder 不算合法父；一旦本次清单没列出该父，effectiveParent() 就落 defaultNotebookId()（最老笔记本）把 note 错挂，
  且沿用远端 updatedAt；之后 decideMetaApply 用严格 updatedAt > lastSyncedMetaAt，时间戳相等 → 永远跳过 → 两端永久不一致。
  纯桌面多端难触发是因为桌面 move 会抬 updatedAt，后续一次移动能顺手纠正。
- **修复**：f867c7e（validParents 纳入 localFolderIdsAtStart + meta 对账加字段判据）；d639b7f/d91c71f（零变更早退前对账 parent 漂移，
  只看本地活跃 note）；fde0725（runDataHealthCheck 增 metaParentMismatch）。
- **数据修复**：零变更早退会挡在对账前，故手动清 device_state.last_seen_commit_id 强制走完整对账 → 10 条自动归位（9116074d 15→5，notebook-personal 10→20）。真机同步后与桌面一致。

### 2. 当前问题 / 未验证 / 遗留
1. **移动端拖拽的"连续手感"没做完整真机验证**：落位提交、即时生效（60ms 内）、子文档移动都已用合成事件验证；
   但**自动滚动的连续手感**与**拖起行跟手的视觉**没法用 CDP 合成事件复现（原生手势行为），需人手指在真机上试。
2. 桌面端目录树头部的全局 ＋（新建文档/分组/笔记本）与移动端「更多 → 新建文档」**保留**了。用户说"统一去掉所有 ＋"，
   但去掉后就没有"新建笔记本"入口（右键菜单没有该项）。若要彻底去掉，需先往右键菜单加「新建笔记本」。
3. 拖拽时拖起行目前是跟手 transform + FLIP 回弹，**没有**桌面那种 releasing 多行过渡动画。
4. 桌面端超长标题平时溢出显示、hover 显形动作时才 ellipsis（用户明确要求"不问不缩、要按钮才缩"）。
5. 测试在手机上把「安卓上行-2/安卓上行-1」等文档顺序动过（dev 测试数据，同步会带到其他端）。

### 3. 下一步计划
1. 真机上用手指完整拖一遍（长按→拖到顶/底触发自动滚动→松手），确认手感；
2. 若用户坚持去掉全局 ＋：给桌面右键菜单加「新建笔记本」（右键任意笔记本节点），再删头部 ＋ 与移动端「更多→新建文档」；
3. 可选：给拖拽补 releasing 过渡动画（参考桌面 Sidebar.tsx 的 releaseState/releaseTransforms）；
4. 可选：把移动端拖拽从自写 touch 逻辑正式收敛到桌面的 Pointer Events 方案（见踩坑 4）。

### 4. 踩过的坑（重要，别再踩）
1. **Android WebView 长按会触发原生 contextmenu**：行上残留 onContextMenu 会弹菜单，压过拖拽。
   移动端行必须 onContextMenu 只 preventDefault（c136c16 修）。
2. **长按会触发原生文字选择**：树区域必须 user-select:none + -webkit-touch-callout:none（821392b 修）。
3. **WebView 抢纵向手势 → touchcancel 取消拖拽**（真机"拖了不重排"的根因）：拖拽激活时给面板 touch-action:none（de808b7 修）。
4. 真机触屏手势有三个独立的原生坑（1/2/3），**CDP 合成 TouchEvent 一个都测不出来**（合成事件不触发原生行为），
   只能靠真机；这也是本轮反复的原因。桌面端用的是 **Pointer Events + setPointerCapture**（鼠标/触屏同一套），
   若后续还要动拖拽，建议直接把移动端也换成指针方案，别在 touch 上继续堆。
5. **childrenOf 必须按 sortOrder 排序**：移动端 childrenOf 原为 tree.filter(...) 不排序，
   乐观重排只改 sortOrder 就**看不出效果**（同级拖不动），而 inside 改了 parentId 却立刻可见（d1fdcb8 修）。
6. **overflow:hidden 不裁元素自己的 transform**：给正在做 translateX 动画的元素自身加 overflow 无效，
   必须加在**祖先**容器上（首页 tab 切滑动"被拉伸"的真因；88251e3 修在 .mobile-app）。
7. **S3 设置在移动端是逐 WebView 的**，App 有两个 http://localhost 的 devtools target；
   只写一个会同步报 "No value provided for input HTTP label: Bucket."，要写所有 target。
8. **CDP 端口在重装 APK 后会变**：真机用 adb forward tcp:9335 localabstract:webview_devtools_remote_xxxx（socket 名会变，需重取）。
   scripts/emu-cdp.sh 只认模拟器，真机要手动取 socket。
9. **启动只跑 npm run dev**（vite-plugin-electron 会自动拉起 Electron，带 9222）。再手动 electron . 会起第二个进程/抢端口。
10. **改样式别自己发明**：落点线/新建菜单都应对齐桌面已专做的实现（src/components/treeDrag.ts、src/styles/ui-polish.css）。

### 5. 环境与命令
- Node 24：export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
- 桌面开发：cd lake-notes-electron && npm run dev（自动起 Electron，CDP 9222；vite 1421）
- 门禁：npx tsc --noEmit && npx vitest run && node node_modules/vite/bin/vite.js build && npx vite build -c vite.mobile.config.ts
- 安卓真机（小米，adapter serial 50950385）：bash scripts/android-build.sh --sync --install
- 真机 CDP：adb -s 50950385 shell cat /proc/net/unix | grep -o webview_devtools_remote_[0-9a-f]* | tail -1
  → adb -s 50950385 forward tcp:9335 localabstract:<socket>
- S3 测试空间：bucket local-lake-hebei，prefix **lake-notes-stress2-260910**（桌面与手机同空间；lake-notes 是无关旧前缀）

### 6. 本轮关键提交
- 卡片/改名/另存为：86491e4 3565615 2c4bd45 940225e fa79763 abdbe9d 10e0996 14338c5 afc8a31 3b1a12f
- 目录树/交互：11142a3 9dc0195 3154041 f9ceda6 b729460 4f3e740 ea78004 e85bf4a c136c16 821392b de808b7 75ef512 d1fdcb8 40eb157 58050ed
- 同步事故：f867c7e d639b7f d91c71f fde0725 34d1a36 4c83e3b
- lakex 契约：b3620cb（docs/LAKEX-CONTRACT.md 第 5.2 节）

---

## 附：会话交接（2026-09-14）—— 无上下文的新会话请先读这一节

> 分支：**feat/drag-siyuan**（本地未推；**未经用户验收不要 push / merge**）。HEAD **e69d4a0**，工作区干净。
> 门禁全绿：tsc 0 · vitest **969 passed / 16 skipped** · 桌面 + 移动构建绿 · Android assembleDebug 通过。
> 起点：上一会话交接点 feat/search-refactor @ 0792ff7（见上一节「附（2026-09-12）」）；本会话在其上追加 **11 个提交**。

### 0. 本轮任务目标（全部来自用户真机/实操反馈）
1. 桌面目录树右键菜单超出屏幕 → 贴边翻转（下方放不下就向上展开）。
2. 移动端首层「小记 ↔ 知识库」切换动效观感奇怪 → 去掉。
3. 确认「加号确实没有了」（已无，无需改）。
4. 桌面拖拽落地非常慢/卡顿（约 3s）→ 优化。
5. 先提交、再切**拖拽专项分支**，完全复刻思源拖拽（桌面 + 移动）。
6. 复刻思源落点语义：父行「之后」与首个子行「之前」是同一视觉间隙，但**蓝条缩进随层级变化**；「放入」用蓝色背景。
7. 移动端目录树子级不缩进（都顶到最左）→ 修。
8. 抽屉手势要滑很长 → 对齐思源「短滑即可」。
9. 跨端**手势/滑动审计**（桌面 + 移动），查漏补缺并整理重复代码。
10. **存储分层审计**（哪些进 S3、哪些仅本地；思源怎么管；值得借鉴什么）。
11. 移动端「新建知识库」弹窗名称非常虚化看不清 → 修。

### 1. 已完成（提交 0792ff7..e69d4a0，共 11 个）
- 2fb2e0a 桌面右键菜单贴边翻转（按真实尺寸，下方不足向上）。
- fb90d6d 移动端去掉首层 tab 滑动/分区入场动效。
- 6f3797d **复刻思源拖拽（桌面+移动）**：新增共享 createDragGhost/moveDragGhost/removeDragGhost（克隆源行做跟手浮层，源行留原位只降透明度）；**去掉拖拽中同级「让位位移」**（连续抖动源）；落点线贴目标行层级缩进；两端边缘自动滚动。桌面 CDP 实测父行 after 线 x=69 / 子行 before 线 x=86（同间隙差 17px）。
- 3d777fb 目标不支持 inside（如笔记本排序）时落点退化为上下半区。
- 8b715c6 **桌面拖拽 3s→0.1s**：FLIP 改「先读后写」消除逐行强制重排（实测 DOM 换序 2109ms→115ms）；moveTreeNode 乐观本地重排（不再 await 全量 listTreeNodes）；pointermove 用 elementFromPoint 命中、去掉每帧全表扫描（28ms/帧）。**同提交**修移动端 .ln-indent 子目录不缩进（padding-left 被 vendored .b3-list-item 覆盖）与抽屉「<1s 快滑即提交」。
- f74dad5 **手势审计**：新增 src/mobile/gestureCore.ts（轴锁/阈值/跟手进度/提交判定纯函数，对齐思源 touchGesture.ts/touch.ts）+ 10 例单测；usePanelDrag 重写（**带符号跟手**、反向不提交、多指/文本选区/横向滚动内容守卫、作废手势不再被重判为另一侧）；MobileSheetMenu 右滑关闭；OutlineSheet/SearchSheet/CreateNotebookSheet/图标/历史 sheet 接入。
- c6f5089 桌面目录/大纲宽度手柄**双击复位**（对齐思源 resize dblclick；目录 224、大纲 280）。
- d3e4141 浮动弹窗**本地持久化位置/尺寸**（localStorage: lake-notes-v3.dialog-states，**不进 S3**）+ **8 向缩放**；并修入场动画 floating-dialog-enter 覆盖 transform:none 导致的跳屏。
- 96f0230 浮层契约收敛：移动端统一 **z-index 令牌 --mobile-z-**（替换 20 处魔法数字）、新增 useSwipeToClose 覆盖各 sheet、所有浮层根补 data-prevent-swipe。
- ffdfb76 新增 **docs/STORAGE-LAYERS.md**（存储分层单一来源 + 「新增持久化必须归类」规则）+ 更正两处过时注释（图标其实进 manifest；恢复留档其实 force=false）。
- e69d4a0 修复底部 sheet 被遮罩 opacity 整体压淡（「新建知识库」名称看不清）。

### 2. 当前问题 / 未验证 / 有意不做
- **移动端拖拽「连续手感/自动滚动」没有真机手指验证**：合成 TouchEvent 复现不了原生手势（跟手视觉、自动滚动连续性），需人手指在真机/带窗口模拟器上试。
- **桌面标签页拖拽**未复刻思源 ghost/落点指示/自动滚动 —— **用户明确「不做」**。
- **编辑器长按块多选** —— **用户明确「不做」**。
- **长按阈值统一**（树 350ms vs 编辑器 450ms）—— **用户明确「先不统一」**。
- **同步快照/回滚、每库配置同步** —— 讨论后 **用户明确「都不做了」**（不愿引入复杂度）。
- **独立弹层不合并组件**（用户认可只收敛契约层）。后续若有新增浮层，按三条契约接入即可：--mobile-z-*、useSwipeToClose、data-prevent-swipe。
- NoteInfoDialog 仍只有右下角缩放、不可拖（有意保留「不是所有弹窗都能拖」）。
- 真机（小米 50950385）本会话中途掉线；最后验证用无界面模拟器 + 用户自起的带窗口模拟器 emulator-5554。

### 3. 下一步计划
1. **用户用带窗口模拟器验收最近修复**：新建知识库名称是否清晰；拖拽手感/落点层级；抽屉短滑。
2. 若继续移动端：真机手指完整拖一遍（长按→拖到顶/底触发自动滚动→松手）。
3. 若要收尾：把右滑关闭/data-prevent-swipe 推广到尚未接入的浮层（若有新增）。
4. 分支验收后是否 push / 合 master 由用户决定（**红线：不擅自合**）。

### 4. 关键新增文件/机制
- src/mobile/gestureCore.ts（+ gestureCore.test.ts）：getTouchAxis、panelProgress/panelCommit、isHorizontalScrollable。
- src/mobile/useSwipeToClose.ts：浮层右滑关闭/返回。
- src/components/DialogResizeHandles.tsx + useFloatingDialog（id / 本地持久化 / 8 向缩放）。
- src/components/treeDrag.ts：createDragGhost/moveDragGhost/removeDragGhost。
- docs/STORAGE-LAYERS.md；移动端 --mobile-z-* 令牌；[data-drag-ghost] 样式。

### 5. 踩过的坑（重要，别再踩）
1. **opacity 是「分组不透明度」**：.mobile-sheet-mask{opacity:.2} 会把作为其子元素的整张 sheet（含文字）一起压到 20% —— 「名称虚化」的真因。遮罩半透明必须放**背景色**（本次用 color-mix(… 20%, transparent)）。
2. **入场动画会覆盖内联 transform**：floating-dialog-enter 的 keyframes 恒带 translate(-50%,-50%)，与拖拽/定位用的 transform:none 打架 → 恢复位置或非右下角缩放时弹窗跳到屏幕外。拖拽/缩放/已定位时置 animation:none。
3. **FLIP 必须「先读后写」**：边写 style 边读 getBoundingClientRect() 会逐行强制重排；500+ 行拖一次 ~3s。先一次性读所有位置，再统一写 transform。
4. **拖拽别做「让位位移」**：源行克隆成浮层跟手、源行留原位只降透明度；去掉相邻行位移后连续抖动消失（对齐思源）。
5. **乐观重排要改 sortOrder**：buildTreeIndex 按 sortOrder 排序；乐观更新只改受影响节点的 sortOrder（其余保留对象引用），否则 UI 不重排。
6. **手势「作废」要上锁**：轴锁后若因「非关闭方向/纵向/滚动内容」作废，必须置 cancelled 并保持（别把 axis 重置），否则同一手势会被重判成反方向、误开另一侧（实测左抽屉被关 + 右大纲被 armed）。
7. **别用通用祖先 overflow 遍历判断「横向可滚动」**：1px 级 scrollWidth 误差会误伤普通内容、抽屉拉不出来。只用内容件白名单（table/code/AV）。
8. **合成 TouchEvent 要派发到真实元素**（elementFromPoint）：派发到 document 会让 e.target 是 Document，target.closest/getComputedStyle 抛错、手势静默失效。
9. **Vite HMR 中间态会骗人**：连续编辑时页面可能停在半成品（报 dragRowHeight is not defined 之类）；**以 reload 后的结果为准**。
10. **命令行路径**：workspace 是 /Users/admin/file/local-lake，仓库在其下 lake-notes-electron（注意 local-lake 别写成 local/lake）；bash 默认 cwd 就是 workspace，建议用 $PWD/lake-notes-electron。
11. **Android gradle 需要写 ~/.gradle**：workspace-write 沙箱会拦成 Could not initialize native services / libnative-platform.dylib；本会话后文件策略已放宽为 full-access。
12. **scripts/android-build.sh 把 gradle 输出 tail -6**：失败时看不到真因，必要时直接跑 gradle 或看完整日志。
13. **emu-up.sh 会复用已跑实例**：用户「看不到模拟器窗口」多半是前一会话用 --no-window 起的 headless 实例；adb emu kill 后重跑即可（AVD 数据不丢）。

### 6. 结论（用户已拍板，别再重开）
- **存储**：我们 =「manifest 声明字段（S3）+ 本地真源/账本 + 纯本机派生」三层；思源 =「整 data/ 同步 + 忽略清单」。两边归属一致（附件/排序/图标同步；历史/孤儿/GC/配置仅本地）。**不换同步模型**，只把分层固化为 docs/STORAGE-LAYERS.md。
- **同步快照/回滚、每库同步配置**：**不做**。
- **标签页拖拽、编辑器长按块多选、长按阈值统一**：**不做**。
- **独立弹层**：**不合并组件**，只维护三条契约（--mobile-z-*、useSwipeToClose、data-prevent-swipe）。

### 7. 本轮关键提交
2fb2e0a fb90d6d 6f3797d 3d777fb 8b715c6 f74dad5 c6f5089 d3e4141 96f0230 ffdfb76 e69d4a0（0792ff7..e69d4a0）
### 窄窗彻底统一（260915，3 个提交 · 见 §2.39「施工结果」）
7fe3e42（壳层几何成对搬进共用作用域 + 删窄窗手抄副本）→ 1962476（小记工作台骨架）→ 0455fe5（浮层/面板宽度与设置导航改连续量）
### 窄窗第二轮反馈（260915，用户三条：目录栏悬浮 / 小记不可见 / 大纲悬浮）
9d7fee0（窄窗目录栏改悬浮抽屉 + 修小记被塞进 0 宽列）→ 3a8137c（窄窗大纲也只留右侧 rail + 悬停浮层）
### 窄窗 review 收尾（260915，用户要求查漏补缺）
bccfe41（修窄窗 4 处"只在宽窗生效"的遗漏：专注模式 / rail 令牌 / 拖拽带 / 触发区宽度；并清死声明与死令牌）
### 窄窗第三轮反馈（260915，用户三条：点正文收起(仅窄窗) / 小地图不动 / 大纲 rail 错位）
a7e9e2d（窄窗大纲 rail 改为占最右一列、与宽窗同宽同位；点正文收起抽屉仅窄窗生效）
### 壳层表面"只留一处来源"（260915，见 §2.40）
40d66a7（大纲条/轨/面板的第三份宽窗专属材质层收回共用作用域；新增跨宽度一致性审计）
### 2.39 窄窗"彻底统一"施工方案（260915 用户拍板：选 B，不做东拼西凑）
> 目标：**壳层规则只留一份**——把宽窗那层从 `@media (min-width: 761px)` 里成对搬到共用作用域，
> 窄窗不再"抄一遍"。做完后拖动窗口只应出现"列宽线性压缩"，不允许任何位置/边框/显隐突变。

**为什么必须成对（已踩过的坑）**
- 把顶栏 `.tab-bar { position: fixed; left/right:0 }` 搬出来、却不同时搬"工作区让位"，
  ⇒ 面包屑被顶栏压住（用户截图 15:29）。这两条**属于同一对**，必须同一次搬完。
- 一次解开 20 块媒体查询（提交 `9399c1d`）⇒ 顶栏与面包屑叠字，**已 `c9882c1` 回滚**。

**成对清单（搬一条必须搬它的搭档）**
| 组 | A 侧（几何） | B 侧（让位/搭档） | 位置 |
| --- | --- | --- | --- |
| 1 顶栏 | `.tab-bar { position:fixed; top/left/right:0; height:var(--topbar-height); z-index:400; background:transparent; border-bottom:0 }`（`b3/layout.css` 第 9 块内） | 文档区顶部让位：`.document-pane { margin: calc(var(--topbar-height) + 4px) 0 0 }`（`styles.css` 约 1825 行，也在 min-width 块内） | 两文件 |
| 2 左轨 | `.activity-rail { margin-top:0; padding-top: var(--topbar-height); background: transparent; border:0 }`（`b3/layout.css`） | `.activity-button { display:grid; place-items:center; width:28px; height:28px; margin:2px 0; border:0; border-radius:6px; color:var(--lake-text-secondary); background:transparent }`（`styles.css` 约 553 行，min-width 块内） | 两文件 |
| 3 顶栏按钮 | `.toolbar__item { border:0; background:transparent }`、`.tab-switcher { border:1px solid transparent; background: rgba(255,255,255,.48); border-radius:8px }`（min-width 块内） | 无（自身成对） | styles.css |
| 4 标签/关闭 | `.tab-item { height:28px; border:1px solid transparent; background: rgba(255,255,255,.42) }` + `.tab-close` 的显隐规则（min-width 块内） | 无 | styles.css |
| 5 状态栏 | `.statusbar { position: static; background: var(--b3-body-background) }`（`b3/layout.css`） | 无 | layout.css |

**施工顺序（每步都必须过两道门禁才提交）**
1. 用 CDP `CSS.getMatchedStylesForNode` 把目标元素**在 4 种状态**下的命中规则全导出：
   `{760, 900} × {sidebar 收起, 展开}`（脚本样例见下）。**先看清谁在赢，再动手。**
2. 按"组"搬：把 A/B 两侧一起移出媒体查询（或一起改成共用作用域），**同时删掉窄窗块里对应的手抄副本**。
3. 门禁 A（窄窗）：416/560/700/900 × 两状态截图 + 量 `bar box`、`document y`、`rail button y`，
   要求：`bar box == [0,0,W]`、`document y == 42`、`rail button y` 与宽窗一致、无水平溢出、无重叠。
4. 门禁 B（宽窗）：1315px 改动前后**像素 0 差异**（同样要"同源连跑对照"做噪声基线）。
5. 任一门禁不过 ⇒ 该组整体回退，不提交。

**诊断脚本样例（已可用）**
```js
await page.send("DOM.enable"); await page.send("CSS.enable");
const doc = await page.send("DOM.getDocument", { depth: -1 });
const q = await page.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: ".tab-bar" });
const m = await page.send("CSS.getMatchedStylesForNode", { nodeId: q.nodeId });
// m.matchedCSSRules[].rule.selectorList.text / .style.cssProperties[].{name,value,important}
```
用它查过：`.tab-switcher` 的"框"其实来自 `background: rgba(255,255,255,.48)`（不是 border）；
`.tab-bar` 曾被窄窗块里一条 `position: static` 覆盖（已删）。

**施工结果（260915 本会话完成，3 个提交；`git log` 见 §7 末尾）**
> 结论：**窄窗"手抄副本"已清零**，宽度 416→999 逐像素扫描**无任何非列宽压缩的突变**（含深浅两主题、
> 三种侧栏模式）。原先记的两条"已知未解"都由本轮定位并修掉：`bar [38,4,718]` 是**旧状态**（`dbdd988`
> 之后已回到 `[0,0,W]`）；`.tab-switcher` 的"框"= 但**根因是它整族规则只在 min-width 块里**，
> 窄窗掉回浏览器默认按钮（2px 边框 + `#efefef` 底），不是那条半透明底。

**搬到共用作用域（去掉 `@media (min-width: 761px)` 守卫，声明与顺序一字未改）**
- 组 1 顶栏：`.tab-bar` fixed 几何、`.tabbar-leading/-spacer/-trailing`、`.tab-items`（`styles.css` + `b3/layout.css`）
  × 让位：`.workspace` 的 `margin: calc(--topbar-height + 4px) 0 4px 0`（＝文档区 y=42 + 底部 4px 灰缝）
- 组 2 左轨：`.activity-rail`（flex/居中/`padding-top: --topbar-height`）× `.activity-button`
  （缺一就左移 2px：实测轨按钮 x 5→3）
- 组 3/4 顶栏控件：`.tab-item*`、`.tab-close*`、`.tab-switcher*` 整族（含切换器菜单/提示）
- 组 5 状态栏：`.statusbar` 材质（`--b3-body-background` + 边框清零）
- 组 6 侧栏：`.sidebar`、`.sidebar::before`、`.sidebar.sidebar-docked`（卡片几何）、
  **收起态悬停预览**（`.sidebar.sidebar-floating/.sidebar-collapsed`，原在 `styles/shell.css` 的 4 个 min-width 块里
  ⇒ 窄窗悬停左轨会拉出一块 `box [38,-15838,265,16706]` 的面板）
- 壳层材质一览：`.app-shell/.activity-rail/.sidebar` 连续材质、`.workspace/.document-pane/.multi-tab-editor`
  透明、卡片圆角、`.statusbar` 边框清零
- 小记工作台：`.quick-notes-pane` 骨架 + `.app-shell.quick-notes-active .workspace` 让位 + 栅格
  （宽窗把目录树列写成 0；窄窗不跟就会被 265px 空列吃宽 ⇒ 760px 下小记两栏被裁到窗外）
- 浮层：删除窄窗"四个面板一刀切 `calc(100vw - 16px) !important`"（跨断点时搜索面板 744→680 跳 64px），
  沿用各自 `min(定宽, 100vw - 边距)`；`.settings-nav` 由"窄窗 150 / 宽窗 208"改成一条
  `flex: 0 0 clamp(150px, 27%, 208px)` 连续量

**窄窗块现在只剩"真·窄窗增量"**：收起态两列栅格（`rail + minmax(148px,1fr)`）、展开态正文档下限 148px、
`.tabbar-leading` 压缩省略链、`.outline-sidebar { display:none }`、`≤560px` 小记叠单栏。
顺带删掉窄窗块里的死声明：`.topbar`（全仓无此元素）、`.sidebar.is-collapsed:hover`（该类只用在
`.outline-item__fold` 上）。

**双门禁（每一步都过）**
- 门禁 A（416/560/760/900 × 收起/展开，8 态）：`bar == [0,0,W]`、`document y == 42 && h == 822`、
  轨按钮恒 `[5,40]`（与宽窗一致）、`scrollWidth == 视口宽`、顶栏/面包屑/文档区重叠 0、溢出元素 0。
- 门禁 B（1315 宽窗"改动前后像素 0 差异"）：资料库 / 小记 / 设置·外观 / 设置·回收站 / 搜索
  五屏 × 18.26M 颜色通道 **差异 0**（第三步用 `git stash` 取"改动前同源截图"再比对；噪声基线实测 0）。
- **窄窗验收（逐像素）**：416→999 每 1px 一档（583 步/屏）——资料库（收起/停靠/浮动）、小记、设置、搜索，
  外加深浅两主题，**非列宽压缩的突变 0 条**。工具：`/tmp/lkcdp/finesweep.mjs`（阈值 1.5px，容亚像素分配）。
- `tsc` 0 error · vitest 969 passed / 16 skipped。

**用户第二轮反馈（260915，三条，已按序落地）**
> 反馈原文：① 窄窗目录栏应悬浮在正文上、不允许固定（固定列挤占正文）；② 小记在窄窗"被颜色覆盖、内容不可见"；
> ③ 窄窗大纲增强也要保留大纲，同样不固定、悬浮即可。

**窄窗（≤760px）新模型：栅格只有两列 = 左轨 + 正文，目录栏/大纲一律浮层**
- 栅格对**所有**侧栏模式统一 `rail + minmax(148px, 1fr)`（原先按模式分成 2/3 列，还留了个
  "`sidebar-collapsed` 时 workspace 钉在第 2 列"的坑，见下）；正文拿满剩余宽度、保底 148px。
- `useDesktopShell` 新增 `sidebarRenderMode`：窄窗下"停靠"**只用于渲染**地映射成"浮动"，
  于是目录栏直接复用既有悬浮带几何（`position:fixed` / top+bottom 72 / 右侧圆角 / 投影 / opacity 1），
  **没有新增几何副本**；`narrowOverlay`（`matchMedia('(max-width: 760px)')`）同时喂给大纲。
  用户真实模式、localStorage、"悬停预览延时收起"、"点正文收起"全部仍按 `sidebarMode` 走。
- 左轨「资料库」按钮在窄窗 = 悬浮抽屉开/关（`toggleSidebarDock`：停靠 ↔ 收起，实测 op 1 → 0 → 1）。
  顺带删掉两处死代码：`narrowSidebarOpen`（只写不读）、`NARROW_SHELL_WIDTH=900` 的窄窗分支。
- 大纲：窄窗下锁定态降级为收起态渲染（`effectiveOutlineMode`），`outline.css` 的**内部件**
  与**本体**（相对定位/占列/上边距/底色）都搬进共用作用域，占列写成 `grid-column: -2 / -1`
  （"最后一列"：宽窗 4 列取第 4 列、窄窗 3 列取第 3 列），窄窗栅格补第三列
  `var(--outline-grid-w, 0px)` ⇒ **rail 宽窄同为 38px、都贴窗口右沿**；悬停 rail → 面板以浮层展开在正文之上。
  **踩过的坑**：曾把窄窗 rail 做成"脱离栅格 + 内缩 13px"的悬浮条，结果它既不贴边（用户报"边栏错位"），
  又整条压在正文右缘、把面包屑右侧图标与编辑器滚动条一起盖住 —— 窄窗的 rail 必须**占列**，
  只有面板才是浮层。

**② 小记空白 = 我上一轮引入的回归（用户截图 #2 就是这个）**
上一轮给窄窗小记加的 3 列栅格 `rail 0 1fr` 与 `.app-shell.sidebar-collapsed .workspace{grid-column:2}`
打架：收起态下工作区被钉进**第 2 列（0 宽的侧栏列）**⇒ 整块工作区宽度归零、只剩灰底。
现在栅格统一两列 + `.workspace{grid-column:2}`，连同"列数与 workspace 列号不一致"这一整类隐患一起消失。

**验证**
- 590/760/561/416 × {停靠, 收起, 浮动} × {资料库, 小记}：栅格恒 `38px + 1fr`；停靠态目录栏
  `[38,72,265,704] fixed/opacity 1`（浮在正文之上）、收起态 `opacity 0`；正文满宽、无水平溢出；
  小记面板 `[38,42,W-38,806]` 正常渲染。
- 大纲开启：760/590/416 下 rail `fixed` 在右侧，内容默认 hidden、悬停浮层展开；1315 宽窗
  （大纲 docked / collapsed 两态）**改动前后像素 0 差异**（`git stash` 同源对照）。
- 逐像素扫描 416→900（每 1px 一档）：**资料库收起态 0 条突变**；资料库停靠态与小记只剩
  **760↔761 那一次"目录栏由列改浮层"的既定切换**（这正是用户要的：窄窗不允许固定列 ⇒ 正文从
  458 变满宽 722）；小记两侧仅侧栏元素自身的样式变化（该视图里目录栏本就 `display:none`，不可见）。
- 门禁 A 8 态全绿；门禁 B（1315：资料库 + 小记）像素 0 差异；`tsc` 0 error · vitest 969/16
  · 桌面 + 移动 `vite build` 通过。

**已知残留（有意保留）**
- **760↔761 文档列宽会变**：窄窗正文满宽、宽窗停靠列吃 265px —— 这是"窄窗不允许固定目录栏"
  的必然结果（用户明确要的行为）。若希望悬浮也提早起效（例如 ≤900 或"正文不足 N px 时"），
  改 `NARROW_OVERLAY_MEDIA` 一处阈值即可，**不要**再动几何。
- 窄窗悬浮抽屉宽度限 `min(--sidebar-width, 100vw - rail - 32px)`（极窄时右侧仍留一点正文）。
- 移动端不在本轮范围（`src/mobile/main.tsx` 不加载 `styles.css`，本轮改动不外溢）。

**review 收尾（260915，提交 bccfe41）——又揪出 4 处"只在宽窗生效"的遗漏**
> 复查方式：把窄窗当"第二个产品面"逐功能走一遍（不只看外观），再看有没有"类名加上了、
> 规则却没跟上"的漏项。**结论：这类漏项还有 4 处，已全部修掉**——说明"宽窗媒体块"里
> 藏着的壳层规则比 §2.39 清单列的多，下次改动窄窗相关行为时按同样方式先扫一遍。

1. **专注模式（⌘⇧Enter）在窄窗完全失效**：实测 590px 下按下去只给 shell 加了 `focus-mode` 类，
   栅格/左轨/抽屉/正文全都没动 —— 那套规则整块在宽窗媒体块里。已搬进共用作用域；
   并给 `.sidebar.sidebar-floating` 的 `opacity:1/pointer-events:auto !important` 加了
   `:not(.focus-mode)`（否则窄窗抽屉会"点回来"）。
2. **窄窗没有 `--activity-rail-width`**：该令牌只在宽窗定义 ⇒ 窄窗下用它且没写兜底的规则**静默失效**
   （悬浮抽屉的 `left` 靠 static 位置"碰巧"落在 38px）；`--outline-collapsed-width` 则掉回 34px，
   与宽窗 38px 差 4px。已搬进共用作用域，两值现在全宽度一致。
3. **窄窗侧栏顶部的拖拽带还抢点击**：`.sidebar::before` 的"不拦点击 + no-drag"保护写在宽窗媒体块里，
   窄窗抽屉上沿仍可拖拽窗口。已共用。
4. **触发区宽度有两份来源，带单测的那份从没生效**：CSS 读 `--lake-outline-trigger-width`（写死 25px），
   JS 的 `OUTLINE_HOVER_TRIGGER_WIDTH`（单测卡 24~25）注入的却是另一个名字。已改为读 JS 那份，
   并删掉三个**全仓无人读**的令牌。

**同批清掉的死代码**（删前取计算值指纹、删后 0 变化才提交）
- `.sidebar.is-collapsed` 一族（该 class 全仓只用在 `.outline-item__fold` 上，sidebar 侧 0 命中）。
- 基础层里早被后面规则整条盖住的声明：`.app-shell` 的 `grid-template-columns/background:#fff`、
  `.sidebar` 的定位/内边距/底色/右边框/z-index、`.tab-bar` 的 sticky 定位+内边距+底色+边框+overflow。

**复查工具与证据**
- `/tmp/lkcdp/qfp.mjs`：**计算值指纹**（2 模式 × 5 宽度 × 13 选择器）——删死声明前后 **0 变化**。
  坑：跑它之前必须把主题/大纲增强钉死，否则"上一次测试留下的深色"会让整张指纹全是差异。
- `/tmp/lkcdp/gateb.mjs`：已改成**自动钉状态**（浅色/停靠/大纲关）并把指针移进正文清残留 hover——
  否则会把"状态差"（不同文档、内核 TOC 悬停浮层）当成 CSS 回归（本轮踩到过一次 5.7%）。
- 结论：1315 宽窗（资料库 + 小记）改动前后 **像素 0 差异**；逐像素扫描 416→900 仍只剩
  760↔761 那次既定切换；`tsc` 0 · vitest 969/16 · 桌面 + 移动 build 通过。

**两条待拍板项的结论（260915 用户回复）**
- **点正文收起目录栏**：用户确认要做，但**仅窄窗**。已实现（提交 a7e9e2d）：pointerdown 判断为
  `floating`（原语义，宽窄通用）**或** `narrowOverlay && docked`（窄窗专属）。实测 1315 停靠态点正文
  毫无变化、590 抽屉收起 —— 隔离由 `narrowOverlay` 单独把住，**改这里时别把宽窗拉进来**。
- **内核标题小地图**：用户明确"不用动（增强大纲与原生大纲不会同时出现）"。窄窗大纲 rail 现在占列，
  本就不再压住正文右缘，这条关闭。

### 2.40 壳层表面"只留一处来源"（260915；用户："为什么会有另外一套默认值，能不能改彻底"）
> 用户原话（在最右侧大纲条颜色不对之后）：*"能不能改彻底一点，完全做好"*。这条是**机制级**结论，
> 比"再补一条窄窗规则"重要 —— 以后任何"某个面在窄窗长得不一样"的问题，先按这里的思路查。

**为什么同一个面会有"另外一套默认值"（根因，务必理解）**
样式是**分层加载**的：基础骨架（`styles.css` 最早那批）→ 思源主题/组件（`b3/*`）→ 壳层打磨层
（`styles/*.css`）。每个组件在**最早那层**都自带一份通用默认（例如大纲栏本体 + 轨道的
`background: var(--shell-material)`，那是 #f6f6f6 一类的通用浅灰面）。后来几轮做"壳层材质统一"时，
又加了一层覆盖（把大纲重刷成壳色 `--shell-unified-background` / 0 描边 / 12px 圆角 / dock 阴影）
—— **但这些覆盖写在 `@media (min-width: 761px)` 里**，因为当时窄窗不算产品面，规则只加在桌面那一段。
于是同一个元素同时挂着**两份值**：宽窗用新层，窄窗掉回旧层。用户看到的
"最右侧那条颜色跟别人不一样"就是 #ebecf0（壳色）vs #f6f6f6（旧默认），差 11 个色阶。

**修法（不是加覆盖，而是收敛来源）**
- 把"宽窗专属的那些壳层覆盖"整体搬进共用作用域：`b3/layout.css` 的大纲轨透明 +
  "右侧浮动（大纲 hover）"整条公式；`styles.css` 的大纲壳层材质层。
- **材质层与它的"工作面搭档"必须成对搬**：材质层会把**面板**也刷成壳色，所以
  "固定/悬停展开的面板恢复成白卡"那组必须同时进共用作用域 —— 缺一就会出现灰面板
  （与 §2.39 的"顶栏 fixed ↔ 文档区让位"同一类配对）。
- 删掉各层里被唯一来源取代的重复公式（旧 `border:1px / radius:14px` 面板公式、
  `outline.css` 里本体与轨道的 `--shell-material` 默认）。**组件层不再写自己的默认底色**。

**验证工具：跨宽度一致性审计（`/tmp/lkcdp/qparity.mjs`，本轮新增）**
同一批壳层表面 × `416/560/760/761/900/1315`（浅色 + 深色各一遍），逐面比对
底色 / 四边描边 / 圆角 / 阴影，要求**六档完全一致**：
`node drive.mjs 9222 qparity.mjs <on|off> <light|dark> <docked|collapsed>`
**坑**：跑之前必须钉死主题/大纲增强（脚本已内置），否则上一次测试留下的深色会被当成差异。

**当前结论**
- 上述十个面（含 `.outline-sidebar` / `__rail` / `__content`）**六档一致**；
- 唯一保留的跨宽度差异是 `.sidebar`，且是**有意**的：窄窗"停靠"即悬浮抽屉。
  已对照验证：窄窗停靠 vs 宽窗悬停浮层 = 同一类名 / 同圆角 / 同阴影 / 同盒子 `[38,72,265,724]`；
- 窄窗大纲条实测 `#f6f6f6 → #ebecf0`，与宽窗同色；1315 宽窗（大纲两态 + 资料库/小记）**像素 0 差异**。
