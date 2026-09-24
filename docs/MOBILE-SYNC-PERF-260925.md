# 移动端同步性能：调查结论与后续方案（260925）

> 写给新会话。本文记录 260925 会话关于「首次全量同步慢」的调查、已落地优化、剩余瓶颈、思源参考、附件评估与推荐路线。
> 开工先读本文件 + `HANDOFF.md`（顶部 260925 段）+ `AGENTS.md`（长期红线）。

## 0. 一句话结论
首次全量同步慢 = 网络串行 + 逐条写 + 逐条建索引，其中后两者是移动端特有（跨 WebView 桥）。网络与 DB 写已优化；**剩余瓶颈是移动端逐个建搜索索引**；再往后是**图片/附件的字节过桥**，需原生（Kotlin）资产端口。

## 1. 已提交（本会话，均在 master）
- `7fe2fd6` fix(sync)：非 doc 文档 kind 透传 + manifest kind 白名单补 board
- `823678a` perf(sync)：下载正文并发预取（消除首同步串行长尾）
- `eee50ac` perf(sync)：hash 账本批量预载（下载/上传环去掉逐条 getSyncBase）
- `b980602` perf(sync/mobile)：窗口级批量写（executeSet）+ synchronous=NORMAL
- 文档：`7a7601d` / `07a315f` / `43bd1e5`；门禁 tsc 0 / vitest 1271 / desktop+mobile build；5 端实测 25/25 + 目录套件 79/79

## 2. 实测数据（下载 1000 篇，全量首同步）
| 阶段 | 桌面 D2/D3 | 模拟器 E | 真机 R |
|---|---|---|---|
| 原始 | 30.2 / 34.7s | 43.3s | 149.5s |
| + 并发预取 | 8.2 / 7.2s | 20.7s | 104.4s |
| + 账本批读 | ~同 | 17.6s | 96.1s |
| + 批量写 + synchronous | ~同 | 16.5s | 83.2s |

本机（无网络）实测：真机 `createNote`×1000 = 94s、`listNotes`×20 = 1.10s；模拟器 13s / 0.15s（约 7 倍差）。顺序写盘真机 597MB/s、模拟器 1.2GB/s（约 2 倍）。

## 3. 根因分析
### 3.1 全量 vs 增量
- 上面是**首次全量**：1000 篇对手机全是新的，索引筛选条件全命中。
- **增量同步只处理变更项**（hash 账本差集）；稳态第二次同步实测 439ms、uploaded=0 downloaded=0。**增量不受影响。**
### 3.2 两端索引路径不同（关键）
- 桌面（进程内、同步、无桥）：`remoteImportRepository.importNote` → `ensureNoteCaches` → `updateNoteCaches` → `searchRepository.upsert`（FTS），1000 篇连同索引 ~8s。
- 手机（跨桥、逐条、同步后另起一趟）：`bridge.syncNow` 末尾 `reconcileIndex` → 每篇 1 次 `SELECT prev` + `d.transaction`（BEGIN/COMMIT 两次过桥）+ `SELECT MAX` + `INSERT notes_fts` + `INSERT search_index` ≈ **6 次过桥/篇**，1000 篇 ≈ **6000 次**。
### 3.3 桥是什么，为什么有，能不能不用
- 桥 = Capacitor 的 WebView(JS) ↔ 原生(Java/Kotlin) IPC。UI/编辑器是 Web，持久化是原生 SQLite/文件，所以必须有桥。
- 保留 WebView 就**去不掉桥**；只能**减少过桥次数**（批量）或**把循环下沉原生**（Kotlin 插件做整批，JS 只调一次）。

## 4. 已落地优化（怎么做的）
- **并发预取**：下载正文按 64 条窗口、4 并发预取（稳态命中 0），决策/落库顺序不变，未命中回退按需 GET。
- **账本批读**：新增可选 `SyncDbPort.getAllSyncBases`，下载环用同步前快照、上传环前重载一次，替代逐条 `getSyncBase`。
- **批量写**：下载窗口内 `applyRemoteNote`/`setSyncBase`/`recordDeclaredAssets` 语句入队，`flushNoteBatch` 用 `executeSet` 一次下发（原生一次桥往返 + 单事务）；失败逐条重放。移动端 native SQLite 加 `PRAGMA synchronous=NORMAL`。

## 5. 剩余瓶颈与下一步方案（未做）
### 5.1 批量 reconcileIndex（✅ 260925 续已落地，见 §12.1）
- 目标：把 ~6000 次逐条过桥压成少数几次。
- 做法（只改 `src/mobile/searchIndex.ts` 的 `reconcileIndex`，core 不动）：
  1. 分块一次 `SELECT note_id, fts_rowid, title_hash, body_hash FROM search_index WHERE note_id IN (...)` 取 prev；
  2. 一次 `SELECT IFNULL(MAX(fts_rowid),0)` 后在 JS 里顺序分配新 rowid；
  3. 逐篇计算后把语句入队（与 sync 的 executeSet 同套路），按块 `executeSet` 下发；无 `executeSet` 时回退 transaction/逐条；失败逐条重放。
- 幂等：reconcile 按 hash 差集，跑漏/失败下次自愈，**不需要思源那套磁盘队列**。
### 5.2 移动端异步索引 + 搜索提示（用户认可的方向）
- 把 `reconcileIndex` 移出 `syncNow` 热路径（丢到维护队列后台跑），同步立即返回；搜索未就绪时提示「正在建索引」。
- 取舍：同步完成后搜索短暂不完整；用户接受（类比 IDEA 后台建索引）。桌面不必改（已快）。
### 5.3 原生资产端口（图片/附件上量后的解，见 §7）

## 6. 思源参考（`/Users/admin/file/local-lake/siyuan-master`）
- **异步索引队列**：`kernel/sql/index_queue.go`（内存 operationQueue + 磁盘 `index.queue` 日志、`recoverIndexQueue` 恢复）+ `kernel/sql/queue.go` 的 `FlushQueue` 后台批量刷。
- **写入本身也异步**：`kernel/model/transaction.go` 的 `go flushQueue()` 用 50ms ticker 批量刷 Transaction。
- **按路径批量**：`UpsertIndexes(paths)`/`RemoveIndexes(paths)`，同步侧 `incReindex(upserts, removes)`。
- **FTS 是外部内容表** `blocks_fts`（content=blocks）+ 可换分词器。
- **桌面/手机同一套**：`kernel/sql` 无 build tag、无 mobile 变体；手机是 gomobile 绑定的同一 Go 内核。差异在我们：桌面进程内，手机跨桥。
- 可借鉴：把索引挪出热路径 + 批量；但我们的 reconcile 幂等，无需磁盘队列。

## 7. 图片/附件评估（未来测试重点）
### 7.1 当前每附件的过桥成本
- 相关代码：`src/mobile/capacitorHttpHandler.ts`（S3 二进制走 base64 过桥）+ `src/mobile/assetFs.ts`（`Filesystem.writeFile`/`readFile` 也是 base64 + mkdir）。
- 一张图下载 ≈ S3 原生 base64 → JS atob，再 JS btoa → 原生写盘：**2 个 base64 往返（≈2×1.33 倍体积）+ 3 次过桥 + JS 编解码 CPU**。上传对称。
- 成本 **∝ 字节数**，DB 语句批量治不了。
### 7.2 阈值（估算，建议实测钉死）
- 几 MB/几张图：不值得；几十 MB/几百文件：开始明显；**≥100MB 或 1000+ 文件：原生端口是决定性**。
- 真机现状：**884MB / 798 资源**（`lake-notes-stress2-260910`）⇒ 早越过阈值，原生资产端口值得。
### 7.3 Java 附件服务改 Kotlin？
- 安卓现状：纯 Java（`AssetServer.java` / `OpenFilePlugin` / `SharedContentPlugin` / `PinShortcutPlugin` / `MainActivity`），build.gradle 无 Kotlin 插件。
- **性能无差别**（都编到 ART 字节码）；好处只在可维护性（null 安全、协程并发传输）。
- 收益来自**把资产传输下沉原生**（Java/Kotlin 都行），不是换语言。建议：现有 `AssetServer.java` 不动；**新增**的原生资产同步插件用 Kotlin 写（协程适合并发 GET/PUT），并加 Kotlin Gradle 插件。
### 7.4 原生资产插件契约（草案）
- JS 只传「资产清单 + S3 配置」：noteId / filename / size / hash / objectKey；
- Kotlin 用 OkHttp 直接 `GET → FileOutputStream`、`FileInputStream → PUT`，字节不过桥；顺带绕开 Filesystem 的 base64+mkdir；
- `src/core` 的同步决策（哪些资产缺失）**一行不动**，只替换移动端端口。

## 8. 架构约束（用户定调，勿违）
- **core（`src/core`，105 文件、平台无关）是单一真相，两端共用，绝不重写**（即使为桌面也不重做）。
- 可动的是**执行层/端口**（`src/mobile/*`）；把端口循环下沉原生属于端口改动，core 不动。
- 设备差异（CPU/存储慢）**不硬优化**，只做代码能做的（减少过桥/序列化）。
- 现有跨端等价测试 `syncEquivalence`/`syncAdapterEquiv`/`syncDualAB` 是护栏，必须保持全绿。

## 9. 推荐顺序
1. ✅ **批量 reconcileIndex**（§5.1，小、稳、不碰 core）——已落地并 4 端实测（§12.1/§12.2）；真机待补测。
2. ✅ **测量附件阈值**（真实图片批量同步，拆「网络 vs base64/过桥」）——已实测（§12.3），过桥/写盘占比 25%~34%，桌面 4.7×。
3. **原生资产同步插件（Kotlin）**（§5.3/§7.4）——依据已充分，待立项实现。
4. 可选：**移动端异步索引 + 搜索提示**（§5.2）——未做。

## 10. 测试脚手架
见 `scripts/multi-end-sync/README.md`（5 端启动、端口、env、备份/还原、清理）。

## 11. 红线提醒
- 真机测试前备份、测试后还原；不要碰正式数据；杀 Electron 只 kill PID；隔离前缀用完删净。

## 12. 260925 续 · 落地与实测结果（批量 reconcileIndex + 附件过桥）

> 本节是 §5/§7/§9 的执行结果；代码见 `src/mobile/searchIndex.ts`、`scripts/multi-end-sync/run5assets.mjs`、`src/mobile/assetPerf.ts`。

### 12.1 批量 reconcileIndex（§5.1 已落地）
- 只改 `src/mobile/searchIndex.ts`：分块（200 篇/块）一次 `SELECT ... WHERE note_id IN (...)` 取 prev + 一次 `SELECT IFNULL(MAX(fts_rowid),0)`，JS 内顺序分配 rowid，语句入队后 `executeSet` 一次下发；无 `executeSet` 回退单事务逐条；失败逐条重放；stale 删除同样批量。**core 未动。**
- 千篇索引过桥次数由 ≈6000 次降到约「块数×3 ≈ 15 次」。幂等（按 hash 差集），不需要思源的磁盘队列。
- 测试：`searchIndex.test.ts` 8 例全绿（新增 executeSet 跨块/rowid 连续/二次对账零下发、失败重放、纯样式只更账本）。门禁：tsc 0 / vitest 1274 passed / desktop+mobile build OK。

### 12.2 多端实测
- **真机 50950385 未连接**（只有 emulator-5554）⇒ 真机数字缺；跑 4 端（D1/D2/D3 + 模拟器），隔离前缀 `perfd-20260925035257`。
- 1000 笔记 + 100 目录：D1 上传 13.9s；D2 8.2s、D3 7.2s；**模拟器 10.68s，其中 reconcile `indexMs=183ms`（≈1.7%）**；收敛 1001/101；套件 **20/20**。（另一轮 E=11.77s / indexMs=192ms。）
- 对照 §2 同模拟器基线 16.5s：**≈16.5→10.7~11.8s（−30%~35%）**。真机同代码预期继续下降（真机桥 ≈ 模拟器 7×）；**需接真机重跑确认**。

### 12.3 附件过桥实测（§7 的实测版）
- 新增 `src/mobile/assetPerf.ts`（HTTP / base64 / Filesystem 分桶计时，`window.__lakePerf`），埋点在 `capacitorHttpHandler.ts` + `assetFs.ts`；测试脚本 `scripts/multi-end-sync/run5assets.mjs`。
- 模拟器实测：
  - 上传 40MB/20 文件：wall 11.3s、**JS btoa 1.80s（16.1%）**；上传 2.4MB/300 文件：wall 5.2s、btoa 36ms，每文件固定成本主导。上传阶段字节来自小记内存层（刚注入），未触发 `loadAssetFile` ⇒ 本次上传未计入磁盘读，进程重启后的上传会多一次读盘 + atob。
  - 下载 40MB/20 文件：wall 26.5s、**写盘 7.98s + btoa 0.83s + atob 0.23s = 过桥/编码 9.04s（34.1%）**；下载 2.4MB/300 文件：wall 6.3s、写盘 1.52s、每文件 ≈5.3ms。
  - 同批 42.4MB/320 文件桌面 D2 下载 6.97s；**模拟器合计 32.8s ≈ 桌面 4.7×**。
- 结论：每附件 **2 次 base64 往返 + 3 次过桥**，字节成本随体积线性、小文件有固定成本；移动端附件下载已「桥/写盘主导」。**原生资产插件（Kotlin，字节不过桥）立项依据充分**；「网络 vs 过桥」拆分口径 = `assetHttp.ms`（网络+原生编解码）vs `b64Encode+b64Decode+fsWrite/fsRead`（JS 编解码 + Filesystem 过桥）。

### 12.4 仍待办
- 接真机重跑 `run5d.mjs`（脚本已自动跳过未连接端并打印 `indexMs`）。
- 可选：移动端异步索引（reconcile 移出 `syncNow` 热路径 + 搜索「正在建索引」提示）——本轮未做。
- 原生资产同步插件：尚未立项实现（本节只给依据与度量口径）。
## 13. 260925 续 · 原生资产同步插件（Kotlin，分支 feat/android-kotlin-native）

- 背景：§7/§12.3 已证「每附件 2×base64 + 3×过桥」，模拟器下载比桌面慢 ≈4.7×。本专项在分支上落地原生插件。
- 原生层已 **全 Kotlin 化**（9 个 .java → .kt，接入 kotlin-android 2.2.20 / JVM 21，无 Java 源文件）。
- `AssetSyncPlugin`：SigV4 自签 + 流式 `putFile` / `getFile` / `listAssets`（sha256 原生算）。JS 用 `nativeAssetSync` 探测接入：移动端 `putObjectStream` 与 `openLocalAssetStream`/`listLocalAssets` 走原生，非原生/失败回退字节路径；**core 未改动**。
- 实测：256KB 资产原生 PUT/GET 到 S3 逐字节一致；整轮同步 `assetHttp/assetB64Encode/fsRead = 0`（资产字节不过桥）。跨端 `run5native.mjs` 4/4（E 原生上传 → D1 逐字节一致；D1 → E 下载逐字节一致）。
- **下载也已接入**：core 加可选 `S3Store.getObjectToFile` + `SyncDbPort.assetFilePath`，`downloadNoteAssets` 加一个 else 保留原逻辑的分支；移动端实现后下载字节也不进 JS。跨端 `run5native` **5/5**（D1→E 下载逐字节一致且 `assetHttp=0`）。桌面不实现该可选方法 → 走 else，行为不变。
