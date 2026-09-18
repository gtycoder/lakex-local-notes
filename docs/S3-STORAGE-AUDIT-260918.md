# S3 存储/同步审计（260918）——瓶颈 · 脆弱点 · 丢数据风险

> **审计范围**：围绕 S3 镜像做的全部工作（同步引擎、清单、资产、GC/深清理、回收站、历史留档、备份/云端恢复、小记、移动端桥）。
> **方法**：只读代码审计（未跑测试、未改代码）。每条结论附 `文件:行号` 证据；标注严重度与**触发条件**。区分「真丢（不可恢复）」与「可自愈（下一轮同步重传）」。
> **固定前提（用户给定，不质疑）**：本地优先 / S3 只是镜像；个人多端、**无并发**；**先提交者胜**；不做冲突合并，被覆盖方靠**历史快照**留档；**回收站是有笔记本行为的容器**。
> **目标量级**：10 万文档 / 100 万附件（`AGENTS.md` §1）。
>
> **⚠️ 260918 二次复核（重要）**：当前产品定位是**个人笔记，实际量级 5K 文档 / 2GB 附件**。§0–§6 是按 `AGENTS.md` §1 的"10 万文档 / 100 万附件"红线量级评的，**按真实量级重定级见 §7**——结论是：只有 **2 条真问题（P0）得修**，其余是"加护栏的保险"或"不用管"。以 §7 为准。
>
> **⚠️⚠️ 260918 三次复核（代码级验证 + 已落地）：以 §8 为准。** §7 的**结论方向**成立，但有 4 处事实错误/口径偏差已在 §8 更正：
> ① **§7.4 的 F2 复现步骤验不出来**（桌面同步先 `remote.test()`，密钥错/endpoint 不可达会在那里就抛 → UI 明确报"同步失败"）；
> ② **D2 的触发条件写反了**（`.lake` 缺失时 `createHistorySnapshot` 先 `existsSync` 就 `return null`，不会产生空快照，而是静默不留档）；
> ③ **B4 的触发面漏了下载侧**（`downloadNoteAssets` 也调 `listLocalAssets` 全量重算哈希）；
> ④ **D5 应从"Medium 真丢"降为 Info**（历史与附件都是 L3 纯本机，别端拿不到 ⇒ 云端删对象不影响本机恢复，且恢复后再保存会重新上传自愈）。
> **本批已修（P0×2 + P1×1，见 §8.3）**：F2 拉取清单失败整轮中止并抛出 · D1/F1 桌面留档失败不再静默吞（+ D2 拒空）· D3/F6 未保存草稿引用的资源纳入保护集。

---

## 0. 结论摘要（按"该不该现在动手"排序）

| # | 问题 | 级别 | 一句话 |
|---|---|---|---|
| 1 | **清单（manifest）是全量快照 + 20MiB 解压后硬上限** | **Critical（规模 Cliff）** | 约 **6 万条**（无附件）或 **~16 万附件** 时同步**静默永久停摆**，距 10 万/100 万目标差 2–6 倍 |
| 2 | **桌面留档失败被静默吞掉** | **Critical（真丢）** | 被覆盖的本地编辑 = 唯一副本；快照写失败仍提示"已存历史" |
| 3 | **历史清理会顺带物理删除"未保存粘贴"的附件** | **High（真丢）** | 粘贴图片后未保存（或崩溃未恢复草稿）→ 启动/定期清理删文件，正文留着死链 |
| 4 | **拉取清单失败被降级成"同步完成"** | **High（假安全）** | 网络/权限/清单过大 → UI 显示同步成功、0/0 |
| 5 | **purge 的文件删除在事务外、失败只 warn** | **Medium（真丢）** | DB+墓碑已删、云端会删 → 只剩无人引用的磁盘文件 |
| 6 | **跨设备历史保护只是"本设备最佳努力"** | **Medium（真丢）** | 执行 GC 的设备看不到别端历史 → 云端副本被删；历史过期后不可恢复 |
| 7 | 规模性能：全量重建清单 / 全表加载 / 单篇全量重扫附件 / 移动端读全部历史正文 | Warning | 10 万级不可用（非丢数据） |

---

## 1. 瓶颈（随规模先崩的地方）

### B1. 【Critical】清单体积天花板：约 6 万条 ≈ 同步永久停摆
- 清单是**全量快照**（每篇笔记的元数据 + **全部附件声明 size/hash** 都写进 `manifests/latest.json`，`syncEngine.ts:700-757`）。
- 读取有**解压后 20MiB 硬上限**：`MAX_MANIFEST_BYTES = 20 * 1024 * 1024`（`src/core/syncUtils.ts:30`），在 `parseLakeManifest` 里对**已 gunzip 的字节**判定（`syncUtils.ts:57-64`；`sync.ts:166-174` 先 gunzip 再判）。
- **实测条目体积**（按 `buildUploadEntry` 口径构造）：单条**无附件 341B**，**带 2 个附件 601B**（≈130B/附件）。
  ⇒ 20MiB 上限内约 **6.15 万条**无附件，或约 **16 万附件**声明；**1M 附件的声明本身就 ≈130MB，超限 6.5 倍**。
- 超限后的行为链（这是最糟的部分）：
  1. `parseLakeManifest` 抛 `清单过大（…）`；
  2. `syncEngine.ts:114-121` 的 catch 只对 `/版本不兼容|清单格式/` 重新抛出，**"清单过大"不匹配** → `report.message = 拉取 manifest 失败` 后 **return**（不下载、不上传、不发布）；
  3. 桌面 `syncEngineController.ts:51-124` 不检查该 message，照常 `report({phase:"done", message:"同步完成"})`；渲染层 `useSyncProgress.ts:37` 置 `success`。
  ⇒ **写侧没有任何体积护栏**（发布路径 `syncEngine.ts:755-757` 不校验），所以是"设备 A 正常发布了一个 20.5MiB 清单，从此**所有设备**（含 A）都读不回来"。
- **恢复路径**：应用内没有。唯一出路是手工删除桶里的 `manifests/latest.json`（之后按"无清单=首次同步"从本地全量重传，`syncEngine.ts:111-113`）。
- 证据：`src/core/syncUtils.ts:30,57-64`、`src/core/syncEngine.ts:105-121,700-757`、`electron/syncEngineController.ts:51-124`、`src/hooks/useSyncProgress.ts:36-41`。

### B2. 每次发布全量重建清单（主进程阻塞）
`next = {...remote}` → 覆盖上传条目 → `next.notes.sort()` → `JSON.stringify(next)` → `gzipSync` **两次**（commit + latest）全在主进程同步执行（`syncEngine.ts:700-757`）。10 万条 = 数十 MB 的字符串拼接 + 排序 + 两次 gzip，UI 会明显卡顿（这不是"慢"，是**同步期间主进程占满**）。

### B3. 每次同步全表加载两次
`getAllNotes()`（全表元数据）在下载环（`syncEngine.ts:265`）与上传环（`syncEngine.ts:505`）各取一次，外加 `localById`/`remoteById`/`validParents`/`remoteParentMap` 多个 10 万级 Map/Set。零变更早退能省掉这段，但**只要有一篇本地改动，整轮就是全量**。

### B4. 单篇编辑 = 全量重扫该篇附件并逐个 sha256
`resolveUploadAssets` → `scanLocalAssets` → `db.listLocalAssets`：`fs.readdirSync` 后**对每个文件 `readFileSync` 全文 + sha256**（`electron/syncAdapters.ts:153-169`）。只对"待上传/软删"的笔记执行（`syncEngine.ts:558,585`），但**编辑一篇挂了 200 个附件（含视频）的笔记，每次都要重算全部附件哈希**——单篇附件越大越痛，且会整块读进内存（`MAX_IMAGE_BYTES`=25MiB × 并发 4）。

### B5. 【移动端专属】GC keep-set 要读**全部历史正文**
`bridge.ts:782` → `historyRepository.historyAssetRefs()`：`SELECT note_id, content FROM note_history` 后逐行正则抽取（`src/mobile/historyRepository.ts:34-43`）。桌面为每份快照预存了 `refs_json`（`historyLifecycle.ts:80,100` + `assetRepository.ts:64-75`），**移动端没有这一列** ⇒ 每次 GC 引用集构建的代价 = O(历史快照总字节)。手机上这是致命的（1 万篇 × 20 份 × 20KB ≈ 4GB 读）。

### B6. 【移动端专属】历史快照存在主库里
移动端 `note_history.content` 直接把正文存在 SQLite（`src/mobile/historyRepository.ts:51-52`），桌面是 `history/{noteId}/*.lake.gz` 独立文件（`historyLifecycle.ts:83-87`）。100 份 × 每篇正文 → 手机主库膨胀，且主库损坏 = 历史全没。

### B7. 只增不减的本地表
`s3_gc_log` 只有 INSERT 与 `SELECT … LIMIT 500`（`syncReconciliation.ts:461-469`，无任何 DELETE）；`declared_assets` 只做 upsert、**从不删除**（`syncReconciliation.ts:450-454`）。附件 churn 到百万级后各百万行。不是正确性问题，是"诊断页/库体积"的慢性病。

### B8. 深清理/GC 诊断 = 全量 list
`runDeepCleanup` 与 `runGcDiagnostics` 一次拉 `objects/`+`assets/`+`manifests/`（+`quick-notes/`）（`sync.ts:474-478`、`syncGc.ts:42-47`）。1M 附件 ≈ 1000 页 ListObjectsV2 串行 RTT。手工按钮可接受，但"预览一下"就要分钟级。

---

## 2. 脆弱点（机制 / 错误处理 / 跨端漂移）

### F1. 【两端语义漂移】留档失败：桌面静默吞、移动端抛出
- 桌面：`syncAdapters.ts:145-147` `createHistorySnapshot` 整体 `try{…}catch{ /* 留档失败不阻断 */ }`。
- 移动端：`src/mobile/syncDbPort.ts:245-253` 直接 `return insertHistorySnapshot(...)`（失败会冒泡、同步中断）。
⇒ 同一个故障在两端口结果相反：桌面**继续覆盖本地正文**，移动端**中止同步**。桌面这条是 §3-D1 的前提。

### F2. 【假安全】拉取清单失败 ⇒ UI 显示"同步完成"
见 B1 行为链。触发面比"清单过大"广得多：网络抖动、权限 403、桶被改名、对象不是合法 JSON（`syncEngine.ts:114-121` 的 else 分支全部降级为 return）。`main.ts:111-136` 的 `runFullSync` 也不检查结果，`useSyncProgress.ts:37` 置 success。

### F3. 零变更早退的隐含契约
`shouldSkipZeroChange`（`syncPerf.ts:25-32`）只看 `commitId`+`hasPending`+`墓碑签名`；`localHashOf` 对 `synced` 笔记**信任 `sync_base` 缓存、不读盘**（`syncAdapters.ts:40-45`）。⇒ **带外修改 `.lake`（脚本/其他编辑器/杀软改文件）永不上传**，代码注释也明说"不在本期覆盖"（`syncAdapters.ts:41`）。个人单机场景可接受，但属于"写进文档、别当 bug 修"的那类。

### F4. purge 的文件删除在事务外，失败只 `console.warn`
`purgeTrashItem`：事务内删 `notes/tree_nodes/note_history/orphan_assets` + 写墓碑（`trashLifecycle.ts:236-281`），**事务提交后**才删文件且 `catch → console.warn`（`trashLifecycle.ts:282-285`）。⇒ 文件删失败时：DB 无该文档、墓碑显示"已彻底删除"、下一步同步 `deletePrefix` 清掉云端前缀（`syncEngineController.ts:88-95`）→ 全系统只剩一个**没有任何引用、也没有入口**的 `.lake`/附件目录。见 §3-D4。

### F5. purge 的"先 DB 后文件"不可原子
同上，属设计取舍；配合 F4 才成为风险。

### F6. `cleanupUnreferencedAssetsForNote` 的删除口径是"目录全清"
`historyLifecycle.ts:190` → `orphanLifecycle.ts:60-70`：遍历 `note-assets/{noteId}/`，凡不在 `getProtectedRefs`（当前正文 ∪ 历史 refs）里的文件**一律物理删**。它不看 `orphan_assets` 表、不看 `draft-journal`、不看编辑器未保存状态。触发条件（两个都要满足）：
1. 该笔记本轮**确有快照被删**（`historyLifecycle.ts:178-179` `if (expired.length === 0) continue`）——默认 `maxSnapshots=100` / `retentionDays=30`（`src/mobile/historyRepository.ts:19-24` 同默认值）；
2. 该笔记此刻存在"已落盘但当前正文未引用"的附件——最典型的就是**粘贴图片后尚未保存**（`resourceRepository` 落盘即写文件，但正文还没保存）。
执行时点：**启动兜底**（`main.ts:469`）与**定期清理**（`main.ts:488-495`）。见 §3-D3。

### F7. 备份/恢复没有校验
`exportWorkspaceBackup`：DB 用 `VACUUM INTO` 先做快照，然后 `cpSync` 拷目录（`workspaceBackup.ts:29-51`）——**非原子、无校验和、无"备份完成"标记**；`backupTargetExists` 让"目标非空"直接报错（`workspaceBackup.ts:17-19`），所以中途失败的**半成品备份无法原地重试**。另外 DB 快照早于目录拷贝：拷贝期间被 purge 的文档可能"DB 里有行、目录里没文件"。
`prepareCloudRestore`（`workspaceBackup.ts:61-68`）：改名隔离 + 建空库 + 重启；恢复完全依赖"云端可读"——若云端清单不可读（B1）或桶不可达，用户拿到的是**空工作区**（隔离目录还在，可手工救回）。

### F8. manifest 链很浅 + 每次发布一次 list
`MANIFEST_CHAIN_KEEP = 3`、`MANIFEST_PRUNE_SLACK = 6`（`sync.ts:96-106`），`pruneOldManifests` 每次发布都 `remote.list("manifests/")`（`sync.ts:506-530`）。取舍已在注释里论证（活动对象恒在 latest 全量快照内），**不是 bug**，但"从清单链回溯更早版本"这条兜底基本不存在。

### F9. 回收站子树遍历无环保护
`descendantIdsIncludingDeleted`（`trashLifecycle.ts:50-60`）用栈 + `parent_id` 查询，无 `seen` 集合。树里一旦出现环（脏数据/并发移动残余），`emptyTrash`/`purge` 会**死循环**。属"防脏数据"的健壮性缺口。

### F10. GC 标记失败只 warn（方向安全）
`onPublished` 里算"新清单不再引用"的键写 `s3_gc_pending`，整体 `try/catch → log.warn`（`syncEngineController.ts:81`）；`prune` 同样（`syncEngineController.ts:83`）。失败后果是**云端冗余堆着**（要靠手工深清理），不会删错——方向上安全。

### F11. 历史引用保护只覆盖"本设备"
`buildLakeGcKeepSet` 的 `historyRefs` 来自**本机** `store.getProtectedRefs`（`sync.ts:363-366`），设计文档也写明"本设备最佳努力，非跨设备承诺"（`S3-GC-DESIGN` B1）。见 §3-D5。

### F12. 回收站条目会把附件永久留在云端
`collectManifestRefs` 只对 `deleted:true` 跳过资产（`syncUtils.ts:86-88`），而**回收站条目是 active 条目**（`trashedAt` 而已）⇒ 回收站里躺着的文档，其全部附件一直计入 keep 集。这是"回收站=容器"语义的正确结果，但意味着**不清理回收站，云端就永不回收这部分存储**。

---

## 3. 丢数据风险（真丢 = 不可恢复）

> 判定口径：本地是真相、云端可重传，所以**只有"本地唯一副本被覆盖/删除"才算真丢**。

### D1.【Critical】被覆盖编辑的留档失败 → 静默丢失
被远端覆盖的本地编辑，其唯一保障是 `createHistorySnapshot`（`syncEngine.ts:485-488` 冲突覆盖、`316-319` purge 覆盖、`368-371` 远端软删覆盖）。桌面适配器把异常吞掉（F1），随后照常 `applyRemoteNote` 覆盖 `.lake`，并在 UI 提示"远端修改已覆盖本地 N 篇（已存历史）"（`useSyncProgress.ts:144`）。
- **触发**：磁盘满 / 快照目录不可写 / DB 写失败 / 权限异常。
- **后果**：编辑正文永久丢失 + 用户被告知"已存历史"（错误信息），不会去找。
- **一点缓冲**：`.lake` 被覆盖前的内容在覆盖那一刻还在内存/被写走，但没有任何第二次机会。

### D2.【High】留档内容未经校验，可能是空串
`contentOf(local)`（`syncEngine.ts:68-72`）在正文文件缺失/读失败时返回 `""`；`createHistorySnapshot` 用 `content ?? fs.readFileSync`（`historyLifecycle.ts:75`）——`""` 不是 `null`，于是**写下一份空正文快照并在 DB 里登记成功**。用户看到历史里有一条，点开是空的。
- **触发**：`.lake` 已丢失/被外部删除/编码异常，而 notes 行还在（DB 与文件不一致）。

### D3.【High】历史清理顺带删掉"未保存粘贴"的附件
见 F6 完整链路。最现实的场景：
1. 编辑文档粘贴一张图（文件立即落盘到 `note-assets/{id}/`，`resourceRepository.upload` → `writeAssetBytes`），**尚未保存**（或保存恰好失败/崩溃）；
2. 崩溃重启：主进程启动兜底清理 `cleanupHistory()`（`main.ts:469`）→ 该篇若本轮有快照被删，则 `cleanupUnreferencedAssetsForNote` 把刚粘贴的图**物理删除**；
3. 渲染层随后从 `draft-journal` 恢复草稿正文（含该图 URL）→ **死链**，用户保存后死链落盘并同步到云端。
- 定期清理（`cleanupIntervalHours`）对"长时间未保存的编辑中"同样命中。
- **桌面专属**：移动端 `cleanupHistory` 只删历史行（`src/mobile/historyRepository.ts:138-157`），且没有 `cleanupUnreferencedAssetsForNote`。

### D4.【Medium】purge 文件删除失败 → 唯一副本变成"孤儿字节"
见 F4。DB 行、历史、孤儿登记、墓碑全部删除，云端前缀也删；磁盘文件因 EBUSY/权限/磁盘错误留下，但**没有任何 DB 引用，也没有 UI 入口**去发现它（`listRemovedAssets` 只列有 `orphan_assets` 行或在历史里被引用的文件，`orphanLifecycle.ts:200-244`）。
- **触发**：文件被其他进程占用（Windows 常见）、权限、磁盘错误；日志里只有一行 `console.warn`。

### D5.【Medium】跨设备历史保护失效 + 历史过期 → 云端附件不可恢复
场景：A 删除某图（从正文移除）→ 该图在 A 变为孤儿、下次 A 发布时不再声明 → A 的 `s3_gc_pending` 记下它；**B 的历史快照里还引用着这张图**（B 曾有未同步编辑被覆盖而留档）。7 天后 **A** 执行对账，用 **A 的**历史引用集判定 → 删除云端对象。B 的历史恢复出正文后图片裂掉；等 B 的历史快照被 `maxSnapshots/retentionDays` 清掉，附件**彻底不可恢复**。
- 设计文档已声明这是"本设备最佳努力"（`S3-GC-DESIGN` B1、`sync.ts:336-338`），但对用户是隐形的。

### D6.【Medium】移动端没有"冲突归档保护窗口"
桌面留档会写 `protected_until`（`HISTORY_SNAPSHOT_PROTECT_DAYS`，`syncEngine.ts:317,369,486`；`historyLifecycle.ts:95-97,169-178`），移动端 `note_history` 无该列、`createHistorySnapshot` 也不接收（`src/mobile/historyRepository.ts:46-53`）⇒ 移动端上"被覆盖编辑的唯一副本"随时可能被 `maxSnapshots/retentionDays` 清掉。

### D7.【Low / 设计如此】小记没有历史快照
`QUICK-NOTES-SPEC` 明确"丢了就丢"。审计确认墓碑路径是"先内容后标志"（`quickNotesSync.ts:62-83`：`applyTombstoneContent`/`applyTombstoneAssets` 先落盘，再 `deleteLocalQuickNote`），且 `buildQuickNotesKeepSet` **对 deleted 条目也保留**正文与图片引用（`quickNotesSync.ts:160-165`）——方向是对的。可被接受的风险只剩：本地写失败时（`applyTombstoneContent` 抛错）同步中断（正确行为），以及小记回收站被清空后不可恢复（语义如此）。

---

## 4. 明确**不是**风险的（写下来防误判/防止"修出 bug"）

| 机制 | 为什么安全 | 证据 |
|---|---|---|
| 桶被清空 / 换桶 / manifest 丢失 | `decideUpload` 对 `remoteContentHash=null` 一律 `upload`，且 `forceHashRead` 重算真实 hash → 本地全量重传 | `decideUpload.ts:20-30`、`syncEngine.ts:527-532` |
| 发布顺序 | 先对象后清单（`syncEngine.ts:684-698` → `756-757`）+ 内容寻址幂等 | `SYNC-PROTOCOL.md` §2、`syncEngine.ts` |
| 崩溃窗口（对象已传、清单未发） | 对象要么被下轮重传，要么被 prune/深清理当作未引用回收（本地仍是真相） | `sync.ts:506-530` |
| 云端误删 | 本地是真相下一轮重传；`GC` 只删"未被任何在留清单引用"的键 | `AGENTS.md` §3 #11 |
| 时间戳非法 / 年龄未知 | `gcPolicy` 一律判"未过窗口"（永不误删） | `gcPolicy.ts:20-30` |
| 墓碑对象缺失 | 占位符 hash 加入 keep 集无害，下载侧对缺失对象跳过 + warning | `syncUtils.ts:83-88`、`syncEngine.ts:349-351` |
| 保守的并发上限 | 峰值 PUT = 2×4 = 8（七牛建议上限） | `syncEngine.ts:36-40` |

---

## 5. 建议（按"性价比 × 危险度"，全部为独立小改动）

| 优先级 | 动作 | 成本 | 解决 |
|---|---|---|---|
| P0 | **发布前做清单体积护栏**（超阈值直接报错，不写 latest）；同时把"清单过大/拉取失败"提升为**用户可见的失败**（不是 done） | S | B1 + F2 |
| P0 | **桌面留档失败必须传播**（与移动端一致），UI 明确"未留档、本次覆盖已中止" | S | D1 + F1 |
| P0 | **留档前校验内容非空**，空则视为失败 | S | D2 |
| P1 | `cleanupUnreferencedAssetsForNote` 加保护：跳过 `draft-journal` 引用的文件、**不在启动时执行**、或改为"只清 `orphan_assets` 里登记且年龄 > N 的文件" | S–M | D3 + F6 |
| P1 | `s3_gc_log` / `declared_assets` 定期裁剪 | S | B7 |
| P1 | purge 文件删除失败 → 写"待重试"表 + **阻断云端前缀删除**（先文件后云） | S | D4 + F4 |
| P2 | 移动端 `note_history` 加 `refs_json`（对齐桌面） | M | B5 |
| P2 | 中期：把附件声明从主清单里拆出去（按笔记分片 / 独立 assets 索引），或把 `MAX_MANIFEST_BYTES` 改为可配 + 流式解析 | M–L | B1 + B2 |
| P2 | 深清理/诊断改为分页增量 + 进度可取消 | M | B8 |
| P3 | `descendantIdsIncludingDeleted` 加 `seen` 集合 | S | F9 |

> **不建议现在做的**：为 10 万/100 万目标重写同步协议。B1/B2 先用"护栏 + 可见失败"止血；真要规模化再谈清单分片（那是协议级变更，按红线须单独立项）。

---

## 6. 审计方法与证据索引

- 同步编排：`src/core/syncEngine.ts`（820 行全读）、`electron/syncEngineController.ts`、`electron/syncAdapters.ts`
- 资产：`src/core/syncAssets.ts`、`electron/resourceRepository.ts`、`electron/assetServer.ts`
- 清单：`src/core/syncUtils.ts`、`src/core/manifestTypes.ts`、`src/core/decideUpload.ts`、`src/core/lakeReconcile.ts`
- GC：`electron/sync.ts`（buildLakeGcKeepSet / runGcReconcile / runDeepCleanup / pruneOldManifests）、`electron/syncGc.ts`、`src/core/gcDecisions.ts`、`src/core/gcPolicy.ts`、`docs/S3-GC-DESIGN.md`
- 回收站：`electron/trashLifecycle.ts`、`electron/trashRepository.ts`
- 历史/孤儿：`electron/historyLifecycle.ts`、`electron/orphanLifecycle.ts`、`electron/assetRepository.ts`
- 备份：`electron/workspaceBackup.ts`；启动时序：`electron/main.ts:435-520`
- 小记：`electron/quickNotesSync.ts`、`src/core/quickNotesSyncEngine.ts`
- 移动端：`src/mobile/bridge.ts`、`src/mobile/syncDbPort.ts`、`src/mobile/historyRepository.ts`、`src/mobile/schema.ts`
- UI 反馈：`src/hooks/useSyncProgress.ts`

**未覆盖**（本轮未验证，标为不确定）：① 清单体积的**实测**值（本文用按 `buildUploadEntry` 口径构造的条目估算，建议在压测库上实测 10 万条真实的 `latest.json` 字节数）；② 移动端真机上的 GC 内存峰值；③ `docs/SYNC-RELIABILITY-VERIFY.md` 里已记录的验证项是否仍全绿。
---

## 7. 按真实量级复核（5K 文档 / 2GB 附件）—— 哪些是真问题

> 用户 260918 明确：**当前定位是个人笔记，量级 5,000 文档 + 2GB 附件**。本节把 §0–§6 的每一条按这个量级重新定级。
> 结论：**§0–§6 里 19 条，只有 2 条（F2、D1）在个人量级上必须修；2 条（D2、D3）建议修；其余是「加护栏的保险」或「不用管」。**

### 7.1 量级换算（实测，非估算）

用 `crypto.randomUUID()` 造真实形态的清单（5,000 条笔记 + 按 2GB 反推的附件条数），量解压后字节与 gzip 字节：

| 附件形态 | 附件条数 | 清单解压后 | gzip 后 | 占 20MiB 上限 |
|---|---|---|---|---|
| 2GB @100KB/文件（截图为主） | 20,000 | **4.08 MiB** | 1.31 MiB | **20.4%** |
| 2GB @500KB/文件 | 4,049 | 2.10 MiB | 0.61 MiB | 10.5% |
| 2GB @1MB/文件 | 2,006 | 1.85 MiB | 0.52 MiB | 9.3% |
| 2GB @5MB/文件（PDF/音视频） | 416 | 1.66 MiB | 0.45 MiB | 8.3% |

⇒ **即使按最坏形态（2GB 全是 100KB 小文件、2 万个附件），也只用掉上限的 20%（约 5 倍余量）**；典型形态约 10 倍余量。
要撞到 20MiB 上限，需要约 **6 万条文档** 或 **约 16 万个附件声明**（≈ 8–16GB 附件）。
**（§8 复核补充）**：余量口径按**条数**说（字节比例会随条目形态漂移；独立复测 5K+2万附件 = 4.30MiB / 21.5%，与上表一致）；另有 `MAX_MANIFEST_NOTES=200_000` 条数上限（`syncUtils.ts:31`），字节上限先撞。

### 7.2 逐条重定级

| 编号 | 原级 | **个人量级下的真实结论** | 依据 |
|---|---|---|---|
| B1 清单 20MiB 上限 | Critical | **撤销** → 降为「未来保险」 | 实测 1.7–4.1 MiB，占上限 8–20%（§7.1）；要撞限需 6 万条 / 16 万附件 |
| B2 每次发布全量重建清单 | Warning | **撤销** | 1.3–4 MiB JSON + 2 次 gzip = 数十 ms；5K 条排序/序列化无感 |
| B3 每次同步全表加载两次 | Warning | **撤销** | 5K 行元数据，毫秒级 |
| B4 单篇编辑重扫全部附件并逐个 sha256 | Warning | **保留（唯一还成立的项目级性能项）** | 见 §7.3 + **§8.2 更正**：触发面还包含**下载侧**（`downloadNoteAssets` 也全量重算该篇附件哈希），且有**内存上界**（整文件读进内存 × 并发 4） |
| B5 移动端 GC 读全部历史正文 | Warning | **降为 Info** | `gcDeepCleanup` 是**手动按钮**（`src/mobile/bridge.ts:756`），不在同步热路径；5K 量级最多几百 MB 一次性读 |
| B6 移动端历史存主库 | Warning | **降为 Info（观察）** | 实际只有被编辑过的笔记才有快照；主库涨到几百 MB 量级才需要管 |
| B7 表只增不减（s3_gc_log / declared_assets） | Warning | **撤销** | 5K 量级 = 万行级，无感 |
| B8 深清理全量 list | Warning | **撤销** | 2GB ≈ 数百~数千对象 = 几页 ListObjectsV2 |
| **F1/D1** 桌面吞掉留档异常 | Critical | **保留 → P0 ✅ 已修（§8.3）** | 与量级无关。真丢 + UI 假提示「已存历史」。**修法与本表建议不同**：不是"抛给移动端那样中断"，而是留档失败 → 整轮同步中止（覆盖发生在留档之后，所以本地编辑不会被覆盖） |
| **F2** 拉取清单失败＝同步完成 | High | **保留 → P1（不是 P0）✅ 已修（§8.3）** | 代码缺陷成立，但**触发面比 §7.4 写的窄得多**：桌面同步先 `remote.test()`，密钥错/endpoint 不可达/桶改名都会在那里抛 → UI 已明确报「同步失败」。真实触发只剩「清单非法 JSON / 超 20MiB / test() 之后那次 GET 瞬时失败」。详见 **§8.1** |
| D2 留档内容可能是空串 | High | **保留 → P1（与 D1 同处修）✅ 已修** | **§7 的触发条件写反了**：`.lake` 缺失时 `createHistorySnapshot` 先 `existsSync` 就 `return null`（**不会**写空快照，而是**静默不留档**）。真正会写空快照的是「文件在但 adapter 读失败 → content=""」。详见 **§8.1** |
| **D3/F6** 历史清理删掉「未保存粘贴」的附件 | High | **保留 → P1 ✅ 已修（§8.3）** | 真丢（孤儿不上传 ⇒ 云端也没有）。**触发面更正**：`expired.length>0` 对「昨天编辑过、有多份自动快照」的笔记几乎每轮成立；窄的是「清理那一刻恰好有未保存的粘贴图」——自动保存防抖 1s，所以窗口 = 保存失败 / 崩溃 / 粘贴后 1s 内强退 |
| D4/F4 purge 删文件失败只 warn | Medium | **保留 → P2** | 需 rmSync 失败（文件被占用/权限），低频 |
| D5 跨设备历史保护失效 | Medium | **撤销 → Info（不改代码，只记录）** | **§8.2**：历史与附件都是 **L3 纯本机**（`STORAGE-LAYERS.md`），别端拿不到你的历史 ⇒ 云端删掉该对象后，能引用它的只有本机，而本机文件受保护集守着；恢复历史后再保存还会把它重新上传（**自愈**）。真丢只剩「回收站惰性下载 ⇒ 本机从未落盘该附件」这条极窄路径 |
| D6 移动端无 protected_until | Medium | **保留 → P2** | 移动端成为主力编辑端时才重要（并入 HANDOFF §8.7 真机验收批次，不单独立项） |
| F3 带外改 .lake 不上传 | Warning | **保留为已知契约（Info）** | 代码注释已声明「不在本期覆盖」（`syncAdapters.ts:41`） |
| F7 备份无校验 / 不可重试 | Warning | **撤销 → 明确「不做」（只补文档说明）** | **§8.2**：云端才是主备份，给本地导出加校验和/完成标记属 AGENTS §3 #17 的迎合式保险。需要写进文档的只有事实：导出**非原子**、半成品**不能原地重试**（`backupTargetExists` 会拦），要换空目录 |
| F9 回收站遍历无环保护 | Warning | **撤销为 Info** | 只在脏数据出现环时触发；且同步侧对「远端父成环」有显式打破（`syncEngine.ts:447-455`），本地移动走 UI |
| F12 回收站附件常驻云端 | Warning | **撤销** | 2GB 量级，存储成本可忽略；且这是「回收站=容器」语义的正确结果 |

### 7.3 唯一还成立的性能项：B4 的真实上界

- 触发路径：笔记处于 `local`（待上传）→ `decideUpload === "upload"` → `resolveUploadAssets` → `db.listLocalAssets` → 对该笔记 `note-assets/{noteId}/` 下**每个文件** `readFileSync` 全文 + sha256（`electron/syncAdapters.ts:153-169`）。
- **只在「该次编辑尚未同步」期间发生**：同步完成后 `markSyncedIfUnchanged` 置 synced，下一轮走 skip-fast、不再扫描（`decideUpload.ts:20-30`）。所以是**每次「编辑→同步」一次**，不是每轮同步都扫。
  **⚠️ §8.2 更正（触发面漏了一半）**：`listLocalAssets` 还被**下载侧**调用——`downloadNoteAssets` 用它做「本地已持有 size+hash」差集（`syncAssets.ts:47-52`）。所以**远端改了这篇、本端下载时同样会全量重算该篇附件哈希**。正确口径是「该篇每次**参与上传或下载**一次」。
- **上界 = 该篇笔记的附件总大小**。单附件上限：图片 25MiB（`storeLimits.ts:1`）、附件协议 100MiB / 默认配置 25MiB（`storeLimits.ts:9-16`）。
  **⚠️ §8.2 补充（内存上界，原文未提）**：`listLocalAssets` 是 `readFileSync` **整文件进内存**再算哈希 ⇒ 峰值 ≈ 单文件大小 × `ASSET_CONCURRENCY(4)`；按附件协议上限 100MiB 算最坏 **~400MiB**（流式上传 `putObjectStream` 省下的内存被哈希这一步吃回去了）。
- 判断：普通带图笔记（几十个文件、几十 MB）在 SSD 上约 0.1–0.5s，**可接受**；只有「大文件都堆在同一篇」才明显（一篇挂 5 个 100MiB 视频 ⇒ 每次编辑多约 0.5–1s）。
- **建议先实测**（编辑一篇装了几个大附件的笔记，看同步耗时），有痛感再优化。可行的优化是本地派生缓存 `(filename, size, mtime) → hash`——但注意它**紧贴 AGENTS §3 #11 红线**（禁止本机持久缓存影响资产存在性判定），必须单独立项并说明「只缓存哈希、不参与存在性判定」。

### 7.4 保留项的复现步骤（⚠️ 已按 §8 的代码级验证更正；原 F2/D2 两步验不出来）

| 问题 | 最快复现（**更正版**） | 期望的正确行为 |
|---|---|---|
| **F2 同步失败＝显示成功** | ~~改错 Secret Key~~ **验不出来**：桌面同步先 `remote.test()`（ListObjectsV2），密钥错/endpoint 不可达/桶改名都在这里抛 → UI 已报「同步失败」。正确复现：把桶里的 `manifests/latest.json` 换成**非法 JSON**（或 >20MiB 的对象）→ 点同步 | 应显示**同步失败**；修前显示「同步完成」、0 上传 0 下载（且 `SyncResult` 里连 message 都没有）。**✅ 已修**，护栏 `src/core/syncEngine.test.ts`「D2：远端 manifest 是非法 JSON → 整轮中止报错」 |
| **D1 留档失败被吞** | 把 `workspace-default/history/{noteId}` 换成**同名文件**（比 `chmod 500` 稳，不受 SIP/权限影响）→ 制造一次冲突覆盖（B 端改后同步，A 端已提交） | 应「不覆盖 + 明确报错」；修前会覆盖 B 的编辑并提示「已存历史」。**✅ 已修**，护栏 `electron/store.test.ts`「审计 260918 D1/D2」+ `src/core/syncEngine.test.ts`「审计 260918 D1：留档失败 → 整轮中止抛出，本地编辑不被覆盖」 |
| **D3 清理删未保存附件** | ① 设置→历史：「保留天数」改成 0（或「每篇上限」1）② 打开一篇有历史的笔记，粘贴一张图，**在 1s 自动保存落盘前**强退（或直接让保存失败）③ 重启（触发启动兜底清理）④ 从草稿恢复后看图 | 图应仍在；修前文件被物理删除、正文留死链。**✅ 已修**（草稿引用纳入保护集），护栏 `electron/store.test.ts`「审计 260918 D3」 |
| **D2 空快照** | ~~手工删掉 `.lake`~~ **验不出来**：`createHistorySnapshot` 第一句 `if (!fs.existsSync(lakePath)) return null`（`historyLifecycle.ts:73-75`）⇒ 文件缺失时**不写空快照**，而是**静默不留档**（同样是假「已存历史」）。正确复现：`.lake` **在**但读不出内容（权限/编码异常）→ adapter 的 `content=""` → 触发一次「编辑被覆盖」 | 应报「留档失败」；修前会写一条**空**快照并登记成功。**✅ 已修**（adapter 拒空 + 抛出），护栏同 D1 |

### 7.5 个人量级下的最终待办（本节覆盖 §5；**260918 三次复核后状态见「状态」列**）

| 优先级 | 动作 | 成本 | 状态 |
|---|---|---|---|
| **P0→P1** | 同步失败必须可见：`syncEngine.ts` 的清单 catch 不再降级为 return | S | **✅ 已修**：一律抛出（对象缺失=首次同步走 null 分支，不受影响）；顺带修掉「引擎早退后 Controller 仍删 purge 前缀 + `markPurgeSynced`」的顺序问题 |
| **P0** | 留档失败必须传播 + 内容非空校验 | S | **✅ 已修**：去掉 `syncAdapters.ts` 的静默 catch + 拒空正文；桌面手动同步的 UI 文案改为透出真实原因（原来一律「请检查网络或 S3 配置」，会把磁盘/权限问题引向错误方向） |
| **P1** | `cleanupUnreferencedAssetsForNote` 加保护：跳过 draft-journal 引用 | S | **✅ 已修**：保护集单点扩成「当前正文 ∪ 历史 refs ∪ **未保存草稿 refs**」（`AssetRepository.getProtectedRefs`）⇒ 自动清理 / 全局清孤儿 / 单条删孤儿 / 云端 GC keep 集 / GC 待回收标记**五处口径一致**。未采用「不在启动时执行」（草稿恰恰是重启后才需要保护） |
| P2 | 实测 B4；有痛感再做哈希缓存（贴着 AGENTS §3 #11 红线，须单独立项） | S（测） | 未做（唯一性能项，触发面见 §7.3 更正） |
| P2 | purge 删文件失败 → 阻断云端前缀删除 | S | 未做（D4，低频） |
| P2 | 移动端 `note_history` 补 `refs_json` / `protected_until` | M | 未做（B5/B6/D6；建议并入 HANDOFF §8.7 真机验收批次） |
| ~~P3~~ | ~~备份加「完成标记 + 校验」~~ | — | **不做**（§8.2：AGENTS §3 #17 迎合式保险；云端才是主备份） |
| ~~P3~~ | ~~回收站遍历加环保护~~ | — | **不做**（§8.2：只在脏数据出现环时触发，开发版脏数据直接重建） |

> **一句话（三次复核后）**：§1 的「规模 Cliff」在 5K/2GB 下**不存在**（按条数算 ≈5.9 万条 / ≈15 万个附件声明才撞 20MiB，当前 5–12 倍余量），连「写侧体积护栏」也不必单独做（F2 修完后「清单过大」自然会可见地失败）；真正该动手的是**与数据量无关的错误处理三条**，**已全部落地**（§8.3）。剩下的 P2 三项都不是现在的问题。

---

## 8. 三次复核（260918 · 代码级逐条验证 + 修复落地）

> 方法：对 §7 保留/撤销的每一条**实读代码 + 独立复测**（清单体积用独立脚本按 `buildUploadEntry` 字段构造实测；每条修复附代码与护栏测试位置）。本节是 §7 的勘误与落地记录，冲突处以本节为准。

### 8.1 事实更正（§7 原文错/偏差处）

| 条目 | §7 原文 | 代码级事实（更正） |
|---|---|---|
| **F2 触发面** | 「改错 Secret Key → 显示同步完成」（§7.4 复现步骤） | **验不出来**。桌面同步入口先 `await remote.test()`（ListObjectsV2，`syncEngineController.ts:34`），密钥错/endpoint 不可达/桶改名全在这里抛 → `useSyncController` 的 catch 明确弹「同步失败」。真正会走到「引擎 catch 降级」的只有：清单非法 JSON、解压后 >20MiB、`test()` 之后那次 GET 的瞬时失败/限流。**定级随之从 P0 降为 P1**（假安全窗口比宣称的窄一个数量级），但缺陷本身成立、仍值得修 |
| **D2 触发条件** | 「手工删掉 `.lake` → 会写一条空快照」 | **写反了**。`createHistorySnapshot` 第一句 `if (!fs.existsSync(lakePath)) return null`（`historyLifecycle.ts:73-75`）⇒ 文件缺失时**不写快照**，而是**静默不留档**——同样谎报「已存历史」，只是产物不是空快照。会写空快照的是另一条路：adapter `getNote` 的 `readFileSync` 被 `catch{}` 成 `content=""`（文件在但读失败）。两个坑同一处修 |
| **D5 定级** | Medium 真丢、需要跨设备 GC 保护 | **撤销 → Info**。历史快照与附件都是 **L3 纯本机**（`STORAGE-LAYERS.md` §L3），别端根本拿不到你的历史 ⇒ 「A 的 GC 删掉 B 历史引用的云端对象」里，能引用该对象的只有 B 本机，而 B 本机文件受 `getProtectedRefs` 守着不会清；B 恢复历史后再保存还会把附件重新上传（**自愈**）。真丢只剩「回收站惰性下载 ⇒ 本机从未落盘该附件 + 回收站内编辑被覆盖留档」这条极窄路径。**不改代码，只记录** |
| **B4 触发面** | 只在「编辑→同步」上传时发生 | **漏了下载侧**：`downloadNoteAssets` 用 `listLocalAssets` 做本地差集（`syncAssets.ts:47-52`）⇒ 远端改了这篇、本端**下载**时同样全量重算该篇附件 sha256。口径应为「该篇每次**参与上传或下载**一次」。另补内存上界：`readFileSync` 整文件进内存 × 并发 4，按协议上限 100MiB 算最坏 ~400MiB 峰值 |
| **D3/F6 触发概率** | 「需该篇当轮有快照被删」被暗示为罕见 | 前提其实**很常见**：`selectHistoryDrops` 对 24h 外只留「每天最新/每周最新」且 `retentionDays` 外全删（`storeUtils.ts:28-57`），任何「昨天编辑过 + 15 分钟自动快照」的笔记几乎每轮清理都有 drop。真正窄的是另一维：清理那一刻**恰好**有未保存的粘贴图（自动保存防抖 1s ⇒ 窗口 = 保存失败/崩溃/粘贴后 1s 内强退）。仍定 P1（低频但真丢） |
| **§7.1 余量口径** | 「余量 5–10 倍（按字节）」 | 结论成立，但**口径应按条数**：撞 20MiB 需 ≈**6 万条**文档或 ≈**12–16 万个**附件声明（§7.1 表的 4.08MiB@2万附件 = 实测口径一致；独立复测 5K+2万附件 = 4.30MiB/21.5%，5K+5万 = 8.19MiB/41%）。另有 `MAX_MANIFEST_NOTES=200_000` 条数上限（`syncUtils.ts:31`），字节上限先撞，写侧护栏只管字节即可 |

### 8.2 明确「不做」的（防止日后翻出来重做）

- **B1 写侧清单体积护栏**：撞限需 ≈6 万条/15 万附件，本量级 5–12 倍余量；F2 修完后「清单过大」会作为同步失败可见地暴露，届时再处理不迟。
- **F7 备份校验/完成标记**：云端才是主备份，本地导出是次要保险；加校验和属 AGENTS §3 #17 的迎合式保险。只需知道事实：导出**非原子**、半成品**不能原地重试**（`backupTargetExists` 拦），要换空目录。
- **F9 回收站遍历环保护**：只在脏数据出现环时触发；同步侧对「远端父成环」已有显式打破（`syncEngine.ts:447-455`）。开发版脏数据直接重建（AGENTS §3 #7）。
- **D5 跨设备历史保护**：见 §8.1，不改代码。

### 8.3 本批已落地（三条错误处理修复 + 护栏测试）

| 修复 | 改动 | 行为变化 |
|---|---|---|
| **F2 拉取清单失败 ⇒ 整轮中止并抛出** | `src/core/syncEngine.ts`（清单 catch 删掉降级分支）：对象缺失（=首次同步）走 null 分支不受影响；catch 里剩下的全是真失败（网络/权限/非法 JSON/过大），一律抛 `拉取同步清单失败：…`。**顺带修掉**引擎早退后 Controller 仍执行 purge 前缀删除 + `markPurgeSynced` 的顺序问题（throw 后不再到达） | 两端 UI 都显示「同步失败：原因」（移动端 `bridge.syncNow` 本就 catch 显示 message）；坏清单不再被静默跳过 |
| **D1/F1/D2 留档失败不再静默吞 + 拒空** | `electron/syncAdapters.ts` `createHistorySnapshot`：删整体 `catch{}`；空正文（=`.lake` 缺失被 catch 成 ""）抛「留档内容为空」。与移动端 `syncDbPort` 的抛出语义对齐 | 留档失败 ⇒ 该次同步在覆盖**之前**中止 ⇒ 本地编辑不被覆盖、UI 不再谎报「已存历史」。24h 同 hash 去重（返回 null）不算失败 |
| **D3/F6 草稿引用纳入保护集** | `electron/draftJournal.ts` 新增 `draftJournalDir`/`readDraftEntry`（只读）；`electron/assetRepository.ts` `getProtectedRefs` 单点扩成「当前正文 ∪ 历史 refs ∪ **未保存草稿 refs**」；`electron/store.ts` 装配注入；`main.ts` 改用共享目录函数 | 自动清理（cleanupUnreferencedAssetsForNote）/ 全局清孤儿 / 单条删孤儿 / 云端 GC keep 集 / GC 待回收标记**五处口径一致**。未采用「不在启动时执行」（草稿恰恰是重启后才需要保护）。草稿在保存成功时即删 ⇒ 保护是瞬时的，不会让真孤儿永久留下 |
| **桌面手动同步错误文案** | `src/hooks/useSyncController.ts`：catch 分支透出真实原因（原来一律「请检查网络或 S3 配置」，会把磁盘满/权限问题引向错误方向） | `同步失败：留档内容为空…` 等直接可见 |

**护栏测试**（新增/更新，`npx vitest run` 全绿 1014 passed / 16 skipped）：
- `src/core/syncEngine.test.ts`：①「D2：远端 manifest 是非法 JSON → 整轮中止报错」由断言降级 message **改为断言 rejects + 本地未被改动 + 坏清单未被覆盖**；②新增「审计 260918 D1：留档失败 → 整轮中止抛出，本地编辑不被覆盖（不谎报 superseded）」。
- `electron/store.test.ts`：①新增「审计 260918 D3：未保存草稿引用的资源不被历史清理物理删除」（含前提自证：确有快照被删；草稿清掉后恢复原语义可删）；②新增「审计 260918 D1/D2：桌面留档 adapter 不再静默吞失败」（空正文抛 / 写盘失败抛 / 正常与 24h 去重均不抛）。

**门禁（本批实测）**：`tsc` 0 · `vitest` 1014 passed / 16 skipped (1030) · 桌面 + 移动 `vite build` 全绿。

