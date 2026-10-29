# S3 v3 设备存储契约（E2-4 单实现 + 端口差异）

> 261029（E2-4 phase C-3c 收口）。范围：`src/core/s3v3DeviceStore.ts` 的**必需/可选端口**、缺失时的退化行为、
> **共享编排 + 端口差异**矩阵（§5），以及单实现 conformance 契约（§6）。
> 不涉及：协议对象布局（见 `docs/SYNC-PROTOCOL.md`）、发布锁/重试（见 `docs/SYNC-PROTOCOL.md` §12.1）、
> 迁移 v4 单实现（`docs/audit-261027/07-rfc-convergence-kernel-v4.md`）。

引擎（`src/core/s3v3Engine.ts`）只依赖 `S3v3DeviceStore`；**状态编排只有一份** =
`src/core/s3v3/state/deviceStore.ts` 的 `createDeviceStoreMeta`（loadState/saveState/saveFolders/saveQuickNotes
的决策/映射/落库顺序全在这里）。两端适配器已是**薄壳**：
桌面 `DesktopStoreDevice`（SQLite + 文件，187 行）+ `createDesktopPlatformPort`，
移动 `MobileDeviceStore`（SQLite + BodyStore + assetFs）+ `createMobilePlatformPort`；
差异只能出现在窄端口 `PlatformDataPort` / `FileDriver` / 3 个批量钩子（§5）。

**新增同步语义只改 core 共享实现 + conformance**（不再「两端各改一份」）；如果确实需要平台差异，
必须写成端口能力并登记 §5，不允许在共享层写 `if(platform)`。

## 1. 端口清单

### 1.1 必需端口（缺失/抛错 = 本轮同步失败，无降级）

| 组 | 端口 | 说明 |
|---|---|---|
| 生命周期 | `init` `loadState` `saveState` `loadBaseline` `saveBaseline` | 状态/baseline 是同步账本；`saveState/saveBaseline` 只做**投影**，不得重做 LWW/墓碑判定 |
| Lake 正文 | `readBody` `writeBody` `deleteBody` `writeHistory` `archiveBody` | `writeHistory/archiveBody` 是 best-effort 留档端口，不得因历史失败中断同步 |
| Lake 资产 | `listAssets` `readAsset` `writeAsset` `deleteAssetsDir` | 「空目录」不能推断为「用户删光附件」（见 §4） |
| 小记正文 | `readQuickBody` `writeQuickBody` `deleteQuickBody` | 小记无历史快照（产品定稿） |
| 小记资产 | `listQuickAssets` `readQuickAsset` `writeQuickAsset` `deleteQuickAssetsDir` | 同上 |

### 1.2 可选端口（缺失/异常时引擎回退；**只影响性能/体验，不改变同步语义**）

| 端口 | 桌面 | 移动 | 缺失/异常时的退化 |
|---|---|---|---|
| `readBodies` / `readQuickBodies` | 否 | 是 | 按 100 篇一批回退逐篇 `readBody/readQuickBody`；整批抛错也回退 |
| `statBodies` / `statQuickBodies` | 否 | 是 | `null`/抛错 ⇒ 全量重拉回退「读正文 + 逐条 sha256」判复用 |
| `listAssetStats` / `listQuickAssetStats` | 否 | 是 | 回退 `listAssets` 文件名 + `readAsset` 字节 + JS sha256（上传声明/差集变慢） |
| `assetNativePathFor` / `assetNativePath` | 否 | 是 | 回退 JS 字节路径；还需 `remote.getToFile/putFromFile` 才启用原生流式。优先 `For`，缺失时仅 lake 回退旧名 |
| `markQuickNoteSynced` | 是 | 是 | 单条推送不逐条清 dirty：下一轮整轮同步收尾（期间可能短暂显示「待同步」） |
| `persistSyncMarkers` | 是 | 是 | 跳过本次落盘（推送仍成功）；残留标记由下一轮整轮 `saveState` 清理 |
| `archiveQuickNote` | 是 | 是 | 退化为 `writeHistory("quick-"+id)`（小记无历史快照 ⇒ 实际不留副本）。两者语义已在 261028 对齐（桌面 `quickNotes.archiveLocalToTrash` / 移动 `MobileDeviceStore.archiveQuickNote`），本轮仍留在适配器（不在共享编排里） |

`init` 的额外约定：桌面在未注入 `QuickNotesStore` 且未 `skipQuickNotesGuard` 时**必须抛错**
（拒绝静默跳过小记），不得降级成「只同步 Lake」。

## 2. 状态与标记

`DeviceState` 里的 `remotePurged / restorePending / quickDeletes / quickPurges / quickPurgeTimes /
pendingAssets` **由引擎写**；适配器只负责持久化 + DB 投影（`cloud_deleted`、`restore_pending_at`、
`deleted_notes`），可以补充读取（DB 是恢复标记的另一来源），但不得改写语义。

- `remotePurged`：远端已彻底删除、本机保留的只读回收站副本。失效三态 = 显式恢复 / 远端同 id 复活 /
  本地彻底删除；标记内条目**不上传、不复活**，但正文/附件保留可恢复。**失效判据单点（261029）**：
  `src/core/s3v3/state/cloudDeleted.ts` 的 `settleCloudDeleted` —— 引擎 `finalizeRemotePurged`（传 `remotelyPresent`）
  与适配器 `createDeviceStoreMeta.loadState` 的 DB 投影兜底（传 `locallyPurged`）**同调一函数**，不再两层各写一份「同口径」。
- `restorePending`：唯一提前例外。显式恢复 = local-wins 重新发布，发布成功后由
  `saveBaseline/saveState/markQuickNoteSynced/persistSyncMarkers` 清标记；残留 ⇒ 墓碑永胜。
- `pendingAssets`：附件下载失败账本，下一轮开头重试，`attempts>3` 丢弃、上限 500。
- **编辑锁**：`isLocked/lockedAt` 不参与 `updatedAt`；引擎只按 `lockedAt` 做字段级 LWW。
  - 桌面端口：`setNoteEditLocked` 写 `is_locked + locked_at`，`loadState/saveState` 原样往返。
  - 移动端口：**E2-4 收口（261029）**：`listNotesSyncMeta` 读 `locked_at`、`applyRemoteEditLock` 写
    `is_locked + locked_at`、`importRemoteNote` 同批写锁字段 ⇒ 纯锁变更也按字段级 LWW 传播，两端同口径。
    契约场景 5 断言「纯锁变更传播 + lockedAt 一致」。
- `deleteMany` 属 **remote** 端口、不属 DeviceStore：桌面 = 12 并发单对象 DELETE（七牛批量 API 实测更慢），
  移动 = `DeleteObjects` 每批 1000。两套都保留，见 §5。

## 3. 删除 / 恢复 / 全量重拉

| 行为 | 契约 |
|---|---|
| 回收站（软删） | 条目保留 `trashedAt`、正文/附件不删、**不写墓碑**；桌面用 `TRASH_NOTEBOOK_ID` 表示父，移动用 `trashed_at + deleted_from_parent_id`（存储表示不同，对外语义已由场景 6/7 对齐） |
| 彻底删除（purge） | 索引移除 = 删除；对象按前缀清 `objects/{id}-`、`assets/{id}/`、`meta/assets/{id}/`；本机连历史一起清（两端一致） |
| 对端收到 purge | 本机副本进回收站 + `cloud_deleted` 投影，连续多轮不得回传；新设备从没见过 ⇒ 无法恢复（用户 261026 接受） |
| 显式恢复 | 恢复标记 ⇒ local-wins 重新上传 active，清 `cloud_deleted`（场景 6） |
| 全量重拉 `resetFromCloud` | `pullAll(archiveLocal=true)`：本地独有条目**软删进回收站 + 打标**、保留正文/附件/历史、**不上传**（I0，261027/261028）；小记同样走「软删进小记回收站 + cloud_deleted」= core 统一判据（场景 8） |

同步路径**禁止**因「本轮 state 里没有」物理删正文/历史（例外见下）。该判据现在只有一份
（`createDeviceStoreMeta.saveState` 的 missing 分支）：**本地有行、本轮 state 没有** ⇒ 该端口的
「本地 purge」语义：
- 桌面不实现 `purgeLocalNote` ⇒ core 回落 `deleteNote`（软删进回收站 = 迁移前桌面 I0 语义，行为不变）；
- 移动实现 `purgeLocalNote`（写 `deleted_notes` 墓碑 + 删行/正文，保持迁移前移动语义）。

因此**引擎必须把「远端 purge 后的本地副本」以 trashed 条目留在 state 里**（场景 7/8 钉住），
不能指望端口自己区分「远端删了」与「用户删了」。小记的 missing 三态（purge / 曾同步过⇒软删打标 /
从未同步⇒物理删）也全在 core；移动的 `purgeOrphanQuickNote` 不参与（`listMissingQuickNoteIds` 恒空）。

## 4. 资产声明与 deferAssets

- 声明 `meta/assets/{noteId}/{declHash}.json` 是内容寻址的**不可变**权威快照；索引靠 `assetsHash` 引用。
  PUT/GET 永远全量声明；只对声明差集搬字节；禁止逐对象 HEAD/GET 当存在性判据。
- **声明保留（数据安全，261026 真机事故）**：本地资产目录为空 **不等于** 用户删光附件
  （首拉未完成/按需下载未落地/外部清缓存都会为空）。上传分支必须保留远端声明，并顺手按声明补拉；
  否则新索引会声明「无附件」，随后 GC 把云端附件当孤儿物理删除。
- `deferAssets` 是**首拉策略**（引擎选项，默认 false）：true 时只拉 pointer/索引/正文/声明，媒体字节延后。
  注意：普通增量轮**不会**重新调度已就绪条目的缺失资产（失败才进 `pendingAssets`）；按需补拉走
  打开/预览的 `backfillV3Assets` 或下一次全量重拉（场景 9 钉住）。
- `listAssets/listQuickAssets` 可以返回空数组表示「本机暂时没有」，但**不得抛错伪装成空**；抛错会被
  上层当成异常路径。
- E2-4 后「声明保留 / 差集 / 自愈补拉 / 待补资产账本」全部在 core（`applyPlan/applyAssets/roundPorts`），
  端口只负责列名/读字节/写字节；**不要再在适配器里加第二套存在性判断**（`listAssetStats` 例外：
  移动端原生清单只用于加速，判定仍在 core）。

## 5. 共享实现 + 端口差异（E2-4 phase C-3c 收口，261029）

> 背景：E2-4 之前桌面/移动各自实现 `saveState`，本节曾是一张「双端漂移 8 条」对账表；切换后状态的
> 决策/映射/落库顺序全部在 `src/core/s3v3/state/deviceStore.ts` 的 `createDeviceStoreMeta` + 引擎里，
> 平台只剩窄端口（`PlatformDataPort` / `FileDriver` / 3 个批量钩子）。因此**「同一语义两处实现」已消除**；
> 下表剩余的全部是**端口级表达差异**（不是待修漂移清单），逐条登记以便后续重构不把它们当成 bug。

| # | 端口级差异 | 桌面端口 | 移动端口 | 性质 / 断言位置 |
|---|---|---|---|---|
| 1 | 编辑锁时间戳 | `setNoteEditLocked` 写 `is_locked + locked_at`；`applyRemoteEditLock` 原样往返 | **E2-4 已对齐（261029）**：`listNotesSyncMeta` 读 `locked_at`、`applyRemoteEditLock` 写 `is_locked + locked_at`、`importRemoteNote` 同批写锁字段 | 已对齐（不再是缺口）：纯锁变更按字段级 LWW 传播；契约场景 5 断言 `locked` + `lockedAt` 两端一致 |
| 2 | 移动 quick purge 语义 | `quickNotes.purgeQuickNote`：物理删行 + 墓碑 | `purgeQuickNote` 遇到「行仍在的 purge」按他端墓碑处理 ⇒ 保留 quick 回收站副本 + `cloud_deleted`（正文/图片/标签不删） | 用户 261026 定稿「被他端判定缺失的本地副本保留在回收站」；真正不可恢复删除发生在用户本地 purge（行已被移动端删掉，端口路径不可达） |
| 3 | 回收站 parent | 父 = `TRASH_NOTEBOOK_ID` | 父 = 原父，回收站用 `trashed_at + deleted_from_parent_id`；`importRemoteNote` 对 trashed 行用 `deletedFromParentId` 作 parent，`applyRemoteNoteMeta` 对 trashed 行**不写 parent** | 语义一致、存储表示不同（C5 兜底都在 core）；契约场景 6/7 + 目录兜底用例覆盖 |
| 4 | 回收站时间戳 | `store.deleteNote` 自管（自带时间） | 取本轮 state 的远端 `trashedAt`（`MobileDeviceStore.saveState` 写进端口上下文） | 语义一致（都必须落远端时间，不能用本地 now，否则 LWW 漂）；`mobilePlatformPort.test` 钉住 |
| 5 | 批写窗口 | 无钩子（正文 staging 在 JS 内存，saveState 逐条落） | `beginWriteBatch/flushWriteBatch`（语句攒一批 `executeSet` 提交）+ `moveStagedBodyFiles`（staging 文件搬最终路径；先文件后行） | 语义一致；纯性能/崩溃窗口差异（`mobilePlatformPort.test`：500 篇 = 1 次 executeSet / 500 条 INSERT） |
| 6 | 原生资产路径 | 无 `assetNativePathFor`（JS 字节路径） | 提供 `assetNativePathFor`（原生流式 PUT/GET，字节不过 JS 桥） | 语义一致；纯性能差异（`nativeAssetTransfer` / `nativeAssetSync` 护栏） |

**非 DeviceStore 的保留差异**（不在本契约统一，原表结论保留）：

| # | 项 | 桌面 | 移动 | 结论 |
|---|---|---|---|---|
| a | 批量删除 | 12 并发单 DELETE | `DeleteObjects` 1000/批 | 有意保留（provider 性能模型不同，无语义依赖） |
| b | gzip PUT 元信息 | 只加 `ContentEncoding` | 额外 `ContentType: application/octet-stream` | 有意保留（读路径只认 `ContentEncoding`；可无损消除，非必须） |
| c | deferAssets 默认 | 默认 false（只有显式 true 才写） | 新设备默认 true 并固化 | 产品口径（设置层），引擎默认值不变（用户 261028 裁决） |
| d | 状态读取成本 | `hashCache` 持久化 + baseline 二次加载 | 每轮多次 `loadV3State` | 性能非语义；可消除点归 SD-07 残余 |

**明确不做**：不再为端口差异写 `capabilities` 条件分支（契约只跑移动 harness；差异登记在本表 + 定向测试）；
不统一锁字段/批量删除/默认值；不改 UI/样式/类名几何。

## 6. conformance：单实现契约 + 跨端混合

E2-4 切换后**只有一份状态编排**，因此契约测试只有一份、只跑一次：

| 文件 | 形态 | 覆盖 |
|---|---|---|
| `src/mobile/v3/deviceConformance.mobile.test.ts`（21 it） | 单实现契约（移动端口 harness，`defineDeviceContract`） | 共享编排 + 移动端口语义：首传/空跑、双设备首拉、双端/三端编辑收敛、锁传播（端口差异 #1）、恢复、purge、全量重拉、deferAssets、声明保留、正文中断重试、附件失败重试、墓碑三态、cloud_deleted 投影、目录兜底与删除传播、弱网 4 例 |
| `electron/s3v3/deviceConformance.mixed.test.ts`（3 it） | 桌面 × 移动接同一 `MemoryRemote` 的并发收敛 | 首次并发首传、并发改不同文档、同时改同一篇 |
| `electron/s3v3/desktopStoreAdapter.test.ts` / `electron/store.test.ts` | 桌面薄壳 + Store 端口语义 | 桌面端口（hashCache、延迟删资产目录、锁往返、小记库护栏） |

**已删除**：`electron/s3v3/deviceConformance.desktop.test.ts`（旧「双端对拍」的第二份运行 —— 同一共享实现重复跑；
桌面端口已由 mixed + 上表两个文件覆盖）。端口差异不再用 `capabilities` 钉住。

场景矩阵（10 个语义场景，编号与任务/报告一致）：

| # | 场景 | 用例 |
|---|---|---|
| 1 | 首传 | 「首轮上传建立基线；空跑零下载零写入」前半 |
| 2 | 空跑 | 同上后半（第二次 sync 0 下载/0 PUT） |
| 3 | 双设备 | 「第二台设备首拉拿到同 id / 同正文」 |
| 4 | 编辑收敛 | 「双端编辑互相同步」/「三端交错编辑」 |
| 5 | 锁传播 | 「【场景 5】锁传播…」（按端口差异 #1 断言） |
| 6 | 恢复 | 「【场景 6】恢复：从云端已删副本显式恢复…」 |
| 7 | purge | 「【场景 7】purge：发起端删对象…」 |
| 8 | 全量重拉 | 「【场景 8】全量重拉：本地多出的条目软删…」 |
| 9 | deferAssets | 「【场景 9】deferAssets…」 |
| 10 | 声明保留 | 「【场景 10】声明保留…」 |

## 7. 改本契约的检查清单

1. 新端口默认**必需**；要可选必须写清「缺失时引擎怎么退化」，并在 `s3v3DeviceStore.ts` 注释 + 本文件同步。
2. 新同步语义只改 `src/core/s3v3/state/deviceStore.ts`（共享编排）+ 契约用例；**不要**在共享层写 `if(platform)`。
3. 确实需要平台差异 ⇒ 做成端口能力（或钩子），并在 §5 登记；差异用定向测试断言，不写条件分支。
4. 任何「空集合/读失败」都先问：是「没有」还是「还没到」？同步路径只允许保守（保留声明/软删/留历史）。
5. 跑：`npx tsc --noEmit`、定向 `vitest`（`src/mobile/v3/deviceConformance.mobile.test.ts` + `electron/s3v3` 全目录 + `electron/store.test.ts` + `src/mobile/v3` + `src/mobile/data`）、`git diff --check`。
