# RESILIENCE.md — 容错与自愈契约（261105 起）

> **定位**：回答「异常数据 / 异常操作 / 异常进程下，我们保证什么、怎么降级、怎么取证」。
> 分工：SYNC-PROTOCOL 管同步语义、TROUBLESHOOTING 管踩坑、本文管**失败面**。判据一律单一来源，新增失败面必须回填本文。
> 调研依据：desktop/mobile 现状测绘、思源（siyuan-master）兜底机制、故障注入实验（/tmp 复现：坏 sqlite/gzip/JSON、父环、水线未来、只读目录）。

## 1. 六条原则

1. **文件是真相，索引/派生数据可重建**：DB 索引、FTS、搜索缓存都能从正文重建，不得成为唯一真相。
2. **失败面收敛**：同一问题只有一套判据（坏正文 = core/docBodySafety.ts；DB 完整性 = startupRecovery.inspectDatabaseForStartup / data/dbHealth）。
3. **坏数据不静默吞、不覆盖**：非空但解析失败 ⇒ **只读 + 横幅 + 禁止保存**；绝不把坏内容当空文档再写回。
4. **失败就地隔离、留证不删除**：单条/单篇失败只影响自己；可疑字节宁可改名隔离（corrupted/<ts>/）也不静默丢弃。
5. **单点 panic 不扩散**：后台任务/渲染组件各自兜底，一次异常不得拖垮进程、队列或整棵组件树。
6. **越靠近本地写入越严格**：正文 tmp+rename + fsync（桌面 fd+目录，win32 跳过；移动 BodyStore tmp+fsync+rename）、多表写事务、I2「未变才标 / 未变才应用」。

## 2. 已落地能力（261105 前）

| 面 | 桌面 | 移动 |
|---|---|---|
| 进程级崩溃 | uncaughtException/unhandledRejection 落日志；render-process-gone 800ms 自动 reload、30s 内超 3 次熔断；crashReporter | 30s 首屏看门狗 reload；renderer gone → recreate |
| 组件级隔离 | per-tab EditorErrorBoundary（5 处） | 261105 补齐（见 §3） |
| 坏正文 | core/docBodySafety：usheet/board/ink（261105 起含 bitable）⇒ 只读 + 横幅 | 同判据（261105 起四族齐） |
| 缺正文 | ENOENT → bodyMissing + 资源页队列（云端/历史/仅本地） | B-lite 现扫 + 三条恢复 |
| 写入 | 正文 tmp+fsync+rename；多表写 72 处事务；VACUUM INTO 一致性导出 | BodyStore tmp+fsync+rename；WAL + 串行锁；迁移失败**不 bump user_version**、下次幂等重放 |
| 会话保护 | 草稿 journal（原子写）、切页/关闭前 flush | 小记草稿 journal（300ms 防抖） |
| 同步失败 | classifyS3v3Error（retryable/action-required/fatal）、发布锁重试、读回确认 | 触发点重试 + 断点续传标记；状态常驻设置页 |
| 诊断 | 日志分作用域（[crash]/[ipc]）；设置页同步诊断 | 复制诊断 + emptyCatchGuard AST 护栏（80 处带理由空 catch） |

## 3. 261105 容错批（本轮落地）

1. **同步窗口守卫**（core/s3v3/state/deviceStore.ts）：plan 快照与本轮落库之间发生的本地动作优先——轮内软删/purge 的小记与文档**不重建、不清墓碑**；轮内移入/移出回收站**不回滚生命周期**（cur.updatedAt > n.updatedAt 判据）。例外：显式恢复（restorePending）与远端复活（远端 updatedAt 晚于本地 purge 时间）仍正常导入。
2. **桌面启动硬失败恢复页**（electron/startupRecovery.ts + startupRecoveryWindow.ts）：启动前 PRAGMA quick_check + 外键预检 → 失败进恢复页（先备份后重试 / 从云端恢复 / 打开数据目录 / 退出），不再卡 boot splash；uncaughtException 写持久 crash-marker.json，正常启动时消费并告警。
3. **移动崩溃隔离与可观测性**：MobileErrorBoundary（根 + home/workspace/settings/search/ai 五层）；window error/unhandledrejection → crashLog 环形缓冲（20 条）；Kotlin UncaughtExceptionHandler + onRenderProcessGone 落 crash/last-crash.txt，启动读取并入诊断；**坏库页**（quick_check 延后 2.5s；从云端恢复 / 重试 / 清缓存重试 / 复制诊断）优先于普通启动失败页。
4. **清缓存不再是 no-op**：真清派生搜索缓存（单事务清空 + 后台重建）与 PDF 临时目录；明确不清正文/附件/历史/回收站；坏库时如实抛错。
5. **坏正文四族统一**：DocBodyKind 增加 bitable，桌面/移动共用 checkDocBody；空白正文 = 可编辑空表，坏正文 = 只读 + 横幅（不再显示「还没有数据表」）。

## 3.1 261105 数据安全批（1+2）

6. **自动备份（1）**：`electron/autoBackup.ts` — 默认每天、保留 7 份/300MB，`VACUUM INTO` + quick_check + 轮转；与「从备份恢复」闭环；应用未运行时不会后台备份。
7. **保存版本守卫（2）**：保存带 `baseHash`，磁盘被外部/他端改过 ⇒ 不写盘、返回 `external_changed`，三选项（另存副本/覆盖/载入磁盘版）+ 自动保存暂停；同步 apply 路径不受影响。

## 3.2 261105 P1 批（标签 + 同步记录 + review 收口）
1. **文档标签同步**：lake 索引 `tagIds/tagsUpdatedAt`（集合 + 版本 LWW）；目录只在小记标签库，文档关系留主库，跨库删除/改名协调 + 启动孤儿清理；移动端必须搬运字段。
2. **标签空间**：一级入口、只读聚合（文档/小记分组 + 只读预览 + 跳转），就地标签元数据管理；属性面板标签编辑 + 侧栏筛选。
3. **同步记录账本**：只记「远端覆盖本地 / 他端删除（含 quick-purge）/ 保存时磁盘被改」；本机表 500 条/90 天；角标 + 列表 + 一键恢复（历史快照 → local-wins 重传）。
4. **review 修复的失败面**：删光标签必须显式发布空集合（否则两端互刷）；发布条目标签按 LWW 合成；同版本集合 tie-break；`quick-purge` 记账；索引 `tagIds` 去重/上限 + `tagsUpdatedAt` 必须可解析；移动清理空目录保护；备份指纹含 `-wal`、新备份先 quick_check、恢复拷贝边车；重建拒绝 `deleted_notes` 墓碑；另存副本后原页载入磁盘版。

## 3.3 261105 P2 批（性能与 fail-safe 收口）
1. 历史兜底：async 分片（12 篇/让出、20s 预算、deferred 续跑）+ 失败指数退避（10min×2^n，封顶 24h，不推进 mtime）+ 首轮游标 + 清理已删文档账本行。
2. 启动预检：只读打开 + `startup-health.json` 条件深检（崩溃/上次非 clean ⇒ quick_check+FK；正常退出写 clean）；对账 `lastRunAt` 持久化 + 按到期 sleep（1s–24h）；恢复页备份目录统一 `backups/`；重建 >32MiB 拒绝。
3. 安全模式 fail-closed：IPC 失败/异常形状保持 unknown（不写会话、不恢复标签）；退出失败返回 ok:false 且不清 crash-marker。
4. saveState 标签：批量版本读（一次全表）+ 版本未变跳过（2 万篇从 2 万次点查 → 1 次读）。
5. 移动端：标签读全优先（>20000 才截断且 UI 提示）、同步记录账本批量 INSERT + 每轮 prune 一次、alive guard、加载占位、aria-pressed/44 命中盒、already-resolved 中性提示。

## 3.4 261106 导入 / 批量 / 导出批（新失败面）

| 失败面 | 降级 / 判据 | 护栏 |
| --- | --- | --- |
| Markdown 转换（离屏内核） | 单文件 15s 超时、渲染稳定连续两次快照 100ms 轮询、产物必须含 data-lake-id（否则 no-lake-id）、容器非 display:none、串行队列 | src/features/import/markdownImportPipeline.test.ts |
| 导入图片 | 本地图物化为资产（>20MB/非法扩展名/魔数不符拒绝）；远程图 v1 不下载 ⇒ 降级链接 + warning；物化失败降级 | markdownBatchImport.test.ts、markdownImportScan.test.ts |
| 批量落盘 | 单篇失败 ⇒ 软删回滚（移入回收站，不物理删）；不支持/超限计 skipped；取消=停止后续 | markdownBatchImport.test.ts |
| 批量操作 | 先全量校验再单事务执行；异常整批回滚；笔记本 notebook-not-batchable；无 restore/purge | core/batchNotes.test.ts、electron/ipc/registerBatchNotes.test.ts、src/mobile/bridge/batchNotes.test.ts |
| 批量导出 | 只读不写源；目录必须来自本次选择框（pickedExportDir）；画板缺字节 ⇒ skipped（不产坏文件）；逐条失败不影响其它 | electron/batchExport.test.ts、registerBatchExport.test.ts |
| 画板快照（未打开） | 离屏可测量容器（800×600、visibility 隐藏非 display:none）、8s 超时、无论成功/失败都 unmount + 移除；解析失败 ⇒ skipped | src/features/board/boardSnapshot.render.test.tsx |
| 键盘稳定 Sheet | focus 记录几何 → 键盘弹出钉住 top/height → 键盘覆盖列表 → 收起还原；无键盘/无焦点/未打开零副作用 | src/mobile/hooks/useKeyboardStableSheet、keyboardSheetAudit.test.ts |
## 3.5 261114 回收站幽灵文档（新失败面）

| 失败面 | 判据 / 降级 | 取证 |
| --- | --- | --- |
| 回收站子文档被当成活跃文档 | 删笔记本时只有根节点 `parent_id` 进回收站、子文档只标 `trashed_at` ⇒ **唯一判据 = `trashed_at`**：`store.bootstrap()` 只收 `trashed_at IS NULL AND is_purged=0` 且父节点在位的行；`readNote`/`getNoteDigest`/`isGoneNote({trashedAt})` 同口径；渲染层 gone ⇒ 只读 + 横幅，保存被拦只提示不静默 | 日志 save_note 拒写「请先显式恢复」；启动快照/标签会话泄漏 |
| 「已 purge 又被 seed 复活」的幽灵行 | `schemaInit.seed()` 只在「notes 空 + 无墓碑 + 默认笔记本在位」三者同时成立时种欢迎笔记；启动自愈 `removeResurrectedAfterPurge()` 只清「活跃 + 有墓碑 + （id=welcome-note 或父节点已不在位）」的行（墓碑保留 = 彻底删除语义，幂等） | 启动日志 `[store] removed N resurrected-after-purge ghost note(s)` |
| gone 标签卡住退出 | 标记 deleted 时同步清 dirty；beforeunload 只拦「脏且未删除且未保存失败」（判据单一来源 core/unloadGuard.blockingDirtyTabs，保存失败的标签允许丢弃并正常退出）；本机 purge 后按 digest 收掉已打开标签 | 日志 [ui] 窗口无响应 + before-quit 无 will-quit |
| 移动端同型：gone 判定只按 parentId | noteGoneState 必须返回 trashedAt，isGoneNote 全入口传入；保存屏障（关闭/返回/关闭全部/完成编辑）命中 gone 走 discardTab + cancelAutoSave 并 toast 明说「可在回收站恢复」；删分组/笔记本按子树收集已打开标签（descendantNoteTabIds），删除前先 flush 落盘在途编辑 | 移动端 tab 关不掉/退回首页失败；护栏 useWorkspaceSession.test.ts、mobileGoneWiring.test.ts、useNotebookTreeActions.test.ts |
| 删除只动根、子文档漏级联（移动端 note 分支） | 删除 = 整棵子树一起软删：桌面 `deleteTreeNode` 级联（含文档下的多级子文档）；移动 `trashNote`/`trashTreeItem(note)` 走 `trashSubtree`（parent ∪ deleted_from 两路边、防环上限），restore/purge 同集合；已 trashed 节点重复删除幂等（不改 parent，批量顺序不拆根） | 子文档变 `trashed_at=NULL` 悬空行（树里不可见、搜索里还在）、purge 漏删、恢复父项子项不跟随；护栏 `electron/trashCascade.test.ts`、`src/mobile/data/trashCascade.test.ts` |
| 启动硬开文档 | 261114 用户裁决：只恢复上次标签；没有可恢复标签就保持空态（已删 core/coldStartNote 冷启动落点）。恢复候选只收活跃文档（回收站/已 purge/父节点不存在/日记条目都不恢复） | 启动自动打开回收站/孤儿文档；护栏 useBootstrap.render.test.tsx |

护栏：`electron/startupTrash.test.ts`、`src/core/syncDecisions.test.ts`；契约口径见 AGENTS §3#16 与 §7#13。

## 3.6 261114 图片上传任务失联（新失败面：粘贴远程图）

| 失败面 | 判据 / 降级 | 取证 |
| --- | --- | --- |
| 远程图下载成功但卡片永久「图片上传失败」 | 任务与卡片用 **taskId** 绑定：文档编辑器 image 插件改为自实现 `createUploadTask`（`features/editor/imageUploadTask.ts`），taskId 落盘进卡片；结果写 `uploadJournal`（localStorage，7 天/200 条）。`EditorTab` 挂载时 `repairUploadCards` 按 taskId 回填；晚到结果触发一次重建；日志仍 pending 的 URL 由 `resumePendingDocumentImageUploads` 重下 | 现场 `unknown error` + note-assets 里有完整 orphan；修复后同一卡片自动回填（隔离实例 A/B 实测：伪造 broken 卡/重启恢复均 PASS） |
| 内核扩展点被默认桩顶掉（假成功卡） | `image` 插件解析顺序 = `createUploadPromise` 优先；vendor 默认配置的桩对 url 直接返回原 URL/size 0/done ⇒ 文档编辑器必须显式 `createUploadPromise: undefined` 才能走 `createUploadTask`。护栏 `uploadRecoveryWiring.test.ts` | 隔离实例实测：不置 undefined 时卡片 src=原 URL、size 0、无下载 |
| 任务对象接口缺方法 | 必须实现 WY 同款：`on/off`（缺 off 触发 `bind-event-for-react-component` assert）、`isError/isPending/isRunning/isSuccess/isAborted/isTimeout/isCompleted`（缺则 render TypeError）、`run/getStatus/destroy/getResourceURL/abort`；`run()` 错误不 reject（用 status/event 表达） | 隔离实例 render 报错栈 + 修复后 img.ne-image 正常加载 |
| 慢下载把错误卡窗口拉长 | 交互式远程图预算收窄为 **15s × 2**（`DOCUMENT_IMAGE_DOWNLOAD_LIMITS`），主进程 `download_remote_resource` 接收 limits 并夹在 [1s,60s]×[1,3]；渲染层对该类不再叠 `withRetry`。失败信息透传真实原因（不再 unknown error） | 正式日志：主进程 3×30s ≈91s 后才失败、卡片已 error；护栏 `electron/resourceRepository.downloadLimits.test.ts` |

护栏：`uploadJournal.test.ts`、`imageUploadTask.test.ts`、`uploadCardRepair.test.ts`、`uploadRecoveryWiring.test.ts`、`electron/resourceRepository.downloadLimits.test.ts`；内核契约见 `docs/LAKEX-CONTRACT.md` §5.53。
## 4. 已知缺口（261105 收口后的真待办）

**已修（261105 Batch 2）**
1. 水线单调化：`core/syncWaterline.ts` 归一化读取（未来值当 0）+ 写入只增不减/夹到 now + 启动自检回写；所有 pending 查询改用归一化水线。
2. 正文突变保护：`core/s3v3/state/bodyChangeGuard.ts` 三条件判据（基线 hash 变 + 行 updatedAt 未前进 + 内容像坏）⇒ 不 PUT、不认领 publish、`archive-local(suspicious)` + `body_suspicious_external_change` warning；发布索引只用远端版本。
3. 父环防护：`s3v3Merge` 用 note+folder 合并父表 + visited 检测，环上条目远端父改写为安全父并 warning；descendantIds/回收站 CTE/import 全部 visited + 环拒绝。
4. 资产坏文件名：`asset_invalid_name` 结构化 warning（先判后跳、不落 errors/pending），两端可见（移动端修正 kind 判定）。

**已修（261105 Batch 3）**
5. quick-notes 独立库损坏：降级「无小记」模式（Proxy 替身：读安全空值/写抛可读错误），不阻断启动、不注册 v3、不跑 recoverConversions；整轮同步暂停并可读报错 + 恢复指引；降级报告进设置→同步诊断。
6. 崩溃标记 → **安全模式**：`crash-marker.occurrences>=2` 或 30 分钟内连续 2 次 ⇒ 本次跳过自动同步/不恢复 tab/不预热内核，顶部 `SafeModeBanner` 提示 + 复制诊断 + 退出；`safe-mode.json` 设备本地，损坏不二次失败。
7. 写入卫生：导出 tmp+rename；桌面 `atomicWrite` 补 fsync（fd+目录，win32 跳过）；`canonicalJson` 迭代化 + 深度 256/节点 200 万上限（输出逐字节一致）。

**已补（261105 Batch 4 / P1）**
8. 整库备份**导入恢复**入口（从备份恢复）；文件↔元数据**对账**（低频只报告 + 手动重建）；定时兜底历史快照；安全模式会话写入门（`useTabSessionPersistence`）。

**仍待做（按优先级）**
9. 恢复页 hash 通道需真机/打包冒烟；Kotlin 改动需 CI/真机编译验证。
10. 正文突变保护限制：大小骤降分支未接线、合法 UTF-8 截断不拦、可疑篇每轮重复 warning/归档（建议按 (id,hash) 去重）。
11. 安全模式视觉未实机走查（判据已 fail-closed，见 §3.3）。
12. review 遗留（P2）——**261105 P2 批已全部修**：历史兜底分片 async + 失败指数退避 + 首轮游标 + 账本清理；启动预检只读 + 条件深检；对账 `lastRunAt` 持久化 + 按到期 sleep；恢复页备份目录统一 `backups/`；重建 >32MiB 拒绝；移动标签读全优先（截断可见）+ 账本批量写 + alive/a11y；`saveState` 批量版本读只对版本变化应用；安全模式 fail-closed（IPC 失败保持 unknown、退出失败不假装成功）。

## 5. 新增失败面时的检查清单

- 有没有别的族/别的端已经有一套判据？→ 先合并到单一来源。
- 失败时用户看到什么？能否自助恢复（重试 / 从云端 / 从历史）？
- 会不会**覆盖**用户数据？禁止在「解析失败」路径上写回。
- 有没有留证（日志/隔离文件/诊断导出）？坏字节是否被静默丢弃？
- 后台/队列任务是否 try/finally 释放、是否 recover 到任务边界？
- 补回归测试：把这次事故变成一个用例。

## 6. 故障模式矩阵（261105 调研结论；P0 无 / P1 已全部修复）

前提：故障注入实验只用 /tmp 副本（坏 sqlite header / 截断 / gzip 垃圾 / 父环 / 水线未来 / 只读目录），**未碰正式数据**。

| 场景（触发） | 当时的后果 | 现在 |
|---|---|---|
| 同步窗口内软删小记 | saveState 重建行 + 清墓碑 ⇒ 删除永久丢失 | 同步窗口守卫：不重建、不清墓碑（Batch 1） |
| 同步窗口内移入/移出回收站 | 生命周期被回滚 | 本地更新更晚 ⇒ 本轮不覆写（Batch 1） |
| 同步窗口内 purge 文档 | 短暂重建（删了又出现） | 墓碑优先，不重建（Batch 1） |
| 时钟前跳后回 | 水线写未来 ⇒ 删除永不传播 | 水线归一化 + 只增不减 + 启动自检（Batch 2） |
| 正文被外部损坏/替换 | 当本地编辑上传、坏内容覆盖云端 | 突变判据：不 PUT、不认领 publish、留历史 + warning（Batch 2） |
| 主库 header 损坏 | Store 构造即抛、卡 boot splash | 启动预检 → 恢复页（备份后重试/云端恢复/从备份恢复/打开目录/退出）（Batch 1+4） |
| quick-notes 库损坏 | 卡 splash | 降级「无小记」模式，文档照常；同步暂停并可读报错（Batch 3） |
| 远端索引注入目录父环 | 删除/移动/回收站列表卡死 | 合并层改写安全父 + 全链路 visited（Batch 2） |
| 资产非法文件名 | 静默不同步 | 先判后跳 + asset_invalid_name warning，两端可见（Batch 2） |
| 崩溃循环 | 无跨启动记忆 | 崩溃标记 + 安全模式（跳过自动同步/不恢复 tab/不预热）（Batch 3） |
| 安全模式下会话被空标签覆盖 | 用户会话丢失 | 会话写入门（useTabSessionPersistence）（Batch 4） |
| 强杀于保存/草稿窗口 | ≤1.5s 输入丢失 | 可接受（草稿 journal 兜底）；正文写与 DB 事务之间可自愈 |
| 磁盘满/只读目录 | 明确报错、flush 拦关闭 | 保持（Batch 3 起导出/原子写失败不留半成品） |
| 结构化正文 JSON 坏 | 显示空/只读 | 四族统一判据：只读 + 横幅 + 禁止保存（Batch 1） |
| 整库备份无法导入 | 坏了无法自助恢复 | 「从备份恢复」入口：校验 → 隔离原库 → 替换 → 重启（Batch 4） |

## 7. 思源（siyuan-master）可借鉴清单与处置

| 思源机制（证据） | 我们是否采用 | 落地/说明 |
|---|---|---|
| 文件是真相、索引可重建（.sy + 可重建 SQLite 索引） | 已同构 | 正文文件为真相，FTS/索引可重建；缺正文恢复链路 |
| 坏 sidecar 改名隔离后降级（view_state.go corrupted 后缀） | **采用** | Batch 1 起坏正文判据；Batch 4 对账只报告；待补：baseline/state 坏文件改名隔离 |
| 后台任务统一 recover（57 处 defer Recover） | **部分采用** | 后台定时器单飞 + 失败 warn；恢复页/降级保证不扩散（统一 recover 包装登记为 backlog） |
| 崩溃标记 + 下次启动安全模式 | **采用** | Batch 3 safeMode.ts + SafeModeBanner |
| 文件系统实扫反向订正索引（严格节流） | **采用（降级：低频只报告 + 手动重建）** 261105 定稿：扫描 24h/次 stat-only，重建必须用户在「设置→重建数据」确认（只允许本次扫描候选、坏正文拒绝、落「恢复的笔记」、不覆盖原文件） | Batch 4 fileMetadataReconcile.ts：同步后/dirty/空闲 5min/冷却 30min/TryLock，只 readdir+stat，不重建 |
| 损坏文件搬 corrupted/<ts>/ 而不是删 | **部分采用** | 从备份恢复时原库隔离到 corrupt/restore-<ts>/；坏正文目前走只读通道，未建通用隔离目录（backlog） |
| 事务 panic 必回滚 + 结构化错误码 | 未采用（已有事务 + IPC 错误 envelope，收益低） | 记录为「不抄」 |
| 写前比对（未变则不写） | 部分采用 | usheet capture 规范化比对 + 同步 I2「未变才标/才应用」；通用写前比对未做（backlog） |
| 定时兜底历史（10min ticker + 只挑改过 + 保留期） | **采用** | Batch 4 historyFallbackPolicy + 持久账本（mtime 判据），默认 10 分钟 |
| 网络 DNS 类一次性自愈 | 未采用 | 已有 classifyS3v3Error 分类 + 发布锁重试；DNS 刷新列为 backlog |

## 8. 验证债（已登记，不假装已验）

- 恢复页/从备份恢复：需真机或打包版冒烟（hash 动作通道、恢复后重启）。
- Kotlin 侧（CrashLogPlugin、MainActivity 崩溃 handler）未编译/未真机验证。
- 安全模式与恢复页视觉未实机走查；移动端兜底历史/对账未做（两端默认值待统一）。
- 突变保护：大小骤降分支未接线；可疑篇每轮重复 warning/归档（建议 (id,hash) 去重）。
- Markdown 导入：真实 md（图片/表格/脚注/超大文件）桌面冒烟未做；移动端系统分享 .md 冷/热启动、多文件、首次未设默认笔记本、失败回滚未真机验收。
- 批量导出：真实目录导出（画板 PDF 已打开/未打开两态、ink 多页、同名冲突、取消选目录）未真机冒烟；board 离屏快照在真机/低内存设备未验。
- 移动端键盘稳定：标签弹窗/批量打标签/搜索/新建/默认笔记本在真机软键盘下未逐屏验收（当前为 jsdom 与 hook 单测）。
- 移动端「两次返回退出」仅 adb keyevent 冒烟（已验两次返回回桌面），未在真实按键节奏/快速连按下复验。
- 批量多选：桌面 Shift 区间跨大量节点（>500 上限提示、混选笔记本跳过）与移动端长按/滚动手势共存未真机走查。

## 9. 安全与分发面已裁决（261112 收编自原 `audit-261027/02`；**勿重提**）

> 口径（用户 261029 定）：**不为无法出现的场景写防御代码** —— 判断 = ①威胁在本产品真实使用里能不能出现 → ②出现后现有防线能不能兜住 → ③成本与收益是否成比例。
> **要保住的正面资产**（重构时不得削掉）：IPC 来源双重判定（webContents 白名单 + 页面 URL）、路径段校验下沉到路径构造本身（全走 `bodyPathFor`）、SSRF 连接层钉死（DNS rebinding 已修）、prod CSP 的 `script-src` 无 `unsafe-inline/eval`、桌面 S3/AI Key `safeStorage` fail-closed、移动 Keystore AES-256-GCM、云端不可信 filename 三层校验。

| 事项 | 结论 | 依据（为什么不做） |
| --- | --- | --- |
| 资产服务 token 只对带 Origin 的请求生效（SEC-04） | 不做 | 桌面：同机进程要读附件直接读数据目录即可，token 只挡网页；Android：其它 App 需先知道 UUID + 文件名（服务端无目录枚举、路径段已校验），而能读 App 数据的路子本来绕开这层 |
| session 权限收敛（SEC-06） | 不做（「全拒」有害） | 我们**依赖默认放行**的 `navigator.clipboard.readText()`（S3 配置从剪贴板导入、粘贴导入）；相机/麦克风/定位/通知全仓 0 调用方 |
| Android 全局 cleartext / MIXED_CONTENT_ALWAYS_ALLOW（SEC-08） | 不做（只修注释） | 页面 scheme 是 `http://localhost`（Capacitor 特意如此，否则音视频本地资源被混合内容拒）；出网面被 CSP 限死，全局 cleartext 无可达目标 |
| WebView JS 桥全生命周期可用 + `data:/blob:` 导航（SEC-09） | 不做 | 前提是「WebView 里跑起非本应用脚本」：CSP `script-src 'self'`+hash、`object-src 'none'`、外链交系统浏览器 ⇒ 当前无触发路径；HTML 附件已按「外部浏览器打开」落地 |
| PDF 走 PDFium（SEC-11） | 接受并登记 | 内联预览是用户真实在用功能；PDFium 修复随 Electron 升级带走，渲染进程 sandbox 限制后果 |
| 固定派生密钥进 APK（SEC-13b） | 不做 | 真机路径不可达（`keystoreAvailable()` 恒真）；能读 WebView localStorage 的人本来就能读明文 SQLite/正文 |
| 日志 redact token（SEC-13e） | 不做 | 日志里只有每次启动随机、仅本机当次有效的资产 token；S3 secret / AI key 从不进日志 |
| 只回 keyTail 末 4 位（SEC-13c） | 保留（有意） | 识别「我配的是哪把钥匙」；不是安全收益问题 |

**已做（不重复立项）**：SEC-01（AI 连通测试/拉模型不得复用已存 Key 打渲染层指定的任意 baseUrl）、SEC-02（`save_s3_settings` 的目标校验）、SEC-03 的产物口径（Android release keystore 签名已落地；桌面/Windows 不签名不公证 = 用户既定）、SEC-12（CI action 全钉不可变 commit SHA）、浏览器端 P0 安全收口（SSE 鉴权、`/__native.js` 去 token、`/api` 与 `/__events` 统一鉴权、`GET /download` 白名单）。

**已定不做、勿重提**（出处见 AGENTS §3/§4、`docs/RELEASE.md`、`NOTICE`）：
- `LLN1.` 迁移码用固定种子，仅防误读、**不是安全边界**（怀疑泄露就轮换 S3 密钥）；
- macOS 不签名/不公证、Windows 不签名；
- 闭源 Lakex 内核以 vendored 形式随仓库分发、未取得授权（见 `NOTICE`）；
- 移动端 S3 密钥必须可被 JS 读出（签名在 JS），Keystore 只保静态。

**浏览器端去留（用户 261028 裁决：保留）**：仅桌面端提供（浏览器里分屏读笔记），只服务本机 `127.0.0.1:19880`、**不做伺服/局域网开放**；分屏交给浏览器自身，**不做**深链路由/多窗口会话/窗口间独立标签；移动端不做浏览器端。开关不落盘（每次启动默认关）。

## 10. 正文层不变量与单一判据（261112 收编自原 `audit-261027/09`；与 §1/§2 同一契约）

1. **I-RO（读路径不得产生写）**：打开文档不得因序列化/规范化差异写盘、标脏或触发同步 —— 与 I0「云端胜出不得删除本地」同构，都是「某个非用户动作不得产生副作用」。单一判据 = `src/core/docBaseline.ts`；宿主（桌面 usheet / board / ink、移动 usheet）只做 IO。护栏：`usheetOpenReadOnly.test.ts`、`src/features/ink/inkOpenReadOnly.test.ts`、`src/features/board/boardOpenReadOnly.test.ts`。
2. **坏正文 = 单一判据**：`src/core/docBodySafety.ts` 覆盖 usheet / board / ink / bitable 四族；非空但解析失败 ⇒ **只读 + 横幅 + 禁止保存**，绝不把坏内容当空文档写回（§1 原则 3 的落点）。
3. **幂等只对「本端写出的规范正文」成立**：规范化会改写非规范正文（ink 补 `activePageId`、board 丢未知键、bitable 补 `createdAt`）⇒ **读路径必须保真、写路径必须规范**；「打开后直接关闭」不得产生一次 contentHash 变化（即 I-RO）。
4. **跨端同字节**：桌面写盘前 `applyFontPolicy`（读 `getComputedStyle`），移动端不 normalize / 不 applyFontPolicy ⇒ 同一表格两端各存一次会互判「有编辑」。**已知缺口，登记不修**（要动移动端 Univer 实例层，收益只有「少一次假编辑」）。
5. **正向样本不要拆**：多维表条件求值单一来源（`applyViewToRecords` / `evaluateFilterNode` / `buildBitableFillProjection`，AGENTS §3#19）已做到 grep 无第二套 —— 改多维表时不得绕过。
