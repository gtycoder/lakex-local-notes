# HANDOFF-260901 · 会话交接：同步性能批次3已落地，下一步 FTS 增量

> 交接自 260831 晚间会话（承接 HANDOFF-260831.md 的 P3-1/P3-3/P4-1 三大项）。
> 本会话已完成 P3-1 + P3-3 全部 + 计划外两项（回收站幂等跳过、UI 增强），合并 master 并推送。
> 写给零上下文的新会话：先读 AGENTS.md（长期记忆）再读本文。

## 0. 当前基线

- **master = 2fd29f3**（合并 perf/sync-batch3），已推送 Gitee；工作区干净
- **质量门槛：750 passed | 1 skipped（751），tsc 全绿，桌面 vite build 全绿**
- 分支已大清理：本地只剩 master；远程只剩 origin/master + origin/main（用户拍板保留）
- 安卓已发版：**versionCode 2 / versionName 1.1**，已装到小米设备（adb id 50950385）
- 上轮遗留三项的完成状态：P3-1 ✅、P3-3 downloadAssets 并发 ✅、P3-3c ✅（之前完成）、**P3-3 快照 gzip 异步化 ❌ 未做**、**P4-1 FTS 增量 ❌ 未做**

## 1. 本会话完成内容（均已合入 master）

### 1.1 P3-1 同步 O(N²)（最高收益项，已落地）

问题：syncEngine 下载环每条远端笔记调一次 `db.getNote`（全表 SQL + 无条件 readFileSync 全文），
validParents/上传环各再 `getAllNotes` 全量读全文，记账方法各自再全表 `.find`。
N=2000、均 50KB → 3-4N 次全文读盘 + O(N²) SQL，同步阻塞秒级-十秒级。

修法（已实现）：
- engine：下载环前 `localById = new Map(db.getAllNotes())` 一次建索引（validParents 共用）；
  上传环前建 `remoteById`（与墓碑环节共用）；manifest 合并用 `nextIndexById`；
  无上传记账分支复用 `localAll` 索引；`contentOf(row)` 按需取正文（仅在留历史快照、上传入队两时刻）
- adapter：`getAllNotes` 改纯元数据 + contentHash（synced 走 baseHash 缓存零 IO，**不再读全文**）；
  `getNote` 与记账三方法走新增的 `store.getNoteForSync(id)` 单行查询
- noteQueries：`getNoteForSync` 单行 SQL + `listNotesForSync` prepared statement 缓存
- 移动端 bridge **零改动**（内存库行自带 content，hash 回退路径依赖它，勿删）

⚠️ 语义关键点（改动时勿破坏）：上传环的 `getAllNotes` 必须在下载环**之后**取（刚应用的笔记
syncState=synced，提前取会回环重传）；三处 createHistorySnapshot 必须走 contentOf 回查真实文件。

### 1.2 P3-3 资产传输并发化

- syncEngine 新增 `runPool`（定长 4 车道并发池，无 node: 依赖，双端共用）+ `ASSET_CONCURRENCY = 4`
- 上传 `scanLocalAssets`（HEAD+PUT）与下载 `downloadAssets` 均并发 4 路
- 确定性保证：worker 不抛错，结果按**索引归位**后再统一裁决——warnings 按原顺序入列、
  首个错误按原顺序抛出、字节数按索引累计，与旧串行行为逐字节一致
- strict 模式首错后 `aborted` 停止落盘，防"笔记没导入但资产写一半"的孤儿目录
- 实测：107 项首传（106 资产 58MB）从 20.2s → 预期约 5s；稳态 HEAD 巡检 <1s

### 1.3 P3-3b 回收站幂等跳过（计划外发现，收益大）

**缺陷**：下载环 trash-cross 分支缺"hash 等值跳过"（正常对账分支有）。本地已在回收站且内容
与远端一致时，**每轮有变更的同步都会重拉该文档正文 + 全部资产**。日志实锤：B 端对同一 hash
对象重复下载。用户"批量删除频繁"，删一次笔记本 = 之后每轮重拉数十 MB（18:08 A 端 8.6s 即此）。

**修法**（syncEngine trash 分支开头）：`local !== null && localTrashed && local.contentHash === rn.contentHash
&& local.updatedAt >= rn.updatedAt` → 只 setSyncBase 记账，跳过下载。hash 不同（回收站内编辑 S4）
或墓碑时间更新（回收站元数据变更）仍走完整路径，语义等价。

### 1.4 UI 两项

- 同步弹窗：上次同步行追加**耗时**；新增**移入回收站 n 文档**行（仅 >0 显示）。
  数据链：SyncReport 新增 trashedDown/trashedUp → controller 组装 durationMs/trashed → 持久化 → popover
- superseded 留档提示：**删除 12s 自动消失定时器**（用户投诉来不及看）；改为会话内合并去重
  （按 noteId 去重，上限 10 条），重启后从 lastResult 恢复（原有逻辑）

### 1.5 其他

- 分支清理：本地 6 个已合并分支 + 远程 6 个（含 backup/20260819、refactor/mobile-capacitor POC）删除；
  origin/main（7/21 项目基线）按用户要求保留
- 安卓 v1.1 构建（见 §4 流程）

## 2. 当前已知问题 / 待观察

1. **安卓同步报错 = DNS 解析失败**（UnknownHostException，logcat 实锤），是设备网络问题非代码问题；
   联网重试即可。若复现且网络正常，再查 CapacitorHttpHandler
2. **回收站首拉成本**：墓碑携带内容语义 → 接收端首次拉批量删除仍要下载全部正文+资产
   （9.4s 那次）。方案一已消除重复拉，但首拉这一次还在。惰性下载方案（方案二/三）已讨论
   未做——要动恢复红线（恢复上传时 scanLocalAssets 资产不全 → manifest.assets 缺失 → 他端误删资产），
   用户暂缓，观察实际体验再定
3. **笔记本新建跨端撞号**：各端独立分配 sort_order（B 新建列表短 → 号小 → 排最前）。
   排序本身**是同步的**（拖动 → updated_at bump → manifest.folders → 对端 LWW 应用）。
   可选优化：新建取同级 max+1（未做）
4. `android/local.properties` 已建（sdk.dir=/opt/homebrew/share/android-commandlinetools），
   已 gitignore 不入库

## 3. 下一步计划（按推荐顺序）

1. **快照 gzip 异步化**（小改动，先做）：`electron/store.ts` 搜 gzip——15min 自动快照的 gzip
   在主进程同步执行。改 `zlib.gzip` 异步 → 回调内事务写 INSERT（**时序不能反**：先异步压缩，
   回调里再事务写库）
2. **P4-1 FTS 启动全量重建 → 增量**（交接文档最后一个大项）：现状每次启动 DELETE 全部 FTS +
   逐条重插（src/core/searchRepository.ts 约 L65-88），缺 text_cache 的文档逐篇读盘转换。
   修法：FTS 表加 `UNINDEXED updated_at` 列或旁表记账，启动只重建缺失/过期条目。
   **可动 FTS schema**（lake-notes-dev 可删重建，无迁移负担），搜索语义不变
3. 笔记本新建序号 max+1（小甜点）
4. 回收站惰性下载（暂缓，见 §2.2）

## 4. 环境与命令（本会话实测有效）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit && npx vitest run && node node_modules/vite/bin/vite.js build   # 验收三门槛

# 安卓构建（本会话踩坑后完整流程）：
#   JDK 必须用 21（系统默认 JAVA_HOME 是 1.8，AGP 要求 ≥11）：
export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
#   SDK 不在 ~/Library/Android/sdk（不存在！），在 homebrew：
#     sdk.dir=/opt/homebrew/share/android-commandlinetools   （android/local.properties，已 gitignore）
npx vite build --config vite.mobile.config.ts   # 产出 dist-mobile
npx cap sync android
cd android && ./gradlew assembleDebug           # apk: android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk   # adb 在 /opt/homebrew/bin/adb
```

日志位置：A 端 `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；
B 端 `$TMPDIR/lake-device-b/logs/lake-notes.log`（多开 B 端命令见 AGENTS.md §6）。

## 5. 踩坑记录（本会话新增 + 重申关键）

### 本会话新踩
1. **gradle 用 Java 8 跑不起来**（"requires at least JVM runtime version 11"）→ 必须
   `export JAVA_HOME=.../jdk-21.jdk/Contents/Home`
2. **Android SDK 真实路径**是 `/opt/homebrew/share/android-commandlinetools`，不是
   `~/Library/Android/sdk`（后者不存在，adb 其实来自 /opt/homebrew/bin/adb）
3. 终端 heredoc 脚本会被回显干扰（中文/引号多时命令串位）→ 复杂脚本先 Write 成 /tmp/*.py 再执行
4. S3 perf 日志里 head/put-stream 行尾的数字是 **epoch 时间戳**不是耗时；算各操作耗时要按
   相邻日志行时间差
5. sqlite 检查用 python3（better-sqlite3 是 Electron ABI，系统 Node 加载不了）——AGENTS.md 旧坑，本会话再次用到

### 重申（违反即返工，全文见 AGENTS.md）
- `src/core/` 禁 node: 导入；平台差异走端口注入
- 本地是真相，S3 只是镜像；不改同步协议语义、不改 DB 写入行为（本会话 P3-3b 是"跳过无意义的重复下载"，语义等价，不算改协议）
- 数据目录只用 lake-notes-dev；绝不碰 lake-notes-electron 正式数据
- 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`
- 永不为旧数据写兼容/迁移代码；能删重建就删重建
- 不擅自合 master——本批已获用户验收合并（2fd29f3），下一批改动走新分支

## 6. 给新会话的开工清单

1. 读 AGENTS.md + 本文 + docs/TODO.md
2. `git status` / `git log --oneline -3` 确认 master = 2fd29f3
3. 从 master 拉新分支（建议 `perf/fts-incremental`）
4. 按 §3 顺序：先 gzip 异步化（小），再 P4-1（中）
