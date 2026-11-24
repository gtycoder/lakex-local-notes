# 审计③ 发布/提交/线格式层 — 261124 只读审计

> 范围：`src/core/s3v3/commit/`（buildPublishIndex / commitPlan / initialRound / runSyncRound / intentLog / engineBridge 相关消费面）、`src/core/s3v3/protocol/s3v3Index.ts`（serialize/validate/上限）、`src/core/s3v3Engine.ts`（发布环/lock-busy 重试/epoch-generation-fork 判定/syncPullAllRound/syncFirstRound/deepCleanup）、`src/core/s3v3/quickPush/pipeline.ts`、`electron/s3v3/s3Remote.ts` 与 `src/mobile/v3/s3v3Remote.ts`（键位与 put/get 协议面）。
> 判据：docs/SYNC-PROTOCOL.md §2/§4-§8/§12/§13/§14/§17/§18 + AGENTS §3/§4。协议设计（删除压编辑、墓碑权威、恢复唯一例外、无 CAS 锁、同名资产=同内容）按裁决不计为 bug。
> 纪律：只读；每条发现给 文件:行 + 证据 + 影响面 + 最小复现 + 修法；不确定标「待复现」。
> 与审计②（apply/落库层）有两处交叉（发现 1/2 的落库半边在 deviceStore/engineBridge），已在条目内标注，请 lead 合卷时去重。

## 一句话结论

**发布世界的输入本身是干净的**（plan.publish 全部由三方合并赢家合成，回退/排除口径与协议一致），但「发布结果回写本地行」的半条通道（发现 1/2）会把上传/下载失败的边界态变成**静默回滚或合并结局翻转**；另有 wire 形态与行形态混用做 diff（发现 3）、校验器漏检（发现 4/5）与一组锁/代数/清理边界（发现 6–12），其中无 P0，2×P1、1×P2、9×P3。

---

## 发现列表

### P1-1（发现 1）上传失败的回退条目在发布轮里被写回本地行 ⇒ 元数据编辑被静默回滚、永不重试

- **现象**：某条文档正文 PUT 失败（网络错/字节不符/缺正文）时，索引按协议回退远端旧条目（正确）；但同一轮只要**发布了别的变更**，`mergeRoundIntoState` 的 published 分支会把「发布世界」整份覆盖本地状态行 —— 回退条目（远端旧 meta）连带把本地行的 title/parentId/sortOrder/icon/锁/updatedAt 一起回滚到远端旧值。正文 contentHash 因 meta 路径不写 content_hash 而幸存 ⇒ 正文下轮还能重试上云，但**同轮的改名/移动/改图标/锁等元数据编辑已丢且不再重试**（下轮用回退后的 meta + 新 contentHash 发布）。
- **证据**：
  - `src/core/s3v3/commit/buildPublishIndex.ts:44-47` —— 失败条目 `notes.push({ ...prev })` 回退远端旧条目（线格式规则正确）；
  - `src/core/s3v3/commit/engineBridge.ts:183-206` —— `published` 分支 `lakeNotes = publishedLake.notes` 整份覆盖，**不接收 failedUploads**（入参只有 `bodyFailed`，而 `bodyFailed` 来自 apply.entries=下载状态，上传失败根本不在里面）；
  - `src/core/s3v3Engine.ts:591-597` —— 注释声称「上传失败……**保持 local 下轮重试**（已由 applyPlan 记入 failedUploads 并回退索引）」，实现只记 warning，行并未保持 local；
  - `src/core/s3v3/state/deviceStore.ts:730-744` —— `metaDiffers`（`n.updatedAt !== cur.updatedAt` 等）为真 ⇒ `applyRemoteNoteMeta(metaNote, localSnapshot?.updatedAt)`；`localSnapshot = previous`（轮初行，T2）与 cur.updatedAt（T2）相等 ⇒ I2 守卫放行 ⇒ 回写旧 meta；
  - `electron/syncReconciliation.ts:123-147` —— `applyRemoteNoteMeta` 的 UPDATE 只写 title/parent/sort_order/updated_at/is_conflict/trashed/deleted_from，**不写 content_hash**（正文 hash 幸存的原因）；
  - 协议依据：SYNC-PROTOCOL.md §17:619「受影响条目跳过并**保留下轮重试意图**」。
- **影响面**：正文+元数据同轮编辑、正文上传遇瞬时失败、且同轮还有其它变更 ⇒ 改名/移动/锁丢失且不告警（只有一个 transient warning 文案还是错的）；正文虽重试但发出去的是「旧 meta + 新正文」，他端 updatedAt 回退。数据面为**元数据静默丢**，正文不丢。
- **最小复现**：A 端改文档 X 正文+标题、改文档 Y 正文；注入 X 的 PUT 抛错（applyPorts.putRemote 对 X reject）；跑一轮 sync。断言：X 行 title 回到旧值、baseline X 为远端旧条目、下轮 plan 不再产生 X 的 title 变更。
- **建议修法**：`mergeRoundIntoState` 增加 `failedUploads` 入参，published 分支对这些 id **保留本地行**（与 bodyFailed 同型守卫）；基线里该条目保留回退版（让下轮 diff 见到差异）即可维持索引侧协议规则不变。

### P1-2（发现 2）发布轮里下载失败的条目无视 bodyFailed 守卫 ⇒ 合并结局被网络失败翻转（败者内容反向覆盖云端）

- **现象**：`bodyFailed`（正文没落盘的条目）只在 **未发布分支** 被消费（engineBridge.ts:235「正文没真正落盘的条目不得把索引写成远端 hash」）；**published 分支整份覆盖时不看 bodyFailed**。下载失败（对象 404 / sha256 不符）时行 content_hash 保持本地旧值、meta 被写成远端赢家值，而基线推进到远端世界（s3v3Engine.ts:667-676 无条件按 commit 变化推进）⇒ 下一轮三方合并把「冲突败者的旧正文」判成「本地新编辑」⇒ 上传覆盖云端赢家内容，且旧赢家正文随后被「旧正文对象清理」（s3v3Engine.ts:640-661）删除。协议 §17:623 明文「正文下载失败但本地已有 ⇒ **保留本地条目**……不得把对象暂时缺失变成永久删除」，published 分支实现与之相悖。
- **证据**：
  - `src/core/s3v3/commit/engineBridge.ts:183-206`（published 分支无 bodyFailed）vs `208-235`（非发布分支有守卫，注释自述风险为「永久缺正文」）；
  - `src/core/s3v3/apply/applyPlan.ts:100-125` —— 下载失败两条路径：显式 skip 状态进 `entries`（106/111），**GET 抛错只进 errors 不进 entries**（120-125）⇒ s3v3Engine.ts:610 的 `bodyFailed` 连非发布分支的守卫都盖不住网络异常下载；
  - `src/core/s3v3/state/deviceStore.ts:740-744` —— meta 路径照常写远端 meta（updatedAt 前进），content_hash 不写；
  - `src/core/s3v3Engine.ts:667-676` —— 纯拉取/未发布轮也把 baseline 推到远端世界。
- **影响面**：远端已发布版本（赢家）在本机从未落地，下一轮被本地旧内容反向覆盖上云；赢家内容只剩发起端的历史快照兜底。合并语义「远端已发布 ⇒ 远端胜」被一个瞬时 GET 失败翻转。
- **最小复现**：A 发布 X=v2；B 端 X=v1（未同步改动）⇒ 冲突判定远端胜 + archive-local；注入 B 的 X 正文 GET 404；同轮 B 发布另一条变更。下一轮断言 B 应重试下载 v2，实际会上传 v1。
- **建议修法**：① published 分支同样消费 bodyFailed（或把「下载失败」统一挂进持久 `bodyRecoveryPending` 队列）；② applyPlan 对 GET 异常也 push `entries`（status=skipped-error），让 bodyFailed 口径完整。
- **标注**：与审计②（apply/落库）交叉，落库半边请合卷去重。

### P2-3（发现 3）fieldChangedIds 拿 wire 形态基线 vs 行形态 parent 做 diff ⇒ 回收站条目永久误判「字段变更」

- **现象**：基线条目来自发布世界（trashed 条目 parentId 已归一为 null：plan.ts:485、positionMerge.positionOf），而 `state.lake.notes` 的 parentId 是行域（回收站行 = `notebook-trash`：deviceStore.ts:648、loadState 原样透传 :300）。engine 的字段 diff（`b.parentId !== n.parentId`）拿两个表示域直接比 ⇒ **每条已发布的回收站文档每轮都进 fieldChangedIds** ⇒ forcedUpload ⇒ `indexChanged=true` ⇒ 每轮都构建发布世界并全量序列化双索引（commitPlan.ts:67-70 自述「大库空跑的主 CPU 就在这里」），`plan.publish=null` 的零变更短路对「含回收站条目的库」永久失效；同时 `plan.publishes.lake` 每轮误含这些 id，污染 runSyncRound.ts:139 的 `restoredIds`（restorePending 结算输入）。
- **证据**：`src/core/s3v3Engine.ts:824-834`（比较 b.parentId/n.parentId）；`src/core/s3v3/state/deviceStore.ts:300`（`parentId: n.parentId` 原样）、`:648`（行写 TRASH_NOTEBOOK_ID）；`src/core/s3v3/plan/plan.ts:485` + `src/core/s3v3/plan/positionMerge.ts` positionOf（发布/基线 wire 形态 parentId=null）。
- **影响面**：5k 文档/含回收站的库上每轮多一次全量索引 canonical 序列化（发布环 CPU）；publishes/restoredIds 输入被污染（当前只造成轻微标记结算偏差，属判据输入错误）。无数据丢失。
- **最小复现**：库里放一条已同步的回收站文档，连跑两轮空跑 sync：断言 `plan.publish` 应为 null（当前恒非 null），第二轮 serializeLakeIndex 调用数 > 0。
- **建议修法**：fieldChangedIds 的位置比较改用 `positionOf()` 归一域（与 plan/positionMerge 同源），或比较 `trashedAt ? "notebook-trash" : parentId` 的行域基线。

### P3-4（发现 4）validateLakeIndex 目录重复 id 不拒绝（违反 §5.4「键内唯一」）

- **现象**：notes 循环把 id 加进 `ids` 集合（s3v3Index.ts:285-288），folders 循环只查不加（:311-315）⇒ note/folder 同 id 会被拒（该项达标），但**两条 folder 同 id 通过校验**。下游 Map-by-id 消费者静默去重 ⇒ 索引条目无声丢失/目录结构漂移。
- **证据**：`src/core/s3v3/protocol/s3v3Index.ts:285-288` vs `311-315`；协议 §5.4:170「id …**键内唯一**」。
- **影响面**：仅在坏端/手工写入索引时触发；本端发布侧（plan.publish）天然唯一。校验器是线格式最后防线，漏检 = 防线破洞。
- **最小复现**：`validateLakeIndex({v:3,space:"lake",notes:[],folders:[{id:"a",...},{id:"a",...}]})` 当前不抛错。
- **建议修法**：folders 循环补 `ids.add(f.id)`（或独立 folderIds 集合）。

### P3-5（发现 5）validateQuickNotesIndex 对 tagIds/tagsUpdatedAt 的硬化弱于 lake 侧

- **现象**：lake note 的 tagIds 有去重 + 每篇上限（s3v3Index.ts:300-301）、tagsUpdatedAt 强制可解析（:303-309，注释自述「坏时间串会按字典序永久压制 LWW」）；quick item 两处都缺（:339 只查数组/字符串）⇒ 坏 quick 条目的垃圾 tagsUpdatedAt 会**永久压制**该条的小记标签 LWW（rt > lt 恒真），重复/超限 tagIds 撑大索引、破坏集合比较。
- **证据**：`src/core/s3v3/protocol/s3v3Index.ts:295-309` vs `334-340`。
- **影响面**：坏条目来自异常端/旧索引时，小记标签关系被单端永久劫持；与 lake 侧判据分叉（同族问题两套口径）。
- **最小复现**：构造 items[0].tagsUpdatedAt="zzz" 的 quick 索引字节，`parseQuickNotesIndexBytes` 当前通过。
- **建议修法**：quick 侧补同一组判据（去重、S3V3_MAX_TAGS_PER_NOTE、可解析时间）。

### P3-6（发现 6）commitPlan 写后读回不比对 epoch/createdAt/deviceId ⇒ 首传并发同 commit 时可双「published」并分叉 epoch（后果未登记）

- **现象**：写 pointer 后的读回校验只比 generation + 双 commit（commitPlan.ts:150；§12.2 step 4 亦如此规定）。首传（base=null）双方各生成自己的 epoch：若两端将发布的索引**逐字节相同**（如导入同一便携包的两台设备同时首传），双方写 pointer（gen=1、同 commit、不同 epoch）后读回都通过 ⇒ 都返回 published，各存各的 epoch；远端 pointer 只留后写者 ⇒ 先写端下一轮 `epoch-mismatch`（s3v3Engine.ts:406，action-required、要人工 resetFromCloud）。§18.1 登记了「无 CAS 双方都以为发布成功」的一般风险，但**没有登记 epoch 分叉这一具体后果**；§12.4 的首传竞态兜底只覆盖 pointer-corrupt。
- **证据**：`src/core/s3v3/commit/commitPlan.ts:119-122`（首传 pre-check）、`139-153`（写 pointer + 读回无 epoch 比对，返回 `pointer: check`）；`src/core/s3v3Engine.ts:404-411`（epoch-mismatch 判定）。
- **影响面**：触发条件苛刻（首传 + 索引逐字节一致 + 时序交错），触发后一台设备卡 action-required，非静默丢数。**待复现**。
- **最小复现**：两引擎共享一个 mock remote（线性化），同 initialRound 输入并发首传；断言不得双双 published（当前会）。
- **建议修法**：读回校验补 `check.epoch === pointer.epoch && check.createdAt === pointer.createdAt`（或首传要求 `check.deviceId === deviceId`）；把 epoch 分叉后果补进 §18。

### P3-7（发现 7）quickPush 的代数判定漏比 quickNotesCommit ⇒ 整轮判「fork 显式失败」的状态被快路径静默继续并盖掉

- **现象**：quickPush CAS 只比 epoch/generation/lakeCommit（pipeline.ts:340）；整轮对「同 generation 不同 commit」显式报 fork（s3v3Engine.ts:408-409、s3v3Pointer.classifyCloudState）。同一 wire 状态，两套判据：快路径会以该 forked 索引为底合并本条并发布 gen+1，把分叉**静默改写**掉（迟到覆盖的内容虽保留，但 fork 事实被掩盖、与「分叉必须显式失败」裁决不一致）。
- **证据**：`src/core/s3v3/quickPush/pipeline.ts:340` vs `src/core/s3v3Engine.ts:406-410`、`src/core/s3v3/protocol/s3v3Pointer.ts:14-16`。
- **影响面**：坏端/异常写 pointer 时丢失显式告警；正常路径不可达（generation 单调保证）。**待复现**。
- **最小复现**：mock pointer 与 baseline 同 generation、quickNotes.commit 不同 ⇒ `runQuickPush` 当前继续发布，期望返回 full-sync。
- **建议修法**：CAS 条件补 `baseline.quickNotesCommit !== pointer.quickNotes.commit ⇒ full-sync("cloud-changed")`。

### P3-8（发现 8）quickPush / resetFromCloud 写基线丢 targetKey 盖章 ⇒ 换桶「首次相遇」判定的输入被静默清掉

- **现象**：`saveBaseline` 两端都是整份覆盖（electron/s3v3/desktopStoreAdapter.ts:152-153、src/mobile/v3/mobileDeviceStore.ts:209-212）。整轮路径靠 `stampTargetKey`（s3v3Engine.ts:350-361）补章，但 **quickPush 的 saveBaseline（pipeline.ts:434-438）与 resetFromCloud→syncPullAllRound（s3v3Engine.ts:752-755）之后没有补章** ⇒ 基线丢失 `targetKey`，直到下一次整轮。期间若用户换桶/换前缀，`staleTarget` 判定（s3v3Engine.ts:382）拿不到旧 targetKey ⇒ 首次相遇闸门不触发，直接拿旧基线对新目标做三方合并（「云端缺席」被误判成他端删除的风险面）。
- **证据**：`src/core/s3v3/quickPush/pipeline.ts:433-438`（对象字面量无 targetKey）；`src/core/s3v3Engine.ts:350-361`（整轮补章）vs `1013-1018`（resetFromCloud 无补章）；`src/core/s3v3DeviceStore.ts:91-92`（targetKey 语义 = 换桶=新首次相遇）。
- **影响面**：换桶保护被削弱；实际还有 epoch/commit 不符做兜底（不同目标几乎必然 mismatch ⇒ 显式失败），故非数据直接丢失。窗口 = 「只用过保存并同步/从云端恢复之后、未跑整轮就换桶」。
- **最小复现**：跑一次 quickPush 成功后读 baseline：`targetKey` 应保留（当前为 undefined）。
- **建议修法**：quickPush / resetFromCloud 写基线时保留旧 `targetKey`（`...baseline` 携带），或写完调用同一 `stampTargetKey` 语义。

### P3-9（发现 9）移动端 deleteMany 吞掉 DeleteObjects 的 Errors ⇒ 删除失败静默、purge 计数/意图按「已删」结算（双端语义分叉）

- **现象**：桌面 `deleteMany` 逐键 DELETE、失败抛出（electron/s3v3/s3Remote.ts:114-126）；移动 `deleteMany` 用 DeleteObjects（Quiet:true）**不检查响应 Errors**（src/mobile/v3/s3v3Remote.ts:115-123），失败既不抛也不告警。消费方按成功计数：runSyncRound.ts:119-121 `purgeDeleted += d.keys.length`、executePendingDeletes 视为已执行并出队、intentLog 按已发布结算。⇒ 「彻底删除 = 零痕迹」（AGENTS §3#15）在移动端只保证索引缺席，对象删除失败会漏成孤儿，且没有任何重试账本（deepCleanup 才兜底，而它是手动/周期）。
- **证据**：`src/mobile/v3/s3v3Remote.ts:115-123` vs `electron/s3v3/s3Remote.ts:114-126`；`src/core/s3v3/commit/runSyncRound.ts:115-126`；`src/core/s3v3/commit/executePending.ts:53-61`。
- **影响面**：对象泄漏（计费/合规面），无语义丢失（删除权威 = 索引缺席）。**待复现**（七牛 DeleteObjects 的 Errors 行为需实测）。
- **最小复现**：mock DeleteObjectsCommand 返回 `Errors:[...]` ⇒ 当前 `deleteMany` resolve 且无告警。
- **建议修法**：检查响应 `Errors`，非空抛错/告警（与桌面同口径）；两端行为进 deviceConformance 对拍。

### P3-10（发现 10）plan.deletes / deleteLocalBody 只在 published 轮执行 ⇒ 「索引已无条目」的 purge 对象清理无限推迟

- **现象**：runSyncRound.ts:115 把 user-purge 的对象删除挂在 `commit.status === "published"` 下（先发布后清理，P2 #10 正确方向），但当 purge 条目**早已不在远端索引**（上轮删除失败后的重试轮）时，本轮 buildPublishIndex 产出的索引与 base 逐字节相同 ⇒ commitPlan 返回 `unchanged`（commitPlan.ts:73）⇒ 删除永不执行；意图在 generation 前进且索引不含 id 后被 settleUnpublished 清掉（intentLog.ts:66-80 + s3v3Intent.ts:26-31）⇒ 此后连重试计划都不再生成。runSyncRound.ts:125 的 warning 承诺「下轮按删除意图重试」在「库不再有其它变更」时不成立。
- **证据**：`src/core/s3v3/commit/runSyncRound.ts:111-130`（执行条件）、`97-98`、`137-143`；`src/core/s3v3/commit/commitPlan.ts:71-73`；`src/core/s3v3/commit/intentLog.ts:66-80`。
- **影响面**：云端孤儿对象 + 本地正文文件（deleteLocalBody 同样跳过）泄漏；无数据丢失/复活。
- **最小复现**：purge 一条远端已缺席的文档、注入首轮对象删除失败、随后只跑空跑轮若干次 ⇒ 对象仍在、意图消失。
- **建议修法**：unchanged/skipped 轮也执行 `plan.deletes`（它只删已被索引排除的对象，与「先发布后清理」不冲突——unchanged 即索引已是终态），或意图不清除直到删除确认。

### P3-11（发现 11）deepCleanup 不取发布锁、keep 集先于列举计算 ⇒ retentionDays<=0 时可删他端刚上传未切 pointer 的对象

- **现象**：deepCleanup 读 pointer/索引/声明算 keep 集后再 list（s3v3Engine.ts:933-996）；另一台设备在 keep 集计算与 list 之间上传的正文/声明不在 keep 且会被列进删除候选，仅靠保留窗口兜底（默认 7 天安全）；`retentionDays <= 0`（文档允许的「手动显式清理」，§14:529）⇒ 立即删除 ⇒ 若对方随后发布 pointer，索引引用的对象已丢。I1 的维护队列只串行**本机**任务，管不住他端并发发布；deepCleanup 也没拿 `meta/lock.json`。
- **证据**：`src/core/s3v3Engine.ts:933-1008`（keep 集 → list → delete 三段无锁）；SYNC-PROTOCOL.md §14:516-532。
- **影响面**：触发需要 manual cleanup + 并发发布精确时序；后果是云端正文缺失（本地仍有副本，可重传/自愈）。**待复现**。
- **最小复现**：dryRun=false、retentionDays=0，夹具在 keep 集计算后插入一个未被引用的新 body，随后发布 pointer ⇒ 该 body 被删而索引引用它。
- **建议修法**：deepCleanup 先取发布锁（或删除前重读 pointer 二次确认 + 无论 retentionDays 取值都保留「lastModified < lockTTL」的对象）。

### P3-12（发现 12）quickPush 构造资产 key 用抛错形态校验，与整轮「跳过并告警」口径不一致

- **现象**：整轮对非法资产文件名（空格/中文/超长）**先判后跳 + 结构化告警**（applyAssets.ts:78-82、150-151，P1-7 专门修过）；quickPush 的 buildAssets 直接 `quickNoteAssetKey(id, filename)`（pipeline.ts:201），非法名会 `assertSafeSegment` 抛裸错 ⇒ 「保存并同步」整个失败、无结构化告警。两端同一脏数据、两种行为（②判据口径分叉）。
- **证据**：`src/core/s3v3/quickPush/pipeline.ts:184-204` vs `src/core/s3v3/apply/applyAssets.ts:72-82` + `150-151`；`src/core/s3v3/protocol/s3v3Keys.ts:47-51`。
- **影响面**：取决于小记资产文件名生成策略（若恒为生成名则不可达）。**待复现**。
- **最小复现**：在小记资产目录放一个名为`我的图.png`的文件后点「保存并同步」⇒ 当前抛「非法路径段」。
- **建议修法**：buildAssets 复用 `isValidSafeSegment` 口径：跳过 + `asset_invalid_name` 告警（与整轮同判据）。

---

## 已核实无问题（点名查过什么、为何没问题）

1. **发布输入来源（本审计核心问题）**：plan.publish 的条目全部由合并结果合成 —— 内容取内容判定赢家（plan.ts:429）、位置取 positionMerge 赢家（:433-444）、锁取 lockMerge（:447-456）、标签取 LWW 赢家（:457-481），目录/小记同口径（:494-550）；plan 是纯函数、在 apply 之前运行，**不存在「apply 落库改写后再读回发布」的通道**（buildPublishIndex 只消费 plan.publish + apply/applyAssets 结果）。261124 P0 的脏 parent 上云通道（落库改写值 → 下轮当 local 发布）在本层的对应防线就是这组 merge 赢家合成 + `picked.trashedAt ⇒ parentId:null` 归一（plan.ts:485、task-61），核对无误。残余风险在**行域值本身**被落库层改写（属审计②范围）。
2. **failedUploads 回退与 assetsHash 自洽**：回退条目原样用远端旧条目（含旧 assetsHash，其声明对象仍在云端）；新声明上传成功但条目回退时声明成孤儿，由 deepCleanup 回收（协议 §13/§14 预期行为）；assetsHashes 覆盖只作用于未回退条目（buildPublishIndex.ts:44-53 先判 failed）。
3. **发布排除口径**（remote-purged/trash/purge）三处一致：planWorldOf 过滤 remotePurged（恢复例外，engineBridge.ts:20-30）；publish 过滤 local-purge/remote-purged-trash（plan.ts:426、:530）且这些条目不许置 indexChanged（:146、:157、:197-198、:280-287）；quickPush 对「云端已删除·仅本地」无恢复标记直接 full-sync（pipeline.ts:288-292、:362-364）。trashed 条目**在**索引里带 trashedAt（软删语义）✓。
4. **quick 空 tagIds 不写 / lake 显式写 [] 的不对称是安全的**：接收侧 saveQuickNotes 只要 `tagsUpdatedAt` 非空就以 `tagIds ?? []` 应用 = 清空（deviceStore.ts:525-532，D7 注释）；旧索引两字段都缺时跳过不清空 ⇒ 「删光标签」能传播、「旧索引无字段」不误清。lake 侧显式 []（plan.ts:488-489）同理。
5. **零变更短路判据**：commitPlan 的 unchanged 用**序列化 hash 对比 base pointer commit**（:67-73），内容寻址下等价于「与云端逐字节相同」，不会误判；引擎的 sameAsBaseline（s3v3Engine.ts:545-547）显式排除 bootstrap 底稿 ✓。**保留意见**：基线内容与 `lakeCommit` 的自校验缺失（串库/损坏基线会被当真 remote 世界），已列入护栏建议（不构成现行 bug，261124 的串库是测试基建问题）。
6. **锁键/锁常量**：`LOCK_KEY`（publishLock.ts:7）与 `COMMIT_LOCK_KEY`（commitPlan.ts:18）同为 `meta/lock.json`、TTL 同 120s、settle 同 40ms —— 两个发布者共用一把锁 ✓。commitPlan.ts:18-21 是重复定义而非漂移（当前同值），列入护栏钉同值。
7. **quickPush releaseLock 的「TTL-5s 内无条件 DELETE」不是 bug**：§12.3:479 明文规定该优化；安全前提（自家锁未过期、他端只在过期后抢占）与 §12.1 一致，超余量时退回读 owner ✓。
8. **两端 put/get 协议面一致**：GET 解压 = `isGzipMetadataKey(key) && isGzip(bytes)`（两端同判据，s3v3Keys.ts:21-23；不再按魔数误伤附件）；PUT 只按 opts.gzip 压缩并声明 ContentEncoding；pointer/lock 裸写裸读一致；桌面 getRange 不解压但只用于大资产 ✓；prefix 加/去对称（desktop key()/list 剥 prefix，mobile full()/relative()）✓。
9. **isSafeId 覆盖面 vs 固定 id**：`assertSafeSegment = isSafePathSegment + ^[A-Za-z0-9._-]+$`（s3v3Keys.ts:38-51、storeUtils）；`notebook-uncategorized`/`notebook-trash`/`welcome-note` 全部通过（纯 ASCII+连字符）；日记无固定 wire id（diaryNotebookId 动态派生）；`notebook-trash` 按 task-61 不进 wire（plan.ts:482-485）；uuid/哈希形 id 全过 ✓。资产文件名同判据（validateAssetDeclaration:266 与 assetKey 同源）✓。
10. **quickPush「同名资产复用远端声明条目」不是 bug**：协议 §3 对象布局明文「同名 = 同内容」；整轮 changedAssetNames 对 size/hash 不符还有防御性重传（applyAssets.ts:95-96），是超出协议的加固。
11. **quickPush × bootstrap 基线**：bootstrap 基线谱系恒为空（bootstrapBaseline.ts `epoch:""/generation:0/commit:""`）⇒ quickPush CAS 必失败 ⇒ 回退整轮，不可能带 bootstrap 标记写真基线、更不可能触发假 sameAsBaseline ✓。
12. **buildPublishIndex 快路径共享引用**：返回 `plan.publish` 的条目引用，但消费链（commitPlan 序列化、mergeRoundIntoState、saveBaseline）均只读未就地改写条目（engineBridge 的 byId 均构造新对象）✓。
13. **上限常量与 AGENTS 一致**：S3V3_MAX_LAKE_NOTES=100_000 / MAX_QUICK_NOTES=20_000 / MAX_FOLDERS=10_000 / MAX_TAGS=5_000 / MAX_TAGS_PER_NOTE=20 / MAX_INDEX_BYTES=64MiB ✓；canonicalJson 迭代化 + 节点/深度上限防爆栈 ✓。
14. **intentLog 三段生命周期**：add 撤销语义（恢复唯一撤销删除意图）、settlePublished 只 bump 真正发布的 purge 意图、settleUnpublished 复用单一判据 `shouldClearDeletionIntent`（更高 generation + 索引明确缺席才清）✓，无「发布成功即清」的误清路径。
15. **executePendingDeletes 门禁**：不放行即出队（宁可不删）、执行失败保留可执行项重试、purge 前缀先删键后删 ✓；与 §13 一致。
16. **deepCleanup keep 集**：pointer/lock/当前两索引/全部正文/声明/声明内附件/extraKeep/每空间上一版索引，扫描前缀不含 meta 根（lock/pointer 天然不在删除面）✓；lastMissing 保守保留（ageUnknown）✓。
17. **发布成功后旧正文清理**：lake 正文按 noteId-hash 寻址（无跨条目共享）逐条删；小记正文按 hash 共享 ⇒ 只删「新索引无人引用」的 hash（s3v3Engine.ts:649-657，261113 P1 已修）✓；失败降级 warning 不回滚发布 ✓。
18. **initialRound**：空世界 + 本地即真相 + 失败条目不进索引（buildPublishIndex 注释 rule 2 的空世界退化）+ 带本地意图裁剪（261113 P2 #11）✓；被抢先 ⇒ commit retry ⇒ 引擎按 pointer-moved 重来 ✓。

## 建议新增护栏（测试名 + 断言要点）

| 测试名 | 断言要点 | 对应发现 |
|---|---|---|
| `commitFailedUploadKeepsLocalMeta.test` | X 正文 PUT 失败 + Y 变更同轮发布 ⇒ X 行 title/parentId/sortOrder/锁 不回滚、baseline X 保持回退版、下轮重试上传 X（新 meta 仍要发布） | 1 |
| `downloadFailureInPublishedRound.test` | 发布轮中 X 下载 404/sha 不符 ⇒ 行 content_hash 不写远端 hash、下轮计划产出 download（非 upload）、云端赢家正文不被清理 | 2 |
| `applyEntriesCoverNetworkErrors.test` | GET 抛错也进 apply.entries（bodyFailed 可见），非发布分支守卫命中 | 2 |
| `fieldChangedTrashNormalized.test` | 含已发布回收站条目的空跑轮：plan.publish === null（或 fieldChangedIds 空），publishes.lake 不含 trashed id | 3 |
| `validateLakeIndexUniqueFolderIds.test` | folders 两条同 id ⇒ 校验抛错；note/folder 同 id 仍抛错（不回归） | 4 |
| `validateQuickNoteTagHardening.test` | quick item tagIds 重复/超 20、tagsUpdatedAt 非法串 ⇒ 抛错（与 lake 同口径） | 5 |
| `commitPlanFirstPublishRace.test` | 两首传者同 commit 并发 ⇒ 败者 readback 失败（epoch/createdAt 比对）⇒ retry，不得双 published | 6 |
| `quickPushForkGuard.test` | pointer 与 baseline 同 generation、quickNotesCommit 不符 ⇒ full-sync("cloud-changed")，不发布 | 7 |
| `quickPushKeepsTargetKey.test` | quickPush / resetFromCloud 后 baseline.targetKey 保留（或补章） | 8 |
| `mobileDeleteManySurfacesErrors.test` | DeleteObjects 返回 Errors ⇒ 抛错/结构化告警；与桌面语义对拍（deviceConformance） | 9 |
| `purgeDeletesRunOnUnchangedRound.test` | 索引已无条目、对象删除失败后，unchanged 轮仍执行 plan.deletes / 意图不清 | 10 |
| `deepCleanupConcurrentPublish.test` | retentionDays=0 时不得删「keep 集之后出现的未引用对象」或要求持发布锁/二次读 pointer | 11 |
| `quickPushInvalidAssetNameTolerant.test` | 非法资产名 ⇒ 跳过 + asset_invalid_name 告警（不整单失败） | 12 |
| `baselineSelfHashGuard.test` | sameAsBaseline 前校验 serialize(baseline.lake/quickNotes) 的 hash 与 lakeCommit/quickNotesCommit 相符；不符走真读索引并告警（防串库/损坏基线） | 护栏（对应「已核实 5」保留意见） |
| `lockConstantsParity.test` | publishLock.LOCK_KEY/LOCK_TTL_MS 与 commitPlan.COMMIT_LOCK_KEY/COMMIT_LOCK_TTL_MS 同值（防重复定义漂移） | 护栏（已核实 6） |

## 交叉说明

- 发现 1/2 的**落库半边**（deviceStore.saveState / mergeRoundIntoState / syncReconciliation）与审计②（apply/落库层）范围重叠；本报告从「发布回退/失败语义与 §17 的一致性」角度给出完整证据链，合卷时请与 02 报告去重、以先入者为准。
- 发现 3 同时触及引擎字段 diff 与 loadState 投影（审计②的「loadState 投影」核对项），同上处理。
