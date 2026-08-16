# Lake Notes Electron 会话交接文档（隐藏回收站笔记本重构已合并 master）

> 写给完全没有上下文的新会话。**开始工作前先通读本文**，再按需读：
> `AGENTS.md`（项目长期记忆/规则）、`docs/TRASH-NOTEBOOK-DESIGN.md`（重构设计定稿）、
> `docs/REFACTOR-TRASH-NOTEBOOK-HANDOFF.md`（重构起因与方案交接）、`docs/S3-GC-DESIGN.md`（GC v4.1）、
> `docs/QUICK-NOTES-SPEC.md`（小记规格）、`docs/PERFORMANCE-NEXT.md`（性能优化评估清单）、`docs/TODO.md`。
> 对照代码：`electron/sync.ts`、`electron/store.ts`、`electron/quickNotesSync.ts`、`electron/main.ts`、`src/App.tsx`。

项目目录：`/Users/admin/file/local-lake/lake-notes-electron`

---

## 0. 任务目标与当前状态

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo S3 兼容 API）。**本地是真相，S3 只是镜像。**

**当前状态**：隐藏回收站笔记本重构（删除=移动语义，回收站上云 / purge 不广播 / 自动过期 60 天）**已完成并合并进 master**（2026-08-15）。多轮 A/B 真机验收 + 代码审计 + 性能优化全部落地。分支已清理（仅剩 master + backup/pre-reset-95dcaf2-20260806）。

**下一阶段主线**：**Electron 33 → 43.4.0 升级已完成**（2026-08-16，分支 `feat/electron-43-upgrade`，含 better-sqlite3 13.x N-API 迁移 + GPU 裸启动复验通过），然后按 `docs/PERFORMANCE-NEXT.md` 评估增量 manifest 等性能项。

**UI 重做（复刻思源前端，2026-08-16 起）**：**视觉层移植已完成**——b3 令牌（daylight/midnight 原文）、
思源组件 scss 整目录复用、顶栏（工作空间=S3 prefix/云同步/前进后退/外观/更多）、整体布局
（灰底+白色一体卡片+无连接线）、浮动 dock（半高带 112/82）、标签页思源激活态、编辑器面包屑、
全宽底部状态栏、双主题（含 Lake 编辑器深色变量覆盖）、自定义 CSS snippets、scroll-driven animations。
活动轨 42px 对齐思源 .dock；CSP 放行 KaTeX CDN + 本地资产镜像（公式字体正常）。详见 `docs/SIYUAN-UI-PORT.md`。

| 项目 | 信息 |
| --- | --- |
| 目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| 分支 | **master**（重构已合并；backup/pre-reset-95dcaf2-20260806 保留作回滚备份） |
| 远程 | `origin = https://gitee.com/gtycoder/local-lake.git`（origin/HEAD=master；还有 origin/main 等旧远程分支未动） |
| Node | **必须优先 Node 24**：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| Electron | **43.4.0**（2026-08-16 升级完成；GPU 问题已修复，见 §5 坑 0） |
| 基线 | `npx tsc --noEmit` 通过；`npm test -- --run` = **217 passed**；`node node_modules/vite/bin/vite.js build` 通过；`git diff --check` 干净 |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| 打包版测试隔离 | 任意模式可用 `LAKE_USER_DATA` 覆盖 userData（打包版默认走正式数据，**测试打包版务必覆盖**，避免触碰正式数据）；dev/打包版路径不同，可同时运行 |
| 运行状态 | **项目已停止**（A/B、vite 均已退出，multidev 残留已清） |

### 开发版固定 S3 配置（已写入 `electron/main.ts`，仅 dev 首次启动 seed）
- Endpoint: `https://s3.cn-north-1.qiniucs.com`、Region: `cn-north-1`、Bucket: `local-lake-hebei`、前缀 `lake-notes`、`forcePathStyle: false`
- AK/SK 硬编码在 `electron/main.ts` 与 `scripts/s3-ls.mjs` 默认值（**用户决定暂不处理**：git 私有，等全部收尾后统一轮换密钥 + 清 git 历史。见"当前问题"）

---

## 1. 已完成内容

### 1.1 隐藏回收站笔记本重构（本轮核心，已合并）
- 删除 = 移入隐藏回收站笔记本（`parentId=notebook-trash`），`trashed_at`/`deleted_from_parent_id` 上云；恢复 = 移回原位置 + `restore_pending_at`；purge = 物理删 + 轻量墓碑（`deleted:true`），他端保留副本标 `purged`（可恢复、不上传）；自动过期 60 天（`trashAutoPurgeDays`，可配）。
- 设计文档：`docs/TRASH-NOTEBOOK-DESIGN.md`（定稿）、`docs/REFACTOR-TRASH-NOTEBOOK-HANDOFF.md`（起因/方案）。
- 软删路径统一（无软删墓碑、移动即同步、情况 3 自然解决、资源自然 keep）；复杂度集中在 purge 路径（D2 决策"不广播删除"的必然成本）。

### 1.2 统一冲突语义（先同步者胜）
- 正文 / 元数据（图标/改名/排序/父目录）/ 小记三者**同构**：以"本设备已确认版本"为分界——
  - 云端 != 已确认版本（别人先提交）→ 接受远端（文档进历史、小记进回收站、图标被覆盖）；
  - 云端 == 已确认版本 + 本地续编/回滚历史/删除恢复/改名 → 本地胜、上传回写。
- 元数据用 `sync_base.last_synced_meta_at`（markSynced 时记录 notes.updated_at）判定；正文用 baseHash；小记用 contentHash。删除/恢复的显式例外 = `restore_pending_at`。
- **编辑 purged 条目 = 隐式恢复**（saveNote/setNodeIcon/renameTreeNode/setNoteLocked 触发，留档被删版本）。

### 1.3 性能优化（已落地）
- **零变更早退**：记录 `lastSeenCommitId` + 墓碑签名（`device_state`），远端未变且本地无 pending → 整轮跳过（10k 条零变更同步 ~200ms，不写 manifest）。
- **fast-path 记账去重**：`store.allSyncBaseInfo()` 批量读基线（替代逐条 lastSyncedMetaAt 查询），已 synced 且 base/meta/锁一致 → 跳过 setBaseHash/markSynced/setLastUploadedHash（省 ~9 万次 DB 写/次）。
- manifest gzip（此前已做，-87%）。详见 `docs/PERFORMANCE-NEXT.md`（含待评估项）。

### 1.4 审计加固（本轮）
- **资产服务器 CORS token 门禁**：带 Origin 的 CORS 请求须 `?token=` 匹配启动随机令牌（防外部网页/sandbox iframe 读本地图片）；`<img>` 非 CORS 不受影响。令牌经 `LAKE_ASSET_TOKEN` env → preload → `lakeNative.assetToken`。
- **CSP**：index.html meta（`script-src 'self' 'unsafe-inline'`、`img-src`/`connect-src` 放行本地+http(s)、`font-src` 放行 `https://gw.alipayobjects.com`、`worker-src`、`object-src 'none'` 等）；实测零违规、编辑器正常。
- **图片 50MP 像素上限**：自研头部尺寸解析（PNG/JPEG/GIF/WebP），上传/下载/粘贴/转换前拦截解压炸弹（不依赖 sharp 解码器，极小恶意文件也能识别）。
- **小记回收站过滤无内容墓碑**（learned tombstone 不显示假条目）。
- **before-quit 等待在途同步**（任何模式）。
- **restoreTrashItem 根级笔记本恢复位置修复**：原父 `parent_id` 为 NULL 时 `parent_id != ?` 三值逻辑漏判 → 误回默认笔记本；修为 `(parent_id IS NULL OR parent_id != ?)`。
- 修复：小记转正式笔记图片 URL 端口硬编码 19876 → `ASSET_PORT`；manifest 保留链与 GC 一致（`MANIFEST_CHAIN_KEEP=8`，latest + 9 commit = 10 份）；快照弹窗状态残留（HistoryPanel 打开/切 note 重置）；默认笔记本图标纳入 folder 同步（LWW）。

### 1.5 测试
- **217 全绿**（含：先同步者胜三场景、正文续编、历史回滚同步、删除压编辑回收站内容断言、零变更早退、编辑即恢复、50MP 拒绝、幽灵条目过滤、manifest 10 份裁剪、默认笔记本图标等）。
- 真机 A/B 多轮验收（32 场景 + 本轮回归）均通过；本轮修复全部实测（CSP 零违规、token 403/200、早退跳过+有变更不误跳、🛰️ 图标跨端）。

---

## 2. 当前问题 / 已知边界

1. **AK/SK 硬编码**（`electron/main.ts` dev seed + `scripts/s3-ls.mjs` 默认值）：用户决定**暂不处理**（git 私有）；计划"全部收尾后统一轮换密钥 + 清理 git 历史"。**不要把凭据外泄/公开仓库。**
2. **Electron 33 已 EOL + macOS 26 GPU 空转 → 已解决（2026-08-16 升级 43.4.0）**：裸启动实测 GPU Helper ~2% CPU、渲染正常（2094 元素 + 编辑器初始化），fontations 空转未复现；multidev.sh 已改为仅 `--use-angle=metal`。43 EOL 2027-01-05，届时 43 → 44/45 为同 Node 大版本小升级，成本低。详见 §5 坑 0。
3. **性能**：有变更时仍全量解析/上传 manifest（10k 条 ~1-3s 后台）；增量 manifest 待评估（`docs/PERFORMANCE-NEXT.md` 决策表）。
4. **已知边界（低危，暂不处理）**：
   - trash-yield 可能丢弃本地回收站条目的编辑（未留档）；
   - 云端 manifest 损坏/含环 → fail-fast 整次同步中断（审计 #4 设计权衡）；
   - 多端并发 purge/恢复存在"先读后写"竞态窗口（读到墓碑即兜住，低概率）；
   - 小记 `archiveLocalToTrash`/learned tombstone 产生的墓碑会永久保留（体积小，可接受）。
5. **App.tsx 1049 行 monolith**：可维护性优化（拆分）已列入低优先待办，未做。

---

## 3. 下一步计划

1. **Electron 33 → 43.4.0 升级（已完成 2026-08-16，分支 feat/electron-43-upgrade）**：
   - 结果：electron `^43.4.0` + better-sqlite3 `^13.0.3`（**N-API 单二进制，无需 rebuild**，双 ABI 基建 setup-test-abi.sh / vitest alias 已删除）；electron-log / vite-plugin-electron / sharp 均兼容；`tsc` + 217 测试 + vite build 全绿；GPU 裸启动复验通过（§5 坑 0）。
   - 遗留可选项（未做）：打包版 CSP 验证、复查 `sandbox: false` 能否恢复、`--max-old-space-size=8192` 是否下调。
   - 参考：思源 v42.7.1 / VSCode 1.132（42.7.1）均未上 43；本项目因 42 EOL（2026-10-20）太近，直接选当前 stable 43.4.0。
2. **性能**：跑真实数据看单次同步耗时；>2 万条再评估增量 manifest（`docs/PERFORMANCE-NEXT.md` 决策表）。
3. **凭据收尾**（用户明确推迟）：统一轮换七牛密钥 + 用 `git filter-repo` 清理含 AK/SK 的历史；改环境变量注入。
4. 其余：App.tsx 拆分（可选）；小记"learned tombstone 防幽灵"已有（过滤回收站显示）；`Electron-HANDOFF.md.bak-*` / `hist-bench-tmp.mjs` 是遗留临时文件，可择机删除。

---

## 4. 关键命令（多端联调 / 验证）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron

# 测试 / 构建
npm test -- --run
npx tsc --noEmit
node node_modules/vite/bin/vite.js build

# A/B 多端（脚本：vite / device-a / device-b / stop）
./scripts/multidev.sh vite        # 临时禁用 electron 自动拉起（结束会自动还原 vite.config.ts）
./scripts/multidev.sh device-a    # A：默认 dev userData，CDP 9222，资源端口 19876
./scripts/multidev.sh device-b    # B：$TMPDIR/lake-device-b，CDP 9223，资源端口 19877
./scripts/multidev.sh stop

# 手动前台起（本环境 nohup 起不了 electron，必须 tty 长驻）：
# A: ./node_modules/.bin/electron --use-angle=metal --remote-debugging-port=9222 .
# B: LAKE_USER_DATA="$TMPDIR/lake-device-b" LAKE_ASSET_PORT=19877 ./node_modules/.bin/electron --use-angle=metal --remote-debugging-port=9223 .

# CDP 驱动渲染层：node /tmp/lake-cdp-eval.mjs <port> "<async expression>"（window.lakeNative.*）
# 只读 DB：python3 sqlite3（better-sqlite3 是 Electron ABI，系统 Node 跑不了）
#   开发 A：/Users/admin/Library/Application Support/lake-notes-dev/workspace-default/metadata.sqlite3
#   B：$TMPDIR/lake-device-b/workspace-default/metadata.sqlite3（小记：quick-notes/metadata.sqlite3）
# 云端对象：node scripts/s3-ls.mjs --count | --prefix manifests/ | --note <id>
```

---

## 5. 踩过的坑（务必记住）

### 环境 / 进程
0. **Chromium GPU Helper 空转会卡死同步（macOS 26）→ 已随 43.4.0 升级解决**：Electron 33 上 GPU 进程 99% CPU 空转（`fontations_ffi`）→ 渲染冻结 → 主进程 `webContents.send` mojo 背压 → 同步"卡死"。`--disable-gpu` 单独不够，必须 4 参数禁用组。**43.4.0 裸启动实测不再复现**（GPU Helper ~2% CPU、真实数据渲染正常），multidev.sh 已改为仅 `--use-angle=metal`。若未来版本复发，回退到 4 参数禁用组。
1. **vite dev server 会被 exec 会话回收**：必须长驻 tty（`exec_command tty=true`）；`nohup ... &` 在本环境随会话退出被回收。vite-plugin-electron 自动拉起 electron 时临时给 `vite.config.ts` 的 electron 入口加 `onstart: () => {}`，验证完必须还原（`vite.config.ts.multidev-bak` 是脚本备份；**勿提交 onstart 补丁**）。
2. **启动 Electron 勿用 `| head -N` 管道**：head 退出后 stdout 管道断裂，electron-log 控制台传输层抛 `write EPIPE` 未捕获异常 → "A JavaScript error occurred in the main process"。用 `> file 2>&1` 重定向。
3. **结束 electron 只能 kill 具体 PID**，**不要 `pkill -f Electron`**（机器上还有 Trae/SiYuan/VSCode 等）。
4. **单实例锁按 userData 隔离**：不同 userData 可同时跑；同一 userData 第二实例直接 quit。A=19876，B=19877（LAKE_ASSET_PORT）。
5. **CDP 截图/操作**：窗口未激活时先 `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:"active"}`；截图在 `result.data`。
6. **fetch 测试资产服务器会被 CORS 拦**（403/404 响应无 ACAO 头 → 浏览器 "Failed to fetch"）；验证 token 门禁用 curl（带 Origin 头），别用页面 fetch。

### 七牛 S3
7. **HeadBucket 不可用**：`ObjectStore.test()` 必须用 `ListObjectsV2`，否则永远 `UnknownError`。
8. **配置映射**：正确 Endpoint=`https://s3.cn-north-1.qiniucs.com`、Region=`cn-north-1`、Bucket=`local-lake-hebei`、`forcePathStyle=false`。用户最初给的 `local-lake-hebei.s3...` + Bucket `local-lake` 是错的。
9. **manifest 保留 10 份**（`MANIFEST_CHAIN_KEEP=8`，latest + 9 commit）：prune / runGcReconcile / runDeepCleanup 三处链长必须一致，否则深度清理 7 天后会把多留的容错份删掉。

### 同步 / 冲突
10. **零变更早退**依赖：`device_state.last_seen_commit_id` + 墓碑签名（COUNT:MAX(deleted_at)）；`setNoteLocked` 必须标 `sync_state='local'`（否则锁变更被早退漏掉）。**测试里手工改写 manifest 必须换 commitId**（`writeManifest` 助手已自动换）。
11. **先同步者胜**：判定用"已确认版本"（lastSyncedMetaAt / baseHash），不是"谁写的"也不是"编辑时间"；B 已确认 A 的版本后主动改 → B 胜（场景3）；否则 A 先改先同步 → A 胜。
12. **删除压编辑**：A 删 B 离线编辑 → B 跟随删除 + 编辑进历史；**回收站内容以 A 删除的版本为准**（uploadedByUs / 续编分支都要加 `local.parentId !== TRASH_NOTEBOOK_ID` 守卫，否则 B 的编辑溜进回收站内容）。
13. **restoreTrashItem 原父校验**：根级笔记本 parent_id 为 NULL，SQL 必须 `(parent_id IS NULL OR parent_id != ?)`，否则误回退默认笔记本。
14. **purged 条目编辑 = 隐式恢复**：saveNote/setNodeIcon/renameTreeNode/setNoteLocked 需先 `revivePurgedIfNeeded`（移出回收站 + restore_pending + 留档），否则悄悄复活且无恢复标记。
15. **小记冲突（B 方案）**：远端覆盖本地，本地版本以新 id 进回收站（`archiveLocalToTrash` 复制内容+重映射图片 id），恢复即新小记；`quick_note_assets.id` 全局 UNIQUE，冲突副本/归档必须重映射图片 id 否则 UNIQUE 崩溃。
16. **markSynced 三处**：notes + tree_nodes + sync_base.last_synced_meta_at（后者 UPDATE-only，无行跳过）。
17. **IPC 三处同步**：main.ts(handle) + preload.cjs(invoke) + src/lib/native.ts(类型+封装)；资产 token 在 preload `assetToken` + src/lib/assetPort.ts `ASSET_TOKEN`。

### 其他
18. **更好用的小工具**：`node scripts/s3-ls.mjs` 查看云端；`/tmp/lake-cdp-eval.mjs` 驱动渲染层；python3 sqlite3 只读查库。
19. **临时文件**：`Electron-HANDOFF.md.bak-*`、`hist-bench-tmp.mjs` 是遗留，勿提交、可择机删。
20. **assets 端口硬编码**曾出现在 quickNoteConversion（19876）→ 已改 `ASSET_PORT`；新增 URL 拼接一律用 `src/lib/assetPort.ts` 的 `ASSET_ORIGIN`/`LOCAL_ASSET_PREFIX`。

---

## 6. 沟通要点（与用户）

- 用户重视权衡与数据；喜欢深入讨论设计，给方案要附真实场景和后果，可大胆反驳。
- 已定稿语义（**不要重新争论**）：本地是真相、目录强一致、墓碑权威（删除压编辑）、恢复是唯一显式例外、先同步者胜、开发版不考虑数据兼容、小记不备份。
- 性能问题用户非常关注（"产品要流畅不卡顿"）：先给数据/量级，再给方案；`docs/PERFORMANCE-NEXT.md` 的决策表等用户逐条勾选。
- 凭据：AK/SK 暂不处理（用户明确）；不要外泄。
