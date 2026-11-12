# 14 · S3 全场景矩阵（阶段①：清单 + 覆盖盘点）

> 只读盘点 + 文档（未改任何生产代码）· 2026-11-12 · 阶段①写作基线 = HEAD `2d79f78f`；**覆盖计数复核 = HEAD `903a47aa`**（task-44 / task-47 / task-62 / task-66 / task-73 已提交；`electron/s3v3/scenarioMatrix.test.ts` 与 `src/mobile/v3/scenarioMatrix.mobile.test.ts` 已随提交入库）。
> 目标：同步验收不能只靠「三个已知缺陷修好」，要用**场景矩阵**证明常规使用下多端不异常 / 不丢数据 / 不卡死。本文 = 阶段①（场景清单 + 已有覆盖盘点），阶段②按本表补装置与用例。
> **档位**：**A** = MemoryRemote / 双端 conformance harness（`npx vitest` 可跑，CI 档）；**B** = 真实七牛桶子集（唯一前缀 `audit-261112-scn-<stamp>`，三桌面实例，只 DELPREFIX 清理，0 残留）。
> **覆盖状态**：**已有** = 现有测试直接覆盖该断言；**部分** = 有相邻用例/纯逻辑测试，但缺该场景的端到端断言；**真空** = 无任何用例。
> 每条场景的通用判定 = **两端最终一致 + 云端索引状态符合预期 + 无人卡死（无整轮抛错/永久失败）**；表中只列"该场景额外必须钉死"的断言。

## 0. 总览（写作后自动统计）

- 场景总数：**74**（A 档 58 / B 档 1 / A+B 15）。
- 覆盖：**已有 45 / 部分 28 / 真空 1 / 失败 0**（按 HEAD `903a47aa` 重算；阶段②首批 + task-62/66/73 修复 + task-76 收口，见 §0.3–§0.5 与附录 D）。
- 剩余真空 **1 条**：S19 目录重建同 id（需目录显式 id 重建入口，非本批优先级）。S08 / S50 / S53 / S05 / S13 已在 §0.5 收口为「已有」。
- 阶段②发现并已修：**F-01 S17 purge group**（task-62，P0）、**F-01b** 云端 folders[] 残留已 purge 目录（task-77，`fa2fbdad`，见附录 D）。
- 现有可复用的「跨端契约」底座：`electron/s3v3/deviceConformance.ts` 的 `defineDeviceContract`（19 条共享场景，桌面 = `deviceConformance.mixed.test.ts`，移动 = `src/mobile/v3/deviceConformance.mobile.test.ts`）；`electron/s3v3/syncEngine.test.ts`（16 条协议/引擎）、`src/core/s3v3/plan/plan.test.ts`（21 条决策）、`src/core/s3v3/state/deviceStoreMeta.test.ts`（17 条应用层）、`src/core/s3v3/quickPush/*`（10+5 条快路径）、`src/core/s3v3LockContention.test.ts`（4 条锁竞争）。
- **真空集中在四类**：① 生命周期×编辑并发（本地 trash×他端编辑 / purge×编辑 / 恢复×删除同时）；② 结构×移动并发与深层目录（移动不被编辑回滚、深 3 层、group purge/重建、附件随正文迁移）；③ 锁×编辑/锁×回收站；④ 时钟偏差与三端含删除的收敛。

### 0.3 阶段②执行记录（首批，2026-11-12）

装置：桌面 = `Store` + `DesktopStoreDevice` + `S3v3SyncEngine` + 自有 `MemoryRemote`；移动 = `SqlJsAsyncDb` + `runMobileV3Sync` + 自有 `MemoryRemote`（`vi.mock` 掉 sql-wasm/assetFs，正文用每设备独立 fs `BodyStoreBackend`）。

| 新文件 | 覆盖场景 | 结果 |
| --- | --- | --- |
| `electron/s3v3/scenarioMatrix.test.ts` | S14 深 3 层同轮 / S15 移动 group 带子树 / S17 purge group / S63 时钟偏差 / S72 三端含删除 / **S46 附件随正文迁移** / **S74 三端标签×锁** | **7 pass**（S17 已由 task-62 修复，从 `it.fails` 转为正常断言；S46/S74 为本批新补齐） |
| `src/mobile/v3/scenarioMatrix.mobile.test.ts` | S21 双端并发编辑收敛 / S35 删除传播（移动×2） | **2 pass** |
| `src/mobile/v3/mobilePlatformPort.iconSync.test.ts` | task-52 G3：移动端口 icon 镜像写（回收站行可写） | **1 pass** |
| 引用既有（不新增） | S05 / S13 = `electron/s3v3/trashRemoteDivergence.test.ts` P0 / P0-b（task-44 已提交） | 已有 |

命令：`npx tsc --noEmit`（0 error）+ `npx vitest run electron/s3v3/scenarioMatrix.test.ts src/mobile/v3/scenarioMatrix.mobile.test.ts src/mobile/v3/mobilePlatformPort.iconSync.test.ts`（实跑：桌面 7 / 移动 2 / icon 1 = **10 pass**）。

### 0.4 阶段②收口（本批补齐，2026-11-12，基线 HEAD `8fe1124f`）

- **本批新增**：S46 附件随正文迁移（移动文档到另一笔记本后，附件字节/云端声明仍随该文档、对端可读，再跑一轮稳定）；S74 三端 × 标签/锁交错（三端 tagIds 集合一致、lockedAt 字段一致、正文一致且不抖动）。两者均实跑 PASS，落点 `electron/s3v3/scenarioMatrix.test.ts`。
- **S17 / S72 状态**：S17 已由 task-62 修复并转为正常断言（本批实跑 PASS，F-01 收口；S17b/c/d 后续同文件补齐，见 §0.5）；S72 A 档实跑 PASS，B 档真实桶首跑 56/57（缺口 = 被删侧无历史快照），已由 task-73 修复并复核 **57/57**。
- **剩余真空（当时 4 条）**：S08 purge×他端编辑、S19 目录重建同 id、S50 锁×他端连续编辑、S53 锁×移入回收站。S08/S50/S53 已在 §0.5 收口（S50/S53 = `electron/s3v3/lockPropagation.test.ts` L2/L5，task-47 已提交）；仅 S19 仍真空（需目录显式 id 重建入口，非本批优先级）。
- **B 档未执行**：真实七牛桶子集（附录 A 的 12 条）需隔离桌面实例 + 唯一前缀，本轮未跑（不碰真实桶/正式数据目录）；A 档全绿是本轮通过口径。
- **护栏口径提醒**：新增场景只依赖内存远程与临时 userData，不触发真实网络；断言均为「两端/三端最终一致 + 云端索引状态 + 无整轮抛错」。

task-62（P0，F-01 修复）：electron/trashLifecycle.ts（deleteTreeNode 级联为每个子树节点记 deleted_from_parent_id；purgeTrashItem 后代集合改用 parent_id ∪ deleted_from_parent_id+trashed 的递归 CTE）、electron/store.ts（importRemoteFolder/applyRemoteFolderMeta 对已 purge 目录拒绝回魂）、src/mobile/data/trashRepository.ts（collectSubtree 补原始父链边，移动端同口径）。S17 已从 it.fails 改为正常断言 + 「purge 后他端同步不复活」；新增 src/mobile/data/trashRepository.purgeSubtree.test.ts。**完整 vitest 已在本任务收尾时跑**（结果见汇报）。S50/S53/S54 等 `electron/s3v3/lockPropagation.test.ts`（task-47）已随 `20a066eb` 提交，S50/S53 直接转「已有」。

### 0.5 收口复核（task-76，2026-11-12，基线 HEAD `903a47aa`）

- **覆盖计数（按本表逐行重算，不看历史快照）**：**已有 45 / 部分 28 / 真空 1 / 失败 0**（总数 74）。剩余真空仅 **S19**（目录重建同 id，需目录显式 id 重建入口）。
- **本批转为「已有」**：
  - S05 本地 trash×他端编辑 / S13 移动×他端编辑 ⇒ `electron/s3v3/trashRemoteDivergence.test.ts` P0 / P0-b（task-44，已提交）。
  - S50 锁×他端连续编辑 / S53 锁×移入回收站 ⇒ `electron/s3v3/lockPropagation.test.ts` L2 / L5（task-47，已提交）。
  - S08 purge×他端编辑 ⇒ 本任务新增 `electron/s3v3/scenarioMatrix.test.ts`「S08」：被删侧编辑留历史快照（快照=被删侧编辑版本）、单轮同步不抛错、云端索引无条目、A 侧副本只留本地回收站、再跑一轮不复活。
- **S17 行补引（同文件，随 task-62 修复提交 `20a066eb`）**：S17b 清空回收站（同步扁平化后的子树不抛错、逐节点墓碑、云端清空）/ S17c 恢复扁平化组（子文档随根回原父）/ S17d 自动过期（逐根幂等跳过、不抛错）。
- **S72**：A 档用例实跑 PASS；B 档真实桶首跑 56/57（见 `docs/audit-261112/19-s3-real-bucket-subset.md`），唯一缺口「被删侧未同步编辑无历史快照」由 **task-73** 修复（`electron/s3v3/historySnapshotOnRemoteTrash.test.ts`，提交 `903a47aa`），修复后真实桶复核 **57/57** ⇒ 记「已有（task-73 已修，真实桶 57/57）」。
- **实跑**：`npx tsc --noEmit`（0 error）+ `npx vitest run electron/s3v3/scenarioMatrix.test.ts`（**11 pass**，含 S08 与 S17b/c/d）。

---

## 1. 生命周期（L）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言（额外钉死项） | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | 本地移入回收站 → 对端跟随 | A 有活跃文档 n1，已互相同步 | A `trashNote(n1)` → A 同步 → B 同步 | B：回收站可见、正文仍在、活跃树不含；索引 trashedAt 非空 | 双端 | A+B | 已有 · conformance「本地移入回收站 → 对端跟随」/ syncEngine「软删进回收站跨端可见 + 恢复」 |
| S02 | 回收站恢复 → 对端跟随 | S01 后 | A `restoreTrashItem(n1)` → A 同步 → B 同步 | 两端均活跃、原位置或兜底父一致、restore_pending 清除 | 双端 | A | 已有 · conformance 同条后半 |
| S03 | 本地 purge → 云端删除 + 对端留副本 | A 有 n1；B 已持有 | A 移入回收站→purge→同步；B 同步 | 云端索引/对象无 n1；B 保留回收站副本+正文+「云端已删除·仅本地」；B 不回传 | 双端 | A+B | 已有 · conformance「云端彻底删除 → 对端保留回收站副本」/ syncEngine「彻底删除零痕迹」 |
| S04 | purge 后同 id 不复活 | S03 后两轮 | A、B 各同步两轮 | 任一端都不得用旧 state/旧索引把 n1 重建；B 的副本不参与 S3 | 双端 | A | 已有 · syncEngine「彻底删除零痕迹…」+ plan「本地 purge 意图」 |
| S05 | **本地 trash × 他端编辑**（P0 同类） | A 删 n1（未同步）；B 编辑并已发布 | A trash → B 编辑+同步 → A 同步两轮 | **A 整轮不抛错**；正文为他端版；n1 仍在回收站（不隐式恢复）；下一轮仍稳定；显式恢复后才活跃 | 双端 | A+B | 已有 · `electron/s3v3/trashRemoteDivergence.test.ts` P0（task-44，已提交：应用内容、保留回收站、单轮不抛错） |
| S06 | 他端 trash × 本地编辑 | A 编辑 n1 未同步；B 已 trash 并发布 | B trash→同步；A 保存(n1)→A 同步 | 删除压编辑：A 的编辑先落历史快照、不上传覆盖；两端最终都回收站；A 不因保存抛错/不永久卡死 | 双端 | A | 部分 · deviceStoreMeta「P1-2 轮内移入回收站：不覆写生命周期」/「远端墓碑正常传播」+ plan「删除压编辑」 |
| S07 | 恢复 × 他端删除同时 | A 已 trash n1；B 也在删除/已 purge | A 恢复（写 restore_pending）→ 两端各同步两轮 | 恢复是唯一 local-wins 例外：A 活跃且上传覆盖；B 收到复活；标记在 markSynced 后清除（残留=墓碑永胜失效） | 双端 | A | 部分 · syncEngine「显式恢复是唯一例外」+ plan「显式恢复（无基线）」 |
| S08 | purge × 他端编辑 | A 编辑 n1；B purge 已发布 | B purge→同步；A 保存→同步；A 再同步 | A：编辑保留历史快照、不整轮失败、n1 进回收站/打 cloud_deleted；不得把 n1 重新发布复活 | 双端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S08」（task-76 新增：快照=被删侧编辑版、单轮不抛错、云端无条目、A 侧副本只留回收站、不复活） |
| S09 | 回收站自动过期不清 cloud_deleted 副本 | B 持有 cloud_deleted 副本；开启自动过期 | 过期清理跑一轮 | cloud_deleted 副本不豁免清理但也不产生墓碑/不上传；清理后索引/云端无新增 | 桌面 | A | 部分 · cloudDeleted/trash 状态测试（无跨端断言） |
| S10 | 三端：建→改→删→两轮收敛 | D1 建 n1 并同步；D2/D3 已拉取 | D2 改 → D3 删 → 三方各同步两轮 | 三方一致=回收站/删除压编辑；无端卡死；历史快照在编辑端存在；索引无活跃 n1 | 三端 | A | 部分 · conformance「三端交错编辑」（不含删除） |

## 2. 结构 / 移动（M）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S11 | 新建 / 重命名 / 换图标 | A、B 已同步基线 | A 新建 n2 + 改名 + 换 icon → 同步 → B 同步 | B 同 id/title/icon；顺序=sortOrder；不重复上传正文 | 双端 | A | 部分 · desktopStoreAdapter「远端首拉：先建目录再建子文档并落图标」+ plan 改名 |
| S12 | 移动到另一笔记本 | A 有 n1 于 nb1 | A 移动 n1→nb2 → 同步 → B 同步 | B parent=nb2、活跃树位置正确；索引 parentId 一致 | 双端 | A | 部分 · plan 目录/父级合并（无端到端移动断言） |
| S13 | **移动 + 他端编辑同时**（位置不被回滚） | A 移动 n1 未同步；B 编辑 n1 | A move→保存→同步；B 先同步 | 合并后：正文=B 版、位置=A 移动后位置（两字段独立，位置不被编辑/元数据覆盖回滚）；无端卡死 | 双端 | A+B | 已有 · `electron/s3v3/trashRemoteDivergence.test.ts` P0-b「本地移动 vs 他端内容编辑」（task-44，已提交：移动不被内容回滚，云端/对端都是移动后位置） |
| S14 | 嵌套 group 深 3 层同轮到达 | 空 B | A 建 nb/3 层 group + 文档，一轮上传；B 同步 | B 目录层级完整、文档落最深层、无悬空父 | 双端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S14」（实跑 PASS） |
| S15 | 移动 group 带子树 | A 有 nb1/group(3 层) | A 移动 group→nb2 → 同步 → B 同步 | B 整棵子树随父移动、子文档 parent 链正确、无孤儿 | 双端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S15」（实跑 PASS） |
| S16 | 删除 group 带子树 | A/B 有 group 子树 | A 删除 group（进回收站）→ 同步 → B 同步 | 两端子树进回收站、正文保留、活跃树无悬空；文档可读 | 双端 | A | 已有 · conformance「删除含文档的目录：两端不丢数据」 |
| S17 | purge group（目录） | S16 后 | A 清空回收站（purge）→同步→B 同步 | 云端索引不含目录+子树；B 保留回收站副本；同 id 不复活 | 双端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S17 purge group…」+ task-62 修复（子树原父链遍历 / 每篇 note 墓碑 / 对端不复活）；同文件 S17b 清空回收站（扁平化子树不抛错、逐节点墓碑）/ S17c 恢复扁平化组（子文档回原父）/ S17d 自动过期（逐根幂等、不抛错） |
| S18 | 目录 purge 后索引不含 | A purge 目录并发布 | A 同步→检查索引；B 同步 | 发布的 folders[] 不含该 id（无墓碑字段）；B 不重建 | 双端 | A | 部分 · plan「本地 purge 意图」/executePending 待删门禁 |
| S19 | 目录重建同 id | A purge 目录后新建同 id（导入/恢复） | A 同步 → B 同步 | 新目录正常传播（generation 更高时旧墓碑不压制）；B 显示新目录 | 双端 | A | 真空 |
| S20 | 恢复时原父已删 → 兜底笔记本 | A 回收站有 n1，原父已被删 | A 恢复 → 同步 → B 同步 | 两端同父（兜底「未分类」，惰性创建）、n1 活跃、无悬空 | 双端 | A | 已有 · conformance「恢复文档时原父已删 → 落兜底笔记本」 |

## 3. 内容（C）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S21 | 两端同时编辑（冲突） | 基线同步 | A、B 各改 n1 正文 → A 发布 → B 发布/拉取 → 双端两轮 | 远端胜（先提交者）；被覆盖端留历史快照 + supersededNotes/warning；索引 contentHash 唯一 | 双端 | A+B | 已有 · syncEngine「增量双端互传 + 冲突时远端胜出且本地留历史」+ conformance「双端编辑互相同步」+ `src/mobile/v3/scenarioMatrix.mobile.test.ts`「S21」（实跑 PASS） |
| S22 | 同内容不同时间 | 两端正文相同、updatedAt 不同 | 两端各保存同内容并同步 | 不重复 PUT 正文（hash 相同）；不产生冲突/历史快照；元数据按后写胜或不变 | 双端 | A | 已有 · idlePublishRegression + bodyChangeGuard |
| S23 | 空正文 | n1 正文被清空 | 保存空正文→同步→对端 | 空正文可合法传播（新建/清空语义）；不得被误判"缺正文"；不写回坏 JSON | 双端 | A | 部分 · planSuspiciousBody（4 例，纯决策层） |
| S24 | 大正文（多 MB） | n1 为大文档（≥1MB） | 保存→同步→对端拉取 | 字节一致、容量上限内成功；超上限明确失败不写半成品 | 双端 | A | 部分 · correctness.large / perf.big（非 conformance 语义断言） |
| S25 | 本地正文文件缺失 | A 的 n1 正文文件被手动删，DB 行在 | A 打开（只读面板）→同步；B 改并发布→A 同步 | A 不整轮失败（走 importRemoteNote 重建，deviceStore:558-560）；恢复后正文=云端；不上传空正文 | 桌面 | A+B | 已有 · electron/s3v3/missingBody.test.ts + parity「缺正文恢复 warning 透传」 |
| S26 | 坏正文（结构可疑） | A 的 n1 正文坏 JSON/异常结构 | A 同步/发布；B 拉取 | 判定为 suspicious body：不上传覆盖、保留本地原文、warning 可见；B 不因它失败 | 双端 | A | 已有 · suspiciousBody.test + planSuspiciousBody |
| S27 | 打开不写盘（打开=只读） | A 有 n1 已同步 | A 打开 n1 后不做任何编辑 → 关闭 | 不标脏/不写盘/不触发同步上传（contentHash 不变）；usheet/ink/board 同口径 | 双端 | A | 已有 · usheetOpenReadOnly / inkOpenReadOnly / docBaseline 测试（本地护栏，非 S3 用例） |
| S28 | 正文传输中断 → 下轮补齐 | A 发布后 B 拉取正文中断 | B 同步 1 次（失败）→ 再同步 | 本轮跳过+warning（不整轮失败）、已应用正文不重下；下轮补齐且字节一致 | 双端 | A+B | 已有 · conformance「正文传输中断：本轮跳过、下轮补齐」 |
| S29 | 正文 GET 连续 2 轮失败 | 同 S28 | B 连续两轮失败，第 3 轮成功 | 每轮部分应用+警告；第 3 轮收敛；已下载正文不重下 | 双端 | A | 已有 · conformance「拉取连续 2 轮正文 GET 失败」 |

## 4. 标签（T）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S30 | 增删标签跨端传播 | A 有 n1、标签 t1 | A 给 n1 加 t1 → 同步 → B 同步；A 删除 t1 | B 关系正确（集合 LWW）；删除传播=缺席，索引 tags[] 只含 active | 双端 | A | 已有 · documentTagsSync + tagAbsenceSync + mobileTagSync |
| S31 | 他端改标签 + 本地改正文 | A、B 改不同字段 | B 加标签→同步；A 同轮改正文→同步；再互相同步 | 两字段独立合并：正文 A 版、标签 B 版；不互相覆盖；无卡死 | 双端 | A | 部分 · planNoteTags（决策层）无端到端 |
| S32 | 标签目录删除传播 | A/B 已有 t1 | A 删 t1 → 同步 → B 同步 | B 目录不含 t1、关系被清；无墓碑进索引；离线删除抑制重发 | 双端 | A | 已有 · tagAbsenceSync「远端缺席+基线有 ⇒ 本地删」+ mobileTagAbsenceSync |
| S33 | 标签顺序只在本机 | A/B 有 t1,t2 | A 拖拽改序 → 同步 → B 同步 | B 顺序不因 A 改变（设备本地）；wire tagIds 为集合（顺序不传播） | 双端 | A | 已有 · plan「标签关系只改本机顺序（集合相同）⇒ 不发布」 |
| S34 | 未知/已删 tag id 过滤 | 索引含 B 未有的 tag id | B 同步 | B 过滤未知 id、展示层兜底；不因此失败 | 移动/桌面 | A | 部分 · documentTags/mobile tag 测试（无该组合断言） |

## 5. 小记（Q）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S35 | 小记建/改/删/purge 跨端 | A 建 q1 已同步 | A 编辑→同步→B 拉取→B 删除→A 拉取；A purge | 回收站可见/正文保留；purge 墓碑传播，对端不留回收站副本 | 双端 | A | 已有 · quickNotesAdapter 4 例 + syncEngine「小记：上传/拉取/删除无痕」+ `scenarioMatrix.mobile.test.ts`「S35 删除传播」（实跑 PASS） |
| S36 | 保存并同步单条快路径 | A 有 q1，基线正常 | A 点「保存并同步」 | 11 次请求固定顺序（3 pointer 读/1 索引读/1 正文 PUT/1 索引写/1 pointer 写…）；只推本条；不读 lake 索引/不跑整轮 | 桌面 | A | 已有 · quickPushFastPath「请求数固定」+ pipeline「11 次请求」 |
| S37 | 快路径重复点/无变更 | S36 后内容未变 | 再点一次 | 只读 1 次 pointer；0 上传、0 发布、基线不变 | 桌面 | A | 已有 · quickPushFastPath「重复点零上传」 |
| S38 | 快路径回退整轮四条件 | 分别构造 no-cloud / no-baseline / cloud-changed / remote-deleted | 点「保存并同步」 | 四种情况如实回传 full-sync 并调一次整轮；不静默降级；失败不写基线；锁已释放 | 双端 | A | 部分 · pipeline「无 baseline / 不同代 / 远端 purged」+ 移动 quickPushFastPath（无桌面端到端四条件） |
| S39 | 小记资产（图片） | q1 带图 | 保存并同步→B 拉取；B 删除资产 | 声明+资产字节一致；删除后云端对象清理；对端回收站副本仍可读 | 双端 | A | 部分 · quickNotesAdapter「图片附件随小记上传/下载」 |
| S40 | 小记标签 | q1 有标签 t1 | A 改标签→快路径→B 拉取 | 标签关系随索引同步（集合+LWW）；顺序本机 | 双端 | A | 部分 · mobileTagSync（桌面快路径×标签无断言） |
| S41 | 快路径 × 他端同时发布 | B 正在发布 lake 索引 | A 同时点「保存并同步」 | 锁竞争：等锁/重试后成功；不把并发当失败；索引无损（只 upsert 本条） | 双端 | A | 部分 · pipeline「别端新增/删除/改标签：只 upsert 本条」+ lockContention |
| S42 | 快路径失败不污染状态 | 构造 PUT 失败 | 点「保存并同步」 | 失败不写基线/不标已同步/不写坏索引；可重试成功 | 桌面 | A | 部分 · quickPush 失败路径（测试集中于成功/回退） |

## 6. 资产 / 声明（AS）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S43 | 新增图片上传 + 声明 | A 文档插入图 | A 保存→同步→B 同步 | 先对象后声明；B 拉到同字节；声明=该文档在用集（全量） | 双端 | A+B | 已有 · conformance「带附件文档：A 上传声明+附件字节 → B 拉取到同字节」 |
| S44 | 他端已有（差集跳过） | 两端已有同一资产 | A 再同步 | 声明差集为空 ⇒ 0 PUT；不逐对象 HEAD/GET | 双端 | A | 已有 · assetDownloadDiff / assetReuse |
| S45 | 远端资产缺失回拉 | B 本地资产被删、声明仍在 | B 打开文档/同步 | 按声明差集补拉成功；失败给 warning 不整轮失败 | 双端 | A | 部分 · trashAssetBackfill / onDemandAssetsWiring / s3v3AssetBackfill（无 conformance 用例） |
| S46 | 附件随正文迁移 | n1 有附件，A 移动 n1 | A 移动→同步→B 同步 | 附件仍在 n1 名下、B 可读；声明不因移动丢 | 双端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S46」（实跑 PASS：移动后 B 仍读到同字节、云端 `meta/assets/s46-n1/` 声明仍在、再跑一轮稳定） |
| S47 | 声明文件不可变 | 已有声明对象 | 本地附件未落地时上传正文 | 不清空声明、不自删云端附件；新声明为新 declHash 对象 | 双端 | A | 部分 · conformance「声明保留：本地附件未落地时上传正文不得清空声明」 |
| S48 | 资产字节不一致 → 重拉 | 本地资产 size/hash 不符 | 同步 | 按 sha256 判差集重拉；active→trash 复用仅在实读正文 sha256 相等时 | 双端 | A | 部分 · nativeAssetTransfer / assetDownloadDiff |

## 7. 编辑锁（LK）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S49 | 加锁 / 解锁基础传播 | A、B 有 n1 | A 加锁→同步→B 同步；A 解锁→同步→B 同步 | B 只读态随 locked/lockedAt 变化；锁变更不 bump updatedAt | 双端 | A | 已有 · conformance「【场景 5】锁传播」+ parity「编辑锁跨端传播」 |
| S50 | **A 锁 + B 未感知编辑 + B 连续多轮编辑 → 锁必须传播** | A 加锁未同步；B 仍在编辑（未感知锁） | A 加锁同步；B 连续 2 轮编辑+同步；双方再同步两轮 | 最终两端一致只读=锁生效；B 的编辑不因锁被静默丢弃（留历史/冲突口径明确）；锁不被编辑覆盖（lockedAt 字段级 LWW） | 双端 | A+B | 已有 · `electron/s3v3/lockPropagation.test.ts` L2（B 连续两轮编辑后仍收到 A 的锁；task-47，已提交） |
| S51 | 解锁传播 | S50 后 A 解锁 | A 解锁→同步→B 同步 | 两端恢复可编辑；解锁不被旧锁覆盖（lockedAt 后写胜）；不触发正文重传 | 双端 | A | 部分 · conformance 场景 5（纯锁变更，无并发编辑） |
| S52 | 锁着时本机保存被拒 | A 的 n1 锁定 | A 试图保存 n1 | 保存被拦且文案明确（只读/锁定）；不写盘、不标脏、不上传；不整轮失败（用户动作） | 桌面 | A | 部分 · 渲染层只读拦截（useSavePipeline/readOnly），无跨端用例 |
| S53 | 锁 × 移入回收站 | A 锁定 n1 | A/B 任一端 trash n1 → 双端同步 | 回收站状态与锁字段不互斥冲突；恢复后锁状态按 lockedAt LWW 保留；无卡死 | 双端 | A | 已有 · `electron/s3v3/lockPropagation.test.ts` L5（锁 × 移入回收站/恢复，正文与锁状态各自 LWW 收敛、不炸；task-47，已提交） |
| S54 | 锁字段 LWW（时间戳顺序） | A 锁 t1，B 锁 t2（t2>t1） | 双端各同步 | 后锁者胜（字符串 LWW）；锁的中间态不产生正文/索引抖动 | 双端 | A | 部分 · parity 编辑锁传播（两两冲突未覆盖） |

## 8. 引擎 / 协议（E）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S55 | 首拉空设备 | B 空库、云端有数据 | B 同步 | 建基线、落全部文档/目录、正文可搜（text_cache+FTS 随正文落库）；无整轮失败 | 双端 | A+B | 已有 · conformance「首轮上传建立基线…」/ desktopStoreAdapter「loadState 映射 + 引擎初始化上传…」 |
| S56 | 空云采纳策略 | 本地非空、云端空 | 默认报错 / stay 不写 / upload 初始化三种选择 | 默认不静默上传；用户确认后 initialUpload（新 epoch，generation=1，读回校验） | 桌面 | A | 已有 · syncEngine「云端为空时的选择」 |
| S57 | 零变更轮 | 两端已同步且无改动 | 跑一轮同步 | plan.publish=null；0 PUT/0 读正文；仅 1 次 pointer GET + saveState；不取锁 | 双端 | A | 已有 · plan「零变更」+ idlePublishRegression |
| S58 | 发布失败重试 | 发布中途 PUT 失败 1 次 | 本轮失败→下一轮 | 本轮不崩溃、留待重试；下轮补传；云端正文唯一 | 双端 | A+B | 已有 · conformance「弱网：发布中断 1 次 PUT」+ syncEngine「上传失败不污染索引」 |
| S59 | 双端同时发布（pointer 竞争） | 两端均有待发布 | 同时 sync 多轮 | 锁+读回+generation 收敛到同一索引；无 fork；迟到者不得覆盖 | 双端 | A+B | 已有 · lockContention「6 端同时发布」+ syncEngine「发布锁被占用 → lock-busy」 |
| S60 | epoch 变化 / 换桶 | A 指向旧桶；B 已换桶 | A 同步 | epoch-mismatch → action-required（需用户选择云端赢/本地赢），不静默全量重拉 | 双端 | A | 部分 · defaultSwitch.integration + syncErrorInfo（无端到端换桶场景） |
| S61 | 同步中途杀进程 → 重启 | 同步进行到一半进程被杀 | 重启后再同步 | 基线/resume marker 一致、不重传已完成对象、不产生重复指针/索引；最终收敛 | 双端 | B | 部分 · s3v3Resume / syncResumeScope / mobile syncResumeMarker（模拟状态，无真杀进程） |
| S62 | 断网中途失败 | 拉取/上传中断网 | 恢复网络后再同步 | 每轮部分应用+warning；不整轮卡死；恢复后补齐且字节一致 | 双端 | A+B | 已有 · conformance 弱网 3 条（发布/拉取/附件） |
| S63 | 时钟偏差（updatedAt 未来/过去） | A 时钟快/慢 | A/B 各编辑并互相同步 | 决定合并顺序的 updatedAt 不可被时钟偏差永久压制：冲突按"先提交者胜协议"收敛；不出现永久 local-wins/删不掉 | 双端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S63」（只改本机 DB 模拟偏斜，实跑 PASS） |
| S64 | pointer 缺失/坏 JSON | 桶内 pointer 损坏/无 pointer | 各端同步 | pointer-corrupt（fatal，不猜）/ no-baseline（桶已有对象）分类正确；除首传竞态重试 2 次外不静默修复 | 双端 | A | 已有 · syncEngine「pointer 损坏 → pointer-corrupt」+ syncErrorInfo |
| S65 | 索引坏 JSON / 校验失败 | 索引对象损坏 | 同步 | 校验失败 → 明确错误（不覆盖本地、不半写）；可恢复（用户介入） | 双端 | A | 部分 · protocol/applyPlan 校验测试（无端到端坏索引） |
| S66 | fork / generation-rollback / epoch-mismatch | 构造同代不同 commit 等 | 同步 | 三种分类为 action-required；不静默全量重拉；用户选择后收敛 | 双端 | A | 部分 · syncEngine「fork 检测」+ syncErrorInfo（rollback/epoch 分类未端到端） |
| S67 | 深度清理 / 保留窗口 | 有孤儿对象/旧 generation | 跑 deepCleanup | 只删孤儿；当前 pointer/索引/声明数据零误删；保留窗口生效 | 桌面 | A | 已有 · syncEngine「深度清理」+ deepCleanupWindow |
| S68 | 待删队列门禁 | 有 pending 删除且仍被引用 | 执行待删 | 仍被引用则跳过并出队、不误删；失败保留队列，恢复后补删；零痕迹 | 桌面 | A | 已有 · syncEngine「待删门禁」「待删执行失败」 |
| S69 | 发布锁 TTL/抢占 | 他端锁未过期/已过期 | 本端发布 | 未过期：有界等待后 lock-busy（不无限空转）；过期：可抢占并收敛 | 双端 | A+B | 已有 · lockContention 4 例 |
| S70 | 重复同步幂等 / 串行 | 同一进程并发两次 sync | 连续/并发调用 | 维护域串行（enqueueMaintenance）；重复调用不产生第二份索引/指针；无死锁（I3 不自嵌套） | 双端 | A | 部分 · maintenancePolicy/keyedAsyncQueue 测试（无同步端到端） |

## 9. 三端交错（X）

| 编号 | 场景 | 前置状态 | 操作序列 | 判定断言 | 覆盖端 | 档位 | 现有覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S71 | 三端交错编辑收敛 | D1 建并同步；D2/D3 已拉取 | D1/D2/D3 各改→按不同顺序各同步两轮 | 三方最终同正文/同元数据；无人卡死；被覆盖方有历史快照 | 三端 | A | 已有 · conformance「三端交错编辑：最终收敛且不互相覆盖」 |
| S72 | D1 建 → D2 改 → D3 删 → 两轮三方一致 | 同上 | D2 改、D3 删；三方各两轮 | 最终三方都回收站/删除压编辑；历史快照在 D2；索引无活跃 | 三端 | A+B | 已有（task-73 已修，真实桶 57/57）· `electron/s3v3/scenarioMatrix.test.ts`「S72」A 档实跑 PASS；B 档缺口「被删侧未同步编辑无历史快照」由 task-73 修复（`electron/s3v3/historySnapshotOnRemoteTrash.test.ts`） |
| S73 | 三端 × 指针竞争 | 三端同时有待发布 | 同时发布多轮 | 锁竞争收敛到同一份索引；无 fork；迟到覆盖不发生 | 三端 | A | 部分 · lockContention（6 端，非三端场景断言） |
| S74 | 三端 × 标签/锁交错 | 三端各改标签/锁 | 交错同步 | 集合 LWW + lockedAt LWW 收敛；正文不抖动 | 三端 | A | 已有 · `electron/s3v3/scenarioMatrix.test.ts`「S74」（实跑 PASS：三端 tagIds 集合一致、lockedAt 字段一致、正文一致且再跑一轮稳定） |

---

## 附录 A · B 档（真实桶）建议子集（12 条）
S03 purge、S05 本地 trash×他端编辑、S13 移动×他端编辑、S21 双端并发编辑、S25 缺正文恢复、S28 正文中断补齐、S43 资产上传/差集、S50 锁传播×并发编辑、S55 首拉空设备、S58 发布失败重试、S59 双端同时发布、S62 断网失败恢复、S72 三端含删除。
执行口径：唯一前缀 `audit-261112-scn-<stamp>`（三桌面实例，隔离 userData/CDP 端口），结束只 `DELPREFIX` 清理并校验 **0 残留**（`node scripts/s3-ls.mjs --prefix <prefix> --count`）。

## 附录 B · 复用与新增装置对照
- 复用：`electron/s3v3/deviceConformance.ts`（`defineDeviceContract`，桌面/移动各一份 test）；`src/core/s3v3/state/deviceStoreMeta.test.ts`（应用层场景骨架）；`src/core/s3v3LockContention.test.ts`（多端并发骨架）；`scripts/multi-end-sync/`（cdpclient/configure-s3/delprefix，B 档）。
- 新增（阶段②）：① 上面标"真空"的 12 条优先补 conformance 用例（放 `deviceConformance.ts` 的 `defineDeviceContract` 或各自 `*.test.ts`）；② 时钟偏差需要可控 `now()` 注入（deviceStore/plan 层测试已支持 now/时间注入的用例可复用）；③ B 档扩成约 12 条独立脚本，统一 `DELPREFIX` 收尾。

## 附录 C · 阶段①的局限
- 覆盖盘点基于 HEAD 的测试名/文件静态核对（`git ls-tree` + `it("…")` 提取），未逐条跑；"部分"表示有相邻纯逻辑测试但缺该场景的端到端断言。
- task-44 的 `electron/s3v3/trashRemoteDivergence.test.ts`（P0 / P0-b）与 conformance「本地已进回收站 + 他端编辑并发布」用例已提交，S05/S13 已转「已有」；锁相关 S50/S53 由 task-47 的 `electron/s3v3/lockPropagation.test.ts` L2/L5 覆盖。
- 未覆盖：多实例资源端口/夹具冲突（B 档需隔离 userData，见 `docs/MOBILE-OPS.md` 同款纪律）、真实桶延迟/限流（只在 B 档观测，不设数值断言）

## 附录 D · 阶段②失败清单

### F-01（P0，已修 task-62；**回归已绿**：本批复核 `scenarioMatrix.test.ts` S17 实跑 PASS）purge 分组后子文档未被彻底删除、云端索引残留
- 场景：矩阵 S17。A 删除「分组（含子文档）」→ 同步 → purge 该分组 → 双方各自同步。
- 修复前实测：purge 后 deleted_notes 只有 group 的 folder 墓碑；子文档 notes 行仍在（trashed_at 非空、parent_id=notebook-trash）⇒ 子文档漏 purge，并被继续作为 trashed 条目发布，云端 lake 索引残留该 note。
- 根因（两处叠加）：① electron/trashLifecycle.ts deleteTreeNode 只给根节点记 deleted_from_parent_id，子树节点只标 trashed_at；同步侧会把 trashed 条目的 parent 归一成回收站容器（src/core/s3v3/commit/engineBridge.ts:74）⇒ 子树原始父链在本机丢失；② purgeTrashItem 只用 parent_id 找后代（descendantIdsIncludingDeleted）⇒ 归一后子文档不再是分组后代。
- 修复：① deleteTreeNode 级联时对每个子树节点（tree_nodes + notes）补 deleted_from_parent_id=COALESCE(…, parent_id)；② purgeTrashItem 后代集合改为 parent_id ∪（deleted_from_parent_id 且 trashed_at 非空）的递归 CTE（UNION 去重防环、过滤 deleted_at）；每个后代文档都写 note 墓碑并清行/正文/历史/附件目录/搜索（云端对象前缀删除沿用既有 purged 意图）；③ electron/store.ts 的 importRemoteFolder / applyRemoteFolderMeta 对「本机已 purge 的目录」直接忽略（对端回收站副本不能再把它拉回来）。
- 回归：electron/s3v3/scenarioMatrix.test.ts S17（正常断言）+ 新增 src/mobile/data/trashRepository.purgeSubtree.test.ts（移动端同口径：已扁平化子文档也整棵删、每篇有 note 墓碑）。
- 回归扩展（task-76）：同文件 S17b 清空回收站（扁平化子树不抛错、逐节点墓碑）/ S17c 恢复扁平化组（子文档回原父）/ S17d 自动过期（逐根幂等）已补齐；S08 purge×他端编辑（留历史快照、单轮不抛错、不复活）同批实跑 PASS。

### F-01b（P1，已修 `fa2fbdad`/task-77）云端 folders[] 残留已 purge 目录（4 处叠加根因：intents 未交给 plan / 发布未排除 remote-purged-trash / 无基线时副本被当 upload / fieldChanged 重传已删正文；回归 `folderPurgeCloud.test.ts` + conformance 场景 7b）
- 现象：F-01 修复后 S17 实测云端 lake 索引 folders[] 仍有该组（parentId=notebook-trash、trashedAt 非空）—— 由对端 B 在下一轮把它作为「回收站目录」发布；A 端已用 purged 墓碑拒绝回魂（本机不重建），但云端仍残留。
- 判定：违反 AGENTS §3#15「已彻底删除的判定必须永久」在目录上的同一条红线；不在 task-62 写作用域（plan.ts / deviceStore.ts / engineBridge.ts 归 audit-core），只登记。
- 建议：单开任务，把「目录删除 = 缺席 / 本机 purge 的目录不得再发布」做成 core 单一判据（含 folders[] 删除意图 / 对端 remotePurged 目录），并补 S17 的 folders 断言。
- 最小复现：npx vitest run electron/s3v3/scenarioMatrix.test.ts -t S17，在末尾临时读取云端索引 folders[]。
