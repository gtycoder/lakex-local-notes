# Lake Notes 会话交接（HANDOFF-260823）

> 写给**完全没有上下文的新会话**。开始前必读：本文件 + `AGENTS.md` + `PHONE-HANDOFF.md` + `docs/TODO.md`。
> 日期：2026-08-23 ｜ 仓库：`/Users/admin/file/local-lake/lake-notes-electron` ｜ 当前分支：`feat/mobile-android`

---

## 0. 项目一句话

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo S3 兼容）。**本地是真相，S3 只是镜像。** 目标：桌面端已稳定，正在构建**安卓端**（Capacitor + sql.js WASM + 复用共享层）。

---

## 1. 任务目标（当前主线）

**基于 master 重新构建安卓端**，与桌面共享同一套代码（不沿用旧 mobile-capacitor 分支）。核心原则（用户原话）：**"移动端需要复用什么，桌面就拆什么出来共享"**。

架构形态（已定稿）：**不是拆 npm 包**——单仓库内共享目录 `src/core/` + 双构建入口（`vite.config.ts` 桌面 / `vite.mobile.config.ts` 移动端）+ 接口注入（S3Store/SyncDbPort/DbLike）。

---

## 2. 已完成内容

### 2.1 桌面端同步重构 + 缺陷修复（已合入 master，验收通过）

分支 `refactor/sync-split-desktop` 已合并 master（`c559e2d`），含 7 个缺陷修复（全部是 **master 历史遗留、非重构引入**，经多进程真机验证）：

| 提交 | 修复 |
|---|---|
| `566ded1` | B 无编辑跟随更新不留档（superseded 过度保护） |
| `4f6fc62` | 本机作者被覆盖强制留档（uploaded-by-us 补时间维度判据） |
| `fb16957` | B 恢复父目录丢失（importRemoteNote 覆盖 deletedFromParentId） |
| `0c4ef31` | 跟随删除进回收站不留档（move-to-trash 仅本机编辑成果留档） |
| `912afb2` | 跨笔记本/分组移动报"重排列表包含不属于该父节点的节点" |
| `8c25269` | 循环移动收敛 + 嵌套文档父节点判定 |
| `3acaeb5` | 树形回收站 + Lake viewer 预览（TrashRepository 下沉共享层） |

### 2.2 共享层已就位（master）

| 资产 | 位置 | 说明 |
|---|---|---|
| DB 接口 | `src/core/dbLike.ts` | 桌面 better-sqlite3 / 移动端 sql.js 都实现它 |
| 下载对账决策 | `src/core/lakeReconcile.ts` | 含全部修复（时间维度/本机作者/循环收敛） |
| 删除/恢复/墓碑决策 | `src/core/syncDecisions.ts` | decideTrashCross/decideMetaApply/decideTrashYield/decideTombstoneYield/decidePurge/decideLocalTombstone + rowToLocalState |
| 上传决策 | `src/core/decideUpload.ts` | skip-fast |
| 锁合并 | `src/core/syncDecision.ts` | mergeLockState |
| 协议工具 | `src/core/syncUtils.ts` | parseLakeManifest/isGzip/objectKey 等 |
| 纯 JS SHA-256 | `src/core/sha256Sync.ts` | 无 node:crypto，两端通用 |
| **共享同步编排** | `src/core/syncEngine.ts` | 端口注入式，3 单测 |
| 回收站树查询 | `src/core/trashRepository.ts` | WITH RECURSIVE |
| 通用工具 | `src/core/storeUtils.ts` / `assetUrl.ts` | 资源引用提取/路径安全；本地图片 URL 解析 |

### 2.3 移动端脚手架已合入 master（`e0c5a25`）

- `android/`：Capacitor 8.5 Android 工程
- `src/mobile/`：执行壳（bridge/sqliteDb/s3Store/capacitorHttpHandler/persistence/MobilePocApp）
- `capacitor.config.ts` + `vite.mobile.config.ts` + `mobile.html` + `scripts/android-build.sh`
- `docs/MOBILE-TECH-STACK.md`（技术栈定稿）

### 2.4 共享编排 syncEngine 已合入 master（`54d5ef3`）

对齐 master 决策接口：sha256Sync 同步化、reconcileLakeNote 补时间维度字段、SyncDbPort 补 lastSyncedMetaAt、randomUUID 兼容 Web/Node。

**测试基线：529 passed + 1 skipped**（桌面 0 回归）。

---

## 3. 当前状态与问题

### 3.1 当前分支

- `feat/mobile-android`（基于 master `54d5ef3`，与 master 完全一致，无未提交改动）
- 本地只剩 `master` + `feat/mobile-android`（其他分支已清理；`refactor/mobile-capacitor` 已删本地，远端仍留）

### 3.2 双端测试实例仍在运行（可关可留）

- DEV 窗口（B 端）：CDP 9222，userData `~/Library/Application Support/lake-notes-dev`
- TMP 窗口（A 端）：CDP 9223，userData `$TMPDIR/lake-device-b`
- S3 配置：七牛 `s3.cn-north-1.qiniucs.com`，bucket `local-lake-hebei`，prefix `ab-test-verify`，AK/SK 见 DB settings 表

### 3.3 关键认知（防止新会话走偏）

**同步传的不是 sqlite 文件，是"语义数据"（manifest JSON）**。S3 上只有三类：
- `manifests/latest.json`（笔记元数据 + folders 分组排序）
- `objects/{noteId}-{contentHash}.lake`（正文，内容寻址）
- `assets/{noteId}/{filename}`（图片资源）

两端各自有 sqlite 本地状态，通过 manifest 交换"谁有什么、什么版本"。**移动端不碰桌面的 sqlite**；"表结构一致"= 复用查询代码（noteQueries 的 SQL），不是复用数据库文件。

---

## 4. 下一步计划（按定稿方案执行）

定稿方案文档：**`/Users/admin/file/local-lake/doc_share/MOBILE-ANDROID-PLAN-2026-08-22.md`**（已定稿，含 GPT 多轮审计修正）

### Phase 0（P0 硬前提，跨端互通）
| 项 | 内容 |
|---|---|
| D1 | **S3Store.getObject 端口字节化**（返回 `Uint8Array \| null`，gunzip 在端口内完成，core 无 gzip） |
| D2 | **manifest 校验**（读链：端口解压 → `parseLakeManifest(bytes, limits)`，弃裸 JSON.parse） |
| D3 | **决策对齐**（syncEngine 改调共享 decide*/buildUploadEntry/buildTombstoneEntry/computeBookkeeping/rowToLocalState，不复刻手写旧逻辑）——B1 软删↔purge 编码最致命（当前 syncEngine 软删写 deleted:true 会被桌面当永久删除） |
| D3.5 | **语义等价验证**（扩展 syncEngine.test.ts 表驱动覆盖 B1-B4/D4/D8/D9；可选双路径等价测试：同场景跑桌面 sync.ts vs core syncEngine 断言终态一致） |
| D9+ | **LocalNoteRow 补 isLocked/lockedAt/icon/isConflict**（与 D3 同批，防中间态锁漂） |
| D4 | **folders 同步**（SyncDbPort 加 folder 口，当前仅透传 remote.folders） |

### Phase 1（功能）
| 项 | 内容 |
|---|---|
| D5 | 历史快照最小留档（协议 §4.2 强制，完整 UI 后置 PAD 阶段） |
| D6 | noteQueries/searchRepository 下沉共享（**落地前确认 sql.js WASM 是否带 FTS5**，否则搜索退化 LIKE） |
| D7 | 顺手下沉（imageUtils/asyncPool/lakeCaches/storeLimits/storeErrors，均已核实零 node 依赖） |
| D8 | 资产/图片下载 + blob 注入（"看笔记"硬指标；上传方向后置 PAD 阶段） |

### Phase 2（后置，桌面专属）
GC / 导出 / 资源服务器 / 自动快照定时器 / 完整历史 UI / D8 上传方向 / 移动端 manifest prune。

### 落地细节（§1.6）
- F1 sql.js FTS5 支持待确认
- F2 资产落地口：下载循环内另落盘 + 端口加资产落地口，不改 applyRemoteNote 通用语义
- F3 移动端 manifest 不修剪，Phase 2 补 prune 或明确接受

---

## 5. 踩过的坑（重要，避免重蹈）

### 同步语义（桌面重构期沉淀）
1. **B 无编辑跟随更新不留档**：superseded 只该在"本机编辑成果被覆盖"时触发——判据 = `localChanged || localHash === lastUploadedHash`
2. **循环移动**（A 把 999 放 888 下、B 把 888 放 999 下）：必须结构环检测（本地 parent 在远端树中位于本节点之下 → 跟随远端打破环），先提交先确认
3. **deletedFromParentId 会被 importRemoteNote 的 ON CONFLICT UPDATE 覆盖成 null**（不传=null）→ B 恢复回退默认笔记本。传参必须带上
4. **软删 vs purge 编码**：软删 = `buildUploadEntry`（parentId=TRASH + trashedAt，**无 deleted:true**）；仅 purge 用 `buildTombstoneEntry`（deleted:true）。混用 = 普通删除变永久删除
5. **lastUploadedHash 只在本机真正上传时更新**（skip-fast 纯跟随不更新），否则纯跟随被误判"本机是作者"误留档
6. **元数据 LWW**：正文相同也要对账（标题/父目录/锁/图标），用 lastSyncedMetaAt 时间判据

### 架构/共享层
7. **共享层纯逻辑**：`src/core/` 不 import electron/better-sqlite3/fs/node 专属；gunzip 等 node 依赖留在端口/adapter 层
8. **不搞两套逻辑**：syncEngine 必须改调共享 decide*，不复刻手写（旧 mobile-capacitor 的教训——两套逻辑并存持续漂移）
9. **字段不透传即丢失**：锁/图标/冲突标记等协议字段必须随 LocalNoteRow/SyncDbPort 透传，不得因"移动端不展示"丢弃

### 环境/构建
10. 命令：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`；`npx tsc --noEmit`；`npm test -- --run`
11. electron bin 缺失（allow-scripts）→ 从主仓库复制 `dist/Electron.app`
12. 同步编排在 **Electron 主进程**（dist-electron/main.js），改逻辑后必须**重启 electron**，reload 只刷渲染层
13. 移动端构建（PHONE-HANDOFF §6）：CSP 需 `'unsafe-eval'`（sql.js WASM）+ 七牛 S3 connect-src；JDK 21；gradle wrapper 缓存；内部 npm registry 不可达 → 项目级 .npmrc 切 npmmirror
14. **不要 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae），kill 具体 PID

### 测试
15. FakeStore 的 `new Date()` 在同毫秒内相同会破坏 reconcile 时间判据 → 已用单调时钟 `nowIso()`（sync.test.ts）
16. 改 sync.ts 后必须重启双端（bash 后台任务管理，job_output 收集）

---

## 6. 相关文档索引

| 文档 | 位置 | 用途 |
|---|---|---|
| **移动端定稿方案** | `doc_share/MOBILE-ANDROID-PLAN-2026-08-22.md` | **下一步执行的唯一依据**（D1-D9 + 端口清单 + 顺序 + 红线） |
| 移动端扫描报告 | `doc_share/MOBILE-ANDROID-AUDIT-2026-08-22.md` | 拆分缺口扫描 |
| GPT 复查 | `doc_share/MOBILE-ANDROID-AUDIT-2026-08-22-REVIEW.md` | B1-B4/P0 核实 + 可复用候选 |
| 手机端交接 | `PHONE-HANDOFF.md` | 技术栈/踩坑/下一步（§9 Step E 移动端接线） |
| 同步拆分变更 | `doc_share/SYNC-SPLIT-CHANGES-2026-08-22.md` | 本次全部修复记录（§6-9） |
| 多端联调手册 | `PHONE-HANDOFF.md` §10 | 双实例启动/CDP 驱动/踩坑速查 |
| 技术栈定稿 | `docs/MOBILE-TECH-STACK.md` | Capacitor/sql.js/S3 传输选型依据 |

---


## 6.5 新增：同步难逻辑共享（syncPerf，2026-08-24）

用户确认方案：**共享"难逻辑"纯函数，不共享编排骨架**——编排是入口各自实现，底层决策逻辑单点（改一处两端生效）。

### 已落地
| 纯函数 | 文件 | 抽取自（桌面） | 接入 |
|---|---|---|---|
| shouldSkipZeroChange（零变更早退判定） | src/core/syncPerf.ts | electron/sync.ts 零变更早退 | 桌面 sync.ts 早退条件替换 ✓；共享 syncEngine 早退 ✓（移动端白得） |
| isRemoteDescendant（目录循环移动环检测） | 同上 | sync.ts 环检测定义 | 桌面调用处补传 remoteParentMap ✓；syncEngine 元数据对账接入 ✓ |
| createSupersededTracker（superseded 去重） | 同上 | sync.ts pushSuperseded | 桌面 pushSuperseded 代理 ✓；syncEngine remote-wins 收集 → report.supersededNotes ✓ |

### syncEngine 本次新增能力（移动端同步行为对齐桌面）
- 零变更早退：manifest 拉取后 shouldSkipZeroChange → 整轮跳过（不重写 manifest/不逐条记账）
- 记账基线：同步结束写 lastSeenCommitId + tombstone 签名（此前从不写，早退永不生效）
- 结构环检测：remoteParentMap + isRemoteDescendant（本地移动与远端已提交移动互成父子 → 强制跟随远端）
- superseded 收集：SyncReport 新增 supersededNotes 字段（对齐桌面 SyncResult）

### 测试
- src/core/syncPerf.test.ts（10 项：四条件早退/环检测含防环/去重）
- src/core/syncEngine.test.ts 新增 2 项（零变更早退 + 结构环检测），14 项全绿
- 全量 550 passed | 1 skipped（桌面零回归，tsc 通过）

### 遗留（下一步）
- 移动端真机验证本次 syncEngine 改动（2026-08-24 手机离线：WiFi 断、蜂窝数据关、adb 无法开启 → 同步验证待网络恢复；app 已装新构建，页面正常）

---

### 真机验证（2026-08-24，已完成）
- 移动端零变更早退生效：无改动二次同步显示「零变更跳过（20 条）」
- 有待上传笔记 → 不早退：新建+保存后同步「拉取 20 条，上传 1，发布 是」
- 上传后再次同步 → 早退恢复：「零变更跳过（21 条）」
- 修复：移动端 folders 表缺 sync_state → hasLocalPendingNotes 把默认笔记本等已同步目录误判待上传（永不早退）；已加列（默认 'synced'）+ importRemoteFolder 写 synced + 判定改 sync_state != 'synced'（对齐桌面 tree_nodes.sync_state）

### 遗留（下一步）
- 存储升级 Capacitor Filesystem（B1）、同步共享化第二阶段（C3/H2/H4/H5/M1-M6 部分）、复制到微信（B3）

---

### H3 真机验证（2026-08-24，已完成）
- 注入图片资产 → 同步 → S3 assets/{noteId}/{file} 对象已上传，manifest.assets 含 filename/size/hash（真机实测 2 个资产）
- 修复：移动端 saveNote 未置 sync_state='local'（UPSERT 漏列）→ 本地编辑永不触发上传（同步早退跳过）；已修复 + tsc + 550 测试全绿

### 遗留（下一步）
- 存储升级 Capacitor Filesystem（B1）、同步共享化第二阶段（C3/H2/H4/H5/M1-M6 部分）、复制到微信（B3）

---

### B1 存储升级 Capacitor Filesystem（2026-08-24，已完成）
- src/mobile/assetFs.ts：Filesystem 读写（base64 语义按 Android 原生确认：不传 encoding 默认 base64 解码）
- bridge.ts：saveAsset/init 恢复/uploadResource 落盘全部切 FS（目录 note-assets/{noteId}/{file} 与桌面一致）
- 一次性迁移：init 时 IndexedDB 旧资产 → FS（幂等，缺失才搬）
- 真机验证：落盘 ✅、重启持久化 ✅、旧资产迁移 ✅、重启后 blob 渲染 2154×1320 ✅
- **用户定稿：移动端不做原生 HTTP 资源服务器**（思源是 Go 后端起 HTTP，技术栈不同不照搬）——参考思源仅看存储：资产落原生文件系统；显示保持 blob 注入（见 doc_share/ASSET-URL-MOBILE-PLAN.md §8）
- 测试：550 passed 零回归

### 遗留（下一步）
- 同步共享化第二阶段（C3/H2/H4/H5/M1-M6/Step4/Step5 部分）、复制到微信（B3）

---

### 同步共享化第二阶段（2026-08-24，共享层补全）
- H5：syncEngine 远端墓碑压本地编辑（trash-cross）→ 本机编辑成果留档 + superseded（对齐桌面 sync.ts:427-441 mOwnEdit 判定；纯跟随不留档）+ 测试 3 场景
- M6：发布时 notes 按 sortOrder 排序 + folders 从本地发布（SyncDbPort 加 listFoldersForSync，桌面/移动端/测试三端实现）+ 测试
- M4：单对象大小上限（S3Store.getObject 加 maxBytes，正文 64MiB/资产 25MiB 对齐桌面）+ 移动端 HTTP 传输超时（connectTimeout/readTimeout：Get/Put 120s、其余 30s 对齐桌面）
- 核对已具备：C3（parseLakeManifest 20MiB 上限已下沉）、H2（s3Store gzip 魔数已实现）、H3（assets 端口已真机验证）、H4（folders 端口 importRemoteFolder/listFoldersForSync）、M1（锁/元数据 LWW 幂等短路）、M2（恢复例外）、M3（零变更早退+sql.js 内存库无 N+1 压力）
- 测试：syncEngine.test.ts 16 项全绿；全量 552 passed 零回归

### 遗留（下一步）
- 真机验证阶段二共享层改动（构建后同步回归）、Step 5 双端 A/B、复制到微信（B3）

---

### 复制到微信（B3，2026-08-24，已完成）
- clipboardHtml.ts 加移动端分支：blob 注入的已解码图片（src=blob: + complete）→ canvas 同步转 PNG data URL（微信不渲染 webp/avif，对齐桌面 assetServer ?base64=1 sharp）
- 判定：window.lakeNative.uploadResource 存在 = 移动端；桌面 XHR 路径零改动
- 测试：+2 项（jsdom mock canvas），clipboardHtml.test.ts 17 项全绿
- 真机验证：复制事件输出 text/html 含 data:image/png;base64（2154×1320 图 → 1.9MB PNG）✅

## 8. 安卓底层存储机制四步全部完成（2026-08-24）
| 步 | 内容 | 状态 |
|---|---|---|
| ① | H3 上传资产进 manifest 同步 | ✅ 真机验证（manifest.assets + S3 对象 + saveNote sync_state 修复） |
| ② | 存储升级 Capacitor Filesystem（B1） | ✅ 真机验证（落盘/重启持久化/旧资产迁移/blob 渲染） |
| ③ | 同步共享化第二阶段 | ✅ H5 trash-cross 留档、M6 排序+folders 发布、M4 上限+超时（真机验证 folders/排序） |
| ④ | 复制到微信（B3） | ✅ 真机验证（canvas → PNG data URL） |
测试基线：554 passed | 1 skipped（桌面零回归）

### 遗留（后续可选）
- 桌面 sync.ts 完全收敛到共享 syncEngine（用户已定稿：不共享编排骨架，只共享难逻辑——已完成 syncPerf）
- 双端 A/B 真机完整验收（桌面↔手机同 S3 prefix 互读）

---

### B3 转换策略决策（2026-08-24，维持现状）
- 用户拍板：维持「复制时 canvas 转 PNG」现状，不做懒缓存、不做下载转 PNG
- 讨论过「下载时直接转 PNG」：若不考虑历史兼容，hash/上传污染会自我收敛，但仍与 canonical 固定（filename=原始扩展名）+ 桌面零改动冲突；用户确认暂不处理
- 后续待另一会话单独讨论：桌面端 assetServer 承担 webp→PNG 转换逻辑（?base64=1 sharp），想去掉——涉及桌面复制/导出路径改造，非本会话范围

---

### Step 4 等价测试（2026-08-24，完成）
- 新文件 electron/syncEquivalence.test.ts：7 场景表驱动——同一场景输入分别驱动桌面 sync.ts（真实 Store+MockS3）与共享 syncEngine（MemDb+MemS3），断言发布 manifest 与本地终态语义等价（忽略时间戳，比较 id/title/parentId/sortOrder/trashedAt/deleted/锁/图标）
- 场景：首次上传 / 远端下载（含锁/图标）/ 远端墓碑 / 正文冲突 superseded / purge / 恢复例外 / 零变更早退
- **抓到并修复 2 个 syncEngine 真实语义差异**（等价测试价值验证）：
  1. purge 后 manifest 移除条目：桌面发布 manifest 不含 purged 笔记（云端删除完成不再携带）；syncEngine 保留远端 deleted 条目 → 修复：收集 purgedIds，发布时 filter 移除 + purged 存在时也强制发布
  2. 恢复例外跳过远端墓碑：桌面 trash-cross skip-restore-pending 直接 continue（恢复中不被压回回收站）；syncEngine 幂等分支会把远端墓碑 parentId 压回 TRASH → 修复：remoteTrashed && localRestoring → continue
- 测试：7 项全绿；全量 561 passed | 1 skipped（桌面零回归）

### 遗留（下一步）
- 桌面 Controller 化（Step 5）：sync.ts 缩为薄 Controller 调 syncEngine + GC/历史/进度接线（等价测试已证明语义一致，切换风险已大幅下降）

---

### Step 5 桌面 Controller 化（2026-08-24，完成）
- 新增 electron/syncAdapters.ts：createS3StoreAdapter（ObjectStore → S3Store，剥离 prefix 避免双写）+ createStoreSyncPort（Store → SyncDbPort，contentHash 避免读文件算 hash）+ syncConfigFromStore
- 新增 electron/syncEngineController.ts：syncNowViaEngine —— 核心编排用共享 syncEngine，桌面保留特有收尾（GC 差集标记 onPublished / purge 前缀删 / 进度阶段映射 / warnings 结构化 / markSyncComplete / recordSyncResult）
- syncEngine 增强：LocalNoteRow.contentHash 可选（桌面 adapter 提供）、SyncNowOptions.onPublished（发布后暴露 next/prev 供 GC）
- 主流程切换：electron/main.ts 手动同步 syncNow → syncNowViaEngine（原 syncNow 保留导出，测试仍覆盖它）
- 测试：electron/syncAdapterEquiv.test.ts（4 场景：桌面 Store+adapter+engine == 桌面 sync.ts）全绿；全量 566 passed | 1 skipped

### 遗留（下一步）
- 双端真机 A/B 验收（桌面新 Controller ↔ 手机 syncEngine 同 S3 prefix 互读）
- 移动端 PAD 编辑阶段 / 桌面 assetServer webp→PNG 去留（另一会话）

---

### Step 5 双端 A/B 验证（2026-08-24，完成）
- 新增 electron/syncDualAB.test.ts：桌面 Controller（syncNowViaEngine）↔ 移动端（MemDb+syncEngine）共享同一内存 S3（真 S3 语义），模拟真实跨端：
  - A 建笔记同步 → B 拉到 → B 编辑同步 → A 拉到 → 收敛（第三次 A 零上传）
  - A 删除同步 → B 跟随删除（墓碑传播）
- 全量 567 passed | 1 skipped

## 8. 同步共享化全部完成（2026-08-24）
| 阶段 | 内容 | 状态 |
|---|---|---|
| Step 3 | 桌面 adapter（syncAdapters.ts：ObjectStore→S3Store / Store→SyncDbPort） | ✅ |
| Step 4 | 等价测试（syncEquivalence 7 场景 + syncAdapterEquiv 4 场景）——抓到并修复 purge manifest 移除、恢复例外 2 个真实差异 | ✅ |
| Step 5 | 桌面 Controller（syncEngineController.ts：syncNowViaEngine）——核心编排 syncEngine + GC 标记/purge 删/进度/warnings/记账收尾；main.ts 主流程已切换 | ✅ |
| 双端 A/B | syncDualAB 真 S3 语义互读（建/编/删传播收敛） | ✅ |
测试基线：567 passed | 1 skipped；桌面 sync.ts 原 syncNow 保留导出（测试仍覆盖）

### 遗留（后续可选）
- 移动端 PAD 编辑阶段；桌面 assetServer webp→PNG 去留（另一会话讨论）；真机双端 A/B（手机已断开 adb，逻辑等价已由 syncDualAB 覆盖）

---

### Step 5 迁移收尾（2026-08-26，完成）——结构修复 + 类型清零 + 全量验证

> 背景：上一轮迁移在改 syncEngine.ts 时引入**两个纯结构 bug**（非语义问题），导致 oxc/rolldown 转换失败、全部同步测试无法运行；修复过程一度误判为"oxc 不兼容语法"，最终用 AST 定位为括号失衡。

**结构 bug 修复（src/core/syncEngine.ts）**
1. L453 多余 `}` 提前闭合 syncNow：约 200 行（上传/发布/记账）被甩出函数 → 删除后函数正确延伸至 L658
2. 下载循环被调试块提前闭合：`for (const rn of remote.notes) {` 循环体只剩 `console.log("[DL-DBG]"...)` 3 行，整个下载逻辑（含所有 `continue`）在循环外 → 报 Illegal continue statement → 删除调试块 + 补循环闭合

**23 个 tsc 类型错误清零**
- syncEngine.ts：SyncDbPort.markSyncedIfUnchanged 的 lastUploadedHash 改 `string | null`（下载对账收尾传 null 的合法化）；folders 发布 nodeType 联合类型 cast
- syncAdapters.ts：localHashOf 从端口对象提取为独立函数（适配器内部辅助，非 SyncDbPort API）
- syncEngineController.ts：ObjectStore 从 `import type` 改为值导入（默认参数 new ObjectStore）
- syncEquivalence / syncAdapterEquiv 测试：种子 `store.markSyncedIfUnchanged` 改对象形式（用真实行值保证条件更新成功）+ createNoteInAtTopWithContent parentId 非空（defaultNotebookId 回退）+ ScenarioNote 补 updatedAt
- syncDualAB / syncEquivalence 的 MemDb：补 localTrashNote / localRestoreNote
- syncDualAB：ObjectStore/S3Settings 改从 sync.js 导入（controller 不导出它们）

**循环移动语义确认（用户关切）**：先提交先确认、**接受远端**——syncEngine L408-418 isRemoteDescendant 结构环检测强制跟随远端打破环，即使本地 updatedAt 较新；纯结构移动（内容 hash 相同）不触发留档。对应 sync.integration.test.ts 循环移动用例断言（B 跟随 A 的树）。

**验证结果**
- `npx tsc --noEmit`：0 错误
- 同步套件 8 文件 144 项全绿：syncEngine 18 / sync 54 / sync.integration 17（含循环移动）/ syncEquivalence 7 / syncAdapterEquiv 4 / syncDualAB 2 / syncDecisions / lakeReconcile
- 全量 `npm test -- --run`：**569 passed | 1 skipped，桌面 0 回归**（与迁移前基线一致，sync.test.ts 54 项原断言不改全绿 = 桌面语义不变的最强证据）

**测试种子说明**：等价/适配器测试的 synced 种子改为真实生效（此前静默失败、lma 保持 null）；因等价断言只比终态语义（忽略时间戳），种子修正不影响测试结论。

---

### 实机多端验证（2026-08-26，三端全流程）——抓到并修复迁移回归 bug

**环境**：桌面 A（TMP 9223）+ 桌面 B（DEV 9222）+ 手机（小米 50950385，webview CDP 9295）。S3 prefix ab-test-verify（三端同 prefix）。adb 在 /opt/homebrew/share/android-commandlinetools/platform-tools/adb；手机 CDP 转发必须是 adb forward tcp:9295 localabstract:webview_devtools_remote_<pid>（不是 tcp:9295 tcp:9295）。驱动工具 scripts/cdp-util/cdp-eval.sh <port> '<js>'（自动包 async IIFE）。

**流程（8 场景全过）**：① A 建笔记首传 → ② B/手机下载 → ③ B 编辑 → A/手机拉到 → ④ 手机建笔记 → 桌面拉到 → ⑤ A 删笔记本 → B/手机跟随回收站 → ⑥ B 恢复笔记本 → A 传播 → ⑦ A 删笔记 → 手机消失 → ⑧ 三端零变更早退（手机显示"零变更跳过（6 条）"）。循环移动（A 移 2→1 下、B 移 1→2 下，A 先同步，B 跟随 A 树）+ 正文冲突（B 接受远端 vA + vB 强制留档，快照内容实读确认 vB）均通过。

**抓到并修复的真实迁移回归（测试未覆盖）**：**删笔记本不传播**——syncEngine 发布条件（uploadQueue.length > 0 || purgedIds.size > 0）不含 folders 变更（旧 sync.ts 每次同步无条件发布 manifest，folders 带 trashedAt）；删笔记本后 uploadQueue 空 → 不发布 → 目录记账 markFolderSynced（无 trashed 过滤）把回收站笔记本 sync_state 抹回 synced → 删除变更永久丢失。且 hasLocalPendingNotes 被抹后零变更早退直接跳过（修复发布条件也到不了）。
- **修复（两层）**：① 早退判定前计算 foldersChanged（本地 folders 与远端 folders 语义差异对比：title/parentId/sortOrder/nodeType/icon/trashedAt/deletedFromParentId），早退条件加 && !foldersChanged；② 发布条件加 || foldersChanged（计算提前共用）。
- **防回归测试**：sync.integration.test.ts 新增"删笔记本传播"（A 删笔记本 → B listTrash 跟随 + 再同步不乒乓），18/18 通过。
- 验证：tsc 0 错误；全量 **570 passed | 1 skipped**（+1 新测试，桌面 0 回归）。

**环境备注**：多端验证时 vite.config.ts onstart 临时禁用（已还原为原样，备份已删）；vite dev（1421）与双 electron 实例（9222/9223）验证后仍在跑可自行观察；S3 ab-test-verify 已清空重来（83 个旧对象已删）。

### 实机回归修复：跟随删除被误报 superseded（每次同步重复提示，2026-08-26 已修）

- 现象：用户反馈桌面每次同步都提示「远端修改已覆盖本地 1 篇（手机新建笔记-M1）」——手机并没改、本地也无该文档。
- 根因（ownEdit 误判链）：① B 跟随 A 删除后本地条目 sync_state=local → B 下次同步走「软删上传」→ 发布记账无条件写 lastUploadedHash（误标本机是作者）；② 之后每次同步远端 trashed + 本地 trashed → L492 两端一致 skip 分支调 markLocalNoteSynced(id, contentHash, updatedAt, rn.contentHash) —— 第 4 参传 rn.contentHash 又写 lastUploadedHash；③ ownEdit 判定 `localHash === base.lastUploadedHash` 恒成立 → 每次 createHistorySnapshot + superseded 提示。
- 对比旧 sync.ts：lastUploadedHash 只在「本机真正上传过内容（locallyUploadedIds）」时写；软删/纯跟随/两端一致 skip 都不写。
- 修复：① SyncDbPort.markLocalNoteSynced 的 lastUploadedHash 改 `string | null`，两端一致 skip 记账传 null（=清除误标，对齐旧语义）；② adapter 无条件写（null 走 store.setLastUploadedHash(null)）；③ store.setLastUploadedHash(null) 用 UPDATE SET last_uploaded_hash=NULL（不能用 INSERT VALUES(id,null,null)——SQLite upsert 即使 ON CONFLICT 也触发 content_hash NOT NULL，实测复现）；④ 发布记账对 trashed/deleted 条目不写 lastUploadedHash。
- 防回归测试：sync.integration.test.ts 新增「跟随删除不重复留档」（B 跟随删除后 lastUploadedHash 为 null + 再同步 2 次 superseded 恒空），19/19 通过。
- 验证：tsc 0 错误；全量 **571 passed | 1 skipped**；实机 B 端 M1 lastUploadedHash 从 c9975fd 清为 NULL、superseded 从每次提示变为恒空。


### 代码审计（2026-08-26，同步链路自查）——发现并修复 4 项

| 级别 | 问题 | 修复 |
|---|---|---|
| 严重 | **墓碑上传不携带删除前内容**（迁移回归）：syncEngine 3.5 墓碑块 content 为空串 → 发布循环把 contentHash 覆盖为 sha256(空串) 并上传空对象，删除前内容丢失（违反红线 §3.5「墓碑携带删除前内容」）；现有测试只覆盖下载方向漏网 | 墓碑块改为读一次内容（判空+取值）、content 传真实内容、hash 用内容真实 hash；发布阶段自然上传真实对象。补正式测试（manifest contentHash=真实 hash + S3 内容对象可下载） |
| 中 | **早退日志 remote! 空指针隐患**：空桶首次同步 + 本地无变更的极端组合下 remote!.commitId 会 TypeError | 改 remote?.commitId 兜底 / remote?.notes.length 兜底 |
| 中 | **controller warnings noteId 截断**：split(-)[0] 把 UUID 截成 8 字符，UI 无法定位文档 | 改 split(/)[0] 再去掉 -64hex 后缀（对象缺失去 hash 后缀，资源缺失去 filename） |
| 中 | **移动端记账语义不一致**：bridge.ts 的 markSyncedIfUnchanged/setSyncBase 无条件写 last_uploaded_hash（null 清除）→ 下载对账会误清本机已上传标记，ownEdit 判定丢失作者身份 | 改为 lastUploadedHash 非空才写（null 不写不清，对齐桌面 adapter）；markLocalNoteSynced 保持无条件写（null=两端一致 skip 清除） |
| 低 | syncEngine 接口注释冗余/错位 | 合并 |
| 低 | [decide] 每笔记调试日志（10k 条 = 10k 行） | 删除参数级日志，保留 decision 结果日志 |
| 已知 | getNote 每次读文件（10k 条性能）、as never 强转（applyRemoteNote 等） | 不修：正确性优先 / 测试锁定结构兼容，记录待后续优化 |

验证：tsc 0 错误；全量 **572 passed | 1 skipped**（+2 审计测试，桌面 0 回归）。

### 实机验证后意外：vite dev 停止导致画板不可用（2026-08-26，已恢复）

- 现象：用户报告桌面端画板不能用了（画板文档白板无法使用）。排查：非同步改动导致、非渲染层崩溃（reload 后仅 Katex CSP 旧警告）。
- 根因：vite dev server（1421）被停（多端收尾时还原 vite.config.ts 触发 vite 退出）——桌面渲染层从 dev server 按需加载动态 chunk，画板（Drawnix / lakex-drawnix-react-board）是懒加载组件，vite 停了就拉不到模块 → 画板不可用。
- 修复：重启 vite dev（onstart 保持禁用，避免自动拉起第三个 electron 与 9222/9223 冲突）→ 画板恢复。
- 教训：桌面开发环境 vite dev server（1421）绝不能停——停掉会导致所有懒加载组件（画板等）失效；收尾时不要还原 vite.config.ts 的 onstart（保持禁用），重启 vite 前先确认 onstart 状态。
- 当前状态：vite(1421) 200 / 9222 200 / 9223 200 / 手机 9295 200；vite.config.ts onstart 临时禁用（onstart: () => {}），多端环境验证完后再还原。


---

## 7. 用户偏好（务必遵守）

1. **用户验收前不合并 master、不擅自提交**（当前在 feat 分支，改动先在分支，验收后再合并）
2. **用户自己操作 UI 验证**（多端 A/B 手动测试），agent 只观察日志/DB/CDP
3. 命名对齐：**用户说的 A = TMP 窗口（9223），B = DEV 窗口（9222）**（勿混淆）
4. 当前开发版**不做数据兼容**（用户原话："大不了删除所有数据"）
5. 需要用户确认产品语义时给选项 + 推荐
6. 双端数据目录：A = `$TMPDIR/lake-device-b`，B = `~/Library/Application Support/lake-notes-dev`（只读检查 DB：`workspace-default/metadata.sqlite3`）
