# Lake Notes Electron 会话交接文档（UI 复刻思源 + 7 项反馈处理中）

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
- 分支：**`feat/electron-43-upgrade`**（所有工作在此单分支，领先 master ~36+ 提交，可干净 fast-forward）。
- **已完成为【未提交】**（全部 CDP/真机复测通过）：① 顶栏/左右固定栏融合——**本轮发现并修复真正根因**（圆角被 styles.css 覆盖 + 无灰缝），像素级验证 12px 圆角可见；② 云同步 UI 重构（SyncToast）；③ 反馈 2 偏好设置可点击；④ 反馈 6 状态栏图片统计（`图片 N`）；⑤ 反馈 7 弹窗 b3 令牌审计（含毛玻璃跟随主题修复）。
- **待用户真机验收**：反馈 1/2/3/4/5（代码层面已复测 OK，等用户真机确认）。
- 开发数据：`~/Library/Application Support/lake-notes-dev`（**可重建**，已清掉一条测试残留自定义 CSS）。正式数据：`~/Library/Application Support/lake-notes-electron`（**禁止触碰**）。
- 基线：`npx tsc --noEmit` 通过；`npm test -- --run` = **217 passed**（本轮刚跑过，全绿）；vite build 通过；`git diff --check` 干净。
- **vite.config.ts 已还原**（onstart 调试补丁已移除，== HEAD）。

### 关键约束
- **Node 只用临时 PATH**：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`；**不要动全局/公司 Node 18**（CDP 脚本 `WebSocket` 在 Node 18 下不可用，必须 Node 24）。
- **启动命令**（用户常用，本项目仍有效）：
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  cd /Users/admin/file/local-lake/lake-notes-electron
  npm run dev   # vite + 自动拉起 electron
  # 端口被占时：lsof -ti tcp:1421 | xargs kill -9
  ```
- 杀 electron 用**具体 PID**，不要 `pkill -f Electron`（机器上还有 Trae/SiYuan/VSCode 等）。
- 测试打包版务必用 `LAKE_USER_DATA` 覆盖 userData（打包版默认走正式数据）。

---

## 1. 已完成内容

### 1.1 历史主线（已提交，勿重做）
- **Electron 33 → 43.4.0**（`^43.4.0`）+ better-sqlite3 `^13.0.3`（N-API 单二进制，双 ABI 基建已删）。GPU 裸启动复验通过。43 EOL 2027-01-05。
- **性能/稳定**：render-process-gone 自动恢复、堆峰值实测后 `--max-old-space-size=4096`、View Transitions、content-visibility、阅读进度条、零变更同步早退、fast-path 记账去重、manifest gzip。
- **同步语义（定稿，勿重争）**：本地是真相、先同步者胜、删除压编辑（编辑进历史/回收站）、purged 条目编辑=隐式恢复、小记冲突 B 方案。
- **审计加固**：资产服务器 CORS token 门禁、CSP 零违规、50MP 图片上限、before-quit 等待同步等。
- 测试：217 全绿（含冲突三场景、回收站、零变更早退等）。

### 1.2 思源 UI 移植（已提交，核心成果）
- b3 令牌：`src/b3/theme-daylight.css`、`theme-midnight.css`（思源原文）；思源组件 scss 整目录复用 `src/b3/siyuan/`。
- 顶栏融合：`[交通灯82][工作空间▾(设置/回收站)][☁云][多tab弹性][🌙外观][⋯(锁定)]`（MultiTabEditor 的 tab-bar + topbarLeading/topbarTrailing 槽）；前进/后退已移除；小记与笔记顶栏一致。
- 下拉用 **React portal 渲染到 body 根部**（否则被 document-pane overflow + app-shell isolation 裁掉）——见 `src/App.tsx` 的 `createPortal`。
- 面包屑：只留笔记本名 + 大纲纯文本 `H1xxx`；标签页思源激活态；浮动 dock 半高（top:112/bottom:82）；状态栏全宽底部灰条；活动轨 42px。
- 双主题（含 Lake 编辑器 `--lakex-*` 变量覆盖，打在 `.lakex-default-theme`）；自定义 CSS snippets；字体 JetBrainsMono 已复制到 `public/appearance/fonts/`（OTS 解析错误已修）。
- 布局模型（用户认可的方向）：**整窗灰底（`--b3-body-background` 渐变），白色卡片（sidebar / 文档区 / outline）像"从背景抠出来"，卡片间 4px 灰缝 + 圆角**。参考思源 `_layout.scss` + daylight `theme.css`。

### 1.3 思源参考要点（复刻时对照）
- 思源真实窗口：`/Applications/SiYuan.app`（用户本机开着 v3.8.0）；截图参考 `siyuan-master/screenshots/feature0.png`。
- 思源结构事实（像素分析得出）：工具栏约 36-38px、灰底横向渐变；下方白卡全部**四角圆角**（`--b3-border-radius-b=12px`）、顶部与工具栏衔接处无边框线；卡片之间/窗口边缘 4px 灰缝。
- 思源工具栏按钮不参与拖拽；多 tab 在顶栏右侧；状态栏在整窗底部。

### 1.4 本轮已完成（**未提交**，反馈 1/3/4/5）
1. **顶栏与左右固定栏融合（反馈 1）** — 改动 `src/b3/layout.css`：
   - `.tab-bar`（fixed 那条）加 `border-bottom: 0 !important`——原来继承第一条规则的 `1px solid var(--b3-theme-background-light)`（#dfe0e1），在顶栏底边画出一条全宽深灰线，就是用户说的"非常明显的连接线"。
   - `.sidebar.sidebar-docked` 与 `.outline-sidebar--docked .outline-sidebar__content` 改为四角圆角 `var(--b3-border-radius-b)`（原来是 `0 0 12px 12px` / 底部圆角，顶角直角）。
   - `.workspace` / `.document-pane` / `.document-pane:has(> .multi-tab-editor)` 改为 `border-radius: 12px 12px 0 0`（顶部两角圆角，底部保持现状——用户说底部融合已经很好）；小记视图例外恢复 `0`。
   - 验证：CDP 截图 + 像素块平均，暗色/亮色下顶栏→卡片过渡平滑、无深色线；DOM 计算样式确认 border-bottom 0、radius 12px。
2. **云同步 UI 重构（反馈 3/4/5）**：
   - 新增 `src/components/SyncToast.tsx`（小悬浮窗：busy 主色进度条 + 完成/失败/未配置三种状态 + 详情 + 自动消失）；样式追加在 `src/b3/components.css`（`.sync-toast*`，进度条永远 `var(--b3-theme-primary)` 蓝色，不用红）。
   - `src/App.tsx`：删除 SyncPanel 大弹窗（`src/components/SyncPanel.tsx` 已删除）；新增 `runSync()` + `showSyncToast()`（ok 2.6s / error 4.5s / 未配置 7s 自动消失）；点顶栏云按钮 = 直接同步 + 弹小窗。
   - **冲突/覆盖弹窗（反馈 5）**：原来 `window.alert("检测到远端修改已覆盖本地…")` 改为同步完成 toast 的 `detail` 展示（非阻塞、自动消失）。
   - **红色进度条根因（反馈 3）**：开发数据 localStorage `lake-notes-v1.settings.customCss` 里有一条**测试残留** `:root { --b3-theme-primary: #ff5722; }`（橙色），导致所有主色元素（含同步进度条）变橙红。已在 dev 数据里清掉并 reload 验证回蓝（`#3575f0`）。**这不是代码 bug**，是 dev 数据残留；真实 app 若用户没写自定义 CSS 不受影响。

---

## 2. 当前问题 / 7 项反馈逐项状态

用户最近一次反馈（原话摘要），**按此逐项核对**：

| # | 反馈 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 顶栏和左右固定栏融合仍有明显连接线，思源像一整块背景抠出区域；底栏融合好且有圆角 | ✅ 已修（未提交） | **本轮发现真正根因**：layout.css 的 12px 圆角被 styles.css 后加载规则覆盖（1908 行 sidebar `border-radius:0`、2165 行 workspace `14px 0 0 0`、844 行 workspace `border:1px`）→ 视觉上圆角从未生效、顶栏底有灰白跳变线。**修复**：① workspace/document-pane 顶部两角改 `--b3-border-radius-b`(12px)；② sidebar/outline 保留四角圆角；③ workspace 去 border；④ sidebar/workspace 顶部加 4px 灰缝（margin `calc(topbar+4px)`）让圆角可见。**像素级验证**：左上/右上角 12px 圆弧（灰→白平滑渐变）、顶栏底部 4px 灰缝、无横向分割线；暗色同样验证。**待用户真机确认**。 |
| 2 | 偏好设置无法点击 | ✅ CDP 复测通过 | 库视图 + 小记视图都验证：工作空间▾ → 偏好设置能正常打开 SettingsPanel。**待用户真机鼠标确认**（CDP 不能完全等同真机指针）。 |
| 3 | 云同步进度条不要红色 | ✅ 已改（未提交） | 进度条固定 `--b3-theme-primary` 蓝（实测 rgb(53,117,240)），任何状态不用红。 |
| 4 | 点击云同步直接开始，弹小悬浮窗展示状态、自动消失，不要大弹窗按钮 | ✅ 已改（未提交） | SyncToast 替代 SyncPanel。**CDP 验证**：点云按钮直接同步 + toast 自动消失（ok 2.6s / error 4.5s / 未配置 7s）。 |
| 5 | 云端/本地冲突后"本地进历史"弹窗突兀，参考思源 | ✅ 已改（未提交） | window.alert → toast detail。思源本身不做阻塞弹窗，冲突文档进历史列表，符合。 |
| 6 | 状态栏添加图片统计（共多少张图片等） | ✅ 已实现（未提交） | 状态栏加 `图片 N`（当前文档 image card 数，思源同款口径，仅 >0 显示）。**已验证**：含 107 图文档显示 `图片 107`。数据来源：`activeContent` 正则统计 `<card name="image">`。 |
| 7 | 很多弹窗还不是思源样式，需继续审计 | ✅ 已审计（未提交） | 12+ 类弹窗硬编码颜色 → b3 令牌：搜索面板、右键菜单(context-menu)、新建菜单(create-menu)、emoji picker、删除确认(confirm-dialog)、小记转文档(quick-note-convert-dialog)、历史面板(history-panel)、回收站(trash-panel)、设置面板内部(settings-nav/field)、小记页面卡片(composer/entry/empty)、modal-backdrop/settings-overlay 遮罩。**关键修复**：弹窗统一毛玻璃表面（styles.css "苹果风"批量规则）从硬编码 `rgba(255,255,255,.74)` 改为 `color-mix(var(--b3-theme-surface)…)` —— 修复暗色下弹窗仍为半透明白底的问题。清理 `.sync-panel`/`.sync-setup-toast` 死代码。**双主题 CDP 计算样式验证 + VisionPower 视觉确认**（亮 #f6f6f6 / 暗 #2c2c2c 自动适配，无白底突兀）。 |

### 本轮新增改动文件（未提交）
- `src/App.tsx`：状态栏图片统计（`imageCountLabel` + `.statusbar-imagecount`）。
- `src/styles.css`：12+ 类弹窗/菜单/小记卡片硬编码色 → b3 令牌；**毛玻璃表面跟随主题**；清理 `.sync-panel`/`.sync-setup-toast` 死代码。
- `src/b3/layout.css`、`src/b3/components.css`、`src/components/SyncToast.tsx`：上一轮反馈 1/3/4/5（未提交，见 §1.4）。
- `src/components/SyncPanel.tsx`：已删除（被 SyncToast 替代）。

### 其他已知边界（长期）
- AK/SK 硬编码在 `electron/main.ts` dev seed + `scripts/s3-ls.mjs`；**用户明确推迟**，统一收尾时轮换 + `git filter-repo` 清历史。**不要外泄/公开仓库。**
- 编辑器正文排版由 Lake 内核渲染，与思源 protyle 不同（重写成本高，用户已知并接受）。
- 有变更时仍全量解析/上传 manifest（10k 条 ~1-3s）；增量 manifest 待评估（`docs/PERFORMANCE-NEXT.md`）。
- App.tsx ~1100 行 monolith，拆分列入低优先待办。
- 小记"learned tombstone"墓碑永久保留（体积小，可接受）。

---

## 3. 下一步计划（按优先级）

1. **收尾本轮回滚/提交**：
   - 还原 `vite.config.ts`（`cp /tmp/vite.config.ts.bak vite.config.ts`，备份==HEAD；恢复被误删的 drawnix 注释）；确认 `git status` 只剩预期文件：`M src/App.tsx`、`M src/b3/components.css`、`M src/b3/layout.css`、`D src/components/SyncPanel.tsx`、`?? src/components/SyncToast.tsx`。
   - 复验：tsc + 217 测试 + `node node_modules/vite/bin/vite.js build` + 手动过一遍同步 toast。
   - **不要自主推 master**——合并/推送等用户确认（之前约定：单分支干完，用户复测后统一处理）。
2. **反馈 2 复测**：小记视图 + 真机鼠标点 偏好设置；同时把所有下拉/弹窗的真机点击过一遍。
3. **反馈 6 状态栏图片统计**：先确认口径（当前文档 vs 全库），再实现。
4. **反馈 7 弹窗审计**：逐个对照思源 `b3-dialog`/`b3-menu` 样式改（历史/回收站/搜索/删除确认/emoji/设置/S3 同步配置等）。
5. **性能**：跑真实数据看单次同步耗时；>2 万条再评估增量 manifest。
6. **凭据收尾**（用户推迟，最后统一做）。
7. 遗留临时文件可删：`Electron-HANDOFF.md.bak-*`、`hist-bench-tmp.mjs`。

---

## 4. 开发工作流 / 调试工具（必读）

- 启动：见 §0 命令。`npm run dev` 需 **tty 长驻**（exec 会话），`nohup ... &` 会被环境回收。
- **CDP 驱动渲染层**（强烈推荐，本轮全靠它）：
  - `node /tmp/lake-cdp-eval2.mjs <port> "<expr>" [timeoutMs]`（Runtime.evaluate，须 Node 24）
  - `node /tmp/lake-cdp-shot2.mjs <port> <out.png>`（截图）
  - 端口：`9222`（远程调试）。**当前 vite/electron 仍在运行**（端口 1421 / 9222 / electron PID ~49900）；新会话可直接连，或先 `lsof -ti tcp:1421,9222 | xargs kill -9` 重启。
  - 截图是 2x（DPR=2），像素采样记得 `*2`；浅色背景有 subpixel 抗锯齿噪点，判断颜色用**块平均**（20x20），别单点采样。
- **真实窗口截屏**：`screencapture -x -l<窗口id>`（用 python3 + Quartz 查 `kCGWindowNumber`）；注意 macOS 对窗口截图可能有缓存，渲染层变化以 CDP 截图为准。
- **像素/几何分析**：`node -e` + `sharp`（项目 node_modules 里有）。
- **云端查看**：`node scripts/s3-ls.mjs`。
- **dev 数据**：`~/Library/Application Support/lake-notes-dev`，localStorage 里 `lake-notes-v1.settings`（主题/自定义 CSS/字号）；`metadata.sqlite3` 用 python3 sqlite3 只读查。
- 常用 CDP 注入：点按钮 `.click()`、`document.elementFromPoint(x,y)`、`getComputedStyle`、`location.reload()`。

---

## 5. 测试要点

- 基线：`npx tsc --noEmit`、`npm test -- --run`（217）、`node node_modules/vite/bin/vite.js build`、`git diff --check`。
- UI 改动后手动清单：亮/暗双主题都过一遍；库视图 + 小记视图；顶栏两个下拉（工作空间/更多）；云同步 toast（busy/ok/error/未配置四种态 + 自动消失）；设置面板每个 tab；浮动 dock（悬停活动轨/大纲轨）；多 tab 打开/关闭/拖拽；状态栏。
- 回归重点（同步语义勿破坏）：先同步者胜、删除压编辑、回收站、小记冲突、零变更早退、purged 隐式恢复。

---

## 6. 踩过的坑（新会话必看）

### 环境/流程
1. **vite.config.ts 的 onstart 补丁必须还原**：本轮为拿 CDP 端口临时加了
   `onstart(args) { args.startup([".", "--no-sandbox", "--remote-debugging-port=9222"]); }`。
   `git diff` 里还有一处**误删的 drawnix 注释**（用 `cat > vite.config.ts` 重写时丢了）。
   还原：`cp /tmp/vite.config.ts.bak vite.config.ts`（该备份 == git HEAD）。**勿提交 onstart 补丁。**
2. **CDP 脚本要 Node 24**：Node 18 无全局 `WebSocket`，报 `ReferenceError: WebSocket is not defined`。
3. **nohup 会被回收**：electron/vite 必须放 tty 长驻会话；`nohup ... &` 随 exec 会话退出被杀。
4. **杀 electron 用具体 PID，不要 pkill -f**（Trae/SiYuan/VSCode 都是 Electron）。
5. **启动 electron 勿用 `| head` 管道**：stdout 断裂 → electron-log `write EPIPE` 未捕获 → 主进程报 JS error。
6. **单实例锁按 userData 隔离**：同一 userData 第二个实例直接 quit。
7. **dev 数据可重建**：乱改坏了就删 `~/Library/Application Support/lake-notes-dev`；正式数据（`lake-notes-electron`）永不碰。
8. **不要在 dev localStorage 里留自定义 CSS 测试残留**（本轮就因此把主色变成橙红，用户以为进度条 bug）。
9. **测试打包版必须 `LAKE_USER_DATA` 覆盖**，否则写正式数据。

### UI / CSS（本轮经验）
10. **连接线来源**：`.tab-bar` 第一条规则设了 `border-bottom: 1px solid var(--b3-theme-background-light)`（#dfe0e1），fixed 那条没覆盖 → 顶栏底边一条全宽深灰线。改任何"融合"类样式，先查 border/box-shadow 是否被旧规则残留。
11. **styles.css 有大量历史迭代规则**（`!important` 乱战），b3/*.css 是"权威层"（后加载 + `!important`）；改布局优先改 `src/b3/layout.css`，并在 DOM 用 `getComputedStyle` 验证最终生效值。
12. **`.top-menu` 下拉必须 portal 到 body**（`createPortal`），否则被 document-pane overflow / app-shell `isolation: isolate` 裁掉/盖住。
13. **思源布局模型**：整窗灰底 + 白色圆角卡片（四角 12px）+ 4px 灰缝；顶栏透明融入灰底；不要给顶栏画边框线。
14. **浅色 UI 像素判断用块平均**：subpixel 抗锯齿让单点采样出现红/绿/蓝噪点（灰底上采样到 121,114,255 之类），别被误导。

### 同步/存储（历史沉淀）
15. **HeadBucket 不可用**：`ObjectStore.test()` 必须用 `ListObjectsV2`。
16. manifest 保留 10 份（`MANIFEST_CHAIN_KEEP=8`）：prune / runGcReconcile / runDeepCleanup 三处链长必须一致。
17. **零变更早退**依赖 `device_state.last_seen_commit_id` + 墓碑签名；`setNoteLocked` 必须标 `sync_state='local'`。
18. **markSynced 三处**：notes + tree_nodes + sync_base.last_synced_meta_at。
19. **IPC 三处同步**：main.ts(handle) + preload.cjs(invoke) + src/lib/native.ts(类型+封装)。
20. 新增 URL 拼接一律用 `src/lib/assetPort.ts` 的 `ASSET_ORIGIN`/`LOCAL_ASSET_PREFIX`（asset 端口不硬编码）。

---

## 7. 沟通要点（与用户）

- 用户重视权衡与数据；给方案要附真实场景和后果，可大胆反驳。
- 已定稿语义（**不要重新争论**）：本地是真相、目录强一致、墓碑权威、先同步者胜、开发版不考虑数据兼容、小记不备份。
- 性能用户非常关注（"产品要流畅不卡顿"）：先给数据/量级再给方案。
- 用户认可"直接复用/抄袭思源前端代码"，方向是**所有可见 UI 与思源一致**；涉及 AGPL-3.0 的思源代码已保留署名。
- 用户习惯：功能做完后要自己**手动全量测试一遍**；测试完才打新包。给用户测之前先自测到"能直接上手验收"。
- 凭据：AK/SK 暂不处理（用户明确）；不要外泄。
