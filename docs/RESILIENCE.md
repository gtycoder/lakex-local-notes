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
