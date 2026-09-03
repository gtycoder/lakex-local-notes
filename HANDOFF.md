# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（项目长期记忆/红线，务必遵守）→ 相关 `docs/`。
> 历史所有 `HANDOFF-日期.md` / `Electron-HANDOFF` / `PHONE-HANDOFF` 已合并进本文件并删除（内容在 git 历史可查）。
> 本文件只保留**当前状态 + 真正的待办 + 有价值的坑**；过期/已完成的不再罗列。

## 0. 当前基线（新会话开工前）
- 分支/远端：开发主干 `master` ↔ Gitee `origin`（SSH：`git@gitee.com:gtycoder/local-lake.git`；`master` 亦是远程默认分支）同步。
  **本文不固定 commit hash**——查 `git log -1 --oneline`。
- 质量门槛：`tsc` 0 error · `vitest` **762 passed / 15 skipped** · 桌面 `vite build` + 移动 `vite build --config vite.mobile.config.ts` 全绿。
- 本地业务分支只有 `master`（其余已合并/删除；`origin/main` 为旧 Tauri 遗留引用）。**另有一个在途 worktree（2026-09-03 本会话新发现，此前未记入交接）**：
  `/Users/admin/file/local-lake/lake-notes-wt-android`（`feat/android-mobile-editing`，HEAD 是 `master` 的祖先、**无独有 commit、改动全部未提交**）——
  内容是安卓端远程图片/粘贴收口：新增 `src/core/remoteAssetGuard.ts`（渲染层共用的协议+字面私网 host 闸门、`filenameFromUrl`）、
  `src/mobile/remoteFetch.ts`（CapacitorHttp/OkHttp 原生下载远程字节，绕 WebView CORS）+ 3 个测试文件；
  改 `src/features/editor/resourceUpload.ts`（`isDesktop()` → 能力探测 `window.lakeNative?.downloadRemoteResource`）、
  `src/mobile/bridge.ts` + `MobileApp.tsx`（挂 `downloadRemoteResource`）、`src/mobile/main.tsx`（**移动端补挂 `installPasteInterceptor`**）。
  ⇒ 正对 §3.6 与「粘贴远程图片丢失」；**该 worktree 门禁未跑、未经用户验收**，接手时先决定「继续推进」还是「丢弃重建」。
- 最近这一整轮（260902→260903）主线：**语雀 bookmark 卡修复 + S3 同步性能优化 + 两处 bug 修复 + 压测**，已全部合入 master。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron+React+better-sqlite3+语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。

## 2. 本轮已完成（均已在 master）
### 2.1 两个 bug（用户报）
- **#1 同步凭空长「未分类」笔记本**：`syncEngine` 下载阶段原来**无条件**调 `defaultNotebookId()`（本地无笔记本即建「未分类」并上传），
  改为**惰性** `resolveDefaultNotebook()`——仅当某笔记**真正回落到兜底父**时创建（本轮至多一次），且冲突探测等"最终不应用"的路径不解析。
- **#2 小记偶发删不掉**：桌面小记是"乐观删除 + 5 秒撤销窗口（到期才落盘）"，同步完成的 `refresh()` 会把窗口内那条重新拉回列表、且单条 pending 挡住再点删。
  修：`deleteQuickNote` 幂等（已不存在不抛 NotFound）+ `refreshItems` 过滤撤销窗口内那条。移动端小记是即时软删、无此竞态，未动。

### 2.2 S3 同步性能（对齐思源 dejavu：远端清单声明差集，去掉逐对象探测）
- **上传差集** `scanLocalAssets`：存在性以「刚下载的远端清单已声明该资产」为准（发布先对象后清单 + GC 只删未被在留清单引用的键 + 年龄保护 ⇒ 声明即存在），
  只 PUT 缺失者；**返回仍全量声明**（裁剪声明会致他端 GC 误删在用资产）。删除了 `S3Store.exists?/adapter.exists/ObjectStore.headObject` 整条 HEAD 链路。
- **下载差集** `downloadNoteAssets`：下载前按本地实扫 `size+sha256` 跳过已持有资产（缺失/损坏仍下、strict 缺失仍整条拒绝）。
- **active→trash 差集**：跟随删除时，仅"本地实读正文 `sha256==远端 hash`"才复用本地、否则 GET 权威内容（**加固点**：不盲信 `contentHash`——它对 synced 笔记是 `baseHash` 缓存、不读盘）。
- **并发**：正文对象并发上传 `UPLOAD_CONCURRENCY=4`；**P3-4 跨笔记资产扫描并发** `NOTE_UPLOAD_CONCURRENCY=2 × ASSET_CONCURRENCY=4 = 峰值 8`（对齐七牛建议，原 16 偏高）。
- **manifest 链**：`MANIFEST_CHAIN_KEEP 8→3`（回归设计 D4 的 O(3)）+ `pruneOldManifests` 滞后裁剪（超 target+SLACK 才裁，链回捞退出每同步热路径）；prune/gc-reconcile/deep-cleanup 共用该常量。
- **健壮性**：并发 worker 一律"按索引收集错误、池后抛首个"（无 unhandledRejection）；**资产扫描失败的笔记不 markSynced**→保持 local 下轮重扫（防"空声明发布→GC 误删"）。

### 2.3 压测（opt-in，`LAKE_RUN_BENCHMARK=1` 才跑，CI 默认 skip）
- `src/core/syncEngine.benchmark.test.ts`（Tier A 离线计数）、`electron/syncStress.benchmark.test.ts`（Tier B 真实云，隔离前缀+自动清理+凭证仅环境变量）、
  `src/core/syncEngine.dualStress.benchmark.test.ts`（Tier C 双端 A/B 冲突）。报告 `docs/STRESS-260903.md`。
- 关键实测：元数据 churn 真实云 **18.4s→5.0s→（差集+并发）稳态 <1s**；首传 240 图 HEAD **240→0**；manifest 回捞 **~4.3/发布→~1.25**；双端 600 冲突→600 历史快照、1000 篇回收站传播正确。

### 2.4 知识沉淀
- `AGENTS.md` §3 新增不变量 **#11（清单声明⇒存在：禁逐对象 HEAD/禁陈旧缓存；含两前提：无带外删除、资产按 filename 内容寻址；下载侧对称差集）**、
  **#12（未分类惰性）**、**#13（S3 并发峰值 8）**。审计报告（外部 GPT）在仓库外 `../AUDIT-s3-sync-260903.md`、`../AUDIT-dejavu-alignment-260903.md`。

## 3. 真正的待办（已剔除全部完成项，按优先级）
**性能/健壮性（本轮延续）**
1. 资产/正文 PUT 的**对象级 5xx 重试 + 池 fail-fast**（当前靠 #2.2 的"失败不 markSynced→下轮重扫"兜底，属缓做）。
2. **快照 gzip 异步化**（`electron/store.ts` 搜 gzip：15min 自动快照 gzip 现主进程同步跑；改先异步压缩、回调内事务写库，**时序不可反**）。
3. **P4-1 FTS 启动全量重建 → 增量**（`src/core/searchRepository.ts`：现每次启动 DELETE 全部 + 逐条重插；加 `updated_at`/旁表记账，只重建缺失/过期。可动 FTS schema，dev 可删重建）。
4. **FTS 1/2 字短词搜索回退**（trigram 只索引 ≥3 字符；短词走「标题+正文 LIKE」回退或提示）。
5. 笔记本新建跨端 `sort_order` 撞号（可选：新建取同级 max+1）。

**移动端编辑遗留（未决，需用户给具体现象）**
6. 「电脑剪贴板数据」注入移动端编辑器**不解析/内容为空**（含/不含 base64 图标都为空）——根因未定位。
   **静态线索（未验证）**：`installPasteInterceptor()` 原本只在桌面入口 `src/main.tsx:35` 调用，移动端入口没有，`src/mobile/` 里 paste/clipboard 代码为 0 处
   （bookmark 卡降级仍生效，因为它挂在共享的 `src/features/editor/lakeRuntime.ts`）；另一嫌疑是粘贴含 `data:image/png;base64` 大图标时移动端无远程/图片处理路径。
   android worktree（见 §0）已补挂该 interceptor 并实现原生下载 ⇒ **下一步先在那条线上验证，而不是从零开始**。
7. 移动端本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` **真机不可达**（手机 127.0.0.1 指自己）：需 `adb reverse tcp:19876 tcp:19876` 或移动端解析为可达地址。
8. 用户反馈「移动端整体编辑还有问题」——**现象未细化**，待复现。

**产品/技术债（长期）**
9. 大纲 **viewer（只读）点击标题不跳转**（`OutlineSheet` 用 `headingUnfold`+`scrollByNodeId`，viewer 下静默失效；用户计划重做大纲时一并处理）。
10. **回收站首拉成本**（批量删除后接收端首拉仍下全文+资产）——惰性下载方案**暂缓**（要动恢复红线：恢复上传时资产清单必须全，否则他端 GC 误删）。
11. Word/PDF 导出（`electron/export.ts` 已预留 docx/pdf，待实现）；附件大文件 S3 分片/断点续传（一期后）。
12. **Lake 内核策略**：A lakejs 开源源码当"机制字典"；B 版本锚点 + hack 清单（vendor lakex 已 pin，勿随意升级）；按需最小 patch，**不整体 fork**（拿不到闭源源码）。
13. Store 分批重构（`docs/REFACTOR-PLAN-2026-08-17.md`，按领域继续、严禁一次改事务边界）；移动端复用专项（查询层→文件层/adapter）。
14. W-8 ACAO / W-10 dompurify（并入"lake 资源导入统一优化"）。依赖维护：`@types/better-sqlite3` 可单升。

**非代码**：安卓同步偶发 `UnknownHostException` = 设备网络（联网重试）。

## 4. 踩过的坑（本会话新增；通用红线/环境见 AGENTS.md）
- **文档漂移**（2026-09-03 清理）：`AGENTS.md`/`README.md` 曾长期残留旧分支名 `feat/electron-43-upgrade`、Electron 33/better-sqlite3 11、
  82/188/217 测试计数、"SSH key 未注册必须 HTTPS 推送"、失效的参考仓库路径（`siyuan/`、`local-lake-notes-devlop/`）；`docs/PROGRESS.md` 还被 README 标成"★最新交接"。
  ⇒ 已在 `AGENTS.md` §2 定了分工：**易过期事实（分支/hash/计数/当前焦点）只写 HANDOFF §0**，别把这些数字写回 AGENTS/README。
- **`git worktree list` 要纳入开工检查**：android worktree 的未提交 WIP 曾完全没进交接，几乎导致重复劳动（现已记入 §0/§3.6）。
- **`defaultNotebookId()` 急切调用 = 空库同步凭空建「未分类」并上传扩散**；改惰性后，`effectiveParent()` 也只能在"真应用"处解析（冲突探测等 skip 路径调它照样会建）。
- **`contentHash` 会骗人**：`syncAdapters.localHashOf` 对 synced 笔记返回 `store.baseHash`（**不读 .lake**）；判"本地可复用"必须**实读正文 + sha256**，否则文件被外部删/坏时把空内容写进回收站（缺口2 加固的教训，与缺口1"验真实字节"对称）。
- **不要给"资产存在性"做本机持久缓存**（GC 会真删对象→缓存失真→破坏跨端自愈，正是当年删缓存的原因）；用"刚下载的远端清单"做差集才对。
- **S3 并发峰值 ≤8**（七牛建议），`NOTE(2)×ASSET(4)`；曾 16 偏高、无必要。
- **改主进程文件（`electron/*.ts`、`src/core/*`）→ vite-plugin-electron 重启 Electron → 命中未带 `--use-angle=metal` 的 GPU `exit_code=15` 崩溃**；fresh `npm run dev` 一般不崩、**热重载才崩**。改完别再动主进程文件、或重启一次即稳。
- **裸驱 CDP 无需第三方库**：nvm Node **v24 有内置 global `WebSocket`**；页面 target 在 `http://127.0.0.1:9222/json`。可点同步按钮 `button[data-sync-status-button]`、合成 `ClipboardEvent`+`DataTransfer` 粘贴（文本/图片）做真机验证。
- 压测真实云用一次性前缀 `lake-stress-<ts>/`，**结束必 `deletePrefix` 清场 + 复核 0 残留**；凭证只走环境变量、绝不入库。合成 `Readable` 走流式 PUT 在七牛会大面积超时→测脚手架用字节 PUT 路径更稳（真实文件的流式在 app 里正常）。
- `better-sqlite3` 是 **N-API**（Electron 和 vitest/node 都能加载）；命令行查库：拷 `.sqlite3`+`.sqlite3-wal` 到别处用 `/usr/bin/sqlite3 -readonly`（app 在跑时读快照）。
- S3 `[perf]` 日志里 head/put-stream 行尾数字是 **epoch 时间戳不是耗时**（旧坑，现 head 已移除）。
- 幂等/删除语义红线：软删=移动到回收站笔记本（`parentId=TRASH + trashedAt`，**非 `deleted:true`**）；`deleted:true` 只用于 purge 墓碑。混用=B1 致命 bug。

## 5. 下一步建议（新会话）
1. 先跑 §6 门禁确认基线；有问题先测再改。
2. 待办优先做 **§3.2 快照 gzip 异步化**（小、独立）→ **§3.3 FTS 增量**（收益大）；移动端 §3.6/3.7 **需先找用户复现/拿现象**。
3. 任何同步/GC 改动**先读** `AGENTS.md #11/#12/#13` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`（红线密集区，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立"）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
# 开发（CDP 9222；改主进程文件会重启、可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm run test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）——端点/桶见 dev 配置：s3.cn-north-1.qiniucs.com / cn-north-1 / local-lake-hebei
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
```
- 安卓：`export JAVA_HOME=.../jdk-21.jdk/Contents/Home`（AGP 要 ≥11）；SDK 在 `/opt/homebrew/share/android-commandlinetools`（`android/local.properties`，gitignore）；
  `npx vite build --config vite.mobile.config.ts && npx cap sync android && (cd android && ./gradlew assembleDebug)`；`adb` 在 `/opt/homebrew/bin/adb`；真机资产可达需 `adb reverse tcp:19876 tcp:19876`。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`。数据目录：dev 可删重建；正式数据 `lake-notes-electron` **禁碰**。

## 7. 文档索引（`docs/` 仍在，非交接、按需查）
`AGENTS.md`（红线/机制/坑，必读）· `SYNC-PROTOCOL.md` · `S3-GC-DESIGN.md`（GC/保留链）· `TODO.md`（待办总表，§3 已摘要）· `PROGRESS.md` ·
`ANDROID-TECH-SCHEME.md` / `MOBILE-TECH-STACK.md`（移动端）· `ARCHITECTURE.md` · 各 `*-AUDIT/*-REVIEW/*-DESIGN`（历史评审/设计，背景用）。
> 注：`docs/` 里若干 `*-HANDOFF`/`AUDIT`/`PERF` 是过程记录，权威待办以本文件 §3 为准。
