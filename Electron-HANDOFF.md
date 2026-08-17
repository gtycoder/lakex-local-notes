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
- 基线：`npx tsc --noEmit` 通过；`npm test -- --run` = **217 passed**；vite build 通过；`git diff --check` 干净。
- **vite.config.ts 已还原**（== HEAD，无调试补丁）。

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
- 测试：217 全绿（含冲突三场景、回收站、零变更早退等）。

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
- 凭据收尾（AK/SK 硬编码，用户推迟，最后统一轮换 + git filter-repo）。

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

- 基线：`npx tsc --noEmit`、`npm test -- --run`（217）、`node node_modules/vite/bin/vite.js build`、`git diff --check`。
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
