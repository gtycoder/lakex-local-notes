# 05 迁移/基线/恢复路径审计（261124 · 范围⑤）

审计人：audit-task-5（只读）｜日期：2026-11-24｜范围：portable/bootstrapBaseline/导入映射/基线文件/firstEncounter 交互/workspaceRestoreFromBackup。判据来源：docs/PORTABLE-TRANSFER.md §3、docs/SYNC-PROTOCOL.md §21、AGENTS §3#15/§4。协议设计（删除压编辑、墓碑权威、恢复唯一例外）不计为发现。

## 一句话结论

迁移主通道（bootstrap 底稿合成、绝不落拉全轮、导入清账本、基线丢失硬失败）与规格逐条对得上，261124 P0 的「base 有/远端无 ⇒ 批量回收站」主通道已被首次相遇闸门 + §3.1 顺序边界收敛；但发现 **1 条 P1 级静默丢数据**（Batch4-A 恢复的回滚分支会删掉未参与恢复的小记库）与 **1 条 P1 级语义缺口**（首次相遇四选项的**目录侧**没有接改写层，「只增不删」保命通道对目录失效），另有 261124 P0 同族的「文档当父」断链（手机→桌面反向映射换树 id 不改写子级引用）等 P2/P3 若干。

## 发现列表

### P1-1｜workspaceRestoreFromBackup 回滚分支误删「未参与恢复」的小记库（静默、不可恢复）

- **现象**：`restoreMainDatabaseFromBackup` 的 catch 回滚段无条件 `rmSync` 当前小记库，即使本次恢复**根本没动它**（备份里没有 quick-notes 库）。
- **证据**：`electron/workspaceRestoreFromBackup.ts:244-247`：
  ```
  for (const suffix of ["", "-wal", "-shm"]) {
    try { ops.rmSync(currentDbPath + suffix, { force: true }); } catch {}
    if (currentQuickNotesDbPath) { try { ops.rmSync(currentQuickNotesDbPath + suffix, { force: true }); } catch {} }
  }
  ```
  判据是 `currentQuickNotesDbPath` 而不是 `restoreQuickNotes`（:184 `restoreQuickNotes = !!currentQuickNotesDbPath && existsSync(quickBackupPath)`）。成功文案 :238-240 明说「备份中无小记库，**小记库保持不动**」——回滚实现违反自己的意图契约。且 :248-251 的 `rolledBack` 只按 `moved`（被隔离过的主库）计算 ⇒ 小记库已删仍报「已回滚，原库未变」。
- **影响面**：用户拿「只有主库」的备份（老备份 / 手工拷贝的 metadata*.sqlite3）做恢复，且换位段任一步失败（磁盘满 copyFileSync、:221-222 落位校验失败）⇒ **当前小记库（全部小记 + 标签关系）被静默删除，隔离目录里也没有副本**，不可恢复。
- **最小复现**：注入 `fsOps` 让 `copyFileSync(backupPath → temp)` 抛错；`currentQuickNotesDbPath` 指向一个活的小记库、备份目录不含 quick-notes/ ⇒ 断言小记库文件已消失、返回值却 `rolledBack: true`。
- **建议修法**：条件改为 `restoreQuickNotes && currentQuickNotesDbPath`；更稳的是「只删/只回滚 `moved` 清单里出现过的路径」，把「rm 范围 = 隔离清单」写成不变量。

### P1-2｜首次相遇四选项的**目录侧**未接改写层——「只增不删」仍会把本地独有目录收进回收站

- **现象**：`planLakeMerge` 的 folders 循环完全不走 `applyEncounterAction`（改写层只作用于 notes 与 quickNotes）；additive/local-wins 的目录语义与 SYNC-PROTOCOL §21.2 表格不符。
- **证据**：
  - `src/core/s3v3Merge.ts:173-175`（notes 过 `applyEncounterAction`）vs `src/core/s3v3Merge.ts:237-278`（folders 循环无任何 encounter 映射；仅 :275 与 :283-286 两处 cloud-wins 特判）；
  - `src/core/s3v3Merge.ts:255-257`：本地独有目录在「base 有且 updatedAt 未超 base」时恒判 `remote-purged-trash` ⇒ `src/core/s3v3/plan/plan.ts:318` `remove-folder`（本地目录从合并世界消失、被收敛路径收走）；
  - 规格承诺：SYNC-PROTOCOL §21.2「只增不删 = 本机内容全部上传，**本轮双向都不删**」；PORTABLE-TRANSFER §3.2「若用户判断桶/前缀配错，选『只增不删』**即可全量保本机**」。
- **影响面**：P0 用户场景的标准流程可直达——纯离线包导入（bootstrap 底稿**包含全部目录**）→ 配了已有数据的桶 → 首次相遇弹窗选「只增不删」（文档钦定的保命通道）→ 本地独有目录全部被判「云端已删」收进回收站，而文档被正确映射成 upload 上传 ⇒ 目录没了、文档还在且父已入回收站的半损坏状态。另两处同族偏差：
  - local-wins 下「基线认识的远端独有目录」走 `s3v3Merge.ts:263` `local-delete` = 从云端**发布缺席**（他端目录进回收站），而 §21.2 承诺「基线认识 ⇒ 普通 download」（根因同 P2-2）；
  - cloud-wins 下「本地独有且 base 缺」的目录 upload 被 :285 压掉但不落回收站（§21.2「本地独有 → 回收站」只近似成立）——这一条属已知近似，但 §21.5「已知近似」并未登记目录侧，属登记缺口。
- **最小复现**：`planLakeMerge({base 含 f1, local 含 f1(updatedAt 同), remote 无 f1}, ctx.encounter="additive")` ⇒ `folders` 里 f1.kind === "remote-purged-trash"（期望 upload）。
- **建议修法**：目录循环套同一改写层（补 folder 版映射，至少：additive 下 remote-purged-trash→upload；local-wins 下 local-delete→download / download→download-to-trash 同 notes 豁免规则）；若有意保留近似，必须写进 §21.5 并在弹窗文案里说明。
- **测试缺口**：`src/core/s3v3/plan/firstEncounterPlan.regression.test.ts:27-62` 只钉了文档（全部断言 id==="n1"），目录零覆盖。

### P2-1｜mobileToDesktopMapping 反向映射给 note 节点换新树 id 却不改写子级 parent 引用——「文档当父」导入后断链（261124 P0 同族）

- **现象**：手机行的 `parent_id`/`deleted_from_parent_id` 是**业务 id**（note id）；反向映射给每个 note 节点生成**新的树 uuid**，但子级引用原样拷贝 ⇒ 子文档的父引用指向一个不存在的树 id。
- **证据**：
  - `electron/portable/mobileToDesktopMapping.ts:224-232`：`const treeId = newTreeId(); treeNodes.push({ id: treeId, ..., note_file_id: id, parent_id: parentId, ...})`；:247 `notes.parent_id = parentId` 同样原样；:239-240 `deleted_from_parent_id` 同族。
  - 桌面不变量是「tree_nodes.id == note_file_id == notes.id」：`electron/store.ts:893-894`（本地新建）与 `electron/remoteImportRepository.ts:134`（同步导入）都用 note id 当树 id。
  - 树链接判据是**树 id**：`electron/noteQueries.ts:218-226`（trash 递归 CTE `t.parent_id=ti.id`）、`electron/store.ts:592`（启动快照 `EXISTS (SELECT 1 FROM tree_nodes p WHERE p.id = notes.parent_id)`）、`electron/trashLifecycle.ts` 级联展开同型。
- **影响面**：手机里「文档下多级子文档」（AGENTS §3#5 一等能力）经手机快照导入桌面后：① 子文档在树里找不到父（孤儿/不显示）；② 删父文档时 `deleteTreeNode` 按树 parent_id 级联，**漏掉整棵子树**（删父留子）；③ 恢复回原位（deleted_from_parent_id）同样失效；④ 用户之后把子文档再拖到该父下，`moveTreeNode`（`electron/noteMetadataRepository.ts:281`）把父写成父节点的树 uuid ⇒ `listNotesSyncMeta`（`electron/store.ts:607` 直取 `n.parent_id`）把 uuid 当 parentId 发布 ⇒ 他端 `resolveRemoteParent` 解析不了（uuid 既非目录 id 也非 note id）⇒ 回落兜底笔记本 + metaDiffers 每轮重写、脏 parent 上云——正是 261124 P0 的复发通道。
- **最小复现**：`mapMobileToDesktop({ notes: [{id:"p",parent_id:"nb1"},{id:"c",parent_id:"p"}], folders:[{id:"nb1",node_type:"notebook",...}], ... }, { newTreeId: () => "t-" + (++n) })` ⇒ c 的树行 parent_id === "p"，而 p 的树行 id === "t-1"，断链。
- **建议修法**：note 树节点直接用业务 id 作树 id（与 createNote/importRemoteNote 同不变量，schema CHECK 只要求 note 行有 note_file_id）；或建 businessId→treeId 映射，第二遍改写全部 `parent_id`/`deleted_from_parent_id`。
- **测试缺口**：`electron/portable/mobileToDesktopMapping.test.ts:22-41` 只测单层 note，无「文档当父」用例。

### P2-2｜目录删除判据拿「基线在场」当删除意图（判据拿错输入）

- **现象**：文档判「本地缺失 ⇒ 是否传播删除」要求**持久删除意图**（`decideItem` 的 `localPurgeIntent`），目录却只要「基线里有」就判 local-delete。
- **证据**：`src/core/s3v3Merge.ts:260-264`：`if (!l && r) { if (b) folders.push({kind:"local-delete"...}) else ...download }`；对照 `src/core/s3v3Decision.ts:36`（文档同形状必须 `localPurgeIntent` 才 local-purge-wins，否则 :51 download）与 AGENTS §3#15「判据 = 设备本地基线 + 持久删除意图」。
- **影响面**：稳态同步里 purge 墓碑会先进 :241-245 的 folderPurgeIntents 分支，此判据平时无感；但**迁移路径**正好从「行缺失」进：包内云端基线有该目录、映射后的行缺失（mapper 跳过坏行 `mobileToDesktopMapping.ts:159` / `portableMapping` 同型；或导出可用性放宽后带脏快照导出）⇒ 首同步把该目录发布缺席 ⇒ 他端整棵目录进回收站（级联子文档）。
- **最小复现**：`planLakeMerge`（base 有 f1、local 无 f1、remote 有 f1、`folderPurgeIntents` 为空）⇒ kind === "local-delete" 且 `plan.publish` 排除 f1（期望 download）。
- **建议修法**：与文档同判据（folderPurgeIntents / deleted_notes 墓碑才判删除），否则 download。

### P2-3｜workspaceRestoreFromBackup 隔离目录名秒级撞名（replaceWorkspaceWith 已修的 P0-2 同型残留）

- **证据**：`electron/workspaceRestoreFromBackup.ts:60-62`（`timestamp` 截到秒）+ :191（`corrupt/restore-<ts>` 无唯一后缀）；对照 `docs/PORTABLE-TRANSFER.md:110`：workspace 换位路径已因「同秒二次导入/恢复撞名毁工作区」修为 `<ISO 秒>-<单调序号><随机尾>`。
- **影响面**：同秒两次恢复（双击恢复按钮）⇒ 第二次 `renameSync` 覆盖第一次隔离目录里的 `metadata.sqlite3` ⇒ 第一次的**原库回滚副本被静默销毁**。
- **建议修法**：同 replaceWorkspaceWith 的唯一命名；补 `workspaceRestoreUniqueQuarantine.test.ts`。

### P2-4（待复现）｜Batch4-A「从数据库快照恢复」只换两库、不换 sync-v3 ⇒ 旧库 + 新基线 ⇒ 首同步旧内容覆盖云端

- **证据**：`workspaceRestoreFromBackup.ts` 全流程不触碰 `sync-v3/`（grep 0 命中）；恢复的是旧快照的行，`baseline.json.gz` 仍是恢复时刻的最新基线 ⇒ 合并里 `decideItem:58`（lChanged && !rChanged ⇒ upload）把旧内容当「本地后改」上传，全端被 download 覆盖。PORTABLE-TRANSFER §4 只说该档「不承担整库语义」，未登记此同步后果。
- **待复现点**：需实测一例「恢复旧库 → 立即同步」确认发布内容与告警缺失。
- **建议**：恢复成功提示里追加「同步基线与库快照不一致，建议先『从云端恢复』或关闭云同步」；或恢复时把 sync-v3 一并隔离/重置。

### P3-1｜targetKey「去 region」的边缘不一致（无害噪声 + 短键自匹配）

- `src/core/s3v3Engine.ts:357-361` `stampTargetKey` 用裸 `!==`（region 参与）⇒ 两端 region 填法不一致时每端首轮重写一次基线盖章（无判据影响，`staleTarget` 用的是 `sameSyncTargetKey`）；`firstEncounter.ts:212-214` `s3SettingsChanged` 同为裸比较——但这是配置探测（仅提示），与 §21.3「任一变化重探」一致，不算偏差。
- `firstEncounter.ts:48` `pick` 对不足 3 段的截断键按 `[p0,p1,p2]=undefined` 比较 ⇒ 两个同样截断的键互判「同目标」。建议短键直接判不等。

### P3-2｜MobileV3Baseline 类型注释与实际结构漂移

- `src/mobile/data/v3StateRepository.ts:10-19` 注释称「与 DeviceBaseline 结构一致」，但 core `src/core/s3v3DeviceStore.ts:91-92` 有 `targetKey?: string`（引擎 saveBaseline 盖章用），移动类型未声明（运行时靠 JSON.stringify 透传，无功能故障；`isPlausibleBaseline` 也不校验它）。建议补字段以免后续「结构一致」假设被当真。

### P3-3（待复现，极小概率）｜手机快照合成底稿失败 + 快照无 sync-v3 目录时残留旧基线文件

- `src/mobile/portable/importPortable.ts:412-421`：`hasBaseline !== true` 且 `buildBootstrapBaseline` 抛错 ⇒ 只告警、按「无基线」继续，**不写不删**基线文件；而 `PortablePackagePlugin.kt:1006-1008` 快照缺 `mobile/files/sync-v3` 目录时 `continue`（不删本机旧 sync-v3）⇒ 目标机若曾同步过，旧 `baseline.json.gz.b64` 会被 `readPersistedBaseline`（文件优先，`v3StateRepository.ts:96-97`）当「正常基线」读出，与恢复后的行错配（合并 base 错位）。触发需「合成失败（行整体损坏）+ 快照无 sync-v3 + 目标机有旧基线」三重叠加。建议：合成失败分支显式 `deleteBaselineFile` 或改走硬失败。

### P3-4｜手机快照路的合并底稿把「小记回收站」条目当活跃（与桌面侧口径不一致）

- `src/mobile/portable/importPortable.ts:313-315` `readBootstrapRowsFromDb` 读 `quick_notes` **不滤 deleted_at**，且 `bootstrapRowsFromMobileRows` 的 QuickNoteEntry 不带删除态 ⇒ 软删小记以活跃形态进 bootstrap 底稿；桌面侧无此问题（桌面 quick_notes 无 deleted_at 列，软删只在 quick_note_deleted 账本，`bootstrapFromWorkspace.ts:117-129`）。影响：该条目 base 有/远端无 ⇒ 首同步被判「云端已删」（它已在回收站，幂等无感；但用户导入后先恢复再同步会被误伤回回收站）。建议该 SELECT 过滤 `deleted_at IS NULL`。

## 已核实无问题（点名查过什么、为何没问题）

1. **bootstrap 合成的 fail-safe 方向**（`src/core/portable/bootstrapBaseline.ts:35-39,71-91`）：坏 id/坏 hash/重复 id 逐条丢弃——丢出 base 的条目在合并里只会被当「新增」（`decideItem:39-46` 空 base 分支），**不会**误判删除；整体校验不过才抛错。方向安全。
2. **「绝不落拉全轮」四分支核对**（`src/core/s3v3Engine.ts:375-444`）：bootstrap 基线一律血缘对齐后走合并轮（:402 `rebaseBootstrapBaseline`、:421-422 首次相遇底稿、:434-435 竞态路径同口径）；只有真正无基线才 `syncPullAllRound`；有基线无 pointer 显式失败（:443）。与 PORTABLE-TRANSFER §3.1 逐条一致。
3. **「迁入后首同步批量回收站」主通道**：bootstrap ⇒ `noRelationship` ⇒ 云端非空必先问（:383/389-398，facts 带本机/云端/重合数）；「导出后云端删改的照常传播」是 §3.1 明文设计（删除压编辑不变），错桶大缺席风险已由 §3.1「顺序边界（261201 P2-B）」登记 + §3.2 弹窗兜底 ⇒ 不计新发现（目录侧缺口除外，见 P1-2）。
4. **导入后 intents/remotePurged/quickDeletes 残留**：移动覆盖导入 `clearImportedTables` 删 `sync_v3_state`（`importPortable.ts:338-344`）+ `saveV3State(EMPTY_MOBILE_V3_STATE + baseline)`（:546）；桌面导出白名单**不含** `sync-v3/state.json`（`portableExport.ts:9`），desktop-workspace 导入整区换位 ⇒ 账本不带入；手机快照恢复整目录替换 sync-v3（`PortablePackagePlugin.kt:75` SNAPSHOT_DIRS 含 sync-v3、:1011 先 deleteRecursively）⇒ 无残留。删除意图按设计由 `deleted_notes.purged_at`/`quick_note_deleted` 行重建（`deviceStore.ts:335-346`），跨迁移延续删除传播是协议语义。
5. **基线损坏/丢失/陈旧语义**：`readBaselineFile` 永不抛（missing/corrupt 两态，`v3BaselineFile.ts:111-134`）；坏结构不认（`isPlausibleBaseline` :88-100）；`readPersistedBaseline` 四态 file/migrated/absent/lost（`v3StateRepository.ts:95-108`）；同步路径对 lost **硬失败**（`SyncBaselineLostError`，`mobileDeviceStore.ts:175-176/205-208`），绝不降级 pull-all（防小记物删）。
6. **测试基线串库**：`src/mobile/testSetup.ts:22-24` 每用例 `resetMemoryBodyStore`（跨用例不串）；多设备用例均已注入 `setBaselineFileForDbForTest`（childDocs / remParity / bootstrapMigration / s3MigrationScale / mobileDeviceStore / mobileCloudDeleted / mobileTagAbsenceSync / firstEncounter.s3.integration）；conformance 两套（`deviceConformance.mixed.test.ts` / `deviceConformance.mobile.test.ts`）用 per-device `fsBackend(root)` + `setBodyStoreBackendForTest` 隔离根，操作包在 `use()` 里顺序执行。**点名残余风险**：`quickPushSnapshot.test.ts` 单用例内两个 `seeded()` 设备共用默认基线路径（同夹具 ⇒ 当前无假绿，但测不出设备基线分叉）；conformance 两套的全局后端在**并发交错**调用两个移动设备时会串根（当前无并发用例，待复现预防）；`quickPushFastPath / mobileBaselineGuard / historySnapshot / mobilePlatformPort / mobileTagPendingSuppress / mobileBaselineFile` 均为单设备/同库多实例，无跨设备串库面。
7. **workspaceRestoreFromBackup 主路径**：校验先行（quick_check + 关键表 + 外键零违反，:75-97）、隔离只改名不删（:195-212）、落位后二次校验（:221-222/231-232）、WAL/SHM 边车拷贝（:216-220）——问题只在回滚分支（P1-1）与命名（P2-3）。
8. **写后逐表计数复核**（`importPortable.ts:515-530`，去重主键口径）＝261124 丢行事故的回归护栏，且结果计数以复核实测值上报（:552-566 `baselineSource` 按实际写入上报，P2-C 口径一致）。
9. **targetKey 主判据两端接线**：`staleTarget` 用 `sameSyncTargetKey`（去 region，261124 修复）于 `s3v3Engine.ts:382`；两端都传 `targetKeyOf`（`electron/s3v3/desktopSync.ts:165`、`src/mobile/v3/sync.ts:75`）；无设置行留空不抛（:164 注释口径一致）。
10. **quickPurged 只收 `purged_at` 非空**（`bootstrapRowsFromMobileRows`，`importPortable.ts:301`）——软删小记不会被合成进不可恢复墓碑；`saveV3State` 的 `null ⇒ deleteBaselineFile`（`v3StateRepository.ts:198-200`）防覆盖导入残留旧基线。
11. **两端 baseline 落点同构**：桌面 `sync-v3/baseline.json.gz` / 移动 `sync-v3/baseline.json.gz.b64`（gzip+base64 承载，读侧按 magic 自适应，`v3BaselineFile.ts:121-127`）；生产单进程单设备固定路径（:24），多设备隔离只在测试注入（:27-37 有护栏注释）。

## 建议新增护栏（测试名 + 断言要点）

1. `electron/workspaceRestoreFromBackup.rollbackKeepsUntouchedQuickDb.test.ts`：`restoreQuickNotes=false` + 注入 `fsOps` 让换位段抛错 ⇒ 断言小记库三件套（/-wal/-shm）原样存在、返回文案不得称「原库未变」。
2. `src/core/s3v3/plan/firstEncounterFolderMapping.test.ts`（plan 级，目录回归）：
   - additive ×（base 有/远端无）目录 ⇒ 非 remote-purged-trash（应 upload）；
   - local-wins ×（基线认识、远端独有）目录 ⇒ download，publish 不得排除它；
   - cloud-wins ×（本地独有、base 缺）目录 ⇒ 与 §21.2 的回收站语义一致或显式登记近似。
3. `electron/portable/mobileToDesktopMapping.docParent.test.ts`：p（父文档）+ c（parent=p）+ t（trashed，deleted_from_parent_id=p）⇒ 断言 c/t 的树 parent 引用能解析到 p 的树行；`importMobileSnapshot` 端到端再断言 `listTreeNodes` 级联可见、`deleteTreeNode(p)` 能带走 c。
4. `src/core/s3v3Merge.folderDeleteRequiresIntent.test.ts`：base 有/本地无/远端有/无 folderPurgeIntents ⇒ 不得 local-delete（应 download）。
5. `electron/workspaceRestoreFromBackup.uniqueQuarantine.test.ts`：同秒两次恢复 ⇒ 两个隔离目录、两份原库副本都在。
6. `src/mobile/v3/mobileBaselineIsolation.guard.test.ts`（哨兵）：同用例建两个 `MobileDeviceStore`（不注入路径）各自 saveBaseline ⇒ 断言互不可见；今天会红 = 提醒多设备用例必须注入（或改为静态检查）。
7. `（待 P2-4 复现后）batch4RestoreBaselineSkew.test.ts`：恢复旧库 + 现基线 ⇒ 首轮不得静默把旧内容发布覆盖云端（或至少产出 warning/warningDetails）。
