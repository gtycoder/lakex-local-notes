# Lake Notes Electron 会话交接文档

> 写给**完全没有上下文的新会话**。开工前先通读本文，再按需读：
> `AGENTS.md`（项目长期记忆/规则）、`docs/SIYUAN-UI-PORT.md`（思源 UI 移植记录）、
> `docs/PERFORMANCE-NEXT.md`（性能评估）、`docs/TRASH-NOTEBOOK-DESIGN.md`（同步语义定稿）、`docs/TODO.md`。
> 对照代码：`src/App.tsx`、`src/b3/layout.css`、`src/b3/components.css`、`src/components/SyncToast.tsx`、
> `electron/main.ts`、`electron/sync.ts`、`electron/store.ts`。

项目目录：`/Users/admin/file/local-lake/lake-notes-electron`（思源源码：`/Users/admin/file/local-lake/siyuan-master`，v3.8.0，AGPL-3.0，已保留署名）

---

## 0. 任务目标与当前状态

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo，`https://s3.cn-north-1.qiniucs.com`，Bucket `local-lake-hebei`，前缀 `lake-notes`）。**本地是真相，S3 只是镜像。**

**总体目标（用户原话）**：**UI 要完完全全复刻思源笔记**——可见的布局、样式、动效、窗口形式全部和思源一模一样，直接复用/抄袭思源源码（`siyuan-master`，v3.8.0）是可行且被认可的方向；同时要稳定流畅（Electron 43.4.0，性能优化持续做）。

**当前状态**：
- 分支：**`feat/electron-43-upgrade`**（所有工作在此单分支，领先 master 42 提交，可干净 fast-forward）。
- **最新已完成（已提交 `822f987` / `94b0163`）**：① 状态栏锁标志（锁定文档显示"已锁定"）；② 顶栏三个点移到面包屑最右侧（对齐思源 protyle-breadcrumb）；③ 云同步小弹窗跟随云按钮位置弹出（anchor）；④ 云同步弹窗显示时长延长（ok 4s / error 6s / unavailable 8s）。
- **重要背景**：此前尝试修"偏好设置在笔记页面无法点击"时做了多轮改动（settings-overlay 避开顶栏、菜单 z-index 9999 等），**反而把顶栏/小记/状态栏布局搞乱**，用户要求**回滚到 `eb9b2c5`**（第一轮 7 项反馈完成、用户认可的状态）。**当前代码已回滚，不再包含那些有问题的改动**。
- 开发数据：`~/Library/Application Support/lake-notes-dev`（**可重建**）。正式数据：`~/Library/Application Support/lake-notes-electron`（**禁止触碰**）。
- 基线：`npx tsc --noEmit` 通过；`npm test -- --run` = **227 passed**；Vite 8.2.1 build 通过；`git diff --check` 干净。
- **vite.config.ts 已还原**（== HEAD，无调试补丁）。
- **当前工作区有未提交的代码审计/低风险重构改动**：IPC 已按领域拆分，`App.tsx` 已抽取 `DesktopStatusBar`，资源服务已改异步 I/O；详见 `docs/CODE-AUDIT-2026-08-17.md` 和 `docs/REFACTOR-PLAN-2026-08-17.md`。

### 关键约束
- **Node 只用临时 PATH**：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`；**不要动全局/公司 Node 18**（CDP 脚本 `WebSocket` 在 Node 18 下不可用，必须 Node 24）。
- **启动命令**（用户常用，本项目仍有效）：
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  cd /Users/admin/file/local-lake/lake-notes-electron
  npm run dev   # vite + 自动拉起 electron
  # 端口被占时：lsof -ti tcp:1421 | xargs kill -9
  ```
- **dev 必须用 tty 长驻会话**（exec 的 tty:true），`nohup ... &` 会被环境回收（本会话多次踩坑）。
- 杀 electron 用**具体 PID**，不要 `pkill -f Electron`（机器上还有 Trae/SiYuan/VSCode 等）。
- 测试打包版务必用 `LAKE_USER_DATA` 覆盖 userData（打包版默认走正式数据）。

---

## 1. 已完成内容

### 1.1 历史主线（已提交，勿重做）
- **Electron 33 → 43.4.0**（`^43.4.0`）+ better-sqlite3 `^13.0.3`（N-API 单二进制）。GPU 裸启动复验通过。
- **性能/稳定**：render-process-gone 自动恢复、`--max-old-space-size=4096`、View Transitions、content-visibility、阅读进度条、零变更同步早退、fast-path 记账去重、manifest gzip。
- **同步语义（定稿，勿重争）**：本地是真相、先同步者胜、删除压编辑、purged 条目编辑=隐式恢复、小记冲突 B 方案。
- **审计加固**：资产服务器 CORS token 门禁、CSP 零违规、50MP 图片上限、before-quit 等待同步。
- 测试：核心同步/回收站基线全绿；当前完整测试基线为 224（含冲突三场景、回收站、零变更早退、Store 工具边界）。

### 1.2 第一轮 7 项反馈（已提交 `f8869f0` + `eb9b2c5`，用户认可）
| # | 反馈 | 处理 |
| --- | --- | --- |
| 1 | 顶栏连接线 | **真正修复**：发现 layout.css 圆角被 styles.css 后加载规则覆盖（`border-radius:0`/`14px 0 0 0`/`border:1px`），统一为顶部两角 `--b3-border-radius-b`(12px)、sidebar 四角圆角、workspace 去 border、顶部加 4px 灰缝。像素级验证 12px 圆弧可见。 |
| 2 | 偏好设置无法点击 | CDP 复测通过（portal 修复已生效）。**注意：此问题后续又有反复，见 §2**。 |
| 3 | 云同步进度条红色 | SyncToast 进度条固定主色蓝（`rgb(53,117,240)`），任何状态不用红。 |
| 4 | 云同步大弹窗 → 小悬浮窗 | SyncPanel 删除，SyncToast 小窗（busy 蓝进度条 + ok/error/unavailable + 自动消失）。 |
| 5 | 冲突弹窗突兀 | `window.alert` → toast detail（非阻塞）。 |
| 6 | 状态栏图片统计 | `图片 N`（当前文档 image card 数，>0 才显示）。实测 107 图文档显示"图片 107"。 |
| 7 | 弹窗思源样式 | 12+ 类弹窗硬编码色 → b3 令牌；毛玻璃表面跟随主题（`color-mix(var(--b3-theme-surface))`）；清理 `.sync-panel`/`.sync-setup-toast` 死代码。 |

### 1.3 第二轮最新（已提交 `94b0163` + `822f987`，用户当前认可）
| # | 功能 | 实现 |
| --- | --- | --- |
| 1 | 状态栏锁标志 | `statusbar-lock`（Lock 图标 + "已锁定"），`activeNoteId in lockedNoteIds` 时显示。代码：`src/App.tsx`（状态栏 JSX）+ `src/styles.css`（`.statusbar-lock`）。 |
| 2 | 面包屑更多 | 顶栏右侧三个点移到编辑器面包屑最右侧（`protyle-breadcrumb__more` + `protyle-breadcrumb__more-btn`，对齐思源）。代码：`src/App.tsx`（topBarTrailing 只留外观按钮，breadcrumb 末尾加更多按钮）+ `src/b3/layout.css`（样式）。顶栏 trailing 不再有更多按钮。 |
| 3 | SyncToast anchor | 云同步小弹窗跟随云按钮位置（`syncBtnRef` + `anchorRect`，按钮正下方 6px）。代码：`src/App.tsx` + `src/components/SyncToast.tsx`。 |
| 4 | toast 时长延长 | ok 2.6s→4s / error 4.5s→6s / unavailable 7s→8s。代码：`src/App.tsx:490`。 |

---

## 2. 当前问题 / 待办

### ⚠️ 未解决：偏好设置在笔记页面无法点击（用户反馈反复）
- **现象**（用户原话）：笔记空间下点顶栏工作空间 → 菜单能弹出，但**"偏好设置"项无法点击**（鼠标放上去无 hover、无底色变化），**"回收站"可以**；小记空间下都正常。
- **已尝试但无效/被回滚**：
  - settings-overlay 避开顶栏区域（`top: var(--topbar-height)`）——修了"设置打开后顶栏被挡"，但菜单内偏好设置仍点不了。
  - 菜单 z-index 1000→9999 + `translateZ(0)` 合成层——CDP 无法复现，真机仍不行。
  - 菜单项 onClick → onPointerDown——也无效。
  - **这些改动还搞乱了顶栏/小记/状态栏布局，用户要求整体回滚到 `eb9b2c5`。当前代码已回滚，不再包含这些尝试。**
- **已知线索**（CDP 诊断）：
  - 菜单（portal 到 body，z-1000/9999）与 sidebar（z-250，在 app-shell `isolation:isolate` 内）**大量重叠**（重叠区约 170×78px）。
  - **sidebar-header（y=42-80）精确覆盖偏好设置按钮区域（y=47-79）**；回收站（y=79-111）落在 sidebar 的 search-box 区域。
  - CDP 下 hit-test 始终命中按钮（菜单在上），hover 正常（`rgba(0,0,0,0.075)`），**无法用 CDP 复现真机问题**。
  - 怀疑真机 Electron 合成层让 sidebar 覆盖菜单，但未证实。
- **下一步建议**（如果用户再提）：
  1. **让菜单完全不覆盖 sidebar**——把菜单弹出位置改到不重叠区域，或菜单打开时 sidebar 区域 pointer-events:none。
  2. **彻底调查真机合成**——在真机截屏确认菜单是否真的在 sidebar 之上。
  3. **或者干脆把"偏好设置"从工作空间菜单移到别处**（比如面包屑更多按钮里），绕开这个区域。
  - **不要**再盲目改 z-index / overlay / onPointerDown（都试过无效且引发布局回归）。

### 待办（长期）
- 反馈 6/7 残留（第一轮已处理，若用户有新反馈再跟进）。
- 性能：增量 manifest 评估（>2 万条再考虑）。
- **Batch 3B 已完成**：Store 只读查询/纯函数抽取；当前测试基线 224 个。
- **Batch 4A 已完成**：全文搜索领域模块拆分。
- **Batch 4B 已完成**：历史只读查询和回收站只读查询模块拆分。
- **Batch 4C 已完成**：资源引用/保护集和孤儿资源只读查询拆分。
- **Batch 4D-1 已完成**：笔记/目录只读查询拆分。
- **Batch 4D-2 已完成**：笔记目录/元数据写入模块拆分。
- **Batch 4D-3A 已完成**：共享图片格式/尺寸纯函数拆分。
- **Batch 4D-3B-1 已完成**：正文保存协调器拆分。
- **Batch 4D-3B-2 已完成**：资源上传/远程下载协调器拆分。
- **Batch 4D-3B-3 已完成**：远程笔记导入协调器拆分。
- **Quick Notes M1 已完成**：模型类型、内容校验、序列化、preview 和 image MIME 策略移到 `src/lib/quickNoteModel.ts`。
- **Quick Notes M2 已完成**：新增 `electron/quickNotesQueries.ts`，隔离列表、单条读取、回收站和同步墓碑只读查询；当前测试基线仍为 232 个。
- **凭据历史清理暂缓**：当前为私库，暂不执行 `git filter-repo`；七牛 AK/SK 轮换仍需后续单独处理。
- **后续重心转向移动端**：桌面端核心功能、同步、快照、回收站和 UI 主线已基本完成；桌面端后续以低风险维护和审计为主。
- **移动端复用整理评估（2026-08-18）**：继续按“移动端复用边界”整理，不再为了缩短 Store 行数而拆分。Quick Notes M1 纯模型层和 M2 只读查询层已完成；已核对 Tauri Android POC，但其中尚无 Quick Notes 调用方，M3 文件层暂缓；历史/回收站先定义共享契约，图片先共享纯策略、保留平台 I/O adapter。完整评估见 `docs/MOBILE-REUSE-ARCHITECTURE-ASSESSMENT-2026-08-18.md`。
- **思源机制借鉴待办（2026-08-18）**：优先借鉴“按对象串行队列、旧请求 version/abort、视口窗口化、可中断动画、提交时持久化”这些机制；不复制思源架构。建议先做 SearchPanel version guard 和 per-note save queue，再做树/大纲性能优化。完整方案见 `docs/SIYUAN-OPTIMIZATION-BACKLOG-2026-08-18.md`。

### 2.1 代码重构与依赖升级决策（2026-08-17）

#### Store 重构：建议做，但必须分批

当前判断：**Store 重构的收益较高，适合在移动端主线全面展开前先做基础整理，但不适合一次性“大拆类”。**

原因：
- `electron/store.ts` 约 2,400+ 行，已经同时承载笔记 CRUD、SQLite schema/migration、历史快照、回收站、资源、搜索、导出和同步适配。
- 桌面端核心业务语义已基本稳定，继续扩展桌面功能的频率下降；现在整理存储边界，后续移动端复用同一套 IPC/存储能力时收益更高。
- 但 Store 直接关联事务边界、文件落盘顺序、同步状态和删除/恢复语义，完整领域拆分风险为中高。

已定计划：
1. **Batch 3A（已完成）**：SQLite row 类型收窄、低风险纯函数/边界整理，不移动写事务。
2. **Batch 3B（已完成）**：抽取 `electron/storeUtils.ts`（资源引用、ISO 周、历史保留、文件名/路径校验）和 `electron/storeQueries.ts`（只读 note digest 查询）；新增边界测试，保持写入和事务原样。
3. **Batch 4A（已完成）**：先拆出 `electron/searchRepository.ts`，隔离 FTS upsert、索引重建和搜索查询；Store 仍保留兼容 wrapper，未改变缓存回调、FTS SQL 和事务行为。
4. **Batch 4B（已完成）**：拆出 `electron/historyRepository.ts` 的历史只读查询，以及 `electron/trashRepository.ts` 的回收站只读查询；Store 保留兼容 wrapper，未移动恢复、删除、purge 写事务。
5. **Batch 4C（已完成）**：拆出 `electron/assetRepository.ts` 的资源引用、历史保护集、孤儿资源只读查询；Store 保留 wrapper，未移动资源清理/上传写事务。
6. **Batch 4D-1/4D-2/4D-3 已完成**：笔记查询、元数据、正文保存、资源和远程导入均已按小批次拆分；Store 当前约 1,785 行。
7. **后续暂停跨领域 Store 重构**：桌面端核心存储能力已完成整理，后续优先移动端；只有出现明确复用或维护需求时，再评估新的领域拆分。
8. 不在移动端功能开发高峰期进行 Store 的跨领域大迁移；移动端先复用稳定的存储/IPC 契约。

#### 依赖升级：先记录，暂不继续升级

当前已确认：
- Electron：`43.4.0` 已是公开 registry 最新稳定版；`44.0.0-beta` 不升级。
- better-sqlite3：`13.0.3` 已是最新。
- Lake 编辑器：`lakex-editor-react-component@0.1.2`、`lakex-drawnix@0.1.0`、`lakex-drawnix-react-board@0.1.0`、`lakex-drawnix-react-text@0.1.0` 均已是最新，没有可升级版本。
- 已完成低风险更新：`@aws-sdk/client-s3` `3.1101.0 → 3.1111.0`，Vite `8.1.5 → 8.2.1`。

后续依赖优化项（**暂不做**）：
- `@types/better-sqlite3`：`7.6.13 → 9.6.0`。两版类型声明文件实际一致，发布时间相差约 483.5 天；主要是 TypeScript 支持元数据更新。收益低到中、风险低，之后可单独升级验证。
- `electron-builder`、`vite-plugin-electron`：涉及打包链，单独评估。
- React 19、Slate 全家升级、TypeScript 7、lucide-react 主版本升级：暂缓，需专项兼容性评估。
- drawnix/Lake 传递依赖中的 Mermaid/DOMPurify/UUID 安全告警：当前没有安全自动修复方案，不执行 `npm audit fix --force`。

完整批次计划：`docs/REFACTOR-PLAN-2026-08-17.md`；代码审计：`docs/CODE-AUDIT-2026-08-17.md`；正文/资源写入拆分影响评估：`docs/STORE-CONTENT-REFACTOR-IMPACT-2026-08-17.md`。

---

## 3. 踩过的坑（新会话必看）

### 环境/流程
1. **vite.config.ts 调试补丁必须还原**：本会话反复用 `onstart(args) { args.startup([".", "--no-sandbox", "--remote-debugging-port=9222"]); }` 加 CDP 端口，**每次验证完必须 `git checkout vite.config.ts` 还原**（== HEAD）。当前已是干净状态。
2. **CDP 脚本要 Node 24**：Node 18 无全局 `WebSocket`。
3. **nohup 会被回收**：electron/vite 必须放 tty 长驻会话（exec tty:true）；`nohup ... &` 随 exec 会话退出被杀（本会话多次踩坑，dev 启动后 electron 消失）。
4. **杀 electron 用具体 PID，不要 pkill -f**（Trae/SiYuan/VSCode 都是 Electron）。
5. **CDP 的 `Input.dispatchMouseEvent` 与真机物理鼠标有差异**：CDP 合成点击在页面刚加载后第一次可能不产生 `click` 事件（`nativeClick:0`），且**不经过 macOS 窗口系统的 `-webkit-app-region` hit-test**——所以 CDP 无法复现真机偶发点击问题，**别把 CDP 的"正常"当真机也正常**。
6. **dev 数据可重建**：乱改坏了就删 `~/Library/Application Support/lake-notes-dev`；正式数据（`lake-notes-electron`）永不碰。

### UI / CSS（本会话血泪）
7. **settings-overlay / history / trash 三个大面板共用 z-index 800**，覆盖顶栏（tab-bar z-400）。如果设置面板打开时顶栏点不动，是 overlay 全屏遮罩（z-800）盖住了顶栏。
8. **`document-pane` 的 `overflow:hidden + border-radius` 会创建层叠上下文**，把内部 tab-bar 的 z-index 困住——**这是"偏好设置点击"问题的深层背景**（tab-bar z-400 实际比 app-shell 层 overlay 低）。
9. **`.top-menu`（工作空间/更多下拉）用 portal 渲染到 body 根部**，否则被 document-pane overflow / app-shell `isolation:isolate` 裁掉。portal 后仍可能与 sidebar（z-250，在 app-shell isolate 内）重叠，真机合成可能有差异。
10. **大改布局前先确认用户当前认可的状态**：本会话第二轮为修偏好设置做了多轮改动，搞乱布局后用户要求回滚。**改 UI 前先 git commit 当前状态，便于回滚**。

### 同步/存储（历史沉淀，勿破坏）
11. HeadBucket 不可用：`ObjectStore.test()` 必须用 `ListObjectsV2`。
12. manifest 保留 10 份：prune / runGcReconcile / runDeepCleanup 三处链长必须一致。
13. 零变更早退依赖 `device_state.last_seen_commit_id` + 墓碑签名；`setNoteLocked` 必须标 `sync_state='local'`。
14. markSynced 三处：notes + tree_nodes + sync_base.last_synced_meta_at。
15. IPC 三处同步：main.ts(handle) + preload.cjs(invoke) + src/lib/native.ts(类型+封装)。
16. 新增 URL 拼接一律用 `src/lib/assetPort.ts` 的 `ASSET_ORIGIN`/`LOCAL_ASSET_PREFIX`。

---

## 4. 开发工作流 / 调试工具

- 启动：见 §0 命令（tty 长驻）。
- **CDP 驱动渲染层**（需临时加 vite.config.ts 补丁，验证后还原）：
  - `node /tmp/lake-cdp-eval2.mjs <port> "<expr>" [timeoutMs]`（Runtime.evaluate，须 Node 24）
  - `node /tmp/lake-cdp-shot2.mjs <port> <out.png>`（截图）
  - 端口：`9222`（远程调试）。
  - 截图是 2x（DPR=2），像素采样记得 `*2`；浅色背景有 subpixel 抗锯齿噪点，判断颜色用**块平均**（20x20）。
- **图片识别**（本会话非多模态时用）：`node ~/.codex/bin/vp-describe.mjs <绝对路径> "<问题>"`（VisionPower MCP 桥接，白名单含 `/Users/admin/file/local-lake`）。
- **像素/几何分析**：`node -e` + `sharp`（项目 node_modules 里有）。
- **云端查看**：`node scripts/s3-ls.mjs`。
- **dev 数据**：`~/Library/Application Support/lake-notes-dev`，localStorage 里 `lake-notes-v1.settings`；`metadata.sqlite3` 用 python3 sqlite3 只读查。

---

## 5. 测试要点

- 基线：`npx tsc --noEmit`、`npm test -- --run`（227）、`node node_modules/vite/bin/vite.js build`、`git diff --check`。
- UI 改动后手动清单：亮/暗双主题都过一遍；库视图 + 小记视图；顶栏两个下拉（工作空间/更多）；云同步 toast（busy/ok/error/未配置四态 + 自动消失）；设置面板每个 tab；锁定文档状态栏锁标志；面包屑更多按钮；浮动 dock；多 tab；状态栏。
- 回归重点（同步语义勿破坏）：先同步者胜、删除压编辑、回收站、小记冲突、零变更早退、purged 隐式恢复。

---

## 6. 沟通要点（与用户）

- 用户重视权衡与数据；给方案要附真实场景和后果，可大胆反驳。
- 已定稿语义（**不要重新争论**）：本地是真相、目录强一致、墓碑权威、先同步者胜、开发版不考虑数据兼容、小记不备份。
- 用户认可"直接复用/抄袭思源前端代码"，方向是**所有可见 UI 与思源一致**；涉及 AGPL-3.0 的思源代码已保留署名。
- 用户习惯：功能做完后要自己**手动全量测试一遍**；测试完才打新包。给用户测之前先自测到"能直接上手验收"。
- **用户对反复失败的修复很敏感**（偏好设置问题多轮未果导致布局回归），**不要在大改动上反复试探**；改 UI 前先确认当前认可状态 + 提交基线，小步改动、每步验证。
- 凭据：AK/SK 暂不处理（用户明确）；不要外泄。

---

## 2026-08-18 思源机制优化实施补充（后续会话先读）

本轮已根据 `/Users/admin/file/local-lake/siyuan-master` 的思源 3.8.0 源码完成第一轮流程、性能和可靠性优化。详细方案与停止条件见：

```text
/Users/admin/file/local-lake/lake-notes-electron/docs/SIYUAN-OPTIMIZATION-BACKLOG-2026-08-18.md
```

### 本轮已完成

- `src/components/SearchPanel.tsx`：请求版本保护，旧搜索结果和旧 loading 不再覆盖当前请求。
- `src/lib/keyedAsyncQueue.ts` + `src/App.tsx`：按 noteId 串行保存，跨文档并行；保留 debounce/revision/IPC/Store 语义。
- `src/lib/treeIndex.ts` + `src/components/Sidebar.tsx`：树索引、搜索可见集合、TreeRow memo。
- `src/App.tsx`：Sidebar/Outline 宽度拖动改为提交时持久化，卸载时补合法值。
- History/Quick Notes/Trash/同步 tab reload：统一使用 `src/lib/requestVersion.ts` 做异步结果有效性保护。
- HistoryPanel/TrashPanel：Escape 关闭；`src/b3/animations.css`：reduced-motion 覆盖新增动效。
- `src/lib/assetPort.ts`、编辑器和 `electron/main.ts`：本地资源 CORS 预加载 token 修复；token 不写入正文/缓存。

### 当前验证基线（2026 年 8 月 18 日）

必须使用 Node 24：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
```

验证结果：

```text
19 个测试文件
241 个测试全部通过
npx tsc --noEmit 通过
Vite/Electron build 通过
git diff --check 通过
```

运行时使用的是可重建开发数据：

```text
~/Library/Application Support/lake-notes-dev
```

已通过 CDP 做无截图 smoke test：搜索打开/输入/结果/关闭、小记工作区切换、本地图片加载、页面 reload；未捕获 CORS、Unhandled 或 JavaScript exception。

### 本轮明确暂缓

- 树虚拟化：开发库当前只有 19 个 tree node，没有达到 2,000 可见行阈值；不要为了“像思源”提前引入复杂虚拟列表。
- renderer → main 退出 flush/ack：先保持现有 beforeunload + 主进程同步等待，除非能复现确认退出后的异步保存丢失。
- 全局 TaskManager、动态设置表单、复杂动画控制器：没有足够真实调用方或可复现问题，不要抽象。

### 运行与清理注意

- 开发服务必须用 TTY 长驻；本轮调试可能使用过 `npm run dev:vite`、独立静态服务器和 CDP。
- 不要使用 `pkill -f Electron`；只杀本项目的具体 PID。
- 调试完成后确认没有遗留本项目 Electron/Vite/Python server 进程；不要触碰正式数据目录。

---

## 2026-08-18 编辑器小问题修复补充

### 本轮用户反馈与处理

1. **新建代码块标题首次输入被打断**
   - 关联文件：`src/features/editor/EditorTab.tsx`。
   - 根因：代码块自愈检测在新卡片刚创建、用户仍持有编辑器焦点时触发 `rebuildTick`，销毁并重建 Lake 实例，导致标题输入框/选区被打断。
   - 处理：检测到编辑器仍有 active element 或 selection 时暂缓重建；在 `focusout` 后再补一次 heal 检查，保留原有坏代码块自愈能力。

2. **高亮块悬浮工具栏闪烁、颜色点击偶发失效**
   - 关联文件：`src/features/editor/lakeRuntime.ts`。
   - 原有 hover bridge 对卡片离开/进入 overlay 的判断没有把 Lake 主浮动工具栏和 Ant 下拉层统一视为 toolbar context。
   - 处理：补充 `.ne-ui-toolbar`、`.ant-dropdown`、`.ant-select-dropdown` 等上下文，使高亮块颜色/类型弹出层在 mouseleave/mouseout 往返中不被提前隐藏。

3. **删除小记撤销提示被状态栏盖住**
   - 关联文件：`src/components/QuickNotesWorkspace.tsx`、`src/styles.css`、`src/b3/components.css`。
   - Quick Notes undo toast 和同步 toast 统一移到右上区域；提高 z-index、增加左侧主色标记、边框和阴影；撤销按钮改为主题主色并增加可读性。
   - 当前 toast 的运行时位置为 `top: 50px`、`z-index: 760`，不会再被状态栏覆盖。

4. **GIF/WebP 动图存储与播放**
   - 关联文件：`src/features/editor/resourceUpload.ts`、`electron/resourceRepository.ts`、`src/features/editor/imageFormat.ts`。
   - 远程下载后端始终按实际文件 magic bytes 判断格式；GIF 保存为 `.gif`，WebP 保存为 `.webp`，不会仅依据 URL 后缀改名。
   - 修复本地 File/Data URL 上传路径：不再把 WebP/AVIF 先光栅化成 PNG，避免动画 WebP 丢失动画帧。
   - 复制到不支持 WebP/AVIF 的外部应用时，仍由 `electron/assetServer.ts?base64=1` 做临时 PNG 转换；这不影响笔记本地存储格式。
   - 如果用户粘贴的是知乎 `.jpg` 预览 URL，而服务器实际返回的也是 JPEG，应用无法从 JPEG 还原动画；必须拿到站点提供的原始 GIF/动画 WebP URL。暂不加入站点专用 URL 猜测，避免重复下载、误抓取或绕过站点策略。

### 本轮验证基线

```text
21 个测试文件
243 个测试全部通过
npx tsc --noEmit 通过
Vite/Electron build 通过
git diff --check 通过
```

新增/强化测试：

```text
src/features/editor/imageFormat.test.ts
electron/resourceRepository.test.ts
```

使用开发数据做了 Electron/CDP 检查：

- 删除小记撤销 toast：右上、`z-index: 760`、未被状态栏覆盖；
- 搜索面板打开和 Escape 关闭正常；
- 本地图片正常加载；
- 高亮块可正常创建，DOM/编辑器未出现本轮修改导致的新增异常。

### 运行时已知独立问题

开发数据中包含 Drawnix/思维导图内容；在 Electron 开发/HMR 环境打开相关文档时仍可能看到 Lake 依赖内部的：

```text
Cannot read properties of undefined (reading '__defineMacro')
```

该错误来自 Drawnix/mindmap 运行时路径，与本轮代码块焦点、高亮块 hover、toast 和图片格式改动无直接调用关系；生产静态构建 smoke 在打开包含思维导图的开发文档时也能观察到同一既有错误。后续如继续审计编辑器，可单独建立 Drawnix 错误边界和 mindmap 兼容性任务。

---

## 2026-08-18 高亮块间隙复现与最终修复补充

用户进一步确认了稳定复现路径：鼠标从高亮块移动到颜色/工具栏区域时，只要经过中间空隙，浮动工具栏就会消失；如果直接落到色块上则正常。

### 最终处理

文件：

```text
/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts
```

`setupCardToolbarHoverBridge` 已从“只看 relatedTarget 是否已经在 toolbar 内”改为带过渡缓冲的 hover 状态桥：

- 卡片离开时不立即把 mouseleave 交给 Lake；
- 增加约 650ms 的 gap grace period；
- 鼠标进入 `.ne-ui-toolbar`、`.ne-card-toolbar`、`.ne-ui-boundary-popover`、Ant 下拉层等上下文时取消隐藏计时器；
- 真正离开卡片和工具栏后，才补发正常的合成 mouseleave；
- 保留 `ne-alert-hole` 高亮块支持；
- 处理颜色块之间、卡片与工具栏之间的物理空隙。

这次修改后在开发窗口中用相同的“先移动到空隙、再进入颜色区”的路径验证，当前表现已稳定。

### Drawnix / mindmap 额外修复

文件：

```text
/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts
```

将数学脚本从外部 URL 改为应用内随包镜像：

```text
./vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js
./vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js
```

避免外链脚本加载顺序和全局 `katex.__defineMacro` 不存在导致包含公式/思维导图内容的文档报错。

### 最新验证

```text
21 个测试文件
243 个测试全部通过
npx tsc --noEmit 通过
Vite/Electron build 通过
git diff --check 通过
```

调试用的 CDP/Vite/Electron 进程已清理，`vite.config.ts` 已恢复为无调试端口版本。

---

# 会话收尾交接（2026-08-18）

> 本节是本次长会话的最终状态摘要。新会话应先读完整文档，再以当前代码和 Git 状态为准，不要根据旧章节中的历史测试数字判断当前状态。

## 一、最终任务目标

本次任务围绕 Lake Notes Electron 的代码审计、Store/IPC 拆分、移动端复用准备、思源 3.8.0 机制借鉴和编辑器稳定性优化展开，最终要求：

- 保持本地优先、SQLite/文件为真相、S3 为镜像的既定语义；
- 不破坏同步、墓碑、回收站、历史快照和小记冲突协议；
- 借鉴思源的可靠机制，而不是复制 Go kernel/WebSocket 架构；
- 每批改动都做定向测试、完整测试和构建验证；
- 最后提交全部工作，合并到 `master` 并推送远程。

## 二、本次已完成内容

### 2.1 Store、IPC 和移动端准备

已完成并准备随本次提交进入 master：

- Store 只读查询/纯函数基础层；
- `SearchRepository`；
- `HistoryRepository`、`TrashRepository`；
- `AssetRepository`；
- `NoteQueries`；
- `NoteMetadataRepository`；
- 图片格式/尺寸纯函数；
- 正文保存、资源上传/远程下载、远程笔记导入协调器；
- Quick Notes M1/M2 模型、校验、序列化和查询层；
- IPC registrar 及 Notes/History/Sync/Quick Notes 分域注册；
- `DesktopStatusBar` 抽取；
- 资源服务异步 I/O；
- Electron 43.4.0、better-sqlite3 13.x 基线；
- 必要的 AWS SDK、Vite 依赖升级。

Quick Notes M3 文件 staging 跨端抽象暂缓，原因是移动端 POC 尚未有真实 Quick Notes 页面和调用 API。

### 2.2 思源机制借鉴优化

已完成：

- SearchPanel 请求版本保护；
- 按 `noteId` 串行保存队列；
- Sidebar parent → children 树索引；
- TreeRow memo 和主要回调稳定；
- Sidebar/Outline 宽度提交式 localStorage 持久化；
- History/Orphan/Trash/Quick Notes 列表刷新版本保护；
- History 快照/孤儿文件预览版本保护；
- 同步、历史恢复、回收站恢复后的 tab reload 版本保护；
- HistoryPanel/TrashPanel Escape 关闭；
- reduced-motion 动效覆盖；
- 本地资源 CORS 预加载 token 修复。

有意暂缓：

- 树虚拟化：开发数据当前只有 19 个 tree node，没有达到复杂虚拟列表阈值；
- renderer → main 退出 flush/ack：尚未复现确认退出后的异步保存丢失；
- 全局 TaskManager、动态设置表单和复杂动画控制器：没有足够真实调用方。

方案记录：

```text
/Users/admin/file/local-lake/lake-notes-electron/docs/SIYUAN-OPTIMIZATION-BACKLOG-2026-08-18.md
```

### 2.3 本轮编辑器问题修复

#### 代码块首次创建焦点

文件：

```text
/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/EditorTab.tsx
```

- 保留真正坏代码块的旧自愈重建能力；
- 用户仍在编辑器内输入时不重建；
- focusout 后再次检查；
- 仍没有 CodeMirror/CM editor 的可见坏代码块才进入重建；
- 连续重建无改善时停止，避免死循环；
- 重建优先使用 `latestDocumentRef`，避免 React prop 滞后覆盖最新内容。

#### 高亮块悬浮工具栏

文件：

```text
/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts
```

已针对真实复现的“卡片和颜色/工具栏之间存在空隙时 toolbar 消失”修复：

- 卡片离开时不立即把 mouseleave 交给 Lake；
- 增加约 650ms gap grace period；
- 进入 `.ne-ui-toolbar`、`.ne-card-toolbar`、`.ne-ui-boundary-popover`、Ant 下拉层时取消隐藏计时；
- 真正离开卡片和 toolbar 后才补发正常 mouseleave；
- 高亮块 `ne-alert-hole` 保持在桥接范围内。

#### 右下角弹出提示

删除小记撤销 toast 和同步 toast fallback 已统一移到右上区域：

```text
/Users/admin/file/local-lake/lake-notes-electron/src/components/QuickNotesWorkspace.tsx
/Users/admin/file/local-lake/lake-notes-electron/src/styles.css
/Users/admin/file/local-lake/lake-notes-electron/src/b3/components.css
```

删除小记 toast 当前使用高层级、左侧主色标记、边框和阴影，不再被状态栏盖住。

#### GIF/WebP

- 远程下载按实际 magic bytes 保存格式；
- GIF 保存为 `.gif`；
- WebP 保存为 `.webp`；
- 本地 File/Data URL 上传不再把 WebP/AVIF 转成 PNG；
- clipboard 导出到不支持 WebP/AVIF 的外部应用时仍可临时转换 PNG；
- 如果用户提供的是站点 JPEG 预览图，无法从 JPEG 还原动画，必须重新提供原始 GIF/动画 WebP 地址。

#### Drawnix/mindmap 与 KaTeX

文件：

```text
/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts
```

数学脚本已从外链改为应用内镜像：

```text
./vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js
./vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js
```

目的是避免 `katex.__defineMacro` 因外链加载顺序、外部网络或全局对象未就绪而报错。

## 三、当前问题和验证边界

### 已知的非阻断问题

开发数据中包含 Drawnix/思维导图内容。此前在开发/HMR 或相关文档初始化时观察到：

```text
Cannot read properties of undefined (reading '__defineMacro')
```

已改为本地 KaTeX/mhchem 镜像；提交前需要新会话继续用全新 Electron 进程打开包含公式/思维导图的文档确认是否彻底消失。如果仍存在，应在 Drawnix 卡片边界增加错误隔离，不要让单个 mindmap 错误影响整个编辑器。

### 构建 warning

当前 build 仍有既有 warning：

- `index.html` vendor CodeMirror 脚本不是 module；
- JetBrainsMono 字体保持运行时路径；
- 主 bundle 超过 500 kB。

这些不是 TypeScript、测试或构建失败。

## 四、最终测试基线

必须使用 Node 24：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
```

最终通过：

```text
21 个测试文件
243 个测试全部通过
npx tsc --noEmit
Vite/Electron build
git diff --check
```

开发数据路径：

```text
/Users/admin/Library/Application Support/lake-notes-dev
```

正式数据路径，禁止触碰：

```text
/Users/admin/Library/Application Support/lake-notes-electron
```

## 五、下一步计划

提交并合并完成后，后续新会话按以下顺序继续：

1. 用全新 Electron 进程打开含公式/思维导图的文档，确认 `__defineMacro` 是否彻底消失；
2. 用真实物理鼠标复测高亮块“卡片 → 空隙 → 颜色工具栏”的路径；
3. 复测新建代码块标题第一次输入、失焦后重建和多个代码块连续创建；
4. 如果稳定，再考虑是否需要提交单独的 Drawnix 错误边界；
5. 移动端继续复用 Quick Notes/History/Trash/Asset DTO 和 service contract；
6. 暂不引入树虚拟化和全局 TaskManager，除非真实数据和测量证明需要。

## 六、踩过的坑

- 不要使用 `pkill -f Electron`，机器上有 SiYuan、Trae、VSCode 等其他 Electron；
- CDP 合成鼠标和真实 macOS 物理鼠标的 hit-test 不完全一致，不能仅凭 CDP 正常就判定物理鼠标问题已解决；
- 调试 CDP 时临时修改过 `vite.config.ts`，提交前必须恢复；当前已恢复；
- `npm run dev` 必须使用 TTY 长驻，`nohup` 会被环境回收；
- `document-pane`、portal、`isolation`、`-webkit-app-region` 会造成真实鼠标和合成层命中差异；
- 不要在用户仍有编辑焦点时重建 Lake 编辑器；
- 不要在卡片和浮动工具栏之间的物理空隙里立即触发 hide；
- 不要把 WebP/AVIF 为了 clipboard 兼容而直接转换后写入笔记存储；
- 用户粘贴的 JPEG 预览图不能靠应用恢复动画，必须拿到原始动画资源地址；
- 任何新增 IPC 都必须同步修改 main handler、preload 和 `src/lib/native.ts`；
- 事务边界和同步语义不能为了抽象或减少行数而改变。

---

## 附：分支对比审计报告（verify/remote-master-80e8b76 ↔ backup/pre-reset-master-20260819）

> 只读审计，未改动/未合并任何代码。生成时间：2026-08-19。
> 对比对象：`verify/remote-master-80e8b76`（= origin/master 80e8b76，远端基线）
> 与 `backup/pre-reset-master-20260819`（= 本地废弃前全量快照，含 5 个提交 + 未提交工作区）。
> 6 个提交：`6d25944` 审计五项+资源并发 / `726e9b6` W-13+W-2 / `f355d78` 审计二批 / `b576dea` 依赖复查 / `738064b` 交接文档 / `9de5f88` 工作区快照。
> 差异：46 文件，+1862 / -1016（剔除 HANDOFF 后约 44 文件）。

### 0. 核心结论

1. 本次审计**没有找到确定导致「编辑器渲染慢」的回归点**；UI 侧大部分是防卡顿优化（debounce、memo、稳定回调），反而应比远端快。
2. 「图片下载慢」最可疑的候选已重新排序（依据最新证据，见第 3 节）：主进程下载实现两分支零 diff，CSP connect-src 不影响图片下载；最可疑改为 **CDN 重定向/资产服务器响应链路** 与 **同步资源并发/超时对 UI 线程的占用**，但需真实运行对照确认（用户正在验证远端分支，正好可对照）。
3. 暂存分支相对远端删除 `src/lib/workerPool.ts` 是**安全死代码清理**（远端该文件 177 行零调用），不是图片慢的根因。
4. 存储侧新增 S3 超时、manifest 护栏、4 并发资源传输是**实质性优化**，建议逐步合并，但要注意小记下载的失败语义变化。

### 1. 存储改动（建议优先、风险低）

#### 1.1 S3 请求超时（W-6）——低风险，建议合并
- 新增 `S3_REQUEST_TIMEOUT_MS=30s`、`S3_TRANSFER_TIMEOUT_MS=120s`（大对象放宽），ObjectStore.send 用 AbortController 兜底。
- 远端无任何超时，网络黑洞会无限挂起；此改动解决「同步卡死/退出卡死」，正向。
- 观察项：`testConnection`/清单小命令 30s，七牛 Kodo 慢时可能误报，可实测。

#### 1.2 manifest 字节/条目护栏（W-13）——低风险，建议合并
- `parseLakeManifest`：20MiB 字节上限 + 20 万笔记/5 万目录；小记清单 10MiB + 10 万条目。
- 防 gzip 炸弹/投毒清单打爆主进程，纯增量保护，兼容现有清单。

#### 1.3 资源上传/下载 4 并发（asyncPool）——低风险，建议合并（含一条语义注意）
- Lake 下载：`runPool(assetList, 4)`；上传：`runPool(pendingAssets, 4)`；小记上传/下载同。
- 远端是逐条串行（每条 await S3 往返），4 并发在网络往返主导时显著提速；不会造成 DB 并发问题（资源写盘仍在主流程内按顺序应用）。
- 语义注意：`runPool` 任一失败会停止领取新任务并抛错，**小记 `downloadAssets` 从「逐条失败也继续攒数组」变为「任一失败立即中止」**——更安全，但行为变化需知晓。
- 上传失败语义：Lake 上传本身主循环已有中止；小记上传同样从 continue 变为中止，需回归小记同步。

#### 1.4 CDN 重定向内存索引（W-5）——低风险，建议合并
- 启动时一次性 `scanMirroredCdnFiles` 扫 vendor cdn 目录建 Set，回调内纯内存判断，替代每请求 `existsSync + statSync`（同步 I/O 阻塞主进程）。
- 纯优化，无行为变化；若 vendor 目录在运行时被外部改动，新文件不会即时出现在索引（目录随包固定，可接受）。

#### 1.5 S3 Secret 掩码（W-14）——低风险，建议合并
- `get_s3_settings` 不再返回明文 secret，渲染层显示 `********`；保存时掩码不变则沿用旧值。
- 已附 CDP 验证记录；注意：**掩码保存后若想换新密钥，必须输入新值，留 `********` 不会改密钥**。

#### 1.6 IPC 入参校验（W-4/W-10/W-3 等）——低风险，建议合并
- 正文/缓存 32MiB 上限、标题/图标长度、search limit 封顶、S3/同步/历史配置收窄、导出目录白名单、mdToHtml 协议白名单。
- 均为纵深防御，纯增量；唯一行为影响：超过 32MiB 的正文会拒绝保存（正常不会触发）。

#### 1.7 退出同步兜底（QUIT_SYNC_DEADLINE 60s）——低风险，建议合并
- before-quit 等同步完成时加 60s 强退兜底，避免网络黑洞导致无法退出。
- 注意与 1.1 的 30s/120s 超时协同：单次大文件 120s 可能超过退出 60s 兜底，弱网下大文件传输时退出会被强杀，属预期取舍。

#### 1.8 测试新增/调整——建议一并合并
- assetServer 14 用例、asyncPool、ipcLimits、docStats、tabLimit 等；同步/小记/导出测试适配。
- 覆盖主要新逻辑，可独立合并。

#### 1.9 轻微观察（不阻塞）
- `sync.ts` 中 `isSafeSegment` 的导入存在两行冗余（`export { ... }` 后又 `import` + `const`），可清理为单一导入。
- `sync.diff` 中若干 `JSON.parse→parseLakeManifest` 替换后留下空行/双空行，纯格式。

### 2. UI 改动（建议按功能点单独验收，风险中等）

#### 2.1 标签钉住/上限/淘汰（tabLimit + App + MultiTabEditor + SettingsPanel）——建议合并
- 新增 `maxOpenTabs`（默认 8）、钉住组置顶、LRU 淘汰保护当前/钉住。
- App 持有 pinnedNoteIds，替代 MultiTabEditor 内部 state，关闭/淘汰时清理残留。
- 纯前端状态逻辑，有单测；合并后需验收：钉住、自动淘汰、设置面板档位。

#### 2.2 顶部 tab 不收缩 + 200px 上限 + 悬停 title + 隐藏滚动条——建议合并（但注意滚动条争议）
- 备份分支 CSS：`flex:0 0 auto`、`max-width:200px`、`.tab-items` 横向滚动 + 滚动条隐藏、wheel 监听水平滚动。
- 之前会话对「顶栏滚动条是否真的隐藏」有争议，需要截图验收：极窄窗口下多 tab 是否出现原生横向滚动条。
- 风险：CSS `!important` 与 scrollbar 统一规则较多，若验收 OK 可合并；若滚动条仍出现需调整（不要简单加 overflow:hidden 到滚动容器，会禁用滚动）。

#### 2.3 弹窗 portal 层级修复 + 大纲图标恢复——建议合并
- tab 切换弹窗从绝对定位改为 `createPortal` 到 body + fixed 定位，脱离 tab-bar/大纲 rail 层叠上下文，解决被大纲遮挡。
- OutlineSidebar rail 图标从透明 ghost 恢复为可见按钮。
- 纯 UI 修复，建议连同 2.2 一起验收（弹窗定位依赖 switcherButton rect）。

#### 2.4 字数/图片统计 debounce（W-2-A）——建议合并
- 从「每次渲染对整篇正文跑两次 O(n) 正则」改为：切换/重载立即算，输入 300ms debounce。
- 纯优化，方向正确。注意 `computeDocStats` 每 300ms 仍会对整篇 Lake HTML 做 3 次 replace + 1 次 match；32MiB 上限下极端文档可能仍有单次几十 ms，可后续考虑增量/缓存，但通常无感。

#### 2.5 Sidebar 回调稳定化 + memo（W-2-B）——建议合并
- App 的 sidebar 回调全部 useCallback 化，Sidebar memo，treeRowProps useMemo。
- 减少按键路径下侧边栏整树重渲染，纯优化。注意 Sidebar 的 `useMemo` 依赖列表较长且含 `context?.id ?? null`，若后续新增 props 需同步维护依赖。

#### 2.6 KaTeX/mhchem 预注入顺序 + 卡片错误边界——建议合并
- `injectKatexScriptsInOrder` 在创建编辑器前按 katex→mhchem 顺序注入本地脚本（async=false），修复 `katex.__defineMacro` 竞态。
- Drawnix/mindmap 卡片包错误边界，渲染异常只降级单卡。
- 合并后必须回归：含公式/思维导图文档打开（此前验证项）。注意：预注入脚本与 Lake 的 script 去重协议（loaded/error 属性）耦合，若 Lake 版本升级需复查。

#### 2.7 滚动条全局样式统一（base/layout/styles/outline 大改）——风险中等，建议单独验收
- 删除多个重复 scrollbar 规则，统一收口到 layout.css；编辑区滚动条 1px、tab 隐藏。
- 这是本轮争议集中点，且涉及大量 CSS 删除/改写，**务必在真实窗口截图验收**（普通列表、大纲、编辑区、菜单、tab）。
- 若验收不符合预期，此文件可暂缓合并，不影响其它功能点。

#### 2.8 其它小 UI 项
- `clearScrollMemory`：关闭/删除 tab 时清理滚动记忆 Map，防长会话累积。建议合并。
- tab 切换 `scrollIntoView` 加 smooth：纯体验，可留可去。
- outline 切换 360ms 禁用 grid 动画：防抖动，低风险。
- `SettingsPanel` 移除 S3 明文显示开关：随 W-14 一起。
- `EditorTab` 无实际行为差异（仅导出函数）。
- `App.tsx` 大量 useCallback 稳定化：方向正确；注意 `moveTreeNode` 依赖 `[treeNodes]`，`sidebarMove` 依赖 `moveTreeNode`，树变化时回调仍会重建，属预期。

#### 2.9 UI 侧未发现与「渲染慢」直接相关的回归
- 唯一理论性注意：App 每次内容变化都会重渲染，新增的 docStats effect、pinnedNoteIds effect、outlineSwitching effect 均非高开销；Sidebar memo 反而减少重渲染。
- 若真实渲染慢，优先怀疑 **CSP** 或 **运行时外部脚本**（见下），而非这些状态逻辑。

### 3. 图片下载慢/编辑器渲染慢：最可疑排序（依据运行证据修正）

#### 3.0 已排除的嫌疑（证据确凿）
- **主进程图片下载实现**：`electron/resourceRepository.ts`（含 `downloadRemote`、30s 超时、3 次重试、SSRF、25MiB/50MP 上限）在两个分支 **零 diff** → 图片下载慢不是下载实现本身造成。
- **渲染层上传队列**：`src/lib/concurrency.ts`（6 并发队列）两边一致；`src/features/editor/resourceUpload.ts` 仅删除两个无调用桩。
- **Worker 池删除**：远端 `src/lib/workerPool.ts` 177 行零调用，删除安全，不是根因。
- **CSP connect-src 收窄**：渲染层唯一外部 `fetch` 在 `downloadWithBrowserFetch`（浏览器演示模式）；桌面端图片下载走 `native.downloadRemoteResource` → 主进程 `net.request`，**不经过 renderer CSP**。`clipboardHtml` 的 XHR 只打本地 assetServer。因此 `connect-src http: https: → http://127.0.0.1:*` 不会导致图片下载慢。
- **CSP script-src 收窄**：vendor 静态资源全量扫描仅发现 `www.w3.org`（SVG 命名空间，非网络请求），**没有任何外部 CDN 域名**；且 `dist/index.html` 已验证 `__LAKE_CSP_SCRIPT_EXTRA__` 占位被替换为空、无残留。本地镜像脚本可正常加载。

#### 3.1 最可疑 #1：CDN 重定向（gw.alipayobjects.com）首次命中时机
- 暂存分支改为启动时 `scanMirroredCdnFiles` 一次性扫 vendor 目录建 Set，替代每请求 `existsSync+statSync`。方向是优化（去掉同步 I/O）。
- **风险点**：若 vendor 目录含符号链接/大小写差异/启动时未就绪，Set 里漏掉文件，则 Lake 运行时请求该文件时**不会重定向到本地**，会直连 `gw.alipayobjects.com`（CSP script-src 已不允许该域名 → 被拦；或网络慢 → 表现为渲染/图片慢）。
- **验证**：真实打开含公式/思维导图/图片的文档，DevTools Network 看是否有 `gw.alipayobjects.com` 请求未 302 到 `127.0.0.1:19876`；Console 是否有 CSP violation。
- **建议**：保留 W-5 优化，但对比两份 `scanMirroredCdnFiles` 结果与 Lake 实际请求路径，确认 Set 覆盖完整；必要时保留原 `existsSync` 兜底（仅对未命中项）。

#### 3.2 最可疑 #2：同步资源 4 并发 + S3 超时对主进程/UI 的占用
- 暂存分支 `runPool(assetList, 4)` 并发下载/上传资源，远端逐条串行。并发提升吞吐，但 4 个 S3 流同时在主进程传输 25MiB 级对象时，`getOptional` 内部 `Buffer.from(await Body.transformToByteArray())` 与 sha256 校验会占用主进程事件循环 → 打开文档/图片渲染时可能感觉变慢。
- 同时新增 S3 30s/120s abort 定时器；极端弱网下多个 120s 传输并存，主进程被拖住。
- **建议**：并发数 4 是合理默认，但可在同步进行时观察 `log.sync` 的 `[perf] get/put` 耗时；若确认与 UI 卡顿相关，可降为 2 或把资源传输移入独立 worker 线程（后续优化）。

#### 3.3 最可疑 #3：KaTeX/mhchem 预注入与卡片错误边界
- `injectKatexScriptsInOrder` 在每次 `createLakeDocument` 前检查并注入两个本地脚本（async=false 顺序执行）。脚本已在 DOM 时跳过。
- **风险**：若 `document.querySelector` 的 src 与 Lake 实际加载的 src 不一致（大小写/路径变体），会重复注入；Lake 后续通过 `script[src]` 去重可能不识别 → 重复下载/重复执行 → 打开含公式文档变慢。
- **验证**：DevTools 看 `<script src="./vendor/cdn/os/lib/katex/...">` 是否只出现一次；Console 是否重复 `__defineMacro` 报错。
- **建议**：保留错误边界（纯防御）；预注入若验证重复可改为在 Lake 注入后只等 load，不做主动注入。

#### 3.4 最可疑 #4：UI 状态链路（较低）
- 新增 `docStats` effect 依赖 `[openTabs, activeNoteId, mobileActive]`，`openTabs` 每次内容变化都是**新数组** → 每次按键 effect 重跑，但内部 `statsKeyRef` 相同则 debounce 300ms，不立即算 → 可接受。
- `pinnedNoteIds`/`outlineSwitching` effect 依赖 `openTabs`/`activeNoteId`，每次内容变化重跑，都是 O(n) 级轻量。
- 若真实渲染慢，**优先按 3.1/3.2 排查，这些 UI 状态属于低频嫌疑**。

#### 3.5 明确下一步（只读验证清单）
1. 真实窗口打开含公式/思维导图/多图文档，DevTools Network 过滤 `gw.alipayobjects.com`，确认是否全部 302 到本地；Console 确认无 CSP violation。
2. 同步进行时观察 `log.sync [perf]`，确认资源并发是否与 UI 卡顿时段重合。
3. 打开含公式文档，确认 katex/mhchem 脚本只注入一次。
4. 对照远端基线（旧 CSP + 串行下载）同文档的打开速度与网络面板。

### 4. 待办/下一步

1. 用户正在 `verify/remote-master-80e8b76` 验证远端基线（当前无改动、无合并）。
2. 远端基线验证通过后，决定本地 master 处置（重置到 origin/master 或其它）。
3. 存储改动（第 1 节）可按批从备份分支 cherry-pick/手摘，先跑 `npm test`（基线 263 测试；备份分支新增后约 297 测试）。
4. UI 改动（第 2 节）按功能点单独验收，其中 2.7 滚动条、3（CDN 重定向/CSP 运行验证）必须真实窗口截图/控制台验证。
5. 合并时保留 `vite.config.ts` 的 cspScriptExtraPlugin 与 `public/vendor/lakex-doc/kitchen-url.js`（互为配套）。

### 5. 踩坑/经验补充（供新会话）

- 之前会话反复被「顶栏滚动条是否隐藏」卡住：以真实窗口 CDP 截图 + 计算样式为准，不要只看 CSS 断言。
- CSP 修改必须同时检查 index.html 占位替换产物与 DevTools Console，不能只改 meta 就收工。已确认 dist 无占位残留；connect-src 收窄不影响主进程图片下载，重点验证 gw 域名是否被 CDN 重定向覆盖。
- `workerPool.ts` 是死代码，删除安全；但 `imageConverter.worker.ts` 里还有同名 `convertToPng`，别混淆。
- 资源并发 4 与退出 60s 兜底并存：弱网大文件传输时退出可能强杀，属预期，但验收时注意。
- 小记 `downloadAssets` 失败语义从「跳过继续」变「中止」，同步回归要覆盖小记图片缺失场景。

---

## 2026-08-19 master 合并完成（后续会话先读）

> 详见 `docs/MERGE-2026-08-19.md`。要点：
> - master 已重置并推送远程 = `9e51119`，包含 UI 合集 + 五批存储改动 + W-3/死代码清理，297 测试全绿。
> - **CSP 收紧已明确搁置**（index.html / kitchen-url.js / vite.config 未合并），理由见上述文档 §四。
> - 备份分支已推送 `origin/backup/pre-reset-master-20260819`。
> - 本地与云端数据已全部清空，从零测试中。
