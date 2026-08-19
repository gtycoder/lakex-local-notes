# Lake Notes Electron 会话交接文档

> 写给**完全没有上下文的新会话**。开工前先通读本文，再按需读：
> `AGENTS.md`（项目长期记忆/规则）、`docs/MERGE-2026-08-19.md`（8-19 合并说明）、
> `docs/SIYUAN-UI-PORT.md`（思源 UI 移植记录）、`docs/PERFORMANCE-NEXT.md`（性能评估）、
> `docs/TODO.md`（待办清单）。
> 对照代码：`src/App.tsx`、`src/b3/layout.css`、`src/features/outline/outline.css`、
> `src/features/editor/MultiTabEditor.tsx`、`electron/main.ts`、`electron/sync.ts`。

项目目录：`/Users/admin/file/local-lake/lake-notes-electron`（思源源码：`/Users/admin/file/local-lake/siyuan-master`，v3.8.0，AGPL-3.0，已保留署名）

---

## 0. 任务目标与当前状态

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo，`https://s3.cn-north-1.qiniucs.com`，Bucket `local-lake-hebei`，前缀 `lake-notes`）。**本地是真相，S3 只是镜像。**

**总体目标（用户原话）**：**UI 要完完全全复刻思源笔记**——可见的布局、样式、动效、窗口形式全部和思源一模一样，直接复用/抄袭思源源码（`siyuan-master`，v3.8.0）是可行且被认可的方向；同时要稳定流畅（Electron 43.4.0，性能优化持续做）。

**当前状态（2026-08-19 会话收尾）**：
- 分支：**`master`**（本地=远程 `origin/master` = `13dd306`），工作区干净。
- 测试基线：**297 passed**（26 测试文件）、`npx tsc --noEmit` ✅、`vite build` ✅、`git diff --check` ✅。
- **vite.config.ts 保留了 CDP 调试参数**（`onstart: startup([".", "--remote-debugging-port=9222"])`）——用户明确要求保留，后续调试直接用。
- 开发数据：`~/Library/Application Support/lake-notes-dev`（**可重建**；本会话多次清空，当前可能已重建）。
- 正式数据：`~/Library/Application Support/lake-notes-electron`（**已按用户要求删除**——2026-08-19 用户要求"全部清空"，云端 S3 也已清空为 0 对象，无备份）。

### 关键约束
- **Node 只用临时 PATH**：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`；**不要动全局/公司 Node 18**（CDP 脚本 `WebSocket` 在 Node 18 下不可用，必须 Node 24）。
- **启动命令**（dev，带 CDP）：
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  cd /Users/admin/file/local-lake/lake-notes-electron
  export LAKE_USER_DATA="$HOME/Library/Application Support/lake-notes-dev"
  npm run dev   # vite + 自动拉起 electron（vite.config 已带 --remote-debugging-port=9222）
  # 端口被占时：lsof -ti tcp:1421,9222,19876 | xargs kill -9
  ```
- **dev 必须用 tty 长驻会话**（exec 的 tty:true），`nohup ... &` 会被环境回收。
- 杀 electron 用**具体 PID**，不要 `pkill -f Electron`（机器上还有 Trae/SiYuan/VSCode 等）。
- CDP 调试工具：`/tmp/lake-cdp-eval2.mjs <port> "<expr>"`（Runtime.evaluate）、`/tmp/lake-cdp-shot2.mjs <port> <out.png>`（截图）——脚本需要 Node 24。

---

## 1. 本会话（2026-08-19）已完成内容

### 1.1 存储改动五批合并（已合入 master）
从 `backup/pre-reset-master-20260819` 按批 cherry-pick/手摘合并，每批独立提交+测试：

| 批 | 提交 | 内容 |
|---|---|---|
| 1 | f1eab65 | W-13 manifest 字节/条目护栏（Lake 20MiB/20万条 + 小记 10MiB/10万条） |
| 2 | 274299f | W-6 S3 请求/传输超时（30s/120s AbortSignal）+ 退出同步 60s 兜底 |
| 3 | d8b1a09 | W-5 CDN 重定向内存索引（启动扫描 vendor 建 Set，回调零 I/O） |
| 4 | ea29074 | W-14 IPC 入参校验（正文 32MiB/标题 500/图标 64/搜索 200）+ S3 Secret 掩码 + mdToHtml 协议白名单 + isSafeSegment 收敛 |
| 5 | d05c57a | 资源上传/下载 4 并发（asyncPool，Lake + 小记） |
| 6 | 9e51119 | W-3 资产 URL 正则端口跟随 ASSET_PORT + 锁依赖版本 + 删 workerPool 死代码 |

### 1.2 滚动条问题（重要：多轮反复，最终方案）
**最终状态（用户认可，已合入 master `13dd306`）**：
- **移除全部自定义滚动条外观**（1px/2px/4px/8px 方案全部回退），保留**系统默认 10px 轨道**。
- 仅保留 `::-webkit-scrollbar-thumb { min-height: 64px }`（超长文档 thumb 不缩到几像素，可点击）。
- **hover 增宽逻辑已移除**（用户反馈触发区"有两段"、体验差，去掉后稳定）。

**反复过程（教训）**：
1. 最初尝试思源式细条（border 4px + inset shadow + hover 变粗）——**Electron 43/Chromium 150 不生效**（thumb 不可见/满宽，border 动态变化被忽略）。
2. 改 4px/8px 轨道方案——用户觉得"还不如原来的"。
3. 回退到系统默认 + thumb min-height 28→48→64px。
4. 加 hover 增宽（容器 hover 10→15px）——用户反馈触发区太大（整个编辑器 hover 就变粗）。
5. 收窄到右缘 44px（JS mousemove 判定）——用户反馈"有两段加粗逻辑，一段离得远一段贴边缘"。
6. **最终：全部移除 hover 增宽，只留 min-height 64px**。

### 1.3 大纲悬浮触发区（已合入 master `13dd306`）
**问题**：大纲悬浮模式（collapsed + hover rail）时，rail 视觉 42px 但触发区域太宽，"还没碰到 rail 就弹出"。

**最终方案**：
- **rail 视觉保持 42px**（`--outline-collapsed-width: var(--activity-rail-width)`，对齐思源 .dock）。
- **新增 `.outline-sidebar__trigger` 独立触发层**（rail 内右侧 28px，可配 `--outline-hover-trigger-width`）——只有它触发悬浮（`onPointerEnter`），rail 左侧 14px 不误触发。
- **rail 溢出部分 `pointer-events: none`**（视觉保留，不拦截编辑器滚动条 hover）；`activity-button` 和 `trigger` 恢复 `pointer-events: auto`。
- 触发层 `top: 36px` 避开顶部 activity-button。

**关键文件**：`src/features/outline/OutlineSidebar.tsx`、`src/features/outline/outline.css`。

### 1.4 大纲动画节奏统一（已合入 master）
- `outline.css`：content 过渡从 `opacity 140ms + transform 180ms` 统一为 **260ms shell-ease**（与 app-shell grid 列宽 260ms 同步），并加 `visibility 260ms`（收起时淡出后隐藏、展开时立即显示）。
- 配合 tab 切换闪烁修复（View Transition 收窄到 `.tab-panels`，见下）。

### 1.5 前置会话遗留（已在 master，勿重做）
- **tab 切换闪烁修复**（`c26fe07` + merge `a162db2`）：`view-transition-name: note-pane` 从 `.document-pane` 移到 `.tab-panels`（顶栏不再参与淡入淡出）；`outline-switching` 期间保留 grid 过渡（260ms 平滑收起/展开）。
- Electron 33→43.4.0、性能/稳定、同步语义定稿、审计加固、第一轮 7 项反馈等（见旧文档 §1，均已在 master 历史）。

### 1.6 数据清空（用户要求）
- 本地：`lake-notes-dev`/`lake-notes-electron`/`lake-notes-test`/`com.lakenotes.poc`/`lake-notes-tauri-poc`（Caches+WebKit）/`com.lakenotes.electron.plist` 全部删除。
- 云端：S3 `lake-notes/` 前缀 383 个对象全部删除，复核 0。
- **注意**：正式数据无备份；dev 数据会在启动时自动重建（含种子内容）。

---

## 2. 当前分支与远程

```
origin/master = 本地 master = 13dd306
提交线（最近）：
13dd306 fix(ui): 大纲悬浮触发区独立 28px + rail 溢出穿透 + 滚动条清理（thumb 最短 64px）
a162db2 merge: fix(ui) tab 切换闪烁（View Transition 收窄 + 大纲平滑过渡）
c26fe07 fix(ui): tab 切换闪烁
00af00f docs: 2026-08-19 master 合并说明
9e51119 ~ f1eab65 （五批存储改动）
5314d3f feat(ui): UI 改进合集（tab/弹窗/统计/大纲/滚动条）
80e8b76 feat: finalize audit refactor and editor stability fixes
```

远程分支：`origin/master`（=13dd306）、`origin/backup/pre-reset-master-20260819`（9de5f88 废弃前快照）、`origin/main`（34752f6 早期 baseline，无关）。

**本地已清理**：`verify/remote-master-80e8b76`、`verify/ui-issues`、`feat/electron-43-upgrade`、`backup/pre-reset-master-20260819`、`backup/pre-reset-95dcaf2-20260806` 均已删除。后者的 9 个独有提交已打包到 `/tmp/lake-git-backup/pre-reset-95dcaf2-20260806.bundle`（如需恢复可 `git bundle unbundle`）。

---

## 3. 当前问题 / 已知边界

### 3.1 CSP 收紧——明确搁置（未合并）
- 内容：`index.html` 的 script-src 收紧（去 `unsafe-inline`/gw CDN）、connect-src 收窄、`kitchen-url.js` 配套、vite.config `cspScriptExtraPlugin`。
- **为什么搁置**：非刚需（纯安全纵深防御）；收紧后若 W-5 CDN 重定向未覆盖完整，资源会被 CSP 直接拦死（公式/图片坏）而非变慢；需要真实窗口验证后才可合并。
- 后续决定点：若 W-5 覆盖完整验证通过可单独合并；若不完整应给 W-5 加 `existsSync` 兜底，**而非收紧 CSP**。

### 3.2 渲染慢根因排查（HANDOFF 旧 §3，未完成）
最可疑排序（需真实运行对照验证）：
1. **CDN 重定向首次命中**（gw.alipayobjects.com 是否全部 302 到 127.0.0.1:19876）；
2. **同步 4 并发 + S3 超时对主进程/UI 占用**（弱网大文件时）；
3. **KaTeX/mhchem 预注入**（是否重复注入）。
验证清单：DevTools Network 过滤 gw.alipayobjects.com、Console 无 CSP violation、katex 脚本只注入一次。

### 3.3 编辑器相关待验证（前置会话遗留）
- `__defineMacro` 报错是否彻底消失（KaTeX 已改本地镜像，需全新进程验证）。
- 高亮块"卡片→空隙→颜色工具栏"物理鼠标复测（CDP 合成鼠标不经过 macOS hit-test）。
- 代码块首次创建焦点/失焦重建。

### 3.4 大纲/滚动条已知边界
- 滚动条当前为系统默认 10px + thumb min-height 64px，**无 hover 增宽**（用户接受现状）。
- 大纲悬浮触发区 = rail 右侧 28px 独立层（用户认可）。
- 大纲 docked 时切换 tab 大纲列宽 260ms 平滑过渡（用户认可）。

---

## 4. 下一步计划

1. **渲染慢验证**（见 3.2）：真实窗口打开含公式/思维导图/多图文档，Network + Console 验证 CDN 重定向与 CSP。
2. **编辑器稳定性复测**（见 3.3）：`__defineMacro`、高亮块 hover、代码块焦点。
3. **CSP 决策**（见 3.1）：验证 W-5 覆盖后决定是否合并。
4. 长期 TODO（`docs/TODO.md`）：Word/PDF 导出、附件功能（分片上传/懒下载）、全文搜索 2 字回退、Store 重构后续批次、移动端复用、大纲"展开到 X 级"偶发崩溃观察。

---

## 5. 踩过的坑 / 经验（本会话新增）

### 滚动条（血泪）
1. **Chromium 150 不支持 `::-webkit-scrollbar-thumb:hover` 的 border/box-shadow 动态变化**——思源式"hover 变粗"（border 4px→1px）在此环境失效（实测 border 恒 4px）。不要再用这个技巧。
2. `::-webkit-scrollbar` 的 `background-color`/`background-clip` 自定义也不可靠（只设部分属性时其余用默认）。
3. 滚动条 hover 触发别用"容器 hover"（范围太大），也别用 JS 全局判定（易出"两段"），**当前干脆不 hover 变粗**。
4. `getComputedStyle(el, '::-webkit-scrollbar-thumb')` 能读默认值，但 **`:hover` 伪元素读不到**（需真实鼠标 + 截图验证）。

### 大纲悬浮
5. **rail 视觉宽度与 grid 列宽要一致**：`--outline-collapsed-width` 继承 `--activity-rail-width`(42px) 时，rail 会超出 grid 列(34px) 8px，导致"没碰到 rail 就触发悬浮"。解法是**独立触发层**（rail 内右侧窄条），而不是改 rail 宽度。
6. **rail 溢出部分要 `pointer-events: none`**，否则遮挡编辑器滚动条 hover（"滚动条只在左侧生效"的假象）。
7. 合成 JS 事件（`dispatchEvent`）不触发 React 合成事件（React 17+ 挂 root）；验证交互用 CDP `Input.dispatchMouseEvent` 真实鼠标。

### 环境/流程
8. 本机 Electron 进程常残留（dev 崩溃后 vite 可能还在）：启动前 `lsof -ti tcp:1421,9222,19876 | xargs kill -9`。
9. `node -e` 顶层 `await` 在 CJS 下不可用，用 `.mjs` 脚本或 `--input-type=module`。
10. 像素扫描（sharp）在内容复杂文档上不可靠（文字/图片干扰），优先用 `getComputedStyle`/真实鼠标/截图+VisionPower。
11. **改 UI 前先确认用户当前认可的状态**；用户对反复失败的修复很敏感，小步改动、每步验证。**大改/反复试探前先 commit 或 revert 到位**（本会话滚动条多轮反复，最终靠"全部移除"收场）。

---

## 6. 沟通要点（与用户）

- 用户重视权衡与数据；给方案要附真实场景和后果，可大胆反驳。
- 已定稿语义（**不要重新争论**）：本地是真相、目录强一致、墓碑权威、先同步者胜、开发版不考虑数据兼容、小记不备份。
- 用户认可"直接复用/抄袭思源前端代码"，方向是**所有可见 UI 与思源一致**；涉及 AGPL-3.0 的思源代码已保留署名。
- 用户习惯：功能做完后要自己**手动全量测试一遍**；测试完才打新包。给用户测之前先自测到"能直接上手验收"。
- 凭据：AK/SK 曾出现在仓库历史（C-001，用户接受风险暂不轮换）；不要外泄。S3 凭据可从 Codex 历史日志提取（本会话用于清空云端），但不要打印完整值。
