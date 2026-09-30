# 非多维表全栈审计与简化重构讨论稿

> 日期：2026-09-30（Asia/Shanghai）。状态：**只读审计已完成第一轮；本文用于讨论，产品代码未修改，任何重构尚未开始。**
> 源码基线：`ae1cfdab490049adc9bc9023b2bba3948122169d`，`master`。
> 范围：桌面外壳、普通 Lake 文档、标签/保存/历史/资源、同步编排、安卓持久化与交互接线；Sheet/Board 只审其宿主与保存接口。
> **排除：多维表模型/算法/字段/网格/交互实现、搜索整体重构、vendor 与依赖清理。** 多维表专项由另一会话维护；本文没有其实施计划，也不替代专项文档。
> 审计期间另一会话更新了 `HANDOFF.md` 与 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。本轮不编辑、不提交这些文件。初始工作树干净，结束时这两份既有文档修改不属于本轮。

## 导读

- 想先知道“到底是不是过度防御”：读 §1、§3、§5。
- 想看有证据的真问题：读 §4，特别是 F01/F02/F04/F05/F07/F10。
- 想讨论一个可以重新设计的板块：读 §7 **文档会话与持久化**。
- 想划分能删、不能删、暂缓：读 §5 与 §9。
- 想知道这轮到底验证了什么：读 §10 和附录。

---

## 1. 结论：问题不是“防线太多”，而是“状态没有唯一所有者”

**值得较激进重构的是文档会话/保存/重载/关闭的整个纵向链路，而不是推翻同步协议，也不是按文件行数重新切一遍目录。**

目前能确认四种情况同时存在：

1. **真正必要的防线**：本地墓碑、远端发布顺序、字节校验、资源引用保护、IPC 身份校验、缩略图限并发。这些直接保护真实不变量，不能因为长或有 `if/catch` 就删。
2. **已经失去意义的防线**：旧 schema 补列、旧明文密钥兼容、已被连接层钉死 DNS 取代的“预解析检查”入口、生产适配器为了旧测试桩保留的可选分支。可以删除，而不是再包一层。
3. **防御反过来破坏正确性**：保存吞错让关闭继续；全局“最后请求胜出”取消不同文档的合法刷新；清理“孤儿草稿”删除最后一份输入；单调时间保护了历史排序却没保护文件身份。
4. **为旧结构缺陷叠出的补丁链**：正文缓存失效、重建实例、延迟销毁、滚动回钉、定时重试、多个 observer。不是全部无用，但需要把它们的责任收回内核适配器与会话边界，逐项证据化退役。

**建议：少数边界做硬约束；内部正常路径尽量直线运行。错误可以显式失败，不能假装成功，也不能自动清掉用户仍有价值的数据。**

不接受以下“重构”：再造通用 CommandBus、Repository 工厂、事件溯源、插件注册系统、协同冲突算法、全库缓存、SQLite 连接池。也不把“性能最高”当可证明结论：本轮没有真实前台帧时/移动端耗时基线，只能选成本更低、可验证的结构。

### 优先讨论的三项

1. **先修已确认错误契约**：保存失败不得关闭；同一内容快照绑定同一 revision；回收站状态由读回数据判定，不靠“操作成功所以全部恢复”。
2. **批准文档会话纵向重构，不批准全系统重写**：一次收回保存、关闭、淘汰、重载的所有权，消掉多个正文与状态副本间的互相修补。
3. **单独决定桌面正文的最终持久化介质**：短期保留文件；中期若不要求文件可直接编辑，正文入 SQLite 可以从根源消灭文件/DB 双提交。不能把这个产品级变化夹在普通重构里。

## 2. 需求与边界：先把不需要解决的问题删掉

以下以 README 的量级/场景、AGENTS 的红线、实际代码为准：

| 约束 | 对架构的直接结论 |
|---|---|
| 单用户多设备轮换，无协同对抗 | 不需要 CRDT、分布式租约、跨设备冲突合并；但本机异步保存、多个窗口、后台同步仍会交错，不能忽略本地竞态。 |
| 5000 文档 / 2 万附件 / 全库约 20GB；单正文数 MB | 按访问量而非总库量工作；大文件必须流式；不要每次按键遍历全库，也不要把 20GB 预加载进 JS。AGENTS 的 10 万/100 万只是长期压测参考。 |
| 本地为真，云端镜像；先提交者为真；覆盖前历史留档 | 保留现有同步/墓碑/恢复规则，不重新争论产品语义。UI 未提交的输入也必须得到保存、留档或明确阻止，不能只保护已经在磁盘里的版本。 |
| 删除压编辑，显式恢复唯一例外 | 普通保存不得触发隐式恢复；只读 UI 防误操作，存储写入口防异步晚到，两者是不同层级的必要边界。锁定是否仅防误操作，需保持现有产品定义，不把UI锁擅自升级成安全权限。 |
| 开发数据可重建、不做旧数据兼容 | schema 应直接表达当前版本；旧库补列、旧格式解释器、旧测试桩降级都要逐项删除。不得擅自清用户现有数据。 |
| 保持本地资源离线、附件命名/身份契约 | 文件名身份、展示名和访问 URL 分离；不做内容去重；不改资源/manifest 格式来“省事”。 |
| 闭源 lakex 已 pin | 默认配置/官方 API 优先；无官方能力的行为必须经当前 bundle 与真实运行验证。不能凭开源 lake-main 猜替代命令。 |
| 安卓正式端 | “移动没有崩溃兜底需求”的注释不能替代产品要求；Android 进程退出、返回、切阅读均要有持久化契约。 |
| 多维表正在另一会话审查 | 不触碰其正文、动作或 UI；只报告共享宿主接口上的风险，实施前划清共享文件写集。 |

### 上下文来源与漂移

已读取指定入口、架构/存储/同步/GC/历史/开发/Android/浏览器/面板相关文档，阅读多维表专项以确认隔离范围。内核能力按 vendor 源码 → 本地官方 `07 API与事件 / 47 通用配置 / 65 大纲 / 08 命令列表` → `LAKEX-CONTRACT.md` 的证据链核查。

需避免继续当事实使用的旧记录：

- 初始 HANDOFF 标“填色未提交”，实际 HEAD 已包含该批提交；另一会话已在交接文档纠正。
- `DEVELOPMENT.md` 仍列旧 Electron、旧测试数及旧提交历史；当前依赖以本地 `package.json` 与安装结果为准。
- `STORAGE-LAYERS.md` 的 manifest 链“8 层”与现契约“3 层”不符。
- AGENTS 部分“系统 Node 无法跑 better-sqlite3”记录与当前 N-API 13.x 文档及本轮真实 SQLite 执行不符。
- `ANDROID-TECH-SCHEME.md` 中 sql.js/IndexedDB 的旧方案不是当前正式端架构；正式数据为原生 SQLite/WAL + Filesystem + AssetServer.kt。

**本轮只记录，不替另一会话改交接，也不把文档修订混入产品重构。**

## 3. 从外到内的审查地图

| 层 | 已核查路径 | 结论 | 证据边界 |
|---|---|---|---|
| 用户任务 | 写文档→停顿保存→关闭/淘汰；恢复/历史；安卓完成/返回 | 保存与关闭的成功契约失配；恢复只读误解除；安卓取消队列冒充 flush。 | 隔离行为复现；未做真实端完整走查。 |
| 外壳与交互 | App、Tabs、ErrorBoundary、同步提示、Overlay | 多个状态所有者；“切标签即可恢复”的提示在 keep-alive 下不成立；同步反馈双订阅不同规则。 | 静态路径+局部行为；不是像素评价。 |
| 编辑器适配 | EditorTab、LakeEditor、lakeRuntime；Sheet/Board 宿主保存 | 初始化/自愈/滚动/保存耦合；代码块观察器与全局音频扫描范围过大；嵌套防抖隐藏未保存状态。 | 当前源码与内核契约；未验证所有兼容补丁能删。 |
| 会话与保存 | SavePipeline、SaveCore、DocumentTabs、TabLifecycle、SyncRefresh | revision 与旧 payload 没绑定；每文档保存排队只保证顺序、不保证最新；全局重载 guard 错误取消。 | 直接调用现有 hook 逻辑的隔离复现。 |
| 持久化与历史 | NoteContentRepository、Store、HistoryLifecycle、AssetRepository、OrphanLifecycle | 文件先提交并不等于双介质原子；历史文件身份撞车；文档级资源清理绕过草稿保护。 | 真临时文件/真实 SQLite/故障注入。 |
| 传输与安全 | IPC registrar、asset/web 服务、SSRF/pinned fetch、SecretStore | 有效边界应保留；失效兼容可删；HTTP 只有头超时；移动固定密钥只是混淆。 | mock transport + WebCrypto 样本；没有攻击真实用户数据。 |
| 同步与维护 | core syncEngine、Controller、adapter、GC；移动 bridge | 协议整体不建议推倒；能力可选分支混入“旧测试桩兜底”；安卓网络同步锁阻塞本地保存。 | 已追调用链；未跑真实 S3 双端/完整压力。 |
| 工程护栏 | Vitest、core boundary、CSS 指标、opt-in 容量基准 | 默认全绿并未覆盖会话时序；单个容量基准实际失效；声明数不能证明结构质量。 | 本轮真实执行结果。 |

### 没有证据就不打分

**覆盖声明**：这是关键业务链路的第一轮全栈审查，不是“全仓每行均审完”。未发现的问题不等于该模块无问题；下一轮优先补真实端用户动作及长文档测量，而不是继续靠关键词扩充问题数量。

本轮没有前台 UI、键盘全路径、对比度/窄窗截图、IME 真机测量，因此不提供“无障碍 90 分”“体验流畅”“性能提升 70%”之类虚构评分。以下 UX 问题只来自可证明的动作语义：失败后关闭、错误恢复指引、未保存状态不可见等。

## 4. 发现清单：问题、用户后果、最小修正

证据等级：

- **A**：隔离执行当前源码复现（hook 的 React API 用最小替身；文件/SQLite/密码样本是真执行）。不是 React DOM、Electron 或 Android 端到端验收。
- **B**：当前源码调用路径足以证明结构/控制流；具体发生频率与真实性能未测。
- **C**：假设/优化候选，必须补实测后才能定实施。

P1 = 数据/恢复/重要功能正确性；P2 = 性能/维护/错误体验；没有把所有问题夸成 P0。每项下面的修正是方向，不是已实施承诺。

### F01 [P1/A] 保存吞错，调用者仍关闭/淘汰脏标签

**证据**：`src/hooks/useSavePipeline.ts:50–81` 捕获错误后调用 onError，但没有重新抛出或返回失败；`NOT_FOUND` 直接返回。`src/hooks/useDocumentTabs.ts:50–68` 只 await，不检查成功，然后移除 tab；`useTabLifecycle.ts:34–45` 淘汰也如此。

**复现 R01**：让 `native.saveNote` 抛“disk full”，实际 closeTab 最后仍移除脏 tab。

这不是“catch 不够多”，恰恰是把错误吞成 fulfilled Promise。草稿是否已经落盘取决于 1.5s 定时器和先前行为，不能拿“还有草稿”保证输入安全。锁定前 await 保存的路径同样受到影响。

**修正**：后台调度可以捕获展示；显式 `flush/save` 必须抛错或返回明确失败。关闭、淘汰、锁定只有确认相应 revision 持久化后继续；失败留在原文档，可重试/复制/显式放弃。

**验收**：磁盘满、NotFound、DB 提交失败三种情形都不能静默关闭；多标签关闭遇一篇失败，不抹掉失败文档；状态显示真实原因。

### F02 [P1/A] revision 防护采样太晚，旧排队任务被认证成“最新”

**证据**：`useSavePipeline.ts:51–62` 先捕获传入 title/content，**在任务获得 queue 执行权后**才读 `core.revision(noteId)`，缓存也在此时从 live editor 取。

**复现 R02**：v1 保存正在执行；另一 v1 请求排队；用户更新为 v2、bump revision。排队任务开始后读到 v2 的 revision，却上传 v1 正文和 v2 派生缓存。响应后判相等→把 tab 回写 v1、dirty=false、清草稿。

**本质**：版本号不是有一个计数器就行，必须描述**这份 payload**。KeyedAsyncQueue 只防并发，不能防旧数据。

**修正**：body/title/caches/revision 是同一次 capture 的不可变快照；入队前绑定。更好的是单 in-flight + 一个可替换 pending，不积压旧正文；完成只能 ack 自己的 revision，不能重新拿 live revision 替自己背书。

**验收**：任意排序的保存/编辑/重载，都满足 `ackRevision ≤ submittedRevision`；旧响应不修改最新正文、不清最新草稿；正文与缓存同版本。

### F03 [P2/A] 全局 last-request-wins 把不同文档合法重载互相取消

**证据**：`useWorkspaceState.ts:40` 一份 `tabReloadVersionRef`；`useSyncRefresh.ts:61/84/101` 的回收站、历史、附件重命名及 `useSyncProgress` 都共享它。

**复现 R03**：先 reload(a)，再 reload(b)，两个 DB 读均成功，但 a 的结果被 b 的 next() 取消，a 保持旧正文。

**修正**：取消作用域是文档会话/generation，不是全工作区。各文档互不取消；同文档的两次重载再考虑最新胜出。全库同步本身的取消另用同步 run id，不能混成一个 guard。

**验收**：a/b 同时附件改名两篇均更新；重载期间开始输入不能被旧读回覆盖；会话关闭后晚到响应不重开标签。

### F04 [P1/A+B] 恢复任意条目，会解除仍在回收站的其他标签只读，并可能隐式恢复

**证据**：`useSyncRefresh.ts:60–73` 遍历所有 deleted tab，只要 readNote 成功就 `deleted:false`，没有 `isGoneNote(note)`。软删本来保留正文，故“能读”不等于“已恢复”。

**复现 R04**：a 仍 `syncState='purged'`，读回成功；触发其他条目的恢复回调，a 也变 deleted=false。

**另一端证据**：`electron/noteContentRepository.ts:36/50–55` 在普通 save 中调用 `revivePurgedIfNeeded`；`trashLifecycle.ts:133–140` 对保留 purge 副本隐式 restore。UI 一旦错误解除，晚到保存就可能走这条路，违反“显式恢复唯一例外”。目前路径存在，未把真实同步复活后果当已 E2E 验收。

**修正**：回调传本次恢复 id；每次读回都按真实 gone/locked 判状态。普通保存拒绝 trash/purged，不兼职 restore；显式恢复用既有独立动作。关闭/锁定前尚未保存输入先处理，不是删掉保存入口就丢输入。

**验收**：恢复 b 不改变 a 的 deleted；陈旧 save 不撤销墓碑；显式 restore 后继续保存正常。不要删除 isGoneNote，而是删隐式复活。

### F05 [P1/A] 安卓 flush 是取消全部保存，完成当前文档会丢掉别篇待保存任务

**证据**：`src/mobile/useAutoSave.ts:9–33` save 回调类型为 void，异步 Promise 未 await/catch；flush 清全部 timers，不保存 payload。`NotebookWorkspace.tsx:213–216/238–248` 在完成活动文档前调用它，随后只保存当前文档。卸载也调用同一个“flush”。

**复现 R05**：a/b 都排队，flush 后 writes=[]，pending=0。**这不是“可能晚一点存”，而是任务已被取消。**

**补充**：closeTab/LRU 不等待此 hook 的持久化；关闭单篇时只要工作区仍活着，定时器可能还会到点，不能笼统说“每次关闭都丢”。真正明确丢弃点是全局 flush/卸载。

**修正**：flush(id?) 保存对应最新 payload并返回 Promise；cancel(id) 单独命名；异步失败保留 dirty 与任务，不做未处理拒绝。完成只冲当前会话；工作区离开明确冲全部，不从 effect cleanup 里赌异步一定能完成。

**验收**：a 正在输入→b 完成→a 仍落盘；1s 内返回/退出后再打开内容保留；失败展示、留在编辑态；进程强杀窗口的承诺另行定义。

### F06 [P1/A] 安卓普通保存 UPSERT 可重写仍被删除的记录

**证据**：`src/mobile/noteRepository.ts:122–133` 仅“查是否变化”过滤 `trashed_at IS NULL`；真正 UPSERT 的 ON CONFLICT 无生命周期条件，将任意既有 id 改成 `sync_state='local'`，保留其 trashed_at。

**复现 R10**：真实 SQLite 的 trash/purged 行执行当前 SQL 后，content 从 trash-original→late-save，syncState从purged→local，trashedAt仍在。

**修正**：create 与 save/update 分开。save 对 missing/gone 返回明确错误；不能 upsert 当万能“自愈”。不可把仍在回收站的行改成local后继续写正文。生命周期判定放写边界，不能只靠当前屏幕 editing 标记。

**验收**：删除后晚到保存不会写正文/标local；创建仍正常；显式恢复后能写；移动端与桌面同一语义对拍，不共享两套不同 schema 的 SQL 文本。

### F07 [P1/A] 快照排序做了防撞，文件身份仍撞车

**证据**：`electron/historyLifecycle.ts:83–100` 文件名仅秒级时间+内容hash前缀；created_at 单调 +1ms 在文件名生成之后。`deleteHistory:144–150` 删除一行即 unlink 路径，不知道别的行也指向同文件。

**复现 R07**：同秒 force=true 生成两条相同内容快照，真实 SQLite 中 id 不同、file_path 相同。删 h1 后 h2 行还在，文件没了；自动清理部分旧行也可能触发同问题。

**修正**：选一个简单的身份规则：文件名随机唯一；或以真实历史行 id 命名并用同一提交路径。不要再加“共享文件引用计数”支持非需求中的文件去重。排序用 `created_at DESC, id DESC` 后可删除为了排序而手造单调时钟的补丁。

**验收**：同毫秒/同秒/同内容连续 3 次 force，每条可读；删除/清理任一条，其余仍可恢复；快照留档失败不能假成功。

### F08 [P1/A+B] “文件先于 DB”只改变失败方向，不能承诺本地一致性自愈

**证据**：`noteContentRepository.ts:60–74` atomicWrite 成功再 DB transaction。DB 提交失败没有回滚文件、也没有确定的恢复标记。`syncAdapters.ts:42–45` 对 synced 行信任 baseHash、不实读正文。

**复现 R08**：真实文件从 old→new；故障注入 DB commit fail；元数据仍旧/synced。这里复现的是双介质不一致，不是 S3 全链路数据丢失。

**为什么“下轮幂等自愈”证据不足**：下一次真正成功保存当然能修；但会话可能已被 F01 关闭，且 synced 行的内容 hash 不会主动重扫。没有“肯定会重试”的所有者，不能以极罕见给出正确性证明。

**修正/取舍**：§8 三条路线。短期保留文件时需要明确 commit-pending→重试/恢复证据；中期正文入 SQLite 可根除。不要把 fs.rename 的单文件原子性误称为整个笔记保存原子性；也不承诺它能抗断电（现路径无 fsync）。

**验收**：文件写失败、DB 失败、进程在两步间退出都能重开恢复正确正文和待同步标记；派生缓存出错不把已提交正文报失败。

### F09 [P1/A] 自动删除“对应文档不存在”的草稿，删除了最后的恢复出口

**证据**：`useSyncRefresh.ts:41–48` 将不在 summaries 里的 journal 自动 delete。与 `useTabLifecycle.ts:117–125` 的“对应文档不存在，草稿仍保留可手动丢弃”契约冲突。

**复现 R11**：summaries=[]、存在 missing 文档 journal；刷新删除该 journal。

**修正**：不存在的草稿是“孤立恢复数据”，不是“无价值垃圾”。列出但不可覆盖原文档，提供复制正文/显式丢弃。暂不做“恢复为新文档”功能也可以，不能自动删最后一份输入。

**验收**：文档 missing 时草稿仍可复制；坏格式与合法孤立 journal 区分；重新创建不擅自复用旧 id；显式丢弃才删。

### F10 [P1/A] 文档级孤儿资源删除绕过统一草稿保护

**证据**：`electron/assetRepository.ts:82–94` getProtectedRefs包含当前正文、历史与草稿。全局/自动路径复用它；`orphanLifecycle.ts:90–101` cleanNoteOrphans却只过滤 `protectedByHistory`，从展示列表直接删文件。

**复现 R12**：草稿唯一引用某图；getProtectedRefs=true；cleanNoteOrphans删图成功、原文件不存在。真实临时文件，不涉及正式库。

**修正**：展示“已从正文移除”与删除判定分离；所有删除入口在最终 unlink 前共用现有 getProtectedRefs。不是再加一套草稿 if；删除绕行入口的自有判据。

**验收**：文档级、全局、单条、自动历史清理四路径对同资产同结论；草稿唯一引用不删，显式丢弃且其余无引用后可删。

### F11 [P2/A] 远程图片只有响应头超时，正文停滞没有 deadline

**证据**：`electron/httpFetcher.ts:112–140` headers 到达就 clearTimeout，把 response.body交给 resourceRepository。外层有 3 次尝试，但 body 卡住就没有下一次。

**复现 R09**：配置15ms deadline，headers立即到，body等80ms后成功，总耗时约83ms。不等待永远挂起来证明问题。

**修正**：一个请求 deadline覆盖 DNS/连接/重定向/消费 body，结束/取消统一释放。现3×30s与重定向逐跳30s不等于整任务30s；先约定总任务上限，别再添加第四种 watchdog。

**验收**：headers快body慢、body无限停滞、慢DNS、重定向链、取消都按约定截止；下载槽释放；非重试型非法输入不浪费重试。

### F12 [P1/A] 安卓固定密钥 AES-GCM 是混淆，不是设备秘密

**证据**：`src/mobile/secretStore.ts:14/34–38` KEY_MATERIAL为公共固定字符串，经SHA256得到每台设备相同key。注释“同一安装内稳定/换机重装不能解密”与实现不符。

**复现 R06**：只用公开常量派生另一份key，成功解密自行生成的样本，没有读/显示任何真实S3凭据。

**限定**：不等于任何网站直接能读IndexedDB；威胁是能得到密文的攻击者不需要设备秘密就能解密。不可据此移除保护、改存明文。

**修正**：正式Android端用Android Keystore持有key、原生bridge操作密文；SecretStore接口保持。不新增泛化凭据SDK、也不搞可回退到固定key的“兼容模式”。现开发凭据重填，不清真实用户库。

**验收**：仅密文+源码不可解密；卸载/密钥不可用清晰提示重填；不写日志、manifest、普通设置字段；失败不能报告保存成功。

### F13 [P2/B] 同步反馈有两个消费者、两套状态寿命

**证据**：`useSyncProgress.ts:35–65` 常驻监听；`useSyncController.ts:44–80` 手动同步另订阅，12s后清conflict notice，与常驻“累计保留”不同。done时两者均更新sync，常驻getSyncStatus的晚到响应还会写success。

**后果**：手动与自动同一结果展示不同；小记失败最终是否显示error取决于晚到更新；不把未跑的“必定变success”当已复现。

**修正**：一个同步状态消费者；手动按钮只发动作。完成态一次以Lake+QuickNotes的组合结果归一，提示寿命同一决策。移除第二订阅与其定时器，而非再给每次setSync加版本号。

**验收**：自动/手动相同结果同状态；Lake成功/小记失败不会被done覆盖成全部成功；取消归idle；用户仍能查看归档历史。

### F14 [P2/B] 错误边界阻止了全窗崩溃，却给了不可执行的恢复指引

**证据**：`MultiTabEditor.tsx:542–555` failed=true；key只取noteId/reloadKey，切tab仅visible变化不重置边界。提示却说“切换标签或重新打开即可恢复”。

**修正**：保留错误边界，在同tab提供真正重试动作（先保护该会话未提交正文，再换mount generation）；或者只提供准确的关闭/重开指导。不要为隔离错误删除边界，也不要靠每次切tab都销毁所有编辑器来兑现文案。

### F15 [P2/B] Sheet/Board内层800ms再加外层1000ms；dirty确认太迟

**证据**：BoardEditor:26/264–294、SheetEditor:36/925–937，变更先延迟序列化/onChange；外层useNoteLifecycle在收到onChange时才dirty和bump；随后useSavePipeline再等1s。beforeunload只看外层dirty。

**静态时序R13**：最后一次操作到磁盘正常路径至少约1.8s，不计上传/保存耗时。前800ms内外层可能认为clean；卸载内部flush才回调已被移除的tab，上层本来已决定关闭。这轮没有做真实画板“操作后立即关窗”验收。

**修正**：编辑器一收到用户变更即通知会话dirty；序列化昂贵可以合并，但只有会话负责持久化防抖。关闭前await adapter.capture/媒体任务再flush，不依赖卸载发布正文。涉及公共宿主，必须与多维表会话协调，不能顺手改其实现。

### F16 [P2/B] 安卓整轮网络同步持有本地写队列，离线优先被网络等待反向阻塞

**证据**：`bridge.ts:392–396` saveNote与`829+`syncNow都持`maintenance.run('main')`；syncNow包住全部远端GET/PUT及小记同步，期间任何普通保存只能排队。

**后果**：慢网时UI还在写，磁盘未提交时间受网络影响；这不是日常5000量级缺虚拟化，是锁的粒度错误。当前没有真机时延数字。

**修正**：现队列先保留，不能简单让全部DB操作并发。分离“sync/GC维护互斥”和“短本地事务互斥”；网络阶段不占本地DB写锁，下载应用/记账用短事务+现有快照一致性校验。修改共享引擎前需单独立项、先跑两端对拍。

### F17 [P2/A] opt-in容量基准失效，默认全绿遮住长期性能验证空洞

**证据**：本轮实际执行`LAKE_RUN_BENCHMARK=1 vitest run electron/workspace.benchmark.test.ts`，失败在61行：要求summary.resources≥10000，实际契约resources=0（资源差集在同步时才知道）。

**结果**：默认 suite把此项跳过，所以1430通过不能说明容量测试通过。日志中的 savedMs混合保存与造1万文件，不能拿它当saveNote延迟。

**修正**：断言当前契约，独立测创建/保存/扫描/摘要，不把fixture生成并入业务耗时。基准样本可针对5000/2万，但不要凭旧标题升级到100万设计。

## 5. “过度防御”裁决：删什么、留什么、条件是什么

### 5.1 已有明确删除理由的内容

| 项 | 当前证据 | 推荐动作 | 为何不会损害当前需求 |
|---|---|---|---|
| `electron/schemaInit.ts:114–205`、`src/mobile/schema.ts:27–103+`的逐列旧库升级 | CREATE TABLE仍缺当前列，靠PRAGMA+ALTER拼完整；含旧FTS tokenizer替换与旧hash回填。 | 把**当前完整schema**直接写CREATE TABLE，删除旧补列/旧数据回填；seed与用户删除不复活规则保留。搜索表的当前DDL保留、不重构搜索引擎。 | AGENTS明确不做旧库兼容。现有库升级策略需用户明确接受重建/导出后再实施，绝不自动删正式库。 |
| schema seed中的“旧文档补tree” | `schemaInit.ts:217+`迁移旧孤立notes。 | 删除旧模型迁移；新建笔记一次事务写正确树。 | 当前生产写路径已同时写notes/tree；保留数据健康诊断，不把迁移当修复。 |
| `secretCipher.ts`的旧明文读取分支 | decrypt遇非enc:v1原样返回；测试刻意验证plain-old。 | 非当前格式返回明确“重新配置”，删旧明文兼容测试。 | 当前凭据应由安全存储加密；不用为了旧开发数据长期接受明文。 |
| `ssrf.ts:53+ assertSafeRemoteHost` | 生产仅pinned fetch依赖isBlockedIPv4/IPv6/SsrfError；旧assert入口只被自身测试调用。 | 删除旧预解析入口及无消费者测试，保留IP策略和连接层钉死/逐跳校验。 | 消除失效防线，不取消SSRF边界。 |
| `syncAdapters.ts:193–210`等“旧FakeStore可能没有”分支 | 墓碑published/isFolderPurged/applyRemoteFolderDelete等正式Store均有；可选调用来自旧桩兼容。 | 生产adapter对必需能力直接调用；测试提供完整port。 | 墓碑功能是必需项，不是运行时可选能力。真实平台差异如流式上传/下载仍保留能力判断。 |
| `assetServer.ts:223–236`的旧file/null origin许可 | 打包已lake://app，dev/Web具明确origin；此处保留旧file页面解释。 | 在真实浏览器/PDF/clipboard核对后删除旧许可，单一配置来源生成允许集合。 | 当前已不以file页运行。**条件删除**：Origin:null也可能来自sandbox上下文，先验现消费者；不是为了“整齐”直接删。 |
| 同步提示第二订阅+12s timer | F13；同一任务两套结果处理。 | 删除重复消费者，保留一个结果模型。 | 不损失同步反馈，反而统一手动/自动语义。 |
| 普通save的隐式purge恢复 | F04。 | 删除恢复副作用；只保留显式restore动作。 | 契合“恢复是唯一显式例外”，不是削弱数据保护。 |

### 5.2 架构落地后才能删除的补丁

- **contentCache/reloadKeysRef**（MultiTabEditor:90+/235+）：目前为了实例不同步与外部reload维持数据；新会话拥有正文、reload有generation后可整体删除，不能今天孤立删完让外部恢复失效。
- **零散save/draft timer map与glue回调**：新会话单一owner接管后删；不要保留旧hook“兼容”新会话。
- **全局tabReloadVersionRef**：删除全局作用域，但保留每文档generation；不是删所有异步保护。
- **created_at人造单调时间**：先修历史文件身份，再改`ORDER BY created_at,id`；避免建新Clock服务。
- **编辑器“全重建自愈”**：先复现当前kernel插卡失败，证明定点水合已足够，才退役重建、stuck计数和滚动恢复关联。不能因用户说激进而无证据移除当前唯一修复。
- **过多ready/scroll定时补偿**：收进一处生命周期适配，记录对应kernel contract与退役条件；每次真实修复删除旧补偿，而不是并存两个实现。
- **CSS总声明数硬上限**：现为AGENTS红线，本轮不改。建议讨论改为正确性/重复所有者/原语/截图为主，体积趋势为辅；不能继续“为了过门禁新建文件”。新增功能增加合理声明不是质量退化证明。

### 5.3 这些看起来“防御”，实际应该保留

| 机制 | 真实作用 |
|---|---|
| IPC可信sender/frame、contextIsolation/sandbox、受控window.open | 富文本和本地浏览器可接触外部内容；主进程持文件/密钥/删除能力，信任边界真实存在。 |
| 回收站UI只读+存储写边界 | UI防误操作；写边界防晚到IPC/陈旧会话。可以合并内部判定，不可只剩其中一层。 |
| 永久墓碑、显式restore_pending_at、目录事务 | 删除/恢复语义核心，不是协同过度设计。 |
| 先对象后manifest、GC keep闭包、年龄保护、sync/GC互斥 | 保证声明资产可读、当前引用不被误删；清单差集前提成立才可跳对象存在性探测。 |
| 下载size+sha256实读校验 | 不信任陈旧缓存/半下载，跨端字节正确性边界。 |
| 历史/草稿/当前引用统一保护 | 本地历史/未保存输入仍要用附件；F10说明要消掉旁路，不是删保护。 |
| 缩略图4并发、有限缓存、失败回原图 | 控制像素解码峰值，优化失败不能破坏原图展示。计数缓存/slot并非天然多余。 |
| 单userData单实例锁 | 文件+SQLite单写契约；不用引入跨进程锁系统。 |
| 可重建缓存生成失败不阻断已提交正文 | 核心保存与后台维护分离是对的；只需保证异步结果可诊断、不错误清dirty。 |
| QuickNotes跨DB/文件转换journal | 多介质操作有真实崩溃窗口，不应仅凭“四态太复杂”删。先减少介质/提交边界才能简化恢复。 |

## 6. 性能审查：先降低工作量，而不是升级技术栈

### 6.1 已定位到的结构性成本

1. **输入全量序列化**：`EditorTab.tsx:453`每contentchange立即getDocument(text/lake)，再比较初始化/是否变化；正文数MB时每次按键可产生数MB字符串、token正则与父层状态更新。初始化guard位于序列化之后，不能省掉序列化成本。需先挡initializing/retired，再按会话capture时机合并。**不可粗暴漏最后一次输入**，关闭/失焦/保存会capture。
2. **保存重复传正文**：`Store.saveNote:561–575`注释“免IPC全文回传”，实际返回对象仍`content`；native.saveNote类型也返回NoteDocument。输入请求和成功响应各携带body。只确认revision和元数据即可，UI正文来自自己的不可变snapshot。
3. **Sheet/Board双重防抖**：F15，节流层多了，但没有更安全；一个调度器合并序列化与保存。
4. **全局音频扫描乘以编辑器数**：`lakeRuntime.ts:953`每创建一个实例启动重试，用document.querySelectorAll扫全工作区卡片；多个keep-alive实例重复处理同一批卡。改为该host的卡/事件，保留已证明的音频修复，不加全局扫描缓存。
5. **每次DOM mutation安排代码块check**：`EditorTab.tsx:744–801`整个host subtree监听，600ms后扫全部codeblocks并逐个量几何；更适合插卡/渲染完成时针对新卡工作。实际频率/成本需profile，不宣称已卡顿。
6. **保存后同步扫孤儿与全部历史refs**：NoteContentRepository→detectOrphans每次保存readdir/stat与history refs解析；放到提交后的合并维护任务，删除时仍fresh检查。不要加远端存在性缓存破坏红线。
7. **安卓网络持有本地写队列**：F16，锁粒度比cache更值得先改。

### 6.2 这轮不建议做的“性能升级”

- 全目录树虚拟化：HANDOFF要求先量卡顿；当前无测量。
- 每库全文hash持久缓存/附件hash缓存：可能有收益，但需文件不可变契约与真实热点；不因5000文档就加。
- Renderer/DB Worker全迁移：仅发现单CPU长任务超预算再单独迁移；不能用新worker协议掩盖多余遍历。
- Canvas重写所有表格/替换Lake：不符合范围，也不可用性能愿景证明行为等价。
- 把桌面/移动SQL文本抽共享：两端schema和正文介质不同；共享纯业务规则、port合同与对拍测试即可。
- 再提高S3并发：现上限8是已确认契约；不是本轮性能瓶颈修法。

### 6.3 验收指标（建议目标，不是已测成绩）

先在同一设备、同一fixture、相同前台状态录旧版数据，再讨论阈值：

- 固定样本：小/1MB/数MB正文；8/24已访问标签；5000元数据与2万附件；图片/代码/音视频/大纲文档。
- 输入：keydown→可见反馈、serialization次数与累计CPU、主线程>50ms长任务数；不只量Reactrender。
- 保存：最后操作→dirty、最后操作→ack、IPC字节量、一次capture次数；正常停顿目标约原1s，而非1.8s+。
- 热切tab：首帧/焦点恢复/scroll anchor；**普通切tab零setDocument/零destroy**。
- 锁/解锁/外部重载：允许因viewer/editor能力不同重建，但记录实例峰值/ready延迟，不能偷换“永不重建”。
- 安卓慢网：同步进行时本地save ack分布；离开前flush完成率、失败提示、进程kill恢复合同。

## 7. 推荐重设计：DocumentSession，统一文档生命周期的唯一所有者

### 7.1 为什么选这个板块

它同时解决F01/F02/F03/F04/F05/F06/F09/F15，并减少输入/IPC/双重防抖。收益对应已经复现的用户问题，不是“换个状态库更优雅”。

**目标不是更多抽象，而是把现在分散的状态和定时器放回一个具体的文档会话。** 保留现编辑器、正文格式、资源、历史与同步port；不建立通用领域框架。

### 7.2 最小结构

```text
UI：标签栏 / 状态栏 / 编辑器宿主
              │ 调用具体动作、订阅所需摘要
              ▼
SessionRegistry（仅已打开文档的 Map，不是全库store）
  └─ DocumentSession
       ├─ 文档身份 + generation + lifecycle（active/trash/purged）
       ├─ 最新编辑revision / 已提交revision
       ├─ 唯一 draft / pending snapshot / in-flight
       ├─ 编辑器adapter：changed、capture、mount/dispose
       └─ save/flush/reload/close（唯一调度与错误契约）
              ▼
现有 native/bridge 的明确 create/save/restore/history 动作
              ▼
当前平台持久化（先保持文件+DB / 安卓SQLite），同步仍走现协议
```

建议只新增 **具体会话实现 + 小registry + 一个订阅hook**，不创建五层SessionService/Manager/Coordinator/Facade。

### 7.3 必须成立的七个不变量

1. **一文档一会话**：tab是会话摘要，不再存第二份可写正文；编辑器内核是当前交互模型，session持待提交snapshot，两者通过capture契约连接，不互相回灌每次按键。
2. **一快照一revision**：title/body/cache/version一起capture；ready时派生缓存不替换正文，缓存可null但必须对应这份body。
3. **ack不改用户稿**：ack只更新committedRevision与元数据；不会把响应正文塞回编辑器。
4. **最多一个写请求+一个latest pending**：新编辑替换pending；旧快照不无限排队；旧ack不清新稿。
5. **只有flush成功才能close/evict/lock/reload**：错误保留会话；显式放弃是用户动作，不是catch后的默认行为。
6. **异步作用域是session generation**：某文档reload/close后晚到请求不能更新新generation；不同文档不取消。
7. **保存不是恢复**：生命周期写边界权威；接收删除先保住合法未提交输入，再只读提示，显式restore才重开写权。

### 7.4 保存算法（可用很少代码表达）

```text
changed()
  revision++
  立即通知 dirty 摘要（第一次 clean→dirty，非每键全AppsetState）
  重置这一会话的一个保存定时器

停顿到点 / 手动保存
  capture当前 title/body/cache/revision
  pending = snapshot              // 覆盖更旧pending
  drain()

drain()
  有in-flight则返回
  取走pending，保存该不可变snapshot
  成功：committedRevision=max(committedRevision, snapshot.revision)
        同版本journal才可清理
  失败：保留待提交版本与可见error
        不自动热循环重试；下次明确保存/编辑/合理重试点再试
  最后：若pending更新，继续drain

flush()
  capture最新合法编辑（包括adapter尚未序列化的变化）
  等到目标revision成功提交；失败则reject
  如等待期间继续输入，close应阻止新写或再次确认最新revision，不偷偷关
```

不要以“task开始时读取live revision”表示snapshot版本。不要把没有新输入时的保存成功误清某个晚到journal。

### 7.5 草稿机制怎么简化，不靠删保险

短期保留现journal，**所有写/清由session管理**：

- 正常成功保存不另写一份草稿；失败/关窗/需留档时保存最新revision。
- 承诺“1s内任意强杀也无损”就必须更早持久化，防抖机制本身无法保证；先明确可接受窗口，不能注释里宣称安全。
- ghost/missing草稿保留可复制/显式丢弃；不自动清。
- 清journal绑定submitted revision：旧save成功不删除新journal。
- 生命周期跨进程退出由主进程close握手发起“请flush”并等待ack，超时给用户真实选择；不用再堆beforeunload+unmount两组fire-and-forget。

这里的握手只解决正常关闭，不声称能拦OS强杀/OOM；崩溃保护靠已持久化草稿/正文。

### 7.6 编辑器适配器与懒加载

- 普通tab切换保留已创建实例与undo；首次可见前不创建。标签数量由现上限策略管，暂不加“暖池预算”。
- 正常onChange只报changed，session按需capture；外部reload才给新body+generation。避免每次状态更新setDocument。
- Lake viewer/editor目前为不同入口，锁切换允许重建；双层过渡仅保留一代outgoing、一条有限timeout，先验证再收敛。
- 私有API仅留在当前kernel adapter并链接契约；宿主不继续操作_neRef/DOM/fiber。
- 代码块/音频修复：只处理本host、本卡、本generation。若官方没有card-ready事件，有限针对性观察比全局轮询可靠；不要编造不存在的lakex API。
- Sheet/Board先改变共享宿主capture/flush接口；其内部数据模型与第三方引擎不重写，多维表实现留另一会话处理。

### 7.7 用户体验由正确结构自然改善

- dirty即时出现；保存错误在原稿上给“重试/复制”，不是toast后消失。
- 热切标签不重建，不丢undo/焦点，隐藏标签不接新输入但仍可完成此前合法保存。
- 切阅读/锁定要么真flush成功，要么留在原态并说明原因。
- 同步结果单一状态，部分失败不冒充全成功；删除后readonly原因可见。
- 从历史/资源重载不被另一篇文档动作取消；只有同文档generation控制结果。

### 7.8 为什么不马上加 Zustand/XState/新框架

只需要打开文档Map、具体动作、每会话订阅。React已有外部订阅能力可用；也可以先用现hook在局部做到唯一owner。新依赖本身不解决snapshot/revision/生命周期不变量。

不要在没有基线测量时强求“所有状态都外置”。先让正文不进全工作区render热路径，其他设置/布局状态保持现有位置。

## 8. 桌面持久化三路线：不偷换产品决定

| 路线 | 内容 | 优点 | 代价/反对意见 | 建议 |
|---|---|---|---|---|
| A 保持文件+DB，只修会话 | F01/F02等，文件先写维持当前 | 最快、文件格式/工具不变 | F08跨介质窗口还在，不可号称完全原子；必须明确恢复/失败合同 | 立即第一阶段，但不是双介质终局。 |
| B 保持文件+DB，增加**单一保存意图** | 当前journal可升级为commit-pending，body目标/hash/meta/revision；启动恢复使文件与meta对齐 | 不改外部文件契约，故障可恢复 | 这是必要复杂度但真实增加恢复路径；禁止save journal + draft journal +另一个commit log并存三套 | 只有必须保持文件真源时选择；一次取代旧机制，不加fallback。 |
| C 正文+元数据入SQLite同事务，文件仅导出 | 复用现SQLite，body/cache/title/syncstate同事务；资源仍文件且独立不可变 | 从根源删双提交恢复逻辑；桌面/安卓语义更接近 | 影响文件直读工具、备份、history、syncadapter、已有脚本；不是无影响重构。数MB存DB需实测写放大/WAL/备份 | **长期结构最简候选，不在本轮默认实施。** 先确认用户是否需要`.lake`直接编辑/读写互通。 |

**不推荐**：为了保留文件同时造通用跨介质事务引擎、每保存文件备份副本、全库启动hash扫描、多级recover fallback。必须先减少真源数量，不能以“最优雅”增加第四本账。

当前history和QuickNotes仍各自有真实跨介质契约；不因选C就把全项目同库迁移也塞进一批。

## 9. 实施与讨论顺序（均未开始）

### S0：先补真实失败行为测试，再修小而确定的问题

建议F01/F02/F04/F05/F06/F07/F09/F10/F11为第一组，按独立写集分批。

- 不更新多维表专项记录、不改其模型；共享Tabs/保存/Overlay要先协调当前会话。
- hook行为测试用真实React测试环境或抽具体会话逻辑，不止源码正则。
- 固定三种断言：不回退最新输入；不误清恢复数据；不以无错误Promise冒充成功。
- snapshot/body/cache一致性、两个不同note的异步交错、trash保存晚到、同秒force文件身份均入正式测试。

### S1：DocumentSession纵向替换

先普通doc，验证打开/输入/关闭/恢复/锁/重载，然后接Sheet/Board的capture接口，Android使用同一会话业务逻辑但不同持久化port。

**不得把旧SavePipeline和新Session并跑后留兼容层。** 切一个完整路径，删除其旧timer/cache/glue；每批都在原可运行系统上推进。

### S2：删除确定过时路径

当前完整DDL、旧测试桩兜底、旧预DNS入口、旧明文兼容、隐式恢复。删除后fresh workspace初始化与现端对拍。开发库重建需要用户同意，别为了过测试清正式数据。

### S3：内核适配收口与实机性能

把重试/观察限制为host/card/session；卡水合、自愈、scroll层先测后删。跑前台长正文/代码/媒体/大纲/锁定回归，不用隐藏CDP图像加载状态来判产品缺陷。

### S4：独立评审持久化与同步锁粒度

只有用户选§8路线，才动持久化真源。安卓网络持本地锁另单独方案与跨端sync对拍；现协议、GC保护/并发上限保持。

### 暂不做

搜索整体重构、目录虚拟化、S3并发提升、全库hash cache、插件系统、vendor死路径清理、表引擎替换、自动恢复为新文档、全项目SQL统一。

## 10. 验证结果与诚实边界

### 已执行

| 项 | 本轮结果 |
|---|---|
| git基线/worktree | 初始master@ae1cfda、唯一worktree、工作树干净；中途另一会话写两份交接文档，本轮未编辑它们。 |
| `tsc --noEmit` | 通过。 |
| 全量Vitest | **160文件通过 / 5跳过；1430用例通过 / 16跳过**。 |
| core边界 | 69文件，0违规。 |
| ui-metrics | 桌面hex/rgb=0、`!important`=9、未定义令牌=0；这是结构指标，不是体验验收。 |
| diff whitespace | 通过。 |
| 隔离源码复现 | **R01–R12共12个行为/字节/文件/SQL复现**；R13为静态调度时序核查，不混入行为复现计数。 |
| opt-in workspace benchmark | **执行失败**：旧resources断言与现契约冲突；不能写“所有门禁全绿”。 |

复现脚本通过TypeScript transpile读取当前源码、在data module中替换React hooks与native port：useRef/useCallback/useState等是最小执行替身，因此证明被测闭包逻辑，不证明React调度/浏览器DOM事件。History使用真实better-sqlite3内存库及临时文件；HTTP用mock transport；Secret只用自行生成的测试明文。

### 未执行

- 未启动/操作用户的Electron窗口、未kill任何进程；没有CDP前台截图、keyboard/paste/IME验收。
- 未运行Android模拟器/真机；未清App、未覆盖本地正式数据。
- 未跑真实S3、GC删除、双端云同步；未取真实密钥。
- 未重跑桌面/移动build：本轮无产品源码改动；旧build结果不冒充本轮结果。
- 未逐行审vendor、整套生成emoji字典或所有业务测试；大文件行数/trycatch数量不是缺陷证据。
- 未安装依赖、未启动子代理、未调用外部LLM审查、未commit/push。

### 性能基准日志应如何读

opt-in日志出现createdMs≈368、savedMs≈653、summaryMs≈2（单次抽样，机器当时环境）。savedMs含保存后造10000文件；全部资产是假fixture，不能视为真实图片处理或5000文档性能成绩。失败断言说明基准本身该修，不说明产品资源同步失败。

## 11. 我们接下来要讨论的决定

建议先讨论下面三点，不一次批准所有重构：

1. **是否认可“文档会话纵向重构”为主板块？** 推荐认可，但先只批准S0/S1首段普通doc，保留正文/同步协议与所有用户功能；不让拆文件代替所有权修正。
2. **文件真源是否是必须需求？** 如果`.lake`只是内部落盘格式而非外部编辑接口，路线C值得独立设计；否则选路线B并接受必要的单一恢复记录。当前不做未经确认的数据介质迁移。
3. **未保存强杀的保护窗口是什么？** 普通完成/关闭必须等待成功；强杀任意一毫秒“零损失”与1s防抖矛盾。先明确journal/ack用户合同，不能继续靠注释假定移动无崩溃需求。

另外两个工程决定：CSS声明数是否继续一刀切硬上限；删旧schema兼容时如何处理当前开发库。它们需要显式变更长期机制，不在本轮擅自修改AGENTS。

---

## 附录A：本轮产物与复现方法

- 本讨论稿：`/Users/admin/file/local-lake/lake-notes-electron/docs/NON-BITABLE-ENGINEERING-AUDIT-2026-09-30.md`。
- 可重复审计脚本：`/Users/admin/file/local-lake/lake-notes-electron/docs/audit-evidence-2026-09-30/reproduce.mjs`。
- 固定基线复现结果：`/Users/admin/file/local-lake/lake-notes-electron/docs/audit-evidence-2026-09-30/reproduction-results.json`。
- 原有全量测试末尾日志与失败基准日志：同证据目录。
- 临时原件：`/tmp/lake-audit-260930/`，不作为长期唯一证据，关键脚本与结果已随报告保存。

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
node docs/audit-evidence-2026-09-30/reproduce.mjs
```

脚本只创建独立临时fixture、内存SQLite、mock API；不连接真实S3，不读正式数据。每次运行按**当前源码**重做，因此未来代码修好后部分原行为应改变；保留JSON作为ae1cfda的审计证据，不能把“再次复现失败”误当产品回归。正式测试应反向断言正确行为，而不是要求bug继续存在。

## 附录B：核心证据定位

以下相对文件简记均相对于 `/Users/admin/file/local-lake/lake-notes-electron`；本报告所有正式链接均指向绝对路径。

- [保存/错误/版本采样](/Users/admin/file/local-lake/lake-notes-electron/src/hooks/useSavePipeline.ts#L50)
- [关闭决策](/Users/admin/file/local-lake/lake-notes-electron/src/hooks/useDocumentTabs.ts#L50)
- [全局重载/回收站恢复/孤立草稿清理](/Users/admin/file/local-lake/lake-notes-electron/src/hooks/useSyncRefresh.ts#L40)
- [淘汰与二次封顶](/Users/admin/file/local-lake/lake-notes-electron/src/hooks/useTabLifecycle.ts#L34)
- [缓存副本与ErrorBoundary](/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/MultiTabEditor.tsx#L90)
- [桌面正文提交](/Users/admin/file/local-lake/lake-notes-electron/electron/noteContentRepository.ts#L30)
- [历史文件身份](/Users/admin/file/local-lake/lake-notes-electron/electron/historyLifecycle.ts#L72)
- [资源引用保护](/Users/admin/file/local-lake/lake-notes-electron/electron/assetRepository.ts#L82)
- [绕过保护的文档级清理](/Users/admin/file/local-lake/lake-notes-electron/electron/orphanLifecycle.ts#L90)
- [移动取消式flush](/Users/admin/file/local-lake/lake-notes-electron/src/mobile/useAutoSave.ts#L9)
- [移动正文UPSERT](/Users/admin/file/local-lake/lake-notes-electron/src/mobile/noteRepository.ts#L111)
- [移动网络/写队列](/Users/admin/file/local-lake/lake-notes-electron/src/mobile/bridge.ts#L829)
- [移动固定密钥](/Users/admin/file/local-lake/lake-notes-electron/src/mobile/secretStore.ts#L14)
- [HTTP头超时](/Users/admin/file/local-lake/lake-notes-electron/electron/httpFetcher.ts#L112)
- [普通doc全序列化](/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/EditorTab.tsx#L446)
- [全局音视频补偿](/Users/admin/file/local-lake/lake-notes-electron/src/features/editor/lakeRuntime.ts#L943)
- [失效容量基准断言](/Users/admin/file/local-lake/lake-notes-electron/electron/workspace.benchmark.test.ts#L61)

**收口原则：把不变量放在唯一能保证它的边界；把无用的内部防御删掉；把失败留给正确的调用者处理。简洁不是少几行，而是少几种状态、少几份真源、少几个可以绕过正确性的入口。**

## 12. S0 实施进度（260930-S0，在本分支完成；路线 C 未触碰）

> 会话 260930-S0。分支 codex/audit-s0（从 master 6a0ec68 开出）。**已合入 master（本地 merge commit 42ad41b）、未推送**。
> 约束：只做 §9 S0 的小而确定的问题，每项配真实反向行为测试；**不启动 §8 路线 C（正文入 SQLite）**，S1 DocumentSession 也未批准。

### 已完成（9/9）

| 发现 | 修法 | 改动 | 测试 |
|---|---|---|---|
| F09 | 孤儿草稿不再自动 deleteDraftJournal，全部列出；显式丢弃才删 | src/hooks/useSyncRefresh.ts | useSyncRefresh.test.ts 新增：孤儿草稿仍列出、刷新路径不触达 deleteDraftJournal |
| F10 | cleanNoteOrphans 删除判据改用 assetRepository.getProtectedRefs（当前正文 ∪ 历史 ∪ 草稿），不再只看 protectedByHistory | electron/orphanLifecycle.ts | electron/store.test.ts 新增：草稿唯一引用的图不被删，显式丢弃后才可删 |
| F07 | 历史快照文件名加随机后缀，同秒 + 同内容 + force 不再共用路径 | electron/historyLifecycle.ts | electron/store.test.ts 新增：两条同秒快照 file_path 不同，删一条另一条仍可恢复 |
| F05 | 移动 useAutoSave.flush 改为立即保存挂起文档；新增独立 cancel；卸载只做取消兜底 | src/mobile/useAutoSave.ts | 新增 src/mobile/useAutoSave.test.ts：flush 保存全部/指定、cancel 不写 |
| F11 | httpFetcher 收到响应头不清 deadline；包装 body 在消费完成/出错时清定时器，整体 deadline 覆盖 body | electron/httpFetcher.ts | electron/httpFetcher.test.ts 新增：头快 body 挂起仍 AbortError |
| F06 | create 与 save 分离：`noteRepository.createNote` 走 INSERT；`saveNote` 只做 UPDATE，missing/gone（trashed_at / sync_state='purged'）抛错 + 写边界二次守卫；`bridge.saveNote` 对 gone 与"有永久墓碑的 missing"拒绝，只有无墓碑的新 id 才初始化 | src/mobile/noteRepository.ts、src/mobile/bridge.ts | 新增 src/mobile/noteRepository.test.ts（5 例，真实 sql.js SQL）；bridgePurge.test.ts +1（purge 后晚到保存不复活） |
| F01 | 显式保存返回 `PersistOutcome`（失败不再吞成 fulfilled）；closeTab / 淘汰 / 锁定确认持久化成功才继续；`selectEvictionIds` 新增 `protectNoteIds`（失败标签保留且不补位） | src/hooks/useSavePipeline.ts、useDocumentTabs.ts、useTabLifecycle.ts、useNoteLifecycle.ts、useDesktopHandlers.ts、src/core/tabLimit.ts | 新增 useSavePipeline.test.ts / useDocumentTabs.test.ts / useTabLifecycle.test.ts + tabLimit.test.ts：磁盘失败不关 tab、淘汰保留失败标签、锁定前失败不锁 |
| F02 | title/body/caches/revision **入队前**绑定为同一次不可变快照；任务内不再读 live revision/editor；ack 只认自己的 revision | src/hooks/useSavePipeline.ts | useSavePipeline.test.ts：排队旧正文 + bump 后两次 ack 都不 apply；无 bump 时正常 apply |
| F04 | ① `handleTrashRestored(restoredId?)` 对每个 deleted tab 用 `isGoneNote` 重新判定（不再"能读即解锁"）；`noteContentRepository.save` 拒绝 trashed_at/purged，删除普通保存的隐式 revive；② **元数据写边界 fail-closed**：`noteMetadataRepository` 的 rename/icon/lock 先 `assertNodeWritable`，回收站/purged 节点明确拒绝，删除 `trashLifecycle.revivePurgedIfNeeded`（隐式恢复最后入口） | src/hooks/useSyncRefresh.ts、TrashPanel.tsx、DesktopOverlays.tsx、electron/noteContentRepository.ts、noteMetadataRepository.ts、trashLifecycle.ts、store.ts | useSyncRefresh.test.ts（恢复 b 不解除 a）；noteContentRepository.test.ts +2；store.test.ts +2（保存 + 元数据反向断言）；sync.integration.test.ts S4 改反向断言；桌面真实端 +6 |
| F03 | 全工作区单一 `tabReloadVersionRef` 会让不同文档的合法重载互相取消 → 新增 `createNoteReloadGuard`（按 noteId token）；`handleTrashRestored`/`handleHistoryRestored`/`reloadNoteTab` 按文档取消；`useSyncProgress` 全库同步改用自己的 sync run id | src/core/requestVersion.ts、useSyncRefresh.ts、useSyncProgress.ts、useWorkspaceState.ts、App.tsx | requestVersion.test +2；useSyncRefresh.test +2（R03：reload a/b 互不取消；同文档旧响应作废）；桌面真实端 +2 |
| F17 | 断言 `getSyncPendingSummary` 真实契约（resources 恒为 0；documents/folders = 本地待上传事实），fixture 生成与业务耗时分离 | electron/workspace.benchmark.test.ts | opt-in 基准实跑通过：`savedMs≈3 / fixtureMs≈843 / summary.resources=0` |

门禁：tsc 通过；全量 vitest **1493 passed / 16 skipped**（含后续捕获批 + F14/F15）；check:core 71 文件 0 违规；git diff --check 通过；opt-in `LAKE_RUN_BENCHMARK=1 npx vitest run electron/workspace.benchmark.test.ts` 通过。

**桌面真实端 CDP 验收**：`node scripts/e2e-audit-s0.mjs` **17/17 通过**（捕获批新增「输入后立即关闭也把最后输入落盘」）（隔离 `LAKE_USER_DATA`/端口、owned child 精确收尾）——scheme origin `lake://app`；F04 回收站/purge 后普通保存被真实 IPC+SQLite 拒绝且正文不改写、显式恢复后可写、恢复 c 不解除仍在回收站的 d、元数据 rename/icon/lock 对回收站节点被拒且显式恢复后可写；F03 两篇不同文档各自历史恢复都生效；F01/F02 输入→自动保存落盘；F01 保存失败（.lake 缺失→NotFound）时脏标签不关闭、恢复可写后再关成功。

**安卓真实端验收**：`node scripts/e2e-f06-android.mjs` **6/6 通过**（emulator-5554 + `android-build.sh --sync` debug APK；用 MobileApp 暴露的 `window.lakeNative` 调试契约直驱 bridge）——回收站晚到保存被拒且正文 sizeBytes 不变；条目仍在回收站；purge 后晚到保存被拒且不复活；显式恢复后可写。

### 未完成

无（F03 + F04 元数据尾已补）。F12–F16 不在 S0 本批（见 §9）。

### 诚实边界与已知取舍

- 9 项都有反向行为测试，且都是真实执行路径（真实 sql.js SQL / React hook / 真实文件），不是源码正则护栏。
- **F06 安卓真实端已完成**（模拟器 + debug APK，6/6）。移动端"他端 purge 的保留副本（行保留 + `sync_state='purged'`）"这一状态不经暴露的调试契约构造，由 `src/mobile/noteRepository.test.ts` 的真实 sql.js SQL 用例直接覆盖。
- 桌面真实端只走隔离临时 userData + 独立端口 + owned child，全程未触碰正式数据目录。
- **F04 元数据尾已收口**：rename/icon/lock 对 trash/purged 明确拒绝；`trashLifecycle.revivePurgedIfNeeded` 已删除，仓库内不再有隐式恢复入口。
- **F03 竞态**在真实 hook（jsdom，受控延迟）下验证（R03）；桌面真实端因 `window.lakeNative` 被 contextBridge 冻结（实测 `Object.isFrozen===true`、不可写、不可配置），无法向真实 App 注入 `readNote` 延迟，故真实端覆盖"两篇不同文档各自历史恢复都生效"的路径，竞态本身由 hook 测试 + core guard 单测证明。
- **F06 的 `bridge.saveNote`**：在"无行且无永久墓碑"时仍会初始化新文档（既有 `createNote` 流程依赖该入口）；真正被禁止的是覆盖回收站/已 purge 行、以及复活有墓碑的条目。repository 层的 `saveNote` 对 missing/gone 一律拒绝。
- 未做真实 S3 双端/GC 验收（S0 是本地逻辑修复）。
- 改动已合入 master（本地 merge commit 42ad41b），**未推送**；待用户验收。

### 后续小范围收口（C / B / A：捕获契约，审计 §6.1 / §7.3）

> S0 之后的独立增量：**不启动 S1 DocumentSession**，只解决"多 MB 文档每键整篇序列化"这一个已测量的真问题，并顺手收敛生命周期闸门。

| 项 | 内容 | 提交 |
|---|---|---|
| C | 关闭/淘汰/锁定的持久化闸门收敛为 `src/core/lifecycleFlush.ts` 单一来源（blocked 视为可继续），避免规则漂移 | 962f4b0 |
| B | 新增 opt-in `scripts/profile-editor-input.mjs` 实测：2MB 文档单键 getDocument+state ≈ 58ms、0.5MB ≈ 17ms、~0 ≈ 0.6ms | f994ee2 |
| A+B | **捕获契约**：EditorTab contentchange 只通知「有变更」、不再每键序列化；正文由 `useSavePipeline.captureContent` 在保存/草稿/关闭时按需 capture；删除 `MultiTabEditor.contentCache`/`reloadKeysRef`（第二份可写正文）；close/evict/lock/beforeunload 不再传可能过期的 `tab.content` | 24a21cc |

**效果**（同一 profile 脚本、同口径）：2MB 单键 **57.9 → 10.0 ms**、长任务 **1761ms → 0**；0.5MB **16.8 → 5.3 ms**、长任务 533ms → 0；~0 不变（0.6→0.7ms）。桌面 e2e **17/17**。

**诚实边界（捕获批）**：
- profile 脚本的「tab 就绪」判定不严（曾出现 `openMs=4`，即在目标 tab 渲染完成前开测），**只信量级、不信精确 before/after**；已按同一脚本同口径对比。
- 重建（锁/自愈/换文档）前的最后捕获放在 `EditorTab` effect cleanup（写入 `latestDocumentRef`），保证不丢在途输入；但「内核中途自愈时正好在打字」这一竞态没有真实端注入点，只有代码路径保证（未实测）。
- doc 每键只 `bumpRevision` + 重置防抖，**只在 clean→dirty 第一次**更新 tab 状态；sheet/board 仍走显式 content（其内部本就防抖）。
- `src/core/editorChangeGuard.ts` 因捕获契约后不再被调用（模块与单测保留，未清理）。
- 未做真实 Electron 前台长文输入体感验收（profile 是程序化注入，非人手打字）。

### 后续小范围收口（D：F14 错误边界真实重试 + F15 Sheet/Board 保存时机）

| 项 | 内容 | 提交 |
|---|---|---|
| F14 | 抽出 EditorErrorBoundary：提供可点的「重试」（换 mount generation 强制重建子树），删除「切换标签即可恢复」这句不可执行的话；新增 errorBoundary.test.ts（抛错→显示重试→点击后真实恢复） | e6aab97 |
| profile | profile-editor-input.mjs 就绪判定加固（先等目标 tab active、再等可见引擎内容长度连续两轮一致），消除 openMs=4 假象 | e6aab97 |
| F15 | Sheet/Board/Bitable 一改动立即 onDirty（早于各自 800ms 内部防抖）+ 注册按需同步序列化 capture；useSavePipelineGlue 新增捕获注册表（优先于 Lake getDocument）；关闭/退出/淘汰/锁定走 capture ⇒ 消除「改完 <800ms 就关」丢最后编辑 | 87e5e4e + c726e23 |

**明确不做**：**F13**（经用户评估：后果仅同步状态/提示偶发不一致、无数据影响，审计当时也未复现最强变体）；**§6.1-#2**（保存响应回传整篇正文：收益小、动 IPC 契约）。**editorChangeGuard 不是死代码**（仍被 LakeEditor 使用），未删。

**门禁**：全量 vitest **1493 passed / 16 skipped**；tsc / check:core（71 文件 0 违规）/ git diff --check 通过；桌面 e2e 17/17。

**诚实边界（F14/F15）**：
- F14 的「重试」有 jsdom 行为测试，但「真实内核崩一次再点重试」未在真实端注入。
- F15 覆盖 Sheet/Board/Bitable。三者的「编辑→立即关闭」都无法用 CDP 稳定驱动，未做自动化真实端，待人工抽验；图片提升未落地时 capture 返回 null，由外层回退到 tab 最后已提交版本。
- profile 绝对值仍受机器负载影响（只信量级）。

### 后续：S2 过时路径清理 + §6.1 剩余性能测量

**S2 清理（已实施）**：secretCipher 旧明文兼容、ssrf `assertSafeRemoteHost` 旧预解析入口、syncAdapters 旧 FakeStore `?.` 兜底（测试补齐完整 port）、schemaInit 旧逐列 ALTER + 旧 trigram 重建 + 旧 notes→tree seed 迁移（改为当前完整 DDL）。**暂缓**：assetServer 旧 file/null origin（审计标注为条件删除，需真实浏览器核对消费者）。

**§6.1 测量**（脚本 opt-in、隔离实例）：
| 项 | 结果 | 判断 |
|---|---|---|
| #4 音频兜底全工作区扫描 | 1 标签 ~11 次、8 标签 ~53 次（≈6.6×标签数/前 6s） | 确认成倍；**已修**（5c70b1c：改 `mount.querySelectorAll`，全局扫描 53→0、范围 ≈1/N） |
| #5 代码块水合扫描 | 8 标签总计仅 1 次（仅可见实例、交互期 defer） | 未测到高频，不作为问题 |
| #6 保存后孤儿/历史 refs 扫描 | 裸 ~1ms；500 资源+100 历史 ~7ms（增量 ~6ms/次） | 量小，暂不改 |
- 脚本：`scripts/profile-save-orphans.mjs`、`scripts/profile-scan-counts.mjs`。



